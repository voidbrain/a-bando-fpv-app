import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { PANELS, PANEL_BY_ID, type PanelId } from '../ui/panel-defs';
import { persistState, savedState } from './persist';

export interface PanelState {
  visible: boolean;
  /** Collapsed to the title bar. */
  minimized: boolean;
  /** Transparent: background hidden, only the content stays. */
  ghost: boolean;
  /** Dragged position in px; null = the default anchor from the panel definition. */
  x: number | null;
  y: number | null;
  /** Stacking order. */
  z: number;
  /** User-set size in px (resizable panels). */
  w: number | null;
  h: number | null;
}

export interface LayoutState {
  panels: Record<PanelId, PanelState>;
  zTop: number;
}

const KEY = 'abando-ng-layout';
const Z_START = 10;
const Z_MAX = 5000;

const initialPanel = (visible: boolean): PanelState => ({ visible, minimized: false, ghost: false, x: null, y: null, z: Z_START, w: null, h: null });
const defaults = (): LayoutState => ({ panels: Object.fromEntries(PANELS.map((p) => [p.id, initialPanel(p.visible)])) as Record<PanelId, PanelState>, zTop: Z_START });

/** Where every floating panel is, whether it is shown / collapsed / transparent, and which is on top. Remembered across visits. */
export const LayoutStore = signalStore(
  { providedIn: 'root' },
  withState(() => {
    const d = defaults();
    const saved = savedState<LayoutState>(KEY, d);
    // merge per panel so panels added in a newer version still appear with defaults
    const panels = { ...d.panels };
    for (const id of Object.keys(panels) as PanelId[]) {
      const s = saved.panels?.[id];
      // A stale saved size from an older build (or from when a panel was resizable) makes the reopened panel the
      // wrong height: only trust w/h for panels that are resizable today. Also drop sizes that were recorded while
      // the panel was collapsed / transiently laid out (a few px high) — those reopen at the wrong height.
      let clean: Partial<PanelState> = s ? (PANEL_BY_ID[id].resizable ? s : { ...s, w: null, h: null }) : {};
      if (clean.minimized && (clean.w ?? 0) < 120) clean = { ...clean, w: null };
      if ((clean.h ?? 999) < 100 || (clean.w ?? 999) < 60) clean = { ...clean, h: null, w: null };
      panels[id] = { ...panels[id], ...clean };
    }
    return { panels, zTop: saved.zTop ?? Z_START };
  }),
  withMethods((store) => {
    const update = (id: PanelId, fn: (p: PanelState) => Partial<PanelState>): void =>
      patchState(store, (s) => ({ panels: { ...s.panels, [id]: { ...s.panels[id], ...fn(s.panels[id]) } } }));
    return {
      setVisible: (id: PanelId, visible: boolean) => update(id, () => ({ visible })),
      toggle: (id: PanelId) => update(id, (p) => ({ visible: !p.visible })),
      toggleMinimized: (id: PanelId) => update(id, (p) => ({ minimized: !p.minimized })),
      toggleGhost: (id: PanelId) => update(id, (p) => ({ ghost: !p.ghost })),
      moveTo: (id: PanelId, x: number, y: number) => update(id, () => ({ x, y })),
      resizeTo: (id: PanelId, w: number, h: number) => update(id, () => ({ w, h })),
      setWidth: (id: PanelId, w: number) => update(id, () => ({ w })),
      /** Bring a panel to the front. Renumbers everything when the counter gets large. */
      raise: (id: PanelId) =>
        patchState(store, (s) => {
          // already the only panel on top (initially every panel shares z = 10, so the counter must have moved)
          if (s.panels[id].z === s.zTop && s.zTop > Z_START) return {};
          let panels = s.panels;
          let z = s.zTop + 1;
          if (z > Z_MAX) {
            const order = (Object.keys(panels) as PanelId[]).sort((a, b) => panels[a].z - panels[b].z);
            const next = { ...panels };
            z = Z_START;
            for (const k of order) next[k] = { ...next[k], z: z++ };
            panels = next;
          }
          return { zTop: z, panels: { ...panels, [id]: { ...panels[id], z } } };
        }),
      reset: () => patchState(store, defaults()),
    };
  }),
  withHooks((store) => {
    persistState(store, KEY);
    return {};
  }),
);
