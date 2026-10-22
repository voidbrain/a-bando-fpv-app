/** Every floating panel in the app: identity, title and where it first appears. */
export type PanelId =
  | 'views' | 'flights' | 'simulator' | 'radio' | 'timeline' | 'speed' | 'attitude' | 'compass'
  | 'path' | 'studio' | 'blackbox' | 'video' | 'live' | 'render' | 'help' | 'vpOrbit' | 'vpChase' | 'vpFpv' | 'vpTop';

export interface PanelDef {
  id: PanelId;
  title: string;
  /** Group in the Views panel's list of toggles. */
  group: 'data' | 'instruments' | 'cameras' | 'tools';
  visible: boolean;
  /** First position (CSS pixels from the named edges); dragging replaces it. */
  anchor: { left?: number; right?: number; top?: number; bottom?: number };
  /** Initial width in px (cards size to content when omitted). */
  width?: number;
  /** The user can drag the corner to resize it; the content fills it. */
  resizable?: boolean;
  /** Initial height in px (resizable panels only). */
  height?: number;
}

export const PANELS: readonly PanelDef[] = [
  { id: 'views', title: 'Views', group: 'tools', visible: true, anchor: { left: 12, top: 12 }, width: 210 },
  { id: 'flights', title: 'Flights', group: 'data', visible: true, anchor: { left: 12, top: 232 }, width: 250 },
  { id: 'simulator', title: 'Simulator', group: 'data', visible: true, anchor: { left: 12, bottom: 12 }, width: 250 },
  { id: 'radio', title: 'Radio controller', group: 'tools', visible: false, anchor: { left: 280, top: 300 }, width: 280 },
  { id: 'timeline', title: 'Timeline', group: 'data', visible: true, anchor: { left: 280, bottom: 12 }, width: 560 },
  { id: 'speed', title: 'Speed', group: 'instruments', visible: true, anchor: { right: 12, top: 12 }, width: 170 },
  { id: 'attitude', title: 'Attitude & heading', group: 'instruments', visible: true, anchor: { right: 12, top: 168 }, width: 270 },
  { id: 'compass', title: 'Map north', group: 'instruments', visible: false, anchor: { right: 300, top: 12 }, width: 170 },
  { id: 'path', title: 'Flight path', group: 'instruments', visible: true, anchor: { right: 12, bottom: 12 }, width: 330, resizable: true, height: 270 },
  { id: 'studio', title: 'Bandos · map & model editor', group: 'tools', visible: true, anchor: { right: 12, top: 60 }, width: 920, resizable: true, height: 720 },
  { id: 'blackbox', title: 'Blackbox', group: 'instruments', visible: false, anchor: { right: 12, top: 330 }, width: 360 },
  { id: 'video', title: 'Video', group: 'data', visible: false, anchor: { left: 280, top: 12 }, width: 380 },
  { id: 'live', title: 'Live link', group: 'data', visible: false, anchor: { left: 280, top: 12 }, width: 300 },
  { id: 'render', title: 'Render', group: 'tools', visible: false, anchor: { left: 280, top: 12 }, width: 300 },
  { id: 'help', title: 'Controls', group: 'tools', visible: false, anchor: { left: 280, top: 12 }, width: 300 },
  { id: 'vpOrbit', title: 'Orbit view', group: 'cameras', visible: false, anchor: { right: 360, top: 12 }, width: 380, resizable: true, height: 270 },
  { id: 'vpChase', title: 'Chase view', group: 'cameras', visible: false, anchor: { right: 360, top: 12 }, width: 380, resizable: true, height: 270 },
  { id: 'vpFpv', title: 'FPV view', group: 'cameras', visible: false, anchor: { right: 360, top: 12 }, width: 380, resizable: true, height: 270 },
  { id: 'vpTop', title: 'Top view · north up', group: 'cameras', visible: false, anchor: { right: 360, top: 12 }, width: 380, resizable: true, height: 270 },
];

export const PANEL_BY_ID: Readonly<Record<PanelId, PanelDef>> = Object.fromEntries(PANELS.map((p) => [p.id, p])) as Record<PanelId, PanelDef>;
