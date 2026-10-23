import { Service, inject } from '@angular/core';
import { LayoutStore } from '../state/layout.store';
import { arrangeRows } from '../ui/panel-arrange';
import type { PanelId } from '../ui/panel-defs';

/**
 * Opens the panels for a job (a Welcome link, a step of the guide): the others close (Views stays, it is the way back),
 * these come back to their own size, side by side in the free middle of the window, on top.
 */
@Service()
export class PanelPlacer {
  private readonly layout = inject(LayoutStore);

  async open(ids: readonly PanelId[]): Promise<void> {
    const keep = new Set<PanelId>([...ids, 'views']);
    for (const [id, p] of Object.entries(this.layout.panels()) as [PanelId, { visible: boolean }][]) if (p.visible && !keep.has(id)) this.layout.setVisible(id, false);
    this.layout.restore(Object.fromEntries(ids.map((id) => [id, { visible: true, x: null, y: null, w: null, h: null, minimized: false, ghost: false }])));
    for (const id of ids) this.layout.raise(id);
    await new Promise((r) => setTimeout(r, 60)); // drawn at their own size: measure them
    const box = (id: PanelId): DOMRect | undefined => document.querySelector<HTMLElement>(`app-panel[data-id="${id}"]`)?.getBoundingClientRect();
    const views = this.layout.panels().views.visible ? box('views') : undefined;
    const x0 = views ? views.right + 12 : 12;
    const area = { x: x0, y: 56, w: Math.max(200, innerWidth - x0 - 12), h: innerHeight - 68 };
    const sizes = ids.map((id) => {
      const r = box(id);
      return { w: r?.width ?? 300, h: r?.height ?? 200 };
    });
    arrangeRows(sizes, area).forEach((p, i) => this.layout.moveTo(ids[i]!, p.x, p.y));
  }
}
