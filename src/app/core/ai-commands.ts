import { addFloor } from './building-ops';
import { contains, type Rect } from './footprint';
import { addOpening, listOpenings, outlineOf, patchOpening, removeOpening, reshapeBuilding, wallsOf } from './openings';
import type { BuildingSpec, SiteSpec } from './site-spec';

/**
 * The only things the assistant can do. A language model never writes geometry: it picks commands from this fixed
 * list (checked and clamped here), the app turns them into edits with the same helpers the mouse tools use, and the
 * whole batch is one undo step. Directions are compass directions (north = up the map), distances are metres,
 * positions along a wall / building are fractions 0..1.
 */
export const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'] as const;
export type Compass = (typeof COMPASS)[number];

export const OPS = [
  'add_door', 'add_window', 'remove_openings',
  'split_rooms', 'add_partition', 'clear_partitions',
  'add_floor', 'set_wall_height', 'set_roof',
  'cut_notch', 'add_wing',
  'rename', 'rotate', 'move', 'resize',
] as const;
export type AiOp = (typeof OPS)[number];

export interface AiCommand {
  op: AiOp;
  /** Building name (or part of it). Default: the selected building, or the only one. */
  building?: string;
  /** Floor, 1 = ground floor. Default 1. */
  level?: number;
  side?: Compass;
  /** Position along the wall / side, 0..1 (0 = west or north end). Default 0.5. */
  position?: number;
  width?: number;
  height?: number;
  sill?: number;
  count?: number;
  axis?: 'length' | 'width';
  /** Leave a door gap in new interior walls. */
  doors?: boolean;
  x0?: number;
  z0?: number;
  x1?: number;
  z1?: number;
  size?: number;
  depth?: number;
  length?: number;
  value?: number;
  name?: string;
  roof?: 'gable' | 'flat' | 'vault';
  /** set_roof: turn the roof a quarter, and repeat the module `count` times (3 gables ...). */
  turn?: boolean;
  degrees?: number;
  east?: number;
  north?: number;
}

export interface RunResult {
  done: string[];
  errors: string[];
  changed: boolean;
}

const DIR: Record<Compass, [number, number]> = {
  north: [0, -1], northeast: [0.7071, -0.7071], east: [1, 0], southeast: [0.7071, 0.7071],
  south: [0, 1], southwest: [-0.7071, 0.7071], west: [-1, 0], northwest: [-0.7071, -0.7071],
};
const num = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const r1 = (v: number): number => Math.round(v * 10) / 10;

/** Turn untrusted model output into clean commands: unknown ops and non-numeric fields are dropped, numbers clamped. */
export function normalizeCommands(raw: unknown): { cmds: AiCommand[]; errors: string[] } {
  const errors: string[] = [];
  const cmds: AiCommand[] = [];
  if (!Array.isArray(raw)) return { cmds, errors: ['no command list'] };
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const op = o['op'];
    if (typeof op !== 'string' || !(OPS as readonly string[]).includes(op)) {
      errors.push(`unknown command “${String(op)}”`);
      continue;
    }
    const c: AiCommand = { op: op as AiOp };
    if (typeof o['building'] === 'string' && o['building'].trim()) c.building = o['building'].trim().slice(0, 60);
    if (typeof o['name'] === 'string' && o['name'].trim()) c.name = o['name'].trim().slice(0, 60);
    if (typeof o['side'] === 'string' && (COMPASS as readonly string[]).includes(o['side'].toLowerCase())) c.side = o['side'].toLowerCase() as Compass;
    if (o['axis'] === 'length' || o['axis'] === 'width') c.axis = o['axis'];
    if (o['roof'] === 'gable' || o['roof'] === 'flat' || o['roof'] === 'vault') c.roof = o['roof'];
    if (typeof o['doors'] === 'boolean') c.doors = o['doors'];
    if (typeof o['turn'] === 'boolean') c.turn = o['turn'];
    const level = num(o['level']);
    if (level !== undefined) c.level = clamp(Math.round(level), 1, 20);
    const count = num(o['count']);
    if (count !== undefined) c.count = clamp(Math.round(count), 1, 12);
    for (const k of ['position', 'x0', 'z0', 'x1', 'z1'] as const) {
      const v = num(o[k]);
      if (v !== undefined) c[k] = clamp(v, 0, 1);
    }
    for (const [k, lo, hi] of [['width', 0.4, 20], ['height', 0.3, 6], ['sill', 0, 5], ['size', 0.5, 200], ['depth', 0.5, 200], ['length', 2, 400], ['value', 1, 30]] as const) {
      const v = num(o[k]);
      if (v !== undefined) c[k] = clamp(v, lo, hi);
    }
    for (const [k, lo, hi] of [['degrees', -360, 360], ['east', -500, 500], ['north', -500, 500]] as const) {
      const v = num(o[k]);
      if (v !== undefined) c[k] = clamp(v, lo, hi);
    }
    cmds.push(c);
  }
  return { cmds, errors };
}

/** Which of the building's four local sides faces the compass direction (accounting for its rotation)? */
function localSide(b: BuildingSpec, dir: Compass): 'n' | 's' | 'e' | 'w' {
  const a = (b.rotDeg * Math.PI) / 180;
  const d = DIR[dir];
  let best: 'n' | 's' | 'e' | 'w' = 'n', bd = -2;
  for (const [s, nx, nz] of [['n', 0, -1], ['s', 0, 1], ['w', -1, 0], ['e', 1, 0]] as const) {
    const wx = nx * Math.cos(a) - nz * Math.sin(a), wz = nx * Math.sin(a) + nz * Math.cos(a);
    const dot = wx * d[0] + wz * d[1];
    if (dot > bd) { bd = dot; best = s; }
  }
  return best;
}

/** The building's bounding-box corner (local signs) closest to a diagonal compass direction. */
function localCorner(b: BuildingSpec, dir: Compass): [number, number] {
  const a = (b.rotDeg * Math.PI) / 180;
  const d = DIR[dir];
  let best: [number, number] = [-1, -1], bd = -9;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const wx = sx * Math.cos(a) - sz * Math.sin(a), wz = sx * Math.sin(a) + sz * Math.cos(a);
    const dot = wx * d[0] + wz * d[1];
    if (dot > bd) { bd = dot; best = [sx, sz]; }
  }
  return best;
}

/** The wall (polygon edge for shaped buildings) whose outside faces `dir`; ties go to the longest wall. */
function wallFacing(b: BuildingSpec, dir: Compass): ReturnType<typeof wallsOf>[number] | null {
  const a = (b.rotDeg * Math.PI) / 180;
  const d = DIR[dir];
  const poly = outlineOf(b);
  let best: ReturnType<typeof wallsOf>[number] | null = null;
  let score = -Infinity;
  for (const w of wallsOf(b)) {
    const mid = w.axis === 'x' ? { x: (w.from + w.to) / 2, z: w.at } : { x: w.at, z: (w.from + w.to) / 2 };
    const probe = contains(poly, mid.x + (w.axis === 'z' ? 0.05 : 0), mid.z + (w.axis === 'x' ? 0.05 : 0));
    const sign = probe ? -1 : 1; // outward = away from the inside
    const nx = w.axis === 'z' ? sign : 0, nz = w.axis === 'x' ? sign : 0;
    const wx = nx * Math.cos(a) - nz * Math.sin(a), wz = nx * Math.sin(a) + nz * Math.cos(a);
    const dot = wx * d[0] + wz * d[1];
    const s = dot * 1000 + (w.to - w.from);
    if (dot > 0.5 && s > score) { score = s; best = w; }
  }
  return best;
}

function findBuilding(spec: SiteSpec, name: string | undefined, selectedId: string): BuildingSpec | string {
  const all = spec.buildings;
  if (name) {
    const q = name.toLowerCase();
    const exact = all.filter((x) => x.name.toLowerCase() === q);
    const part = exact.length ? exact : all.filter((x) => x.name.toLowerCase().includes(q));
    if (part.length === 1) return part[0]!;
    if (part.length > 1) return `several buildings match “${name}”`;
    const sel = all.find((x) => x.id === selectedId);
    if (sel) return sel; // an unknown name while one is selected: assume the selected one
    return `no building called “${name}”`;
  }
  const sel = all.find((x) => x.id === selectedId);
  if (sel) return sel;
  if (all.length === 1) return all[0]!;
  return 'select a building first (or name it)';
}

/** Run a batch on `spec` (mutated in place: pass a draft clone). */
export function runCommands(spec: SiteSpec, cmds: AiCommand[], selectedId: string): RunResult {
  const res: RunResult = { done: [], errors: [], changed: false };
  for (const c of cmds) {
    const found = findBuilding(spec, c.building, selectedId);
    if (typeof found === 'string') {
      res.errors.push(`${c.op}: ${found}`);
      continue;
    }
    const b = found;
    const li = clamp((c.level ?? 1) - 1, 0, b.levels.length - 1);
    const lev = b.levels[li]!;
    const label = `“${b.name}”`;
    if (b.frame) {
      res.errors.push(`${c.op}: ${label} is a greenhouse frame and cannot be edited this way`);
      continue;
    }
    const ok = (msg: string): void => {
      res.done.push(msg);
      res.changed = true;
    };
    switch (c.op) {
      case 'add_door':
      case 'add_window': {
        const kind = c.op === 'add_door' ? 'door' : 'window';
        if (!c.side || !(['north', 'south', 'east', 'west'] as string[]).includes(c.side)) {
          res.errors.push(`${c.op}: say which wall (north, south, east or west)`);
          break;
        }
        const w = wallFacing(b, c.side);
        if (!w) {
          res.errors.push(`${c.op}: ${label} has no ${c.side} wall`);
          break;
        }
        const pos = c.position ?? 0.5;
        const at = w.from + pos * (w.to - w.from);
        const p = w.axis === 'x' ? { x: at, z: w.at } : { x: w.at, z: at };
        const id = addOpening(b, li, p, kind, 1);
        if (!id) {
          res.errors.push(`${c.op}: the ${c.side} wall of ${label} is too short`);
          break;
        }
        patchOpening(b, li, id, { w: c.width, h: c.height, sill: kind === 'window' ? c.sill : undefined });
        ok(`${kind} on the ${c.side} wall of ${label}`);
        break;
      }
      case 'remove_openings': {
        let n = 0;
        for (let g = 0; g < 100; g++) {
          const target = listOpenings(b, li).find((o) => {
            if (c.width !== undefined) return false;
            if (!c.side) return true;
            const w = wallFacing(b, c.side);
            return !!w && w.axis === o.axis && Math.abs(w.at - o.at) < 0.1;
          });
          if (!target) break;
          removeOpening(b, li, target.id);
          n++;
        }
        if (n) ok(`removed ${n} opening(s) from ${label}`);
        else res.errors.push(`remove_openings: nothing to remove in ${label}`);
        break;
      }
      case 'split_rooms': {
        const n = Math.max(2, c.count ?? 2);
        const axis = c.axis ?? (b.length >= b.width ? 'length' : 'width');
        const gap = c.doors === false ? 0 : 1.2;
        lev.partitions = [];
        for (let i = 1; i < n; i++) {
          if (axis === 'length') {
            const x = r1((b.length * i) / n);
            seg(lev.partitions, { x, z: 0 }, { x, z: b.width }, gap);
          } else {
            const z = r1((b.width * i) / n);
            seg(lev.partitions, { x: 0, z }, { x: b.length, z }, gap);
          }
        }
        ok(`${n} rooms in ${label} (floor ${li + 1})${gap ? ', each wall with a door gap' : ''}`);
        break;
      }
      case 'add_partition': {
        if (c.x0 === undefined || c.z0 === undefined || c.x1 === undefined || c.z1 === undefined) {
          res.errors.push('add_partition: needs x0, z0, x1, z1');
          break;
        }
        const ax = r1(c.x0 * b.length), az = r1(c.z0 * b.width), bx = r1(c.x1 * b.length), bz = r1(c.z1 * b.width);
        const horizontal = Math.abs(bx - ax) >= Math.abs(bz - az);
        const a = horizontal ? { x: ax, z: r1((az + bz) / 2) } : { x: r1((ax + bx) / 2), z: az };
        const e = horizontal ? { x: bx, z: a.z } : { x: a.x, z: bz };
        if (Math.hypot(e.x - a.x, e.z - a.z) < 0.5) {
          res.errors.push('add_partition: the wall is too short');
          break;
        }
        seg(lev.partitions, a, e, c.doors ? 1.2 : 0);
        ok(`interior wall in ${label}`);
        break;
      }
      case 'clear_partitions':
        lev.partitions = [];
        ok(`removed the interior walls of ${label} (floor ${li + 1})`);
        break;
      case 'add_floor':
        addFloor(b);
        ok(`added floor ${b.levels.length} to ${label} (a copy of the floor below; the roof moved up)`);
        break;
      case 'set_wall_height': {
        if (c.value === undefined) {
          res.errors.push('set_wall_height: needs a value in metres');
          break;
        }
        const targets = c.level ? [lev] : b.levels;
        let y = 0;
        for (const l of b.levels) {
          if (targets.includes(l)) l.height = c.value;
          l.baseY = y;
          y += l.height;
        }
        ok(`wall height ${c.value} m in ${label}`);
        break;
      }
      case 'set_roof':
        if (!c.roof) res.errors.push('set_roof: needs gable, flat or vault');
        else if (b.footprint) res.errors.push(`set_roof: shaped building ${label} always has a flat roof`);
        else {
          const top = b.levels[b.levels.length - 1]!;
          top.roof = c.roof;
          if (c.turn !== undefined) top.roofTurn = c.turn;
          if (c.count !== undefined) top.roofCount = c.count;
          ok(`${c.count && c.count > 1 ? `${c.count} × ` : ''}${c.roof} roof${top.roofTurn ? ' (turned)' : ''} on ${label}`);
        }
        break;
      case 'cut_notch':
      case 'add_wing': {
        if (!c.side) {
          res.errors.push(`${c.op}: needs a side or corner`);
          break;
        }
        const depth = c.depth ?? Math.min(b.width, b.length) * 0.3;
        const size = c.size ?? Math.max(b.length, b.width) * 0.3;
        let rect: Rect;
        if (['north', 'south', 'east', 'west'].includes(c.side)) {
          const s = localSide(b, c.side);
          const pos = c.position ?? 0.5;
          const run = s === 'n' || s === 's' ? b.length : b.width;
          const mid = -run / 2 + pos * run;
          const lo = clamp(mid - size / 2, -run / 2, run / 2 - 0.5), hi = clamp(lo + size, lo + 0.5, run / 2);
          const out = c.op === 'add_wing' ? depth : 0;
          const inn = c.op === 'cut_notch' ? depth : 0.5;
          rect = s === 'n' ? { x0: lo, x1: hi, z0: -b.width / 2 - out, z1: -b.width / 2 + inn }
            : s === 's' ? { x0: lo, x1: hi, z0: b.width / 2 - inn, z1: b.width / 2 + out }
            : s === 'w' ? { x0: -b.length / 2 - out, x1: -b.length / 2 + inn, z0: lo, z1: hi }
            : { x0: b.length / 2 - inn, x1: b.length / 2 + out, z0: lo, z1: hi };
        } else {
          if (c.op === 'add_wing') {
            res.errors.push('add_wing: choose north, south, east or west');
            break;
          }
          const [sx, sz] = localCorner(b, c.side);
          rect = { x0: sx * b.length / 2, x1: sx * (b.length / 2 - size), z0: sz * b.width / 2, z1: sz * (b.width / 2 - depth) };
        }
        if (reshapeBuilding(b, rect, c.op === 'cut_notch' ? 'cut' : 'add')) ok(`${c.op === 'cut_notch' ? 'cut a notch in' : 'added a wing to'} the ${c.side} of ${label}`);
        else res.errors.push(`${c.op}: that would split ${label} or leave a hole`);
        break;
      }
      case 'rename':
        if (c.name) {
          b.name = c.name;
          ok(`renamed to “${c.name}”`);
        } else res.errors.push('rename: needs a name');
        break;
      case 'rotate':
        if (c.degrees === undefined) res.errors.push('rotate: needs degrees');
        else {
          b.rotDeg = (((b.rotDeg + c.degrees) % 360) + 360) % 360;
          ok(`rotated ${label} by ${c.degrees}°`);
        }
        break;
      case 'move':
        b.pos = { x: b.pos.x + (c.east ?? 0), z: b.pos.z - (c.north ?? 0) };
        ok(`moved ${label} ${c.east ?? 0} m east, ${c.north ?? 0} m north`);
        break;
      case 'resize':
        if (b.footprint) res.errors.push(`resize: ${label} is a shaped building: use cut / add wing`);
        else if (c.length === undefined && c.depth === undefined) res.errors.push('resize: needs length and/or depth');
        else {
          b.length = c.length ?? b.length;
          b.width = c.depth ?? b.width;
          ok(`${label} is now ${b.length} × ${b.width} m`);
        }
        break;
    }
  }
  return res;
}

/** Push a wall (or two halves with a door gap in the middle) onto a level's partition list. */
function seg(out: [{ x: number; z: number }, { x: number; z: number }][], a: { x: number; z: number }, e: { x: number; z: number }, gap: number): void {
  const len = Math.hypot(e.x - a.x, e.z - a.z);
  if (gap <= 0 || len < gap + 2) {
    out.push([a, e]);
    return;
  }
  const t0 = (len / 2 - gap / 2) / len, t1 = (len / 2 + gap / 2) / len;
  const at = (t: number): { x: number; z: number } => ({ x: r1(a.x + (e.x - a.x) * t), z: r1(a.z + (e.z - a.z) * t) });
  out.push([a, at(t0)], [at(t1), e]);
}
