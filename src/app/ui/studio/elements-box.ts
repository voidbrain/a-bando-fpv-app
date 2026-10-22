import { Component, computed, input, output, signal } from '@angular/core';
import { outlineOf } from '../../core/openings';
import type { SiteSpec, StructureKind } from '../../core/site-spec';
import { FloatBox } from '../float-box';

/** Where a click in the list should take the editor. */
export interface ElementGo {
  kind: 'building' | 'structure' | 'fence' | 'trees';
  /** building id, or index into structures / walls. */
  id?: string;
  index?: number;
  x: number;
  z: number;
  /** About how big it is (metres), so the map can zoom to fit. */
  size: number;
}

const GLYPH: Record<StructureKind, string> = {
  chimney: '🏭', silo: '🛢', tank: '⛽', water_tower: '🗼', lattice_tower: '📡', bridge: '🌉', stairs: '🪜', ramp: '📐',
  tower_crane: '🏗', container: '📦', car: '🚗', truck: '🚚', excavator: '🚜',
};
const CELL = 60; // metres: trees closer than this are listed together

interface BRow { id: string; name: string; levels: number; size: string; points: string; frame: boolean; x: number; z: number; big: number }

/** Everything in the model in one list, by category, with a small outline for each: buildings, structures, fences, and trees grouped by area. */
@Component({
  selector: 'app-elements-box',
  imports: [FloatBox],
  template: `
    <app-float-box fid="elements-v1" title="Elements" [x]="8" [y]="480" [w]="280" [h]="320" [minW]="220" [minH]="140">
      <input type="text" class="q" placeholder="Filter by name…" [value]="q()" (input)="q.set(val($event))" aria-label="Filter elements" />
      <div class="scroll">
        <details open>
          <summary><b>Buildings</b> <span class="dim small">{{ buildings().length }}</span></summary>
          @for (b of buildings(); track b.id) {
            <button class="row" [class.sel]="b.id === selectedId()" (click)="go.emit({ kind: 'building', id: b.id, x: b.x, z: b.z, size: b.big })">
              <svg viewBox="0 0 40 40" class="th"><polygon [attr.points]="b.points" [attr.fill]="b.frame ? '#9ec1b6' : '#c9c5b8'" stroke="#222" stroke-width="1.5" /></svg>
              <span class="nm">{{ b.name }}</span><span class="dim small">{{ b.size }} · {{ b.levels }} fl</span>
            </button>
          }
        </details>
        @if (structures().length) {
          <details open>
            <summary><b>Structures</b> <span class="dim small">{{ structures().length }}</span></summary>
            @for (s of structures(); track s.i) {
              <button class="row" (click)="go.emit({ kind: 'structure', index: s.i, x: s.x, z: s.z, size: s.size })">
                <span class="th glyph">{{ s.glyph }}</span><span class="nm">{{ s.name }}</span><span class="dim small">{{ s.kind }}</span>
              </button>
            }
          </details>
        }
        @if (fences().length) {
          <details>
            <summary><b>Walls &amp; fences</b> <span class="dim small">{{ fences().length }}</span></summary>
            @for (f of fences(); track f.i) {
              <button class="row" (click)="go.emit({ kind: 'fence', index: f.i, x: f.x, z: f.z, size: f.len })">
                <svg viewBox="0 0 40 40" class="th"><line x1="6" y1="30" x2="34" y2="10" stroke="#c9c5b8" stroke-width="4" stroke-linecap="round" /></svg>
                <span class="nm">Wall {{ f.i + 1 }}</span><span class="dim small">{{ f.len.toFixed(0) }} m</span>
              </button>
            }
          </details>
        }
        @if (treeGroups().length) {
          <details>
            <summary><b>Trees</b> <span class="dim small">{{ treeTotal() }} in {{ treeGroups().length }} areas</span></summary>
            @for (g of treeGroups(); track g.key) {
              <button class="row" (click)="go.emit({ kind: 'trees', x: g.x, z: g.z, size: CELL })">
                <svg viewBox="0 0 40 40" class="th">
                  @for (d of g.dots; track $index) {
                    <circle [attr.cx]="d[0]" [attr.cy]="d[1]" r="3.2" fill="#4f9a4a" />
                  }
                </svg>
                <span class="nm">{{ g.n }} trees</span><span class="dim small">{{ g.where }}</span>
              </button>
            }
          </details>
        }
      </div>
    </app-float-box>
  `,
  styles: `
    .q { width: 100%; }
    .scroll { overflow: auto; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 4px; }
    summary { cursor: pointer; padding: 2px 0; }
    .row { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: none; border: 1px solid transparent; border-radius: 6px; padding: 3px 4px; cursor: pointer; color: inherit; }
    .row:hover { background: rgba(255, 255, 255, 0.06); }
    .row.sel { border-color: var(--accent); }
    .th { width: 34px; height: 34px; flex: none; background: rgba(0, 0, 0, 0.25); border-radius: 5px; }
    .glyph { display: grid; place-items: center; font-size: 20px; }
    .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `,
})
export class ElementsBox {
  readonly spec = input.required<SiteSpec>();
  readonly selectedId = input<string | null>(null);
  readonly go = output<ElementGo>();
  protected readonly CELL = CELL;
  protected readonly q = signal('');
  protected val = (e: Event): string => (e.target as HTMLInputElement).value.toLowerCase();
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
  protected readonly structures = computed(() =>
    (this.spec().structures ?? []).map((s, i) => ({ i, name: s.name, kind: s.kind.replace('_', ' '), glyph: GLYPH[s.kind] ?? '▲', x: s.x, z: s.z, size: Math.max(s.size, s.length ?? 0, 10) })).filter((s) => this.match(s.name)),
  );
  protected readonly fences = computed(() =>
    (this.spec().walls ?? []).map((w, i) => ({ i, x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2, len: Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) })).filter((f) => this.match('wall')),
  );
  protected readonly treeTotal = computed(() => this.spec().trees.length);
  /** Trees grouped by 60 m cells: a count, a tiny dot map and where the cell is (m east / north of the origin). */
  protected readonly treeGroups = computed(() => {
    const cells = new Map<string, { x: number; z: number }[]>();
    for (const t of this.spec().trees) {
      const k = `${Math.floor(t.x / CELL)}/${Math.floor(t.z / CELL)}`;
      (cells.get(k) ?? cells.set(k, []).get(k)!).push(t);
    }
    return [...cells.entries()]
      .map(([key, list]) => {
        const cx = list.reduce((a, t) => a + t.x, 0) / list.length, cz = list.reduce((a, t) => a + t.z, 0) / list.length;
        const [gx, gz] = key.split('/').map(Number) as [number, number];
        return {
          key, n: list.length, x: cx, z: cz,
          where: `${Math.round(cx)} E · ${Math.round(-cz)} N`,
          dots: list.slice(0, 14).map((t): [number, number] => [4 + ((t.x - gx * CELL) / CELL) * 32, 4 + ((t.z - gz * CELL) / CELL) * 32]),
        };
      })
      .sort((a, b) => b.n - a.n);
  });
}
