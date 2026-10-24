/**
 * The guided tour: short animated snippets that use the real interface (a cursor moves, clicks, types and drags; a
 * caption says what happens), and full tours made of snippets. The same snippets are the clips of the help pages
 * (docs/guide, built by tools/build-guide.mjs) and of the hover tips. Pure data and checks; services/tour.service.ts
 * plays them.
 *
 * Targets: a plain name is a `data-tour` mark in the templates (`[data-tour~="name"]`); anything starting with `#`,
 * `.`, `[` or `app-` is a CSS selector. Points inside a target are fractions of its box (0..1), the centre by default.
 * Slow or online steps (generating from map data, the AI model) are stand-ins (`hook`) that show the real result.
 */

/** `showcase`: the welcome tour's own steps, not listed in the Guide panel or the help pages. */
export type Section = 'bandos' | 'model' | 'ai' | 'flight' | 'showcase';

export const SECTIONS: readonly { id: Section; title: string }[] = [
  { id: 'bandos', title: 'Bandos and the map' },
  { id: 'model', title: 'Editing the model' },
  { id: 'ai', title: 'The AI assistant' },
  { id: 'flight', title: 'Flights, video and sync' },
];

/** What the player can do besides moving the cursor; each one is implemented in the tour service. */
export const HOOKS = ['panel', 'list', 'fakeGenerate', 'tool', 'select', 'view', 'ai', 'demoLog', 'demoVideo', 'autoSync', 'play', 'pause', 'closeBoxes', 'layoutReset', 'orbit', 'flightSite', 'hide', 'camera', 'fakeSync', 'arrange', 'ghost', 'show'] as const;
export type Hook = (typeof HOOKS)[number];

export type At = readonly [number, number];

export type TourAction =
  /** Move the cursor over a target. */
  | { do: 'point'; at: string; to?: At }
  /** Move there and click it (`press` shows the click without sending it, before a hook does the work). */
  | { do: 'click' | 'press'; at: string; to?: At }
  /** Type into an input, one character at a time (then `change`). */
  | { do: 'type'; at: string; text: string }
  /** Press, move and release inside a target (drawing on the plan, orbiting the 3D view). */
  | { do: 'drag'; at: string; from: At; to: At; ms?: number }
  | { do: 'wait'; ms: number }
  | { do: 'hook'; hook: Hook; arg?: string };

export interface Beat {
  /** The caption shown while this beat plays (English; the language layer translates it). */
  say?: string;
  actions: TourAction[];
}

/**
 * What a snippet expects to find before it starts, so it plays the same on its own as inside a tour: `zone` = the
 * Bandos map of a new bando, `model` = a generated model open in the 2D editor (the tour's copy of the Chiari e Forti
 * example), `site` = the bando the demo flight belongs to (a copy of the example without its place), `log` / `video` =
 * the demo flight and its video loaded (on that bando).
 */
export type Need = 'zone' | 'model' | 'site' | 'log' | 'video';

export interface Snippet {
  id: string;
  section: Section;
  needs?: Need[];
  /** Short title: the Guide panel, the help page heading, the hover tip. */
  title: string;
  beats: Beat[];
  /** `data-tour` marks that show this snippet as a hover tip. */
  hover?: string[];
}

export interface Tour {
  id: string;
  title: string;
  about: string;
  snippets: string[];
  /** Leave the panels as the tour arranged them (the showcase ends on its finished screen); others put the layout back. */
  keepLayout?: boolean;
}

const p = (at: string, to?: At): TourAction => ({ do: 'point', at, ...(to ? { to } : {}) });
const click = (at: string, to?: At): TourAction => ({ do: 'click', at, ...(to ? { to } : {}) });
const press = (at: string, to?: At): TourAction => ({ do: 'press', at, ...(to ? { to } : {}) });
const wait = (ms: number): TourAction => ({ do: 'wait', ms });
const hook = (h: Hook, arg?: string): TourAction => ({ do: 'hook', hook: h, ...(arg !== undefined ? { arg } : {}) });
const drag = (at: string, from: At, to: At, ms = 900): TourAction => ({ do: 'drag', at, from, to, ms });
const type = (at: string, text: string): TourAction => ({ do: 'type', at, text });

/** The building the model snippets work on, in the Chiari e Forti example. */
const SHED = 'Boat house';

export const SNIPPETS: readonly Snippet[] = [



  {
    id: 'place',
    section: 'bandos',
    title: 'Start a bando: find the place',
    hover: ['new-bando', 'search'],
    beats: [
      { say: 'New bando opens the map. Search a place, or paste its coordinates.', actions: [hook('panel', 'studio'), hook('list'), click('new-bando'), wait(900), type('search', '45.64690, 12.30022'), click('search-go'), wait(1800)] },
      { say: 'Frame the area: move the map, pull the frame by its edges and corners, turn it with the yellow knob.', actions: [p('map', [0.25, 0.3]), wait(700), p('map', [0.75, 0.7]), wait(1600)] },
    ],
  },
  {
    id: 'generate',
    needs: ['zone'],
    section: 'bandos',
    title: 'Generate the 3D model',
    hover: ['generate'],
    beats: [
      { say: 'Generate 3D downloads buildings, roads, trees, water and the real ground, and builds the model.', actions: [press('generate'), hook('fakeGenerate'), wait(1200)] },
      { say: 'The model is drawn over the map: each building can be moved, resized, reshaped and turned.', actions: [p('map', [0.55, 0.5]), wait(2600)] },
    ],
  },
  {
    id: 'look-3d',
    needs: ['model'],
    section: 'model',
    title: 'Look around in 3D',
    hover: ['view-3d'],
    beats: [
      { say: 'Switch to 3D to look around: drag to orbit, the wheel zooms.', actions: [click('view-3d'), wait(1200), drag('map', [0.35, 0.6], [0.65, 0.55], 1400), wait(600), drag('map', [0.5, 0.5], [0.45, 0.62], 900), wait(1400)] },
      { say: 'Back to 2D to edit the plan.', actions: [click('view-2d'), wait(900)] },
    ],
  },
  {
    id: 'select',
    needs: ['model'],
    section: 'model',
    title: 'Select a building',
    hover: ['tool-select'],
    beats: [{ say: 'Click a building to select it: the inspector shows its size, floors, roof and openings.', actions: [hook('tool', 'select'), p('map', [0.6, 0.5]), hook('select', SHED), wait(2400), p('inspector', [0.5, 0.25]), wait(1600)] }],
  },
  {
    id: 'adjust',
    needs: ['model'],
    section: 'model',
    title: 'Change a building',
    hover: ['wall-height'],
    beats: [
      { say: 'Every value can be changed: here the wall height.', actions: [hook('select', SHED), type('wall-height', '8'), wait(1600)] },
      { say: 'Add a floor, take the roof off, make it a ruin: each change is one Undo step.', actions: [p('add-floor'), wait(1800)] },
    ],
  },
  {
    id: 'add-building',
    needs: ['model'],
    section: 'model',
    title: 'Draw a building',
    hover: ['tool-building'],
    beats: [
      { say: 'Building tool: drag a rectangle on free ground. It snaps flush to close neighbours.', actions: [hook('tool', 'building'), wait(500), drag('map', [0.12, 0.72], [0.24, 0.86], 1100), wait(1400)] },
      { actions: [hook('tool', 'select'), wait(400)] },
    ],
  },
  {
    id: 'trees',
    needs: ['model'],
    section: 'model',
    title: 'Plant trees with the brush',
    hover: ['tool-scatter'],
    beats: [
      { say: 'The tree brush plants trees along a stroke, or fills a square, a circle or a hand-drawn area.', actions: [hook('tool', 'scatter'), wait(500), drag('map', [0.08, 0.3], [0.2, 0.62], 1500), wait(1400)] },
      { actions: [hook('tool', 'select'), wait(400)] },
    ],
  },
  {
    id: 'library',
    needs: ['model'],
    section: 'model',
    title: 'Place a block from the Library',
    hover: ['library'],
    beats: [
      { say: 'The Library has ready-made objects, buildings and patterns, from the online catalogue and your own.', actions: [click('library'), wait(1500)] },
      { say: 'Pick one, then click the map to place it.', actions: [click('block-abando/race-gate'), wait(700), click('block-place'), wait(500), click('map', [0.3, 0.45]), wait(1400)] },
      { actions: [click('library'), hook('closeBoxes'), wait(400)] },
    ],
  },
  {
    id: 'ai',
    needs: ['model'],
    section: 'ai',
    title: 'Edit with the AI assistant',
    hover: ['ai'],
    beats: [
      { say: 'The AI assistant edits from plain words. It runs in your browser, or on your own server.', actions: [hook('select', SHED), hook('ai', 'on'), click('ai'), wait(1400)] },
      { say: 'Ask for a change to the selected building.', actions: [type('ai-input', 'a door in the middle of the north wall, and 8 windows on the east side'), press('ai-send'), hook('ai', 'door'), wait(1800)] },
      { say: 'What changed is listed for review, and Undo is one click. The app reports what it really did, not what the model claims.', actions: [p('ai-changes'), wait(3200), click('ai'), hook('ai', 'off')] },
    ],
  },
  {
    id: 'log',
    needs: ['site'],
    section: 'flight',
    title: 'Load a flight log',
    hover: ['upload-log'],
    beats: [{ say: 'Drop a Betaflight Blackbox log (CSV), a GPX or a JSON file on the page, or press Upload log.', actions: [hook('panel', 'flights'), press('upload-log'), hook('demoLog'), wait(2600)] }],
  },
  {
    id: 'video',
    needs: ['site'],
    section: 'flight',
    title: 'Load the flight video',
    hover: ['load-video'],
    beats: [{ say: 'Load the video of the same flight. It stays on this computer; nothing is uploaded.', actions: [hook('panel', 'video'), press('load-video'), hook('demoVideo'), wait(2400)] }],
  },
  {
    id: 'sync',
    needs: ['log', 'video'],
    section: 'flight',
    title: 'Sync the video with the log',
    hover: ['auto-sync'],
    beats: [{ say: 'Auto-sync lines up the video with the log from how the picture moves; flips and rolls are the best markers.', actions: [hook('panel', 'video'), press('auto-sync'), hook('autoSync'), wait(2200)] }],
  },
  {
    id: 'replay',
    needs: ['log'],
    section: 'flight',
    title: 'Replay the flight',
    hover: ['play'],
    beats: [{ say: 'Play: the drone flies its real path through the model, with the video in step.', actions: [hook('panel', 'timeline'), click('play'), wait(6000), hook('pause')] }],
  },

  // ---- the welcome tour (showcase) (Welcome → a bando → a synced replay → every camera): plays by itself
  {
    id: 'sc-welcome',
    section: 'showcase',
    title: 'Welcome',
    beats: [
      { say: 'OpenBando: your bandos in 3D, and your flights back inside them.', actions: [hook('layoutReset'), hook('orbit', 'on'), wait(2600)] },
      { say: 'Build the place. Fly it again. Share it, or keep it secret.', actions: [p('welcome-build', [0.5, 0.3]), wait(900), click('welcome-fly', [0.5, 0.3]), wait(2200), p('welcome-share', [0.5, 0.3]), wait(900)] },
    ],
  },
  {
    id: 'sc-bando',
    section: 'showcase',
    title: 'Open a bando',
    beats: [
      { say: 'Open a bando: public or hidden. A 3D model to explore.', actions: [click('close-welcome'), hook('panel', 'studio'), hook('list'), wait(700), press('example-villetta-no-place'), hook('flightSite'), hook('orbit', 'off'), hook('camera', 'orbit'), wait(1200), hook('hide', 'studio'), wait(1600)] },
    ],
  },
  {
    id: 'sc-load',
    section: 'showcase',
    title: 'Load the flight',
    beats: [
      { say: 'Drop the Blackbox log and the DVR of the same flight.', actions: [hook('hide', 'studio'), hook('panel', 'flights'), press('upload-log'), hook('demoLog'), wait(900), hook('panel', 'video'), press('load-video'), hook('demoVideo'), wait(900)] },
      { say: 'Auto-sync matches the picture with the gyro: no clapperboard needed.', actions: [hook('show', 'timeline'), press('auto-sync'), hook('fakeSync'), wait(900)] },
    ],
  },
  {
    id: 'sc-replay',
    section: 'showcase',
    title: 'Replay in sync',
    beats: [
      { say: 'Speed, attitude, sticks and the path: every number of the flight, in step with the video.', actions: [hook('arrange', 'replay'), hook('camera', 'chase'), click('play'), wait(8500)] },
      { say: 'Ride along: the FPV camera, in step with the video.', actions: [hook('arrange', 'cameras'), wait(7000)] },
      { say: 'The video turns to glass: the model behind it, in step.', actions: [hook('ghost', 'video'), wait(6000)] },
      { say: 'OpenBando. Build, Fly, Share.', actions: [wait(3500)] },
    ],
  },
];

/** The welcome tour (the showcase), about a minute: Welcome, a bando without its address, a log and its video synced, every camera. */
export const SHOWCASE: Tour = { id: 'showcase', title: 'Welcome', about: 'What OpenBando does, in a minute, played by itself.', snippets: ['sc-welcome', 'sc-bando', 'sc-load', 'sc-replay'], keepLayout: true };

export const TOURS: readonly Tour[] = [
  SHOWCASE,
  { id: 'full', title: 'Full tour', about: 'From a new bando to a synced replay.', snippets: ['place', 'generate', 'look-3d', 'select', 'adjust', 'add-building', 'trees', 'library', 'ai', 'log', 'video', 'sync', 'replay'] },
  { id: 'build', title: 'Build a bando', about: 'Find the place, generate the model, edit it.', snippets: ['place', 'generate', 'look-3d', 'select', 'adjust', 'add-building', 'trees', 'library'] },
  { id: 'fly', title: 'Fly and sync', about: 'Load a flight and its video, sync them, replay.', snippets: ['log', 'video', 'sync', 'replay'] },
];

export const SNIPPET_BY_ID: ReadonlyMap<string, Snippet> = new Map(SNIPPETS.map((s) => [s.id, s]));

/** Problems in the guide data (unknown snippets or hooks, empty beats, duplicates): the tests keep it empty. */
export function checkGuide(snippets: readonly Snippet[] = SNIPPETS, tours: readonly Tour[] = TOURS): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const s of snippets) {
    if (ids.has(s.id)) out.push(`duplicate snippet ${s.id}`);
    ids.add(s.id);
    if (!s.beats.length || !s.beats.some((b) => b.say)) out.push(`${s.id}: needs at least one beat with a caption`);
    for (const b of s.beats) {
      if (!b.actions.length) out.push(`${s.id}: a beat with no action`);
      for (const a of b.actions) if (a.do === 'hook' && !HOOKS.includes(a.hook)) out.push(`${s.id}: unknown hook ${a.hook}`);
    }
  }
  for (const t of tours) for (const id of t.snippets) if (!ids.has(id)) out.push(`${t.id}: unknown snippet ${id}`);
  return out;
}

/** A tour as one list of beats, each with the snippet it belongs to (for the progress line). */
export function tourBeats(t: Tour, by: ReadonlyMap<string, Snippet> = SNIPPET_BY_ID): { snippet: Snippet; beat: Beat }[] {
  return t.snippets.flatMap((id) => {
    const s = by.get(id);
    return s ? s.beats.map((beat) => ({ snippet: s, beat })) : [];
  });
}

/**
 * Where Back goes from beat `i` (0-based) of a list whose snippet starts are flagged in `first`: past a snippet's first
 * beat, to that first beat (the snippet plays again from the start, as it can on its own); on a first beat, to the
 * previous snippet's first beat; on the very first beat, nowhere else.
 */
export function backTarget(first: readonly boolean[], i: number): number {
  const startOf = (k: number): number => {
    while (k > 0 && !first[k]) k--;
    return Math.max(0, k);
  };
  const s = startOf(i);
  return s < i ? s : startOf(Math.max(0, s - 1));
}

/** Roughly how long beats take to play, milliseconds (waits, drags, typing, cursor moves). */
export function playTime(beats: readonly Beat[]): number {
  let ms = 0;
  for (const b of beats)
    for (const a of b.actions) {
      if (a.do === 'wait') ms += a.ms;
      else if (a.do === 'drag') ms += (a.ms ?? 900) + 500;
      else if (a.do === 'type') ms += a.text.length * 55 + 500;
      else if (a.do !== 'hook') ms += 650;
    }
  return ms;
}

/** The snippet a hover tip shows for a `data-tour` mark. */
export function snippetForMark(mark: string, snippets: readonly Snippet[] = SNIPPETS): Snippet | null {
  return snippets.find((s) => s.hover?.includes(mark)) ?? null;
}

/** The scripted answers the tour gives in place of the AI model (the app then runs them like any answer). */
export const AI_SCRIPTS: Readonly<Record<string, string>> = {
  door: JSON.stringify({
    reply: 'A door in the middle of the north wall, and eight windows along the east side.',
    commands: [
      { op: 'add_door', side: 'north', position: 0.5, width: 5, height: 4 },
      ...[0.1, 0.22, 0.34, 0.46, 0.58, 0.7, 0.82, 0.94].map((position) => ({ op: 'add_window', side: 'east', position, width: 2, height: 1.4, sill: 3 })),
    ],
  }),
};

/**
 * A link that plays the showcase by itself: `?tour=showcase` (also `#tour=showcase`), with `lang=it` / `lang=en` to set
 * the language. Null when the address asks for nothing.
 */
export function showcaseLink(search: string, hash = ''): { lang: 'it' | 'en' | null } | null {
  const q = new URLSearchParams(search);
  const h = new URLSearchParams(hash.replace(/^#/, ''));
  if ((q.get('tour') ?? h.get('tour')) !== 'showcase') return null;
  const lang = q.get('lang') ?? h.get('lang');
  return { lang: lang === 'it' || lang === 'en' ? lang : null };
}
