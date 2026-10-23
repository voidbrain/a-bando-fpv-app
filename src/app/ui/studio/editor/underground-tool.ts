import { computed, signal } from '@angular/core';
import type { Pt } from '../../../core/footprint';
import { uid, type UndergroundSpec } from '../../../core/site-spec';
import { defaultTerrain } from '../../../core/terrain';
import { cutCellsPath, newRoom, newTunnel, sectionDrawing, tunnelOutline } from '../../../core/underground';
import type { PickOption } from '../pick-menu';
import { polyPts, type EditorHost } from './editor-host';

/** The Tunnel tool: tunnels and rooms under the ground, the selected one's section, and where the ground is cut. */
export class UndergroundTool {
  constructor(private readonly h: EditorHost) {}

  readonly kind = signal<'tunnel' | 'room'>('tunnel');
  readonly width = signal(4);
  readonly height = signal(3.5);
  readonly depth = signal(1);
  readonly shape = signal<UndergroundSpec['shape']>('box');
  readonly kindOptions: readonly PickOption[] = [
    { id: 'tunnel', label: 'Tunnel', icon: 'tunnel', hint: 'Drag from end to end' },
    { id: 'room', label: 'Room', icon: 'bunker', hint: 'Drag a rectangle (bunker, basement)' },
  ];
  readonly shapeOptions: readonly PickOption[] = [
    { id: 'box', label: 'Box', icon: 'culvertBox', hint: 'Concrete box section' },
    { id: 'pipe', label: 'Pipe', icon: 'culvertPipe', hint: 'Round culvert' },
    { id: 'vault', label: 'Vault', icon: 'culvertVault', hint: 'Brick vault' },
  ];
  readonly asShape = (v: string): UndergroundSpec['shape'] => (v === 'pipe' || v === 'vault' ? v : 'box');
  /** The outline being dragged (site metres) as SVG points. */
  readonly preview = computed(() => {
    const d = this.h.drag();
    return d?.t === 'under' ? polyPts(this.outline(d.a, d.b)) : '';
  });
  readonly sel = computed(() => {
    const p = this.h.pick();
    return p?.t === 'under' ? (this.h.ed.draft().underground?.[p.i] ?? null) : null;
  });
  /** The side view of the selected volume, scaled into a 260 × 96 drawing: ground line, and its inside as a box. */
  readonly section = computed(() => {
    const u = this.sel();
    return u ? sectionDrawing(u, this.h.ground().at) : null;
  });
  /** Where the ground is cut by underground volumes (the openings), as one SVG path of grid cells. */
  readonly cutCells = computed(() => {
    const g = this.h.ground();
    return cutCellsPath(g.grid, g.cut);
  });

  private outline(a: Pt, b: Pt): Pt[] {
    if (this.kind() === 'tunnel') return tunnelOutline(a, b, this.width());
    return [a, { x: b.x, z: a.z }, b, { x: a.x, z: b.z }];
  }

  /** A finished drag: a tunnel from end to end, or a room over the rectangle (one undo step). */
  commit(a: Pt, b: Pt): void {
    const room = this.kind() === 'room';
    if (room ? Math.abs(b.x - a.x) < 2 || Math.abs(b.z - a.z) < 2 : Math.hypot(b.x - a.x, b.z - a.z) < 3) return void this.h.toast.show(room ? 'Drag a rectangle at least 2 m each way.' : 'Drag from one end of the tunnel to the other.');
    const n = (this.h.ed.draft().underground?.length ?? 0) + 1;
    const g = this.h.ground();
    const v: UndergroundSpec = room
      ? newRoom(a, b, g.at, { height: this.height(), depth: this.depth(), id: uid('ug'), name: `Room ${n}` })
      : newTunnel(g.grid, a, b, { width: this.width(), height: this.height(), depth: this.depth(), shape: this.shape(), id: uid('ug'), name: `Tunnel ${n}` });
    this.h.ed.commitSite((s) => {
      s.terrain ??= defaultTerrain(s.extent); // the ground must be a terrain to be cut where the tunnel opens
      (s.underground ??= []).push(v);
    });
    this.h.pick.set({ t: 'under', i: n - 1 });
    this.h.applyNow();
    this.h.toast.show(`${v.name}: floor ${v.floor} m, ceiling ${v.ceiling} m. It is open where the ground is between them (dark on the plan); deeper ground covers it.`, 4000);
  }

  /** Edit the selected volume (one undo step); the ceiling stays at least 0.8 m over the floor. */
  set(patch: Partial<UndergroundSpec>): void {
    const p = this.h.pick();
    if (p?.t !== 'under') return;
    this.h.ed.commitSite((s) => {
      const v = s.underground?.[p.i];
      if (!v) return;
      Object.assign(v, patch);
      if (v.ceiling < v.floor + 0.8) v.ceiling = v.floor + 0.8;
    });
    this.h.applyNow();
  }

  down(e: PointerEvent, i: number): void {
    if (this.h.tool() !== 'select') return this.h.bgDown(e);
    e.stopPropagation();
    this.h.capture(e);
    this.h.pick.set({ t: 'under', i });
  }
}
