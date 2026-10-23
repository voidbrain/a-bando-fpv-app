/**
 * Building blocks: reusable, parametric templates (a building, a structure, a group of things, a façade / column pattern).
 * Placing one writes ORDINARY spec elements, each tagged with a {@link BlockRef} so the library can offer an update or a
 * detach later; nothing at render time depends on the block. New things without app code are made of primitive shapes
 * (box, cylinder, extrusion, array): one generic structure kind, 'shapes'. Pure and tested; every number is clamped
 * because blocks come from files, the online catalogue and AI output.
 */
import { applyStore, setColumnRows, setFacade, type FacadePattern } from './modules';
import { wallsOf } from './openings';
import { expandShapes, sanitizeShapes, shapesHeight, type ShapeSpec } from './shapes';
import { sanitizeSpec, uid, type BuildingSpec, type SiteSpec, type StructureSpec, type TreeSpec, type Vec2, type WallSpec } from './site-spec';

export type ParamValue = number | boolean | string;

export interface BlockParam {
  key: string;
  label: string;
  type: 'number' | 'int' | 'bool' | 'choice';
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  /** Choices for type 'choice'. */
  options?: string[];
}

export type { Prim, ShapeSpec, Vec3 } from './shapes';

/** A number that may come from a parameter: `{ "$": "floors", "mul": 3.2, "add": 0 }` = floors × 3.2 + 0. */
export type ParamRef = { $: string; mul?: number; add?: number };

export interface PatternContent {
  facade?: { pattern: FacadePattern; bay: number; side?: 'all' | 'n' | 's' | 'e' | 'w' };
  columns?: { rows: number; step: number; inset: number };
  store?: { bay: number; step: number; rows: number; inset: number };
}

export interface BlockContent {
  buildings?: BuildingSpec[];
  structures?: StructureSpec[];
  walls?: WallSpec[];
  trees?: TreeSpec[];
  /** Shorthand: the block is one 'shapes' structure made of these primitives. */
  shapes?: ShapeSpec[];
  /** Pattern blocks apply to the selected building's floor instead of placing things. */
  pattern?: PatternContent;
}

export type BlockKind = 'building' | 'structure' | 'group' | 'pattern';
export type Licence = 'CC-BY-4.0' | 'CC0' | 'ODbL';

export interface BlockSpec {
  schema: 1;
  /** Stable id, `namespace/name` ("abando/water-tower"); a pilot's own copy is `local/...`. */
  id: string;
  version: number;
  name: string;
  kind: BlockKind;
  tags: string[];
  author: string;
  licence: Licence;
  description?: string;
  /** A picture: a tool-icon key (`icon:silo`) or a data URI. */
  thumbnail?: string;
  params: BlockParam[];
  /** Content in block-local metres around the insertion point; numbers may be {@link ParamRef}s. */
  content: BlockContent;
}

/** What a placed element remembers about the block it came from. */
export interface BlockRef {
  id: string;
  v: number;
  /** One placement: every element written by it shares this id (update / detach work on the whole group). */
  inst: string;
  params: Record<string, ParamValue>;
  at: Vec2;
  rot: number;
}

// ---- limits (a broken or hostile block must not freeze the app) --------------------------------------

const MAX_JSON = 200_000;
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
const KINDS: readonly BlockKind[] = ['building', 'structure', 'group', 'pattern'];
const LICENCES: readonly Licence[] = ['CC-BY-4.0', 'CC0', 'ODbL'];

/** A block id: `namespace/name`, lowercase letters, digits and dashes. */
export const isBlockId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]{1,32}\/[a-z0-9-]{1,64}$/.test(v);

// ---- checking -------------------------------------------------------------------------------------------

function sanitizeParam(p: unknown): BlockParam | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Partial<BlockParam>;
  if (typeof o.key !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,23}$/.test(o.key)) return null;
  const type = o.type === 'int' || o.type === 'bool' || o.type === 'choice' ? o.type : 'number';
  const label = typeof o.label === 'string' ? o.label.slice(0, 40) : o.key;
  if (type === 'bool') return { key: o.key, label, type, default: !!o.default };
  if (type === 'choice') {
    const options = (Array.isArray(o.options) ? o.options : []).filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 24)).slice(0, 12);
    if (!options.length) return null;
    return { key: o.key, label, type, options, default: options.includes(o.default as string) ? (o.default as string) : options[0]! };
  }
  const min = isNum(o.min) ? clamp(o.min, -1000, 1000) : 0;
  const max = isNum(o.max) ? clamp(o.max, min, 1000) : Math.max(min, 100);
  const d = clamp(isNum(o.default) ? o.default : min, min, max);
  return { key: o.key, label, type, min, max, default: type === 'int' ? Math.round(d) : d, ...(isNum(o.step) && o.step > 0 ? { step: o.step } : {}) };
}

/**
 * The raw content may hold numbers, strings, booleans, arrays, objects and parameter references to declared keys only.
 * Returns null for anything else (functions, unknown references, too deep).
 */
function checkContent(v: unknown, keys: ReadonlySet<string>, depth = 0): boolean {
  if (depth > 12) return false;
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return isFinite(v);
  if (Array.isArray(v)) return v.length <= 2000 && v.every((x) => checkContent(x, keys, depth + 1));
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('$' in o) return typeof o['$'] === 'string' && keys.has(o['$']) && (o['mul'] === undefined || isNum(o['mul'])) && (o['add'] === undefined || isNum(o['add']));
    return Object.values(o).every((x) => checkContent(x, keys, depth + 1));
  }
  return false;
}

/** Keep a block only when it is well formed and, placed with its default values, makes something (or is a pattern). */
export function sanitizeBlock(raw: unknown): BlockSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Partial<BlockSpec>;
  if (!isBlockId(b.id) || typeof b.name !== 'string' || !b.content || typeof b.content !== 'object') return null;
  if (JSON.stringify(b.content).length > MAX_JSON) return null;
  const params = (Array.isArray(b.params) ? b.params : []).map(sanitizeParam).filter((p): p is BlockParam => !!p).slice(0, 12);
  const keys = new Set(params.map((p) => p.key));
  if (keys.size !== params.length || !checkContent(b.content, keys)) return null;
  const kind = KINDS.includes(b.kind as BlockKind) ? (b.kind as BlockKind) : 'group';
  const out: BlockSpec = {
    schema: 1,
    id: b.id,
    version: isNum(b.version) ? Math.max(1, Math.round(b.version)) : 1,
    name: b.name.slice(0, 60),
    kind,
    tags: (Array.isArray(b.tags) ? b.tags : []).filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase().slice(0, 24)).slice(0, 12),
    author: typeof b.author === 'string' ? b.author.slice(0, 60) : 'unknown',
    licence: LICENCES.includes(b.licence as Licence) ? (b.licence as Licence) : 'CC-BY-4.0',
    ...(typeof b.description === 'string' ? { description: b.description.slice(0, 400) } : {}),
    ...(typeof b.thumbnail === 'string' && (/^icon:[a-zA-Z]{1,32}$/.test(b.thumbnail) || (b.thumbnail.startsWith('data:image/') && b.thumbnail.length < 60_000)) ? { thumbnail: b.thumbnail } : {}),
    params,
    content: b.content as BlockContent,
  };
  // it must make something with its own defaults
  if (kind === 'pattern') return out.content.pattern ? out : null;
  const probe = emptyProbe();
  return placeBlock(probe, out, {}, { x: 0, z: 0 }, 0).placed > 0 ? out : null;
}

const emptyProbe = (): SiteSpec => ({ version: 1, id: 'probe', name: '', createdAt: 0, origin: { lat: 0, lon: 0 }, bearingDeg: 0, genScale: 1, groundColor: '#789b52', buildings: [], pads: [], trees: [], seed: 7, extent: 200, droneStart: { x: 0, z: 0 }, calibCorners: { p1: { x: 0, z: 0 }, p2: { x: 0, z: 0 } } });

// ---- parameters -----------------------------------------------------------------------------------------

/** The value of every parameter: the given one when valid (clamped / rounded / one of the options), else the default. */
export function paramValues(block: BlockSpec, given: Readonly<Record<string, ParamValue>> = {}): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of block.params) {
    const v = given[p.key];
    if (p.type === 'bool') out[p.key] = typeof v === 'boolean' ? v : !!p.default;
    else if (p.type === 'choice') out[p.key] = typeof v === 'string' && p.options!.includes(v) ? v : p.default;
    else {
      const n = isNum(v) ? clamp(v, p.min ?? -1000, p.max ?? 1000) : (p.default as number);
      out[p.key] = p.type === 'int' ? Math.round(n) : n;
    }
  }
  return out;
}

/** The content with every parameter reference replaced by its value (a deep copy). */
export function resolveParams<T>(v: T, values: Readonly<Record<string, ParamValue>>): T {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if (typeof o['$'] === 'string') {
        const val = values[o['$']];
        if (typeof val !== 'number') return val;
        return val * (isNum(o['mul']) ? o['mul'] : 1) + (isNum(o['add']) ? o['add'] : 0);
      }
      return Object.fromEntries(Object.entries(o).map(([k, y]) => [k, walk(y)]));
    }
    return x;
  };
  return walk(v) as T;
}

// ---- placing ---------------------------------------------------------------------------------------------

/**
 * Place a block in a spec at `at`, turned `rotDeg`: its buildings, structures, walls and trees are written as ordinary
 * elements (checked like a stored spec), each tagged with one {@link BlockRef}. Returns how many were placed and the
 * placement id. Pattern blocks place nothing here (see {@link applyPattern}).
 */
export function placeBlock(spec: SiteSpec, block: BlockSpec, given: Readonly<Record<string, ParamValue>>, at: Vec2, rotDeg: number, inst = uid('blk')): { placed: number; inst: string } {
  const values = paramValues(block, given);
  const c = resolveParams(block.content, values);
  const ref: BlockRef = { id: block.id, v: block.version, inst, params: values, at: { ...at }, rot: rotDeg };
  const a = (rotDeg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
  const P = (p: Vec2): Vec2 => ({ x: at.x + p.x * cs - p.z * sn, z: at.z + p.x * sn + p.z * cs });
  const structures: StructureSpec[] = [...(Array.isArray(c.structures) ? c.structures : [])];
  const shapes = sanitizeShapes(c.shapes);
  if (shapes.length) structures.push({ id: '', kind: 'shapes', name: block.name, x: 0, z: 0, rotDeg: 0, height: shapesHeight(expandShapes(shapes)), size: 1, shapes });
  // check everything like a stored spec, then move it into place
  const checked = sanitizeSpec({ ...emptyProbe(), buildings: Array.isArray(c.buildings) ? c.buildings : [], structures, walls: Array.isArray(c.walls) ? c.walls : [], trees: Array.isArray(c.trees) ? c.trees : [] });
  if (!checked) return { placed: 0, inst };
  let placed = 0;
  for (const b of checked.buildings.slice(0, 40)) {
    spec.buildings.push({ ...b, id: uid('b'), pos: P(b.pos), rotDeg: (((b.rotDeg + rotDeg) % 360) + 360) % 360, block: ref });
    placed++;
  }
  for (const st of (checked.structures ?? []).slice(0, 40)) {
    (spec.structures ??= []).push({ ...st, id: uid('st'), ...P(st), rotDeg: (((st.rotDeg + rotDeg) % 360) + 360) % 360, block: ref });
    placed++;
  }
  for (const w of (checked.walls ?? []).slice(0, 80)) {
    (spec.walls ??= []).push({ ...w, a: P(w.a), b: P(w.b), block: ref });
    placed++;
  }
  for (const t of checked.trees.slice(0, 200)) {
    spec.trees.push({ ...t, ...P(t), block: ref });
    placed++;
  }
  return { placed, inst };
}

/** Apply a pattern block to one floor of a building (façade bays, column rows, the store preset). Returns what it did. */
export function applyPattern(b: BuildingSpec, li: number, block: BlockSpec, given: Readonly<Record<string, ParamValue>> = {}): string[] {
  const pat = resolveParams(block.content.pattern, paramValues(block, given));
  if (!pat) return [];
  const done: string[] = [];
  const n = (v: unknown, d: number, lo: number, hi: number): number => (isNum(v) ? clamp(v, lo, hi) : d);
  if (pat.store) {
    const step = n(pat.store.step, 0, 0, 40); // 0 = a column on every third pier
    applyStore(b, li, { bay: n(pat.store.bay, 5, 2, 20), ...(step >= 2 ? { step } : {}), rows: Math.round(n(pat.store.rows, 4, 1, 8)), inset: n(pat.store.inset, 4, 1, 30) });
    done.push('store shell');
  }
  if (pat.facade && ['doors', 'panels', 'store'].includes(pat.facade.pattern)) {
    let bays = 0;
    for (const w of wallsOf(b)) if (!pat.facade.side || pat.facade.side === 'all' || w.key === pat.facade.side) bays += setFacade(b, li, w, pat.facade.pattern, { bay: n(pat.facade.bay, 5, 2, 20) });
    done.push(`${bays} façade bays`);
  }
  if (pat.columns) done.push(`${setColumnRows(b, li, { rows: Math.round(n(pat.columns.rows, 4, 1, 8)), step: n(pat.columns.step, 10, 2, 40), inset: n(pat.columns.inset, 4, 1, 30) })} columns`);
  return done;
}

// ---- placed instances: updates and detaching ------------------------------------------------------------

/** Every placement of a block in a spec: its reference and how many elements it wrote. */
export function blockInstances(spec: SiteSpec): { ref: BlockRef; count: number }[] {
  const m = new Map<string, { ref: BlockRef; count: number }>();
  const see = (r: BlockRef | undefined): void => {
    if (!r) return;
    const e = m.get(r.inst);
    if (e) e.count++;
    else m.set(r.inst, { ref: r, count: 1 });
  };
  spec.buildings.forEach((b) => see(b.block));
  (spec.structures ?? []).forEach((s) => see(s.block));
  (spec.walls ?? []).forEach((w) => see(w.block));
  spec.trees.forEach((t) => see(t.block));
  return [...m.values()];
}

/** Placements whose block has a newer version in `latest` (block id → version). */
export function outdated(spec: SiteSpec, latest: ReadonlyMap<string, number>): { ref: BlockRef; count: number; latest: number }[] {
  return blockInstances(spec).flatMap((i) => {
    const v = latest.get(i.ref.id);
    return v !== undefined && v > i.ref.v ? [{ ...i, latest: v }] : [];
  });
}

/** Remove every element of one placement. */
export function removeInstance(spec: SiteSpec, inst: string): void {
  const keep = <T extends { block?: BlockRef }>(l: T[]): T[] => l.filter((x) => x.block?.inst !== inst);
  spec.buildings = keep(spec.buildings);
  spec.structures = keep(spec.structures ?? []);
  spec.walls = keep(spec.walls ?? []);
  spec.trees = keep(spec.trees);
}

/** Replace a placement by the given (newer) version of its block, same place, turn and parameter values. */
export function updateInstance(spec: SiteSpec, inst: string, block: BlockSpec): boolean {
  const i = blockInstances(spec).find((x) => x.ref.inst === inst);
  if (!i || i.ref.id !== block.id) return false;
  removeInstance(spec, inst);
  return placeBlock(spec, block, i.ref.params, i.ref.at, i.ref.rot, inst).placed > 0;
}

/** Keep the elements of a placement but forget the block (they become ordinary hand-made elements). */
export function detachInstance(spec: SiteSpec, inst: string): void {
  const drop = <T extends { block?: BlockRef }>(l: readonly T[]): void => l.forEach((x) => x.block?.inst === inst && delete x.block);
  drop(spec.buildings);
  drop(spec.structures ?? []);
  drop(spec.walls ?? []);
  drop(spec.trees);
}

/** A pilot's own editable copy of a catalogue block: `local/<name>`, version 1, never overwritten by a sync. */
export function forkBlock(b: BlockSpec, author: string): BlockSpec {
  const name = b.id.split('/')[1] ?? 'block';
  return { ...structuredClone(b), id: `local/${name}`.slice(0, 97), version: 1, author, tags: [...b.tags.filter((t) => t !== 'catalogue'), 'fork'] };
}

/**
 * A new block of the pilot's own from elements of a bando (a selected building, structures ...): their positions are
 * stored around `anchor` and turned back by `rotDeg`, ids and block tags dropped, so it can be placed anywhere.
 */
export function blockFrom(name: string, author: string, els: { buildings?: readonly BuildingSpec[]; structures?: readonly StructureSpec[] }, anchor: Vec2, rotDeg = 0): BlockSpec | null {
  const a = (-rotDeg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
  const L = (p: Vec2): Vec2 => {
    const dx = p.x - anchor.x, dz = p.z - anchor.z;
    return { x: Math.round((dx * cs - dz * sn) * 100) / 100, z: Math.round((dx * sn + dz * cs) * 100) / 100 };
  };
  const turn = (d: number): number => (((d - rotDeg) % 360) + 360) % 360;
  const buildings = (els.buildings ?? []).map(({ block: _b, ...b }) => ({ ...structuredClone(b), id: 'b', pos: L(b.pos), rotDeg: turn(b.rotDeg) }));
  const structures = (els.structures ?? []).map(({ block: _b, ...s }) => ({ ...structuredClone(s), id: 's', ...L(s), rotDeg: turn(s.rotDeg) }));
  const kind: BlockKind = buildings.length + structures.length > 1 ? 'group' : buildings.length ? 'building' : 'structure';
  const id = `local/${name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'block'}`;
  return sanitizeBlock({ schema: 1, id, version: 1, name, kind, tags: ['mine'], author, licence: 'CC-BY-4.0', thumbnail: kind === 'building' ? 'icon:building' : 'icon:blocks', params: [], content: { buildings, structures } });
}
