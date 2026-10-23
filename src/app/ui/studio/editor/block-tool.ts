import { computed, signal } from '@angular/core';
import { applyPattern, detachInstance, placeBlock, placedHead, removeInstance, updateInstance } from '../../../core/blocks';
import type { Pt } from '../../../core/footprint';
import { expandShapes, shapesFootprint } from '../../../core/shapes';
import type { StructureSpec } from '../../../core/site-spec';
import type { BlockLibraryService } from '../../../services/block-library.service';
import type { BlockArm } from '../blocks-box';
import type { EditorHost } from './editor-host';

const snap = (v: number, step: number): number => Math.round(v / step) * step;

/**
 * Blocks from the library: the Library box, a block armed for placing (the next click on the map places it), patterns
 * applied to the selected floor, and the selected placement (update to a newer version, detach, remove).
 */
export class BlockTool {
  constructor(
    private readonly h: EditorHost,
    private readonly lib: BlockLibraryService,
  ) {}

  readonly open = signal(false);
  /** The block waiting for a click on the map. */
  readonly armed = signal<BlockArm | null>(null);
  private readonly boxes = new WeakMap<object, { x0: number; z0: number; x1: number; z1: number }>();

  /** The plan footprint of an object made of shapes (remembered per shapes list). */
  shapesBox(st: StructureSpec): { x0: number; z0: number; x1: number; z1: number } {
    const key = st.shapes ?? st;
    let b = this.boxes.get(key);
    if (!b) this.boxes.set(key, (b = shapesFootprint(expandShapes(st.shapes ?? []))));
    return b;
  }

  arm(a: BlockArm): void {
    this.h.setTool('select');
    this.armed.set(a);
    this.h.view3d.set(false);
    this.h.toast.show(`Click the map to place “${a.block.name}”. Esc stops.`);
  }

  /** Place the armed block at `p` (one undo step) and select what it made. */
  place(a: BlockArm, p: Pt): void {
    const { ed } = this.h;
    let r = { placed: 0, inst: '' };
    ed.commitSite((s) => {
      r = placeBlock(s, a.block, a.params, { x: snap(p.x, 0.5), z: snap(p.z, 0.5) }, a.rot);
    });
    if (!r.placed) {
      ed.undo();
      this.h.toast.show('Nothing could be placed from that block.');
      return;
    }
    const head = placedHead(ed.draft(), r.inst);
    if (head && 'building' in head) {
      ed.select(head.building);
      this.h.pick.set({ t: 'building' });
    } else if (head) this.h.pick.set({ t: 'structure', i: head.structure });
    this.h.applyNow();
  }

  /** A pattern block on the selected building's current floor (one undo step). */
  applyPattern(a: BlockArm): void {
    const id = this.h.ed.selectedId();
    if (!id) return void this.h.toast.show('Select a building first.');
    const level = this.h.level();
    let done: string[] = [];
    this.h.ed.commitSite((s) => {
      const x = s.buildings.find((b) => b.id === id);
      if (x) done = applyPattern(x, Math.min(level, x.levels.length - 1), a.block, a.params);
    });
    this.h.colSet.set([]);
    this.h.applyNow();
    this.h.toast.show(done.length ? `“${a.block.name}” on floor ${this.h.levelName(level)}: ${done.join(', ')}.` : 'That pattern changed nothing here.');
  }

  /** The block a selected building or structure was placed from, and whether a newer version exists. */
  readonly sel = computed(() => {
    const p = this.h.pick();
    const ref = p?.t === 'structure' ? this.h.structSel()?.block : p?.t === 'building' || !p ? this.h.building()?.block : undefined;
    if (!ref) return null;
    const lib = this.lib.get(ref.id);
    return { ref, name: lib?.name ?? ref.id, latest: lib && lib.version > ref.v ? lib.version : null };
  });

  update(): void {
    const sb = this.sel(), lib = sb ? this.lib.get(sb.ref.id) : null;
    if (!sb || !lib) return;
    this.h.ed.commitSite((s) => void updateInstance(s, sb.ref.inst, lib));
    this.h.applyNow();
    this.h.toast.show(`Updated to v${lib.version}.`);
  }

  detach(): void {
    const sb = this.sel();
    if (!sb) return;
    this.h.ed.commitSite((s) => detachInstance(s, sb.ref.inst));
    this.h.applyNow();
  }

  remove(): void {
    const sb = this.sel();
    if (!sb) return;
    this.h.ed.commitSite((s) => removeInstance(s, sb.ref.inst));
    this.h.pick.set(null);
    this.h.applyNow();
  }
}
