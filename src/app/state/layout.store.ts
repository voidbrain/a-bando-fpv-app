import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { PANELS, PANEL_BY_ID, type PanelId } from '../ui/panel-defs';
import { signal } from '@angular/core';
import { persistState, savedState } from './persist';

/** Bumped by "Reset UI": components that remember their own place (the editor's toolbars) go back to the default. */
export const uiResets = signal(0);

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
  /** Layout format: a different number discards the remembered panel sizes (older builds stored wrong ones). */
  v?: number;
}

const KEY = 'abando-ng-layout';
const LAYOUT_V = 4;
const Z_START = 10;
const Z_MAX = 5000;

const initialPanel = (visible: boolean): PanelState => ({ visible, minimized: false, ghost: false, x: null, y: null, z: Z_START, w: null, h: null });
const defaults = (): LayoutState => ({ panels: Object.fromEntries(PANELS.map((p) => [p.id, initialPanel(p.visible)])) as Record<PanelId, PanelState>, zTop: Z_START, v: LAYOUT_V });

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
      if (!PANEL_BY_ID[id]) continue;
      // A stale saved size from an older build (or from when a panel was resizable) makes the reopened panel the
      // wrong height: only trust w/h for panels that are resizable today. Also drop sizes that were recorded while
      // the panel was collapsed / transiently laid out (a few px high) — those reopen at the wrong height.
      let clean: Partial<PanelState> = s ? (PANEL_BY_ID[id]?.resizable && saved.v === LAYOUT_V ? s : { ...s, w: null, h: null }) : {};
      if (clean.minimized && (clean.w ?? 0) < 120) clean = { ...clean, w: null };
      if ((clean.h ?? 999) < 100 || (clean.w ?? 999) < 60) clean = { ...clean, h: null, w: null };
      panels[id] = { ...panels[id], ...clean };
    }
    return { panels, zTop: saved.zTop ?? Z_START, v: LAYOUT_V };
  }),
  withMethods((store) => {
    const update = (id: PanelId, fn: (p: PanelState) => Partial<PanelState>): void =>
      patchState(store, (s) => ({ panels: { ...s.panels, [id]: { ...s.panels[id], ...fn(s.panels[id]) } } }));
    /** Bring a panel to the front. Renumbers everything when the counter gets large. */
    const raise = (id: PanelId): void =>
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
      });
    return {
      /** Showing a panel also brings it to the front. */
      setVisible: (id: PanelId, visible: boolean) => {
        update(id, () => ({ visible }));
        if (visible) raise(id);
      },
      toggle: (id: PanelId) => {
        const show = !store.panels()[id].visible;
        update(id, () => ({ visible: show }));
        if (show) raise(id);
      },
      toggleMinimized: (id: PanelId) => update(id, (p) => ({ minimized: !p.minimized })),
      toggleGhost: (id: PanelId) => update(id, (p) => ({ ghost: !p.ghost })),
      moveTo: (id: PanelId, x: number, y: number) => update(id, () => ({ x, y })),
      resizeTo: (id: PanelId, w: number, h: number) => update(id, () => ({ w, h })),
      setWidth: (id: PanelId, w: number) => update(id, () => ({ w })),
      raise,
      /** Put panels back as they were (shown or not, where, collapsed): the guide restores the layout it changed. */
      restore: (saved: Partial<Record<PanelId, Partial<PanelState>>>) =>
        patchState(store, (s) => {
          const panels = { ...s.panels };
          for (const [id, p] of Object.entries(saved) as [PanelId, Partial<PanelState>][]) panels[id] = { ...panels[id], ...p };
          return { panels };
        }),
      reset: () => {
        // everything back to its first place and size; Welcome is for a first visit, Views stays the way back
        const d = defaults();
        d.panels.welcome = { ...d.panels.welcome, visible: false };
        d.panels.views = { ...d.panels.views, visible: true };
        patchState(store, d);
        // the float boxes and the editor's toolbars remember their place on their own
        try {
          for (const k of Object.keys(localStorage)) if (k.startsWith('abando-float-')) localStorage.removeItem(k);
        } catch {
          /* no storage */
        }
        uiResets.update((n) => n + 1);
      },
    };
  }),
  withHooks((store) => {
    persistState(store, KEY);
    return {};
  }),
);
