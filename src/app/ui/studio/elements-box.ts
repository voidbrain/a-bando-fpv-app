import { Component, computed, input, output, signal } from '@angular/core';
import { columnGroups, stairsIn, treeZones, type Pt } from '../../core/elements';
import { listOpenings, outlineOf } from '../../core/openings';
import type { BuildingSpec, SiteSpec, StructureKind } from '../../core/site-spec';
import { FloatBox } from '../float-box';

/** Where a click in the list should take the editor. */
export interface ElementGo {
  kind: 'building' | 'structure' | 'fence' | 'trees' | 'floor' | 'columns' | 'wall' | 'void' | 'opening';
  /** building id (floor, columns, wall, void, opening) */
  id?: string;
  /** index into structures / walls / partitions / voids; for an opening, see `opening`. */
  index?: number;
  level?: number;
  /** Columns of the floor to select. */
  indices?: number[];
  opening?: string;
  /** Tree zone outline, to show on the map. */
  zone?: Pt[];
  x: number;
  z: number;
  /** About how big it is (metres), so the map can zoom to fit. */
  size: number;
}

const GLYPH: Record<StructureKind, string> = {
  chimney: '🏭', silo: '🛢', tank: '⛽', water_tower: '🗼', lattice_tower: '📡', bridge: '🌉', stairs: '🪜', ramp: '📐',
  tower_crane: '🏗', container: '📦', car: '🚗', truck: '🚚', excavator: '🚜', shapes: '◆',
};

interface BRow { id: string; name: string; levels: number; size: string; points: string; frame: boolean; x: number; z: number; big: number }
interface ColRow { key: string; id: string; li: number; label: string; n: number; idx: number[]; x: number; z: number; size: number }

const levelName = (li: number): string => (li === 0 ? 'G' : `L${li}`);
/** A building-local point (from its min corner) in site coordinates. */
const toSite = (b: BuildingSpec, x: number, z: number): Pt => {
  const a = (b.rotDeg * Math.PI) / 180, lx = x - b.length / 2, lz = z - b.width / 2;
  return { x: b.pos.x + lx * Math.cos(a) - lz * Math.sin(a), z: b.pos.z + lx * Math.sin(a) + lz * Math.cos(a) };
};

/**
 * Everything in the model in one list, with a small outline for each. Two views: by category (buildings, structures, walls,
 * columns grouped per row, trees grouped per zone) or as a tree (building → floor → what is on it). Hovering a tree zone
 * outlines it on the map; "show zones" keeps every zone outlined.
 */
@Component({
  selector: 'app-elements-box',
  imports: [FloatBox],
  template: `
    <app-float-box fid="elements-v3" title="Elements" [x]="54" [y]="8" [w]="290" [h]="400" [minW]="240" [minH]="160">
      <div class="tabs" role="tablist">
        <button role="tab" [class.on]="tab() === 'cat'" (click)="tab.set('cat')">By category</button>
        <button role="tab" [class.on]="tab() === 'tree'" (click)="tab.set('tree')">As a tree</button>
      </div>
      <input type="text" class="q" placeholder="Filter by name…" [value]="q()" (input)="q.set(val($event))" aria-label="Filter elements" />
      <label class="zt"><input type="checkbox" (change)="zones.emit(checked($event))" /> show tree zones on the map</label>
      <div class="scroll">
        @if (tab() === 'cat') {
          <details open>
            <summary><b>Buildings</b><span class="cnt">{{ buildings().length }}</span></summary>
            @for (b of buildings(); track b.id) {
              <button class="row" [class.sel]="b.id === selectedId()" (click)="go.emit({ kind: 'building', id: b.id, x: b.x, z: b.z, size: b.big })">
                <svg viewBox="0 0 40 40" class="th"><polygon [attr.points]="b.points" [attr.fill]="b.frame ? '#9ec1b6' : '#c9c5b8'" stroke="#222" stroke-width="1.5" /></svg>
                <span class="nm">{{ b.name }}</span><span class="dim small">{{ b.size }} · {{ b.levels }} fl</span>
              </button>
            }
          </details>
          @if (structures().length) {
            <details open>
              <summary><b>Structures</b><span class="cnt">{{ structures().length }}</span></summary>
              @for (s of structures(); track s.i) {
                <button class="row" (click)="go.emit({ kind: 'structure', index: s.i, x: s.x, z: s.z, size: s.size })">
                  <span class="th glyph">{{ s.glyph }}</span><span class="nm">{{ s.name }}</span><span class="dim small">{{ s.kind }}</span>
                </button>
              }
            </details>
          }
          @if (fences().length) {
            <details>
              <summary><b>Walls &amp; fences</b><span class="cnt">{{ fences().length }}</span></summary>
              @for (f of fences(); track f.i) {
                <button class="row" (click)="go.emit({ kind: 'fence', index: f.i, x: f.x, z: f.z, size: f.len })">
                  <svg viewBox="0 0 40 40" class="th"><line x1="6" y1="30" x2="34" y2="10" stroke="#c9c5b8" stroke-width="4" stroke-linecap="round" /></svg>
                  <span class="nm">Wall {{ f.i + 1 }}</span><span class="dim small">{{ f.len.toFixed(0) }} m</span>
                </button>
              }
            </details>
          }
          @if (colRows().length) {
            <details>
              <summary><b>Columns</b><span class="cnt">{{ colTotal() }} in {{ colRows().length }} rows</span></summary>
              @for (c of colRows(); track c.key) {
                <button class="row" (click)="goCols(c)">
                  <svg viewBox="0 0 40 40" class="th"><circle cx="9" cy="20" r="3.4" fill="#c9c5b8" /><circle cx="20" cy="20" r="3.4" fill="#c9c5b8" /><circle cx="31" cy="20" r="3.4" fill="#c9c5b8" /></svg>
                  <span class="nm">{{ c.label }}</span><span class="dim small">{{ c.n }}</span>
                </button>
              }
            </details>
          }
          @if (zoneRows().length) {
            <details>
              <summary><b>Trees</b><span class="cnt">{{ treeTotal() }} in {{ zoneRows().length }} zones</span></summary>
              @for (g of zoneRows(); track $index) {
                <button class="row" (mouseenter)="hover.emit(g.hull)" (mouseleave)="hover.emit(null)" (click)="goZone(g)">
                  <svg viewBox="0 0 40 40" class="th">
                    @for (d of g.dots; track $index) {
                      <circle [attr.cx]="d[0]" [attr.cy]="d[1]" r="2.6" fill="#4f9a4a" />
                    }
                  </svg>
                  <span class="nm">Zone {{ $index + 1 }}</span><span class="dim small">{{ g.n }} trees · {{ g.where }}</span>
                </button>
              }
            </details>
          }
        } @else {
          @for (b of buildings(); track b.id) {
            <details [open]="b.id === selectedId() || buildings().length < 4">
              <summary><b>{{ b.name }}</b><span class="cnt">{{ b.levels }} fl</span></summary>
              <button class="row sub" [class.sel]="b.id === selectedId()" (click)="go.emit({ kind: 'building', id: b.id, x: b.x, z: b.z, size: b.big })">
                <svg viewBox="0 0 40 40" class="th"><polygon [attr.points]="b.points" [attr.fill]="b.frame ? '#9ec1b6' : '#c9c5b8'" stroke="#222" stroke-width="1.5" /></svg>
                <span class="nm">the building</span><span class="dim small">{{ b.size }}</span>
              </button>
              @for (f of floorsOf(b.id); track f.li) {
                <details class="ind" [open]="buildings().length < 4">
                  <summary><b>Floor {{ f.name }}</b><button class="mini" (click)="goFloor(b, f.li); $event.preventDefault()" title="Edit this floor">edit</button></summary>
                  @if (f.doors || f.windows) {
                    <button class="row sub" (click)="goFloor(b, f.li)"><span class="th glyph">🚪</span><span class="nm">Doors &amp; windows</span><span class="dim small">{{ f.doors }} · {{ f.windows }}</span></button>
                  }
                  @for (p of f.parts; track p) {
                    <button class="row sub" (click)="goPart('wall', b, f.li, p)"><span class="th glyph">▬</span><span class="nm">Interior wall {{ p + 1 }}</span></button>
                  }
                  @for (v of f.voids; track v) {
                    <button class="row sub" (click)="goPart('void', b, f.li, v)"><span class="th glyph">⬚</span><span class="nm">Void {{ v + 1 }}</span></button>
                  }
                  @for (c of f.cols; track c.key) {
                    <button class="row sub" (click)="goCols(c)"><span class="th glyph">●</span><span class="nm">{{ c.label }}</span><span class="dim small">{{ c.n }}</span></button>
                  }
                  @for (s of f.stairs; track s.i) {
                    <button class="row sub" (click)="go.emit({ kind: 'structure', index: s.i, x: s.x, z: s.z, size: 8 })"><span class="th glyph">{{ s.glyph }}</span><span class="nm">{{ s.name }}</span><span class="dim small">{{ s.kind }}</span></button>
                  }
                </details>
              }
            </details>
          }
          @if (looseStructures().length) {
            <details open>
              <summary><b>Structures</b><span class="cnt">{{ looseStructures().length }}</span></summary>
              @for (s of looseStructures(); track s.i) {
                <button class="row sub" (click)="go.emit({ kind: 'structure', index: s.i, x: s.x, z: s.z, size: s.size })"><span class="th glyph">{{ s.glyph }}</span><span class="nm">{{ s.name }}</span><span class="dim small">{{ s.kind }}</span></button>
              }
            </details>
          }
          @if (fences().length) {
            <details>
              <summary><b>Walls &amp; fences</b><span class="cnt">{{ fences().length }}</span></summary>
              @for (f of fences(); track f.i) {
                <button class="row sub" (click)="go.emit({ kind: 'fence', index: f.i, x: f.x, z: f.z, size: f.len })"><span class="th glyph">▬</span><span class="nm">Wall {{ f.i + 1 }}</span><span class="dim small">{{ f.len.toFixed(0) }} m</span></button>
              }
            </details>
          }
          @if (zoneRows().length) {
            <details>
              <summary><b>Trees</b><span class="cnt">{{ treeTotal() }} in {{ zoneRows().length }} zones</span></summary>
              @for (g of zoneRows(); track $index) {
                <button class="row sub" (mouseenter)="hover.emit(g.hull)" (mouseleave)="hover.emit(null)" (click)="goZone(g)"><span class="th glyph">🌳</span><span class="nm">Zone {{ $index + 1 }}</span><span class="dim small">{{ g.n }} trees</span></button>
              }
            </details>
          }
        }
      </div>
    </app-float-box>
  `,
  styles: `
    .q { width: 100%; box-sizing: border-box; }
    .tabs { display: flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
    .tabs button { flex: 1; background: none; border: 0; padding: 3px 6px; cursor: pointer; color: var(--dim); }
    .tabs button.on { background: var(--accent); color: var(--accent-ink); font-weight: 700; }
    .zt { font-size: 11px; color: var(--dim); display: flex; gap: 6px; align-items: center; }
    .scroll { overflow: auto; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 4px; }
    summary { cursor: pointer; padding: 2px 0; display: flex; align-items: center; gap: 8px; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    summary::before { content: '▸'; color: var(--dim); width: 10px; }
    details[open] > summary::before { content: '▾'; }
    .cnt { margin-left: auto; padding: 0 8px; border-radius: 9px; background: rgba(255, 255, 255, 0.1); color: var(--dim); font-size: 11px; white-space: nowrap; }
    .ind { margin-left: 12px; }
    .mini { margin-left: auto; font-size: 10px; padding: 0 6px; background: none; border: 1px solid var(--line); border-radius: 5px; color: var(--dim); cursor: pointer; }
    .row { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: none; border: 1px solid transparent; border-radius: 6px; padding: 3px 4px; cursor: pointer; color: inherit; }
    .row.sub { padding-left: 14px; }
    .row:hover { background: rgba(255, 255, 255, 0.06); }
    .row.sel { border-color: var(--accent); }
    .th { width: 30px; height: 30px; flex: none; background: rgba(0, 0, 0, 0.25); border-radius: 5px; }
    .glyph { display: grid; place-items: center; font-size: 17px; }
    .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `,
})
export class ElementsBox {
  readonly spec = input.required<SiteSpec>();
  readonly selectedId = input<string | null>(null);
  readonly go = output<ElementGo>();
  /** The tree zone under the pointer (its outline), or null. */
  readonly hover = output<Pt[] | null>();
  /** "Show tree zones on the map" switched. */
  readonly zones = output<boolean>();
  protected readonly tab = signal<'cat' | 'tree'>('cat');
  protected readonly q = signal('');
  protected val = (e: Event): string => (e.target as HTMLInputElement).value.toLowerCase();
  protected checked = (e: Event): boolean => (e.target as HTMLInputElement).checked;
  private readonly match = (name: string): boolean => !this.q() || name.toLowerCase().includes(this.q());

  protected readonly buildings = computed<BRow[]>(() =>
    this.spec().buildings.filter((b) => this.match(b.name)).map((b) => {
      const poly = outlineOf(b);
      const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      const k = 32 / Math.max(1, x1 - x0, z1 - z0);
      const points = poly.map((p) => `${(4 + (p.x - x0) * k + (32 - (x1 - x0) * k) / 2).toFixed(1)},${(4 + (p.z - z0) * k + (32 - (z1 - z0) * k) / 2).toFixed(1)}`).join(' ');
      return { id: b.id, name: b.name, levels: b.levels.length, size: `${b.length.toFixed(0)}×${b.width.toFixed(0)} m`, points, frame: !!b.frame, x: b.pos.x, z: b.pos.z, big: Math.max(b.length, b.width) };
    }),
  );
  private readonly allStructures = computed(() =>
    (this.spec().structures ?? []).map((s, i) => ({ i, name: s.name, kind: s.kind.replace('_', ' '), glyph: GLYPH[s.kind] ?? '▲', x: s.x, z: s.z, size: Math.max(s.size, s.length ?? 0, 10) })).filter((s) => this.match(s.name)),
  );
  /** The category view lists every structure; the tree view nests stairs under their building. */
  protected readonly structures = this.allStructures;
  private readonly nested = computed(() => new Set(this.spec().buildings.flatMap((b) => stairsIn(this.spec(), b).map((s) => s.i))));
  protected readonly looseStructures = computed(() => this.allStructures().filter((s) => !this.nested().has(s.i)));
  protected readonly fences = computed(() =>
    (this.spec().walls ?? []).map((w, i) => ({ i, x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2, len: Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) })).filter(() => this.match('wall')),
  );

  /** Columns are never listed one by one: one entry per row of a floor. */
  private readonly floorCols = computed(() => {
    const m = new Map<string, ColRow[]>();
    for (const b of this.spec().buildings) {
      b.levels.forEach((l, li) => {
        const cols = l.columns ?? [];
        const rows = columnGroups(cols).map((g, gi): ColRow => {
          const first = cols[g.idx[0]!]!, last = cols[g.idx[g.idx.length - 1]!]!;
          const mid = toSite(b, (first.x + last.x) / 2, (first.z + last.z) / 2);
          const label = g.axis === 'loose' ? `${b.name} · ${levelName(li)} · other columns` : `${b.name} · ${levelName(li)} · row ${gi + 1} (${g.axis === 'x' ? 'z' : 'x'} ${g.at.toFixed(1)} m)`;
          return { key: `${b.id}/${li}/${gi}`, id: b.id, li, label, n: g.idx.length, idx: g.idx, x: mid.x, z: mid.z, size: Math.max(b.length, b.width) };
        });
        if (rows.length) m.set(`${b.id}/${li}`, rows);
      });
    }
    return m;
  });
  protected readonly colRows = computed(() => [...this.floorCols().values()].flat().filter((c) => this.match(c.label)));
  protected readonly colTotal = computed(() => this.colRows().reduce((a, c) => a + c.n, 0));

  /** What is on each floor, for the tree view. */
  protected floorsOf(id: string): { li: number; name: string; doors: number; windows: number; parts: number[]; voids: number[]; cols: ColRow[]; stairs: { i: number; name: string; kind: string; glyph: string; x: number; z: number }[] }[] {
    const b = this.spec().buildings.find((x) => x.id === id);
    if (!b) return [];
    const stairs = stairsIn(this.spec(), b);
    return b.levels.map((l, li) => {
      const ops = listOpenings(b, li);
      return {
        li, name: levelName(li),
        doors: ops.filter((o) => o.kind === 'door').length, windows: ops.filter((o) => o.kind === 'window').length,
        parts: l.partitions.map((_, i) => i), voids: (l.voids ?? []).map((_, i) => i),
        cols: this.floorCols().get(`${b.id}/${li}`) ?? [],
        stairs: stairs.filter((s) => s.level === li).map((s) => ({ i: s.i, name: s.s.name, kind: s.s.kind, glyph: GLYPH[s.s.kind] ?? '▲', x: s.s.x, z: s.s.z })),
      };
    });
  }

  protected readonly treeTotal = computed(() => this.spec().trees.length);
  /** Tree zones: trees close together are one zone, however they were planted. */
  protected readonly zoneRows = computed(() => {
    const trees = this.spec().trees;
    return treeZones(trees).map((z) => {
      const x0 = z.x - z.size / 2, z0 = z.z - z.size / 2;
      return {
        n: z.idx.length, x: z.x, z: z.z, size: z.size, hull: z.hull,
        where: `${Math.round(z.x)} E · ${Math.round(-z.z)} N`,
        dots: z.idx.slice(0, 16).map((i): [number, number] => [4 + ((trees[i]!.x - x0) / z.size) * 32, 4 + ((trees[i]!.z - z0) / z.size) * 32]),
      };
    });
  });

  protected goZone(g: { x: number; z: number; size: number; hull: Pt[] }): void {
    this.go.emit({ kind: 'trees', zone: g.hull, x: g.x, z: g.z, size: g.size });
  }
  protected goCols(c: ColRow): void {
    this.go.emit({ kind: 'columns', id: c.id, level: c.li, indices: c.idx, x: c.x, z: c.z, size: c.size });
  }
  protected goFloor(b: BRow, li: number): void {
    this.go.emit({ kind: 'floor', id: b.id, level: li, x: b.x, z: b.z, size: b.big });
  }
  protected goPart(kind: 'wall' | 'void', b: BRow, li: number, index: number): void {
    this.go.emit({ kind, id: b.id, level: li, index, x: b.x, z: b.z, size: b.big });
  }
}
