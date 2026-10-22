import { computed, signal } from '@angular/core';
import type { BuildingSpec, LevelSpec, SiteSpec } from '../core/site-spec';
import { cloneSpec, roomsAt, uid } from '../core/site-spec';
import { addFloor, removeFloor } from './building-ops';

/** A room cut by the partition tool: which level and its building-local rectangle. */
export interface RoomInfo {
  level: number;
  rect: { x0: number; z0: number; x1: number; z1: number };
}

const sameRect = (a: RoomInfo['rect'], b: RoomInfo['rect']): boolean => Math.abs(a.x0 - b.x0) < 0.01 && Math.abs(a.z0 - b.z0) < 0.01 && Math.abs(a.x1 - b.x1) < 0.01 && Math.abs(a.z1 - b.z1) < 0.01;

/**
 * The editor draft: a mutable copy of the active spec plus an undo/redo stack. Every committed change goes through
 * {@link commit}, which snapshots the previous state — cheap because specs are small plain objects.
 */
export class SiteEditor {
  readonly draft = signal<SiteSpec>(cloneSpec(EMPTY_SPEC));
  private past: SiteSpec[] = [];
  private future: SiteSpec[] = [];
  /** Currently selected building id ('' = none). */
  readonly selectedId = signal('');
  /** Partition-drawing mode: first corner picked, waiting for the second. */
  readonly partitionFrom = signal<{ x: number; z: number } | null>(null);

  readonly building = computed(() => this.draft().buildings.find((b) => b.id === this.selectedId()) ?? null);
  readonly canUndo = computed(() => this.past.length > 0);
  readonly canRedo = computed(() => this.future.length > 0);

  /** Replace the draft with an external spec (generated, loaded from the library, or imported). Clears history. */
  load(spec: SiteSpec): void {
    this.draft.set(cloneSpec(spec));
    this.past = [];
    this.future = [];
    this.selectedId.set(this.draft().buildings[0]?.id ?? '');
  }

  select(id: string): void {
    this.selectedId.set(id);
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(cloneSpec(this.draft()));
    this.draft.set(prev);
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(cloneSpec(this.draft()));
    this.draft.set(next);
  }

  // ---- building-level edits ----

  addBuilding(preset?: Partial<BuildingSpec>): string {
    const id = uid('bld');
    const b: BuildingSpec = {
      id,
      name: 'New building',
      pos: { x: 0, z: -60 },
      rotDeg: 0,
      length: 20,
      width: 12,
      color: '#d7d0bd',
      levels: [{ baseY: 0, height: 4, sides: { n: true, s: true, e: true, w: true }, doors: {}, partitions: [], roof: 'gable', roofRise: 2.5, roofColor: '#b5683f' }],
      ...preset,
    };
    this.commit((s) => s.buildings.push(b));
    this.selectedId.set(id);
    return id;
  }

  removeBuilding(id: string): void {
    this.commit((s) => {
      s.buildings = s.buildings.filter((b) => b.id !== id);
    });
    if (this.selectedId() === id) this.selectedId.set('');
  }

  duplicateSelected(): void {
    const src = this.building();
    if (!src) return;
    const copy = cloneSpec({ version: 1, id: '', name: '', createdAt: 0, origin: { lat: 0, lon: 0 }, bearingDeg: 0, genScale: 1, groundColor: '', buildings: [src], pads: [], trees: [], seed: 0, extent: 0, droneStart: { x: 0, z: 0 }, calibCorners: { p1: { x: 0, z: 0 }, p2: { x: 0, z: 0 } } }).buildings[0]!;
    copy.id = uid('bld');
    copy.name = `${src.name} copy`;
    copy.pos = { x: src.pos.x + 8, z: src.pos.z + 8 };
    this.commit((s) => s.buildings.push(copy));
    this.selectedId.set(copy.id);
  }

  patchBuilding(patch: Partial<Pick<BuildingSpec, 'name' | 'rotDeg' | 'length' | 'width' | 'color' | 'floorColor'>> & { pos?: BuildingSpec['pos'] }): void {
    this.commit((s) => {
      const b = s.buildings.find((x) => x.id === this.selectedId());
      if (b) Object.assign(b, patch);
    });
  }

  moveSelected(dx: number, dz: number): void {
    this.commit((s) => {
      const b = s.buildings.find((x) => x.id === this.selectedId());
      if (b) {
        b.pos.x += dx;
        b.pos.z += dz;
      }
    });
  }

  // ---- level edits ----

  /** All levels by default (the existing setWall/setRoof/… helpers); pass `li` to edit one level only. */
  editSelectedLevel(fn: (l: LevelSpec, li: number) => void, li?: number): void {
    this.commit((s) => {
      const b = s.buildings.find((x) => x.id === this.selectedId());
      if (!b) return;
      if (li === undefined) b.levels.forEach((l, i) => fn(l, i));
      else if (b.levels[li]) fn(b.levels[li]!, li);
    });
  }

  private editLevel(fn: (b: BuildingSpec, l: LevelSpec, li: number) => void): void {
    this.commit((s) => {
      const b = s.buildings.find((x) => x.id === this.selectedId());
      if (!b) return;
      b.levels.forEach((l, li) => fn(b, l, li));
    });
  }

  setWall(side: 'n' | 's' | 'e' | 'w', on: boolean): void {
    this.editLevel((_b, l) => {
      l.sides[side] = on;
    });
  }

  setRoof(roof: LevelSpec['roof']): void {
    this.editLevel((_b, l) => {
      l.roof = roof;
    });
  }

  setHeight(height: number): void {
    this.editLevel((_b, l) => {
      l.height = Math.max(1, height);
    });
  }

  setRoofRise(rise: number): void {
    this.editLevel((_b, l) => {
      l.roofRise = Math.max(0.2, rise);
    });
  }

  /** Add a floor on top, copied from the last one; the roof moves up (see building-ops). */
  addLevel(): void {
    this.commit((s) => {
      const b = s.buildings.find((x) => x.id === this.selectedId());
      if (b) addFloor(b);
    });
  }

  removeLevel(li: number): void {
    this.commit((s) => {
      const b = s.buildings.find((x) => x.id === this.selectedId());
      if (b) removeFloor(b, li);
    });
  }

  // ---- openings ----

  addOpening(side: 'n' | 's' | 'e' | 'w', kind: 'door' | 'window'): void {
    this.addOpeningAt(side, kind);
  }

  /** Add an opening centred on `side` of one level (default: the ground floor). */
  addOpeningAt(side: 'n' | 's' | 'e' | 'w', kind: 'door' | 'window', level = 0): void {
    this.commit((s) => {
      const b = s.buildings.find((x) => x.id === this.selectedId());
      const l = b?.levels[level];
      if (!b || !l) return;
      const run = side === 'n' || side === 'w' ? b.length : b.width;
      (l.doors[side] ??= []).push({ kind, c: run / 2, w: kind === 'door' ? 2.2 : 1.2, h: kind === 'door' ? Math.min(2.6, l.height * 0.8) : 1 });
    });
  }

  patchOpening(side: 'n' | 's' | 'e' | 'w', index: number, patch: Partial<{ kind: 'door' | 'window'; c: number; w: number; h: number }>): void {
    this.patchOpeningAt(side, undefined, index, patch);
  }

  /** Patch one opening (`level` undefined = every level, as before). */
  patchOpeningAt(side: 'n' | 's' | 'e' | 'w', level: number | undefined, index: number, patch: Partial<{ kind: 'door' | 'window'; c: number; w: number; h: number }>): void {
    this.commit((s) => {
      for (const b of s.buildings) {
        if (b.id !== this.selectedId()) continue;
        for (let li = 0; li < b.levels.length; li++) {
          if (level !== undefined && li !== level) continue;
          const o = b.levels[li]!.doors[side]?.[index];
          if (o) Object.assign(o, patch);
        }
      }
    });
  }

  removeOpening(side: 'n' | 's' | 'e' | 'w', index: number): void {
    this.removeOpeningAt(side, undefined, index);
  }

  /** Remove one opening from one level (`level` undefined = every level, as before). */
  removeOpeningAt(side: 'n' | 's' | 'e' | 'w', level: number | undefined, index: number): void {
    this.commit((s) => {
      const b = s.buildings.find((x) => x.id === this.selectedId());
      if (!b) return;
      for (let li = 0; li < b.levels.length; li++) {
        if (level !== undefined && li !== level) continue;
        b.levels[li]!.doors[side]?.splice(index, 1);
      }
    });
  }

  // ---- interior partitions (the "guess indoor, then edit" tool) ----

  /** Guess a simple interior: cross-shaped partitions splitting the footprint into four rooms. */
  guessInterior(): void {
    this.commit((s) => {
      const b = s.buildings.find((x) => x.id === this.selectedId());
      if (!b) return;
      for (const l of b.levels) {
        if (l.partitions.length) continue;
        l.partitions = [
          [{ x: b.length / 2, z: 0 }, { x: b.length / 2, z: b.width * 0.6 }],
          [{ x: 0, z: b.width * 0.6 }, { x: b.length, z: b.width * 0.6 }],
        ];
      }
    });
  }

  /** Start a partition: remember the first endpoint (in building-local metres). */
  startPartition(x: number, z: number): void {
    this.partitionFrom.set({ x, z });
  }

  finishPartition(x: number, z: number): void {
    const a = this.partitionFrom();
    this.partitionFrom.set(null);
    if (!a) return;
    this.commit((s) => {
      const b = s.buildings.find((x2) => x2.id === this.selectedId());
      if (b) b.levels.forEach((l) => l.partitions.push([a, { x, z }]));
    });
  }

  removePartition(level: number, index: number): void {
    this.commit((s) => {
      const b = s.buildings.find((x) => x.id === this.selectedId());
      b?.levels[level]?.partitions.splice(index, 1);
    });
  }

  /** Rooms of every level of the selected building (for the 2D plan preview). */
  rooms(): RoomInfo[] {
    const b = this.building();
    if (!b) return [];
    const out: RoomInfo[] = [];
    for (let li = 0; li < b.levels.length; li++) {
      // sample the middle cut of each strip: roomsAt returns the cells a horizontal slice passes through
      for (const v of [b.width * 0.25, b.width * 0.5, b.width * 0.75]) {
        for (const r of roomsAt(b, li, v)) {
          if (!out.some((o) => o.level === li && sameRect(o.rect, r))) out.push({ level: li, rect: r });
        }
      }
    }
    return out;
  }

  // ---- site-level ----

  setBearing(deg: number): void {
    this.commit((s) => {
      s.bearingDeg = ((deg % 360) + 360) % 360;
    });
  }

  setName(name: string): void {
    this.commit((s) => {
      s.name = name;
    });
  }

  addTree(x: number, z: number, kind: 'd' | 'c' = 'd'): void {
    this.commit((s) => s.trees.push(kind === 'c' ? { x, z, h: 10, r: 1.6, kind } : { x, z, h: 8, r: 2, kind }));
  }

  removeTree(index: number): void {
    this.commit((s) => s.trees.splice(index, 1));
  }

  /** The draft ready to store / hand to the builder (a detached copy). */
  snapshot(): SiteSpec {
    return cloneSpec(this.draft());
  }

  /** A generic committed draft edit (site-level fields the named helpers don't cover). */
  commitSite(fn: (s: SiteSpec) => void): void {
    this.commit(fn);
  }

  /** Start a continuous edit (a mouse drag): one undo step for the whole gesture. Follow with {@link live} calls. */
  beginGesture(): void {
    this.past.push(cloneSpec(this.draft()));
    if (this.past.length > 60) this.past.shift();
    this.future = [];
  }

  /** Edit the draft without adding an undo step (use between beginGesture() and the end of the drag). */
  live(fn: (s: SiteSpec) => void): void {
    const next = cloneSpec(this.draft());
    fn(next);
    this.draft.set(next);
  }

  private commit(fn: (s: SiteSpec) => void): void {
    this.past.push(cloneSpec(this.draft()));
    if (this.past.length > 60) this.past.shift();
    this.future = [];
    const next = cloneSpec(this.draft());
    fn(next);
    this.draft.set(next);
  }
}

const EMPTY_SPEC: SiteSpec = {
  version: 1,
  id: 'empty',
  name: 'Empty site',
  createdAt: 0,
  origin: { lat: 0, lon: 0 },
  bearingDeg: 0,
  genScale: 1,
  groundColor: '#789b52',
  buildings: [],
  pads: [],
  trees: [],
  seed: 7,
  extent: 300,
  droneStart: { x: 0, z: 0 },
  calibCorners: { p1: { x: -100, z: -100 }, p2: { x: 100, z: 100 } },
};
