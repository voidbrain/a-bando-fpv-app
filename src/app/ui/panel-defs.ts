/** Every floating panel in the app: identity, title and where it first appears. */
export type PanelId =
  | 'views' | 'flights' | 'simulator' | 'radio' | 'timeline' | 'speed' | 'attitude' | 'compass'
  | 'path' | 'studio' | 'blackbox' | 'video' | 'live' | 'render' | 'help' | 'guide' | 'welcome' | 'vpOrbit' | 'vpChase' | 'vpFpv' | 'vpTop';

export interface PanelDef {
  id: PanelId;
  title: string;
  /** Section of the Views panel that shows / hides it. */
  group: 'views' | 'telemetry' | 'simulator' | 'tools';
  /** Telemetry only: a panel you work with (`controls`) or one that shows the flight (`views`). */
  sub?: 'controls' | 'views';
  visible: boolean;
  /** First position (CSS pixels from the named edges, or centred across the window); dragging replaces it. */
  anchor: { left?: number; right?: number; top?: number; bottom?: number; center?: boolean };
  /** Initial width in px (cards size to content when omitted). */
  width?: number;
  /** The user can drag the corner to resize it; the content fills it. */
  resizable?: boolean;
  /** Initial height in px (resizable panels only). */
  height?: number;
}

/** A first visit sees only the empty world and Welcome; closing Welcome brings Views (see WelcomePanel). */
export const PANELS: readonly PanelDef[] = [
  { id: 'views', title: 'Views', group: 'tools', visible: false, anchor: { left: 12, top: 12 }, width: 236 },
  { id: 'flights', title: 'Flights', group: 'telemetry', sub: 'controls', visible: false, anchor: { left: 12, top: 232 }, width: 250 },
  { id: 'simulator', title: 'Simulator', group: 'simulator', visible: false, anchor: { left: 12, bottom: 12 }, width: 250 },
  { id: 'radio', title: 'Radio controller', group: 'simulator', visible: false, anchor: { left: 280, top: 300 }, width: 280 },
  { id: 'timeline', title: 'Timeline', group: 'telemetry', sub: 'controls', visible: false, anchor: { left: 280, bottom: 12 }, width: 560 },
  { id: 'speed', title: 'Speed', group: 'telemetry', sub: 'views', visible: false, anchor: { right: 12, top: 12 }, width: 170 },
  { id: 'attitude', title: 'Attitude & heading', group: 'telemetry', sub: 'views', visible: false, anchor: { right: 12, top: 168 }, width: 270 },
  { id: 'compass', title: 'Map north', group: 'telemetry', sub: 'views', visible: false, anchor: { right: 300, top: 12 }, width: 170 },
  { id: 'path', title: 'Flight path', group: 'telemetry', sub: 'views', visible: false, anchor: { right: 12, bottom: 12 }, width: 330, resizable: true, height: 270 },
  { id: 'studio', title: 'Bandos editor', group: 'tools', visible: false, anchor: { right: 12, top: 60 }, width: 760, resizable: true, height: 540 },
  { id: 'blackbox', title: 'Blackbox', group: 'telemetry', sub: 'controls', visible: false, anchor: { right: 12, top: 330 }, width: 360 },
  { id: 'video', title: 'Video', group: 'telemetry', sub: 'controls', visible: false, anchor: { left: 280, top: 12 }, width: 380 },
  { id: 'live', title: 'Live link', group: 'telemetry', sub: 'controls', visible: false, anchor: { left: 280, top: 12 }, width: 300 },
  { id: 'render', title: 'Render', group: 'tools', visible: false, anchor: { left: 280, top: 12 }, width: 300 },
  { id: 'guide', title: 'Guide me', group: 'tools', visible: false, anchor: { left: 280, top: 12 }, width: 300, resizable: true, height: 420 },
  { id: 'help', title: 'Controls', group: 'simulator', visible: false, anchor: { left: 280, top: 12 }, width: 300 },
  { id: 'vpOrbit', title: 'Orbit view', group: 'views', visible: false, anchor: { right: 360, top: 12 }, width: 380, resizable: true, height: 270 },
  { id: 'vpChase', title: 'Chase view', group: 'views', visible: false, anchor: { right: 360, top: 12 }, width: 380, resizable: true, height: 270 },
  { id: 'vpFpv', title: 'FPV view', group: 'views', visible: false, anchor: { right: 360, top: 12 }, width: 380, resizable: true, height: 270 },
  { id: 'vpTop', title: 'Top view · north up', group: 'views', visible: false, anchor: { right: 360, top: 12 }, width: 380, resizable: true, height: 270 },
  { id: 'welcome', title: 'Welcome', group: 'tools', visible: true, anchor: { center: true, top: 64 }, width: 1080 },
];

export const PANEL_BY_ID: Readonly<Record<PanelId, PanelDef>> = Object.fromEntries(PANELS.map((p) => [p.id, p])) as Record<PanelId, PanelDef>;

/** How far a panel steps aside from others opened at the same first place, so a new one never hides the last one exactly. */
export const CASCADE_STEP = 26;

/**
 * How many panels sit under this one at the same first place: shown, never dragged, with the same anchor, and opened
 * before it (lower in the stacking order; the list order breaks ties). The panel is moved by that many {@link CASCADE_STEP}s.
 */
export function cascadeIndex(id: PanelId, panels: Readonly<Record<PanelId, { visible: boolean; x: number | null; y: number | null; z: number }>>): number {
  const me = panels[id], def = PANEL_BY_ID[id];
  if (!me?.visible || me.x !== null || me.y !== null) return 0;
  const key = JSON.stringify(def.anchor), order = PANELS.findIndex((p) => p.id === id);
  return PANELS.filter((p, i) => {
    const o = panels[p.id];
    return p.id !== id && o?.visible && o.x === null && o.y === null && JSON.stringify(p.anchor) === key && (o.z < me.z || (o.z === me.z && i < order));
  }).length;
}
