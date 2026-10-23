/** Every floating panel in the app: identity, title and where it first appears. */
export type PanelId =
  | 'views' | 'flights' | 'simulator' | 'radio' | 'timeline' | 'speed' | 'attitude' | 'compass'
  | 'path' | 'studio' | 'blackbox' | 'video' | 'live' | 'render' | 'help' | 'guide' | 'vpOrbit' | 'vpChase' | 'vpFpv' | 'vpTop';

export interface PanelDef {
  id: PanelId;
  title: string;
  /** Section of the Views panel that shows / hides it. */
  group: 'views' | 'telemetry' | 'simulator' | 'tools';
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
  { id: 'flights', title: 'Flights', group: 'telemetry', visible: true, anchor: { left: 12, top: 232 }, width: 250 },
  { id: 'simulator', title: 'Simulator', group: 'simulator', visible: true, anchor: { left: 12, bottom: 12 }, width: 250 },
  { id: 'radio', title: 'Radio controller', group: 'simulator', visible: false, anchor: { left: 280, top: 300 }, width: 280 },
  { id: 'timeline', title: 'Timeline', group: 'telemetry', visible: true, anchor: { left: 280, bottom: 12 }, width: 560 },
  { id: 'speed', title: 'Speed', group: 'telemetry', visible: true, anchor: { right: 12, top: 12 }, width: 170 },
  { id: 'attitude', title: 'Attitude & heading', group: 'telemetry', visible: true, anchor: { right: 12, top: 168 }, width: 270 },
  { id: 'compass', title: 'Map north', group: 'telemetry', visible: false, anchor: { right: 300, top: 12 }, width: 170 },
  { id: 'path', title: 'Flight path', group: 'telemetry', visible: true, anchor: { right: 12, bottom: 12 }, width: 330, resizable: true, height: 270 },
  { id: 'studio', title: 'Bandos editor', group: 'tools', visible: true, anchor: { right: 12, top: 60 }, width: 760, resizable: true, height: 540 },
  { id: 'blackbox', title: 'Blackbox', group: 'telemetry', visible: false, anchor: { right: 12, top: 330 }, width: 360 },
  { id: 'video', title: 'Video', group: 'telemetry', visible: false, anchor: { left: 280, top: 12 }, width: 380 },
  { id: 'live', title: 'Live link', group: 'telemetry', visible: false, anchor: { left: 280, top: 12 }, width: 300 },
  { id: 'render', title: 'Render', group: 'tools', visible: false, anchor: { left: 280, top: 12 }, width: 300 },
  { id: 'guide', title: 'Guide me', group: 'tools', visible: true, anchor: { left: 280, top: 12 }, width: 300, resizable: true, height: 420 },
  { id: 'help', title: 'Controls', group: 'simulator', visible: false, anchor: { left: 280, top: 12 }, width: 300 },
  { id: 'vpOrbit', title: 'Orbit view', group: 'views', visible: false, anchor: { right: 360, top: 12 }, width: 380, resizable: true, height: 270 },
  { id: 'vpChase', title: 'Chase view', group: 'views', visible: false, anchor: { right: 360, top: 12 }, width: 380, resizable: true, height: 270 },
  { id: 'vpFpv', title: 'FPV view', group: 'views', visible: false, anchor: { right: 360, top: 12 }, width: 380, resizable: true, height: 270 },
  { id: 'vpTop', title: 'Top view · north up', group: 'views', visible: false, anchor: { right: 360, top: 12 }, width: 380, resizable: true, height: 270 },
];

export const PANEL_BY_ID: Readonly<Record<PanelId, PanelDef>> = Object.fromEntries(PANELS.map((p) => [p.id, p])) as Record<PanelId, PanelDef>;
