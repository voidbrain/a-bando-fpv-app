/**
 * Build the example bandos in `library/bandos/` from map data and on-site survey: `npm run examples`.
 *
 * Inputs (`tools/examples/data/`): what the app's own generator made from OpenStreetMap (`*.osm.json`, the spec as
 * generated, before any edit) and an Overpass answer for waterways OSM has only as centre lines. The
 * refinements below come from the pilot's photos and survey points (lat / lon of corners, a ladder, passages); each is
 * commented with what it is. Blocks come from the published catalogue (`public/library/catalog.json`).
 *
 * Output: `chiari-e-forti.json` and `playground.json` (a made-up place, see below). Generated ids are renumbered the
 * same way on every run, so rebuilding does not churn the files. Then run `node tools/build-catalog.mjs` (the npm script
 * does) to publish them.
 *
 * `villetta-no-place.json` is not built here: that place is kept private, so its sources (map data, survey points)
 * are not in the repository. The file is the app's own export with the place hidden; change it in the app and export
 * it again (Bandos → Export, a bando whose place is hidden stays hidden).
 *
 * Map data © OpenStreetMap contributors (ODbL).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { stripOutline, unionOutline } from '../../src/app/core/layers';
import { applyPattern, placeBlock, sanitizeBlock, type BlockSpec } from '../../src/app/core/blocks';
import { toLocalAt } from '../../src/app/core/geo';
import { emptySpec, sanitizeSpec, type BuildingSpec, type SiteSpec, type Vec2, type LevelSpec, type TreeSpec } from '../../src/app/core/site-spec';

const ROOT = process.cwd(); // run from the repository root (npm run examples)
const DATA = ROOT + '/tools/examples/data';
const cat = JSON.parse(readFileSync(ROOT + '/public/library/catalog.json', 'utf8')).blocks as unknown[];
const block = (id: string): BlockSpec => sanitizeBlock(cat.find((b) => (b as { id: string }).id === id))!;
const rot = (p: Vec2, at: Vec2, deg: number): Vec2 => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: at.x + p.x * c - p.z * s, z: at.z + p.x * s + p.z * c };
};
const lv = (baseY: number, height: number, roof: LevelSpec['roof'], extra: Partial<LevelSpec> = {}): LevelSpec => ({ baseY, height, sides: { n: true, s: true, e: true, w: true }, doors: {}, partitions: [], roof, roofRise: 2.5, ...extra });
const floors = (n: number, h: number, roof: LevelSpec['roof'], extra: Partial<LevelSpec> = {}): LevelSpec[] => Array.from({ length: n }, (_, i) => lv(i * h, h, i === n - 1 ? roof : 'none', i === n - 1 ? extra : {}));
const door = (c: number, w = 1.2, h = 2.3) => ({ kind: 'door' as const, c, w, h });
const round = (spec: SiteSpec): SiteSpec => JSON.parse(JSON.stringify(spec, (k, v) => (typeof v === 'number' && !Number.isInteger(v) && k !== 'lat' && k !== 'lon' && k !== 'datum' ? Math.round(v * 1000) / 1000 : v)));
/** Generated ids (`st-…-…`, `blk-…-…`) renumbered in order of appearance, so the same input gives the same file. */
function stableIds<T>(value: T, prefix: string): T {
  const map = new Map<string, string>();
  return JSON.parse(JSON.stringify(value), (k, v) => {
    if ((k === 'id' || k === 'inst') && typeof v === 'string' && /^[a-z]+-[a-z0-9]+-[a-z0-9]+$/.test(v)) {
      if (!map.has(v)) map.set(v, `${prefix}-${v.split('-')[0]}-${map.size + 1}`);
      return map.get(v);
    }
    return v;
  });
}
/** Write one example; `release` goes up whenever it changes in a way its copies should hear about. */
function finish(spec: SiteSpec, id: string, name: string, file: string, about: string, release = 1): SiteSpec {
  spec.id = id;
  spec.name = name;
  spec.createdAt = Date.UTC(2026, 9, 23);
  const t = spec.terrain?.base;
  if (t) delete (t as { fetchedAt?: number }).fetchedAt;
  const ok = sanitizeSpec(stableIds(round(spec), id));
  if (!ok) throw new Error(name + ' does not pass sanitizeSpec');
  writeFileSync(file, JSON.stringify({ about, release, ...ok }, null, 1) + '\n');
  console.log(name, ok.buildings.length, 'buildings', ok.structures?.length, 'structures', ok.trees.length, 'trees');
  return ok;
}
/** Sutherland-Hodgman: a polygon cut to a rectangle. */
function clipRect(poly: Vec2[], r: { x0: number; x1: number; z0: number; z1: number }): Vec2[] {
  const edges: [(p: Vec2) => boolean, (a: Vec2, b: Vec2) => Vec2][] = [
    [(p) => p.x >= r.x0, (a, b) => ({ x: r.x0, z: a.z + ((b.z - a.z) * (r.x0 - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= r.x1, (a, b) => ({ x: r.x1, z: a.z + ((b.z - a.z) * (r.x1 - a.x)) / (b.x - a.x) })],
    [(p) => p.z >= r.z0, (a, b) => ({ x: a.x + ((b.x - a.x) * (r.z0 - a.z)) / (b.z - a.z), z: r.z0 })],
    [(p) => p.z <= r.z1, (a, b) => ({ x: a.x + ((b.x - a.x) * (r.z1 - a.z)) / (b.z - a.z), z: r.z1 })],
  ];
  let out = poly;
  for (const [inside, cut] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[(i + src.length - 1) % src.length]!, b = src[i]!;
      if (inside(b)) {
        if (!inside(a)) out.push(cut(a, b));
        out.push(b);
      } else if (inside(a)) out.push(cut(a, b));
    }
  }
  return out;
}
/**
 * A ground-floor passage through a building, on the line from `a` to `b` (two points outside it, site metres): an
 * opening `w` wide and `h` high wherever the line crosses an outer wall.
 */
function passage(bd: BuildingSpec, a: Vec2, b: Vec2, w: number, h: number): number {
  const an = (bd.rotDeg * Math.PI) / 180, c = Math.cos(an), s = Math.sin(an);
  const toLocal = (p: Vec2): Vec2 => ({ x: (p.x - bd.pos.x) * c + (p.z - bd.pos.z) * s, z: -(p.x - bd.pos.x) * s + (p.z - bd.pos.z) * c });
  const A = toLocal(a), B = toLocal(b);
  const outline = bd.footprint ?? [{ x: -bd.length / 2, z: -bd.width / 2 }, { x: bd.length / 2, z: -bd.width / 2 }, { x: bd.length / 2, z: bd.width / 2 }, { x: -bd.length / 2, z: bd.width / 2 }];
  const l0 = bd.levels[0]!;
  let n = 0;
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]!, q = outline[(i + 1) % outline.length]!;
    const d = (B.x - A.x) * (q.z - p.z) - (B.z - A.z) * (q.x - p.x);
    if (Math.abs(d) < 1e-9) continue;
    const t = ((p.x - A.x) * (q.z - p.z) - (p.z - A.z) * (q.x - p.x)) / d, u = ((p.x - A.x) * (B.z - A.z) - (p.z - A.z) * (B.x - A.x)) / d;
    if (t < 0 || t > 1 || u < 0 || u > 1) continue;
    const x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t;
    if (bd.footprint) (l0.wallOpenings ??= []).push({ kind: 'door', x, z, w, h });
    else {
      const side = Math.abs(p.z - q.z) < 1e-6 ? (p.z < 0 ? 'n' : 's') : p.x < 0 ? 'w' : 'e';
      const cc = side === 'n' || side === 's' ? x + bd.length / 2 : z + bd.width / 2;
      (l0.doors[side] ??= []).push({ kind: 'door', c: cc, w, h });
    }
    n++;
  }
  return n;
}

// ---------- Chiari e Forti ----------
{
  const s = JSON.parse(readFileSync(DATA + '/chiari-e-forti.osm.json', 'utf8')) as SiteSpec;
  const W = JSON.parse(readFileSync(DATA + '/chiari-e-forti.water.overpass.json', 'utf8')) as { elements: { tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[] };
  const local = (lat: number, lon: number): Vec2 => { const [x, z] = toLocalAt(s.origin, lat, lon, { rot: 0, dx: 0, dz: 0 }); return { x, z }; };
  const B = (n: number) => s.buildings.find((b) => b.name === 'Building ' + n)!;
  // only the factory: the houses and sheds along Via Macello (west of the Melma) go, and so do the roads
  const drop = new Set([1, 16, 22, 29, 30, 32, 33, 34, 35, 37, 38, 39, 40, 41, 43, 44, 45, 17, 23, 25].map((n) => 'Building ' + n));
  s.buildings = s.buildings.filter((b) => !drop.has(b.name));
  s.roads = [];
  s.pads = [];
  // the gravel yard between the blocks and the river; the rest is overgrown ground
  s.surfaces = [{ kind: 'gravel', pts: [{ x: -12, z: -5 }, { x: 40, z: -15 }, { x: 75, z: 10 }, { x: 70, z: 45 }, { x: 10, z: 55 }, { x: -15, z: 40 }] }];
  // water, cut to the terrain (the selected area): the Sile, and one water for the canal and the Melma's pond west of
  // the yard (the Melma is only a centre line in OSM: a 16 m strip, merged with the canal). Where the Melma runs out to
  // the river it is under the Sile's own outline already, so that stretch is not added again.
  const area = { x0: -190, x1: 190, z0: -165, z1: 160 };
  const [river, canal] = [...(s.waters ?? [])].sort((a, b) => b.pts.length - a.pts.length);
  const main = W.elements.filter((e) => e.tags?.['name'] === 'Melma' && !e.tags?.['tunnel']).sort((a, b) => (b.geometry?.length ?? 0) - (a.geometry?.length ?? 0))[0]!;
  const pondLine = (main.geometry ?? []).map((g) => local(g.lat, g.lon)).filter((p) => p.z > -100);
  s.waters = [
    { ...river!, pts: clipRect(river!.pts, area) },
    { depth: 1.6, pts: unionOutline([clipRect(canal!.pts, area), stripOutline(pondLine, 16)], 1) },
  ];
  const brick = '#a65d42', plaster = '#d9d5cc', yellow = '#d6b45f', tiles = '#a4553b', white = '#d8d6cf', grey = '#8f8d86';
  type Look = { name?: string; floors: number; h?: number; color: string; roof: 'gable' | 'flat'; roofColor: string; ruin?: number; roofless?: boolean; crenels?: boolean };
  const cream = '#e6dcc0', ochre = '#e3c27a', red = '#b4664a';
  const looks: Record<number, Look> = {
    // the north-east blocks: the long row (2, 9, 11, 20), the big block by the cuore tower (4), the white-roofed ones
    4: { name: 'Cuore block', floors: 4, color: brick, roof: 'flat', roofColor: grey, ruin: 0.4 },
    2: { name: 'North wing', floors: 4, color: brick, roof: 'gable', roofColor: grey, ruin: 0.45 },
    9: { floors: 4, color: brick, roof: 'gable', roofColor: white, ruin: 0.15 },
    11: { floors: 4, color: brick, roof: 'gable', roofColor: grey, ruin: 0.2 },
    20: { name: 'South wing', floors: 4, color: brick, roof: 'gable', roofColor: tiles, ruin: 0.35 },
    19: { floors: 3, color: plaster, roof: 'gable', roofColor: white, ruin: 0.15 },
    14: { floors: 3, color: yellow, roof: 'flat', roofColor: grey, ruin: 0.2 },
    15: { floors: 3, color: brick, roof: 'gable', roofColor: white, ruin: 0.08 },
    8: { name: 'Square block', floors: 4, color: brick, roof: 'flat', roofColor: grey, ruin: 0.12 },
    36: { floors: 1, color: brick, roof: 'flat', roofColor: grey, ruin: 0.4 },
    // the brick block with the tiled roofs in the middle of the yard
    // the yard block: brick, five floors under tiles, a cream silo wing in front and a lower wing to the east
    10: { name: 'Yard block', floors: 5, color: brick, roof: 'gable', roofColor: tiles, ruin: 0.1 },
    21: { name: 'Silo wing', floors: 5, color: cream, roof: 'gable', roofColor: tiles, ruin: 0.1 },
    27: { floors: 3, color: brick, roof: 'gable', roofColor: tiles, ruin: 0.12 },
    // the riverside cluster: tiled roofs to the west, roofless shells to the east (Buildings 7 and 18)
    // west of the ruined mill: the ochre five-floor blocks with tiled roofs, lower wings, and the tall white tower
    3: { name: 'West wing', floors: 3, color: cream, roof: 'flat', roofColor: tiles, ruin: 0.15 },
    5: { floors: 5, h: 3.8, color: ochre, roof: 'flat', roofColor: tiles, ruin: 0.2 },
    13: { name: 'Ochre block', floors: 5, h: 3.8, color: ochre, roof: 'gable', roofColor: tiles, ruin: 0.15 },
    26: { name: 'White tower', floors: 7, color: white, roof: 'flat', roofColor: grey, ruin: 0.1 },
    28: { floors: 2, color: cream, roof: 'gable', roofColor: tiles, ruin: 0.2 },
    42: { floors: 1, color: brick, roof: 'flat', roofColor: grey, ruin: 0.4 },
    // the ruined mill facing the yard: an open shell with battlements, its walls still standing
    7: { name: 'Ruined mill', floors: 5, h: 4.5, color: red, roof: 'flat', roofColor: tiles, ruin: 0.18, roofless: true, crenels: true },
    18: { name: 'Loading dock', floors: 1, color: '#b9b5ab', roof: 'flat', roofColor: '#b9b5ab' },
    // on the river bank
    6: { name: 'River shed', floors: 1, h: 7, color: '#e9e7e0', roof: 'gable', roofColor: '#c9c8c2', ruin: 0.1 },
    12: { name: 'River shed', floors: 1, h: 7, color: '#e9e7e0', roof: 'gable', roofColor: '#c9c8c2', ruin: 0.1 },
    24: { name: 'Boat house', floors: 2, h: 3.5, color: plaster, roof: 'gable', roofColor: '#6f8a96' },
    31: { floors: 2, h: 3.5, color: brick, roof: 'gable', roofColor: tiles, ruin: 0.2 },
  };
  const styled = new Set<string>();
  for (const [n, k] of Object.entries(looks)) {
    const b = B(+n);
    if (b) styled.add(b.id);
    if (!b) throw new Error('no Building ' + n);
    const h = k.h ?? 4;
    b.levels = floors(k.floors, h, b.footprint ? 'flat' : k.roof, { roofRise: k.roof === 'gable' ? 3 : 1, roofColor: k.roofColor });
    if (!b.footprint) b.levels[0]!.doors = { s: [door(Math.min(4, b.length / 3), 3, 3.2)], n: [door(b.length / 2, 1.2, 2.3)] };
    b.color = k.color;
    if (k.name) b.name = k.name;
    if (k.ruin) b.ruin = k.ruin;
    else delete b.ruin;
    if (k.roofless) b.roofless = true;
    if (k.crenels) b.crenels = true;
  }
  // the mill's tower: brick, arched windows, battlements, at the river end on the yard side (a little proud of the
  // shell's walls so their faces never coincide)
  const mill = s.buildings.find((b) => b.name === 'Ruined mill')!;
  s.buildings.push({ id: 'b-mill-tower', name: 'Mill tower', pos: rot({ x: -mill.length / 2 + 4.5, z: mill.width / 2 - 4.5 }, mill.pos, mill.rotDeg), rotDeg: mill.rotDeg, length: 9.6, width: 9.6, color: red, ruin: 0.08, crenels: true, levels: floors(7, 4.5, 'flat', { roofRise: 1, roofColor: grey }) });
  // the loading dock along the yard: a concrete canopy on posts, open on every side
  const dock = s.buildings.find((b) => b.name === 'Loading dock')!;
  dock.levels = [{ ...lv(0, 4, 'flat', { roofRise: 0.5, roofColor: '#b9b5ab' }), sides: { n: false, s: false, e: false, w: false }, doors: {}, columns: Array.from({ length: Math.floor((dock.length - 2) / 6) + 1 }, (_, i) => ({ x: 1 + i * 6, z: dock.width - 0.6, size: 0.5 })) }];
  // the mill: its yard facade has fallen (the others stand), and a passage runs through its ground floor, west to east
  mill.ruinWalls = { s: 0.55 };
  mill.levels[0]!.doors = {};
  // the passages surveyed on site: through the mill from the yard to the west, and across Building 11
  if (passage(mill, local(45.64667478271263, 12.300042485427923), local(45.64674033669891, 12.299668186664164), 5, 4.2) !== 2) throw new Error('mill passage');
  const b11 = B(11) ?? s.buildings.find((b) => b.name === 'Building 11')!;
  b11.levels[0]!.wallOpenings = [];
  if (passage(b11, local(45.647568389805706, 12.3010475243404), local(45.64767888844379, 12.300787568303639), 4, 3.6) !== 2) throw new Error('building 11 passage');
  // the west wing's corner, surveyed: move the building so its nearest corner sits on it
  const ww = s.buildings.find((b) => b.name === 'West wing')!, surveyed = local(45.64700831880738, 12.298799145232039);
  const wa = (ww.rotDeg * Math.PI) / 180;
  const corners = (ww.footprint ?? []).map((p) => ({ x: ww.pos.x + p.x * Math.cos(wa) - p.z * Math.sin(wa), z: ww.pos.z + p.x * Math.sin(wa) + p.z * Math.cos(wa) }));
  const nearest = corners.reduce((m, p) => (Math.hypot(p.x - surveyed.x, p.z - surveyed.z) < Math.hypot(m.x - surveyed.x, m.z - surveyed.z) ? p : m));
  ww.pos = { x: ww.pos.x + surveyed.x - nearest.x, z: ww.pos.z + surveyed.z - nearest.z };
  // every building kept has its look above
  for (const b of s.buildings) if (!styled.has(b.id) && !b.id.startsWith('b-')) throw new Error('no look for ' + b.name);
  // landmarks: the water tower where OSM has a silo, the "cuore" tower at its real place by the Cuore block
  const silos = (s.structures ?? []).filter((x) => x.kind === 'silo').sort((a, b) => a.x - b.x);
  s.structures = [];
  placeBlock(s, block('abando/water-tower'), { h: 26, r: 4.5 }, { x: silos[0]!.x, z: silos[0]!.z }, 0);
  placeBlock(s, block('abando/sign-tower'), { h: 45, w: 5 }, local(45.648232044260574, 12.300752028304903), 33);
  s.structures.at(-1)!.name = 'Cuore tower';
  // only what is within 250 m of the water tower, in the middle of the site
  const wt = s.structures[0]!;
  s.buildings = s.buildings.filter((b) => Math.hypot(b.pos.x - wt.x, b.pos.z - wt.z) <= 250);
  s.droneStart = { x: 12, z: 36 }; // open gravel, clear of the island
  // the planted island in the middle of the yard, with its trees
  const pc = local(45.64678949075503, 12.30039072819024); // surveyed: the middle of the planted island
  const island = Array.from({ length: 12 }, (_, k) => ({ x: pc.x + Math.cos((k / 12) * Math.PI * 2) * 9, z: pc.z + Math.sin((k / 12) * Math.PI * 2) * 6.5 }));
  s.surfaces.push({ kind: 'grass', pts: island });
  s.trees = [
    { x: pc.x - 3, z: pc.z - 2, h: 13, r: 4.5, kind: 'd' },
    { x: pc.x + 3, z: pc.z + 2, h: 14, r: 5, kind: 'd' },
    { x: pc.x - 1, z: pc.z + 4, h: 10, r: 3.5, kind: 'd' },
  ];
  finish(s, 'example-chiari-e-forti', 'Chiari e Forti', ROOT + '/library/bandos/chiari-e-forti.json', 'The old Chiari e Forti oil factory on the Sile river: brick and ochre blocks with broken roofs, the roofless mill with its battlemented tower by the river, the water tower and the Olio Cuore sign tower.');
}


// ---------- Playground (a made-up place) ----------
// Nowhere real, so it has no place to hide: an old works on the edge of the fields, made to feel like a bando. The
// north is industrial (a barrel-vault store, a warehouse with a basement, silos, tanks, a crane over a half-built
// office); the south is open ground: a pond fed by a canal, hills with a tunnel through one, a crater, a ruined tower
// and a farmhouse, and a practice course of gates in the field by the take-off pad. Every catalogue block is used once
// or more, where it would be. Ground: brush strokes on flat land (no downloaded heights). Trees: seeded, the same on
// every run.
{
  const s = emptySpec({ lat: 0, lon: 0 }, 'Playground');
  s.privacy = 'hidden';
  s.extent = 160;
  s.groundColor = '#7f9d55';
  s.seed = 11;
  let seed = 20261024;
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const used = new Set<string>();
  const put = (id: string, at: Vec2, rotDeg = 0, params: Record<string, number | string> = {}): void => {
    placeBlock(s, block(id), params, at, rotDeg);
    used.add(id);
  };
  const pattern = (b: BuildingSpec, li: number, id: string, params: Record<string, number | string> = {}): void => {
    if (!applyPattern(b, li, block(id), params).length) throw new Error('pattern ' + id + ' did nothing on ' + b.name);
    used.add(id);
  };
  const lastBuilding = (): BuildingSpec => s.buildings.at(-1)!;
  const ring = (c: Vec2, rx: number, rz: number, n = 16, wobble = 0): Vec2[] =>
    Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2, r = 1 + (wobble ? Math.sin(k * 2.7) * wobble : 0);
      return { x: c.x + Math.cos(a) * rx * r, z: c.z + Math.sin(a) * rz * r };
    });

  // the ground: a rail embankment along the north, two hills in the south-east, a ramp up to the lower one, a crater
  s.terrain = {
    cell: 2,
    half: { e: 160, n: 140 },
    strokes: [
      { op: 'raise', pts: [{ x: -150, z: -118 }, { x: 150, z: -118 }], radius: 7, strength: 1.4 },
      { op: 'hill', pts: [{ x: 100, z: 92 }], radius: 36, strength: 11 },
      { op: 'hill', pts: [{ x: 55, z: 118 }], radius: 20, strength: 5 },
      { op: 'ramp', pts: [{ x: 22, z: 112 }, { x: 44, z: 117 }], radius: 5, strength: 4 },
      { op: 'crater', pts: [{ x: 40, z: 45 }], radius: 8, strength: 2.5 },
      { op: 'raise', pts: [{ x: -150, z: 30 }, { x: -140, z: -20 }, { x: -150, z: -60 }], radius: 14, strength: 2 },
    ],
  };
  // a tunnel through the big hill, east to west: its portals open where the hillside cuts it
  s.underground = [{ id: 'u-tunnel', name: 'Hill tunnel', outline: [{ x: 66, z: 87 }, { x: 134, z: 87 }, { x: 134, z: 95 }, { x: 66, z: 95 }], floor: 0, ceiling: 4.5, shape: 'vault', wall: 0.6 }];

  // water: the pond in the south-west and the canal that feeds it from the north, a bridge over the canal
  const pond = ring({ x: -85, z: 80 }, 28, 19, 20, 0.12);
  s.waters = [{ pts: unionOutline([pond, stripOutline([{ x: -125, z: -45 }, { x: -125, z: 40 }, { x: -108, z: 70 }], 8)], 1), depth: 2 }];
  put('abando/bridge', { x: -125, z: 10 }, 0, { l: 16, w: 4, h: 2.5, style: 'arch' });

  // roads: the access road from the south gate up to the yard, a track to the hills, a path to the pond, the railway
  s.roads = [
    { kind: 'road', width: 6, surface: 'asphalt', pts: [{ x: 0, z: 138 }, { x: 0, z: 60 }, { x: 0, z: -15 }, { x: 112, z: -15 }] },
    { kind: 'track', width: 3.5, pts: [{ x: 0, z: 62 }, { x: 30, z: 66 }, { x: 62, z: 74 }, { x: 70, z: 90 }] },
    { kind: 'path', width: 1.6, pts: [{ x: 0, z: 88 }, { x: -30, z: 90 }, { x: -52, z: 86 }] },
    { kind: 'rail', width: 3.2, pts: [{ x: -158, z: -118 }, { x: 158, z: -118 }] },
  ];
  s.surfaces = [
    { kind: 'concrete', pts: [{ x: 10, z: -96 }, { x: 102, z: -96 }, { x: 102, z: -20 }, { x: 10, z: -20 }] },
    { kind: 'asphalt', pts: [{ x: 16, z: 96 }, { x: 46, z: 96 }, { x: 46, z: 116 }, { x: 16, z: 116 }] },
    { kind: 'gravel', pts: ring({ x: -30, z: 128 }, 9, 6, 12) },
    { kind: 'sand', pts: ring({ x: -85, z: 80 }, 32, 23, 20, 0.12) },
    { kind: 'rubble', pts: ring({ x: -22, z: 52 }, 10, 7, 12, 0.2) },
    { kind: 'dirt', pts: ring({ x: 48, z: 70 }, 12, 6, 12, 0.25) }, // worn ground where the track turns up the hill
  ];
  s.droneStart = { x: -30, z: 128 };

  // the works: a barrel-vault store (the main store preset inside), a warehouse with a basement under a hole in its
  // floor, a half-built office under a crane, and the greenhouse frame by the rail
  put('abando/vault-shed', { x: 55, z: -58 }, 0, { len: 70, hall: 12, h: 5.5 });
  const store = lastBuilding();
  store.name = 'Vault store';
  store.ruin = 0.3;
  pattern(store, 0, 'abando/main-store');
  put('abando/small-warehouse', { x: -45, z: -80 }, 0, { l: 24, w: 12, h: 5 });
  const wh = lastBuilding();
  wh.ruin = 0.35;
  wh.basement = { height: 3 };
  wh.levels[0]!.voids = [{ x0: 16, z0: 3, x1: 20, z1: 7 }]; // the way down to the basement
  pattern(wh, 0, 'abando/facade-doors');
  const office: BuildingSpec = { id: 'b-office', name: 'Half-built offices', pos: { x: 70, z: 12 }, rotDeg: 0, length: 30, width: 14, color: '#c9c4b8', ruin: 0.5, levels: floors(3, 3.6, 'flat', { roofRise: 0.6, roofColor: '#8f8d86' }) };
  office.levels[1]!.voids = [{ x0: 4, z0: 4, x1: 8, z1: 9 }];
  s.buildings.push(office);
  pattern(office, 0, 'abando/facade-store');
  pattern(office, 1, 'abando/facade-panels');
  pattern(office, 2, 'abando/column-rows', { rows: 2, step: 6, inset: 3 });
  s.buildings.push({ id: 'b-greenhouse', name: 'Greenhouse frame', pos: { x: -95, z: -85 }, rotDeg: 0, length: 40, width: 14, frame: 'greenhouse', glass: false, levels: [lv(0, 3.5, 'gable', { roofRise: 2 })] });
  // in the south: the ruined tower (open to the sky, battlements, holes through its floors) and a fallen farmhouse
  const tower: BuildingSpec = { id: 'b-tower', name: 'Ruined tower', pos: { x: -80, z: 10 }, rotDeg: 0, length: 8, width: 8, color: '#a65d42', ruin: 0.25, roofless: true, crenels: true, levels: floors(6, 4, 'flat', { roofRise: 1 }) };
  for (const l of tower.levels.slice(1)) l.voids = [{ x0: 2.5, z0: 2.5, x1: 5.5, z1: 5.5 }];
  tower.levels[0]!.doors = { s: [door(4, 2.2, 3)], e: [door(4, 1.4, 2.4)] };
  s.buildings.push(tower);
  s.buildings.push({ id: 'b-farmhouse', name: 'Farmhouse', pos: { x: -30, z: 30 }, rotDeg: 8, length: 13, width: 9, color: '#d9d0bd', ruin: 0.7, levels: floors(2, 3.2, 'gable', { roofRise: 2.5, roofColor: '#a4553b' }) });

  // landmarks and the works' kit
  put('abando/chimney', { x: 98, z: -44 }, 0, { h: 34 });
  put('abando/storage-tank', { x: 116, z: -82 }, 0, { h: 8, r: 6 });
  put('abando/storage-tank', { x: 130, z: -60 }, 0, { h: 6, r: 4.5 });
  put('abando/silo', { x: -12, z: -96 }, 0, { h: 18, r: 4 });
  put('abando/silo', { x: 0, z: -96 }, 0, { h: 16, r: 4 });
  put('abando/water-tower', { x: 138, z: -18 }, 0, { h: 24, r: 4.5 });
  put('abando/water-tower-legs', { x: -132, z: -88 }, 0, { h: 14, r: 3 });
  put('abando/lantern-tower', { x: 125, z: -102 }, 0, { h: 30, w: 6 });
  put('abando/sign-tower', { x: -140, z: 122 }, 25, { h: 38, w: 5 });
  put('abando/tower-crane', { x: 100, z: 26 }, 200, { h: 40, jib: 45 });
  put('abando/scaffolding', { x: 70, z: 20.5 }, 0, { levels: 3 });
  put('abando/stairs', { x: 52, z: 22 }, 90, { h: 3.6, l: 6, w: 1.4 });
  put('abando/cage-ladder', { x: -75.6, z: 6 }, 90, { h: 20 });
  put('abando/lattice-tower', { x: -150, z: -106 }, 0, { h: 26, s: 3 });
  put('abando/lattice-tower', { x: 150, z: -106 }, 0, { h: 26, s: 3 });
  // the yard: containers, pallets, barrels, a truck and a burnt-out car; barriers closing the road at the end
  put('abando/container-stack', { x: 30, z: -10 }, 0);
  put('abando/container', { x: 58, z: -8 }, 90, { l: 12.2 });
  put('abando/pallet-stack', { x: 72, z: -24 }, 0, { n: 8 });
  put('abando/barrels', { x: 80, z: -24 }, 0);
  put('abando/truck', { x: 90, z: -10 }, 0);
  put('abando/car', { x: 44, z: -24 }, 30);
  put('abando/jersey-barriers', { x: 116, z: -15 }, 90, { n: 5 });
  // the road: the south gate, lamps, a bus shelter, a billboard, the old fuel station with a car left under it
  put('abando/gate-pillars', { x: 0, z: 132 }, 0, { gap: 7 });
  for (const z of [110, 70, 30]) put('abando/lamp-post', { x: 5, z }, 0, { h: 6 });
  put('abando/bus-shelter', { x: -7, z: 74 }, 90);
  put('abando/billboard', { x: 14, z: 124 }, 90, { w: 8, h: 4 });
  put('abando/fuel-canopy', { x: 31, z: 106 }, 0, { l: 16, w: 10, h: 5 });
  put('abando/car', { x: 28, z: 106 }, 0);
  // by the farmhouse: the rubble heap with the excavator, the ruins of a wall
  put('abando/excavator', { x: -16, z: 56 }, 210);
  put('abando/ruined-wall', { x: -40, z: 44 }, 15);
  put('abando/ruined-wall', { x: -60, z: 24 }, 95);
  // the practice course in the field by the pad: corner flags, gates to fly through, poles, a hurdle and a kicker
  for (const p of [{ x: -54, z: 62 }, { x: -12, z: 62 }, { x: -12, z: 122 }, { x: -54, z: 122 }]) put('abando/flag-pole', p, 0, { h: 3.5 });
  put('abando/race-gate', { x: -33, z: 64 }, 0, { w: 2, h: 2 });
  put('abando/dive-gate', { x: -14, z: 92 }, 90, { h: 3 });
  put('abando/ladder-gate', { x: -33, z: 120 }, 0);
  put('abando/double-gate', { x: -52, z: 92 }, 90);
  put('abando/hurdle', { x: -40, z: 104 }, 0, { h: 1, w: 3 });
  put('abando/slalom-poles', { x: -46, z: 76 }, 0, { n: 5, gap: 4 });
  put('abando/ramp', { x: -24, z: 106 }, 0, { h: 2, l: 10, w: 3 });

  // fences: a chain-link fence along the works, the phone line over the rail, a hedge by the road, brambles by the
  // tower, the brick wall left of the farm
  s.walls = [
    { a: { x: 8, z: -100 }, b: { x: 104, z: -100 }, height: 2.2, thick: 0.1, material: 'chainlink' },
    { a: { x: 104, z: -100 }, b: { x: 104, z: -24 }, height: 2.2, thick: 0.1, material: 'chainlink' },
    { a: { x: -150, z: -108 }, b: { x: 150, z: -108 }, height: 8, thick: 0.3, material: 'wires' },
    { a: { x: -6, z: 128 }, b: { x: -6, z: 82 }, height: 1.8, thick: 1, material: 'hedge' },
    { a: { x: -98, z: 22 }, b: { x: -70, z: 34 }, height: 1.6, thick: 2, material: 'bramble' },
    { a: { x: -46, z: 18 }, b: { x: -46, z: 44 }, height: 2, thick: 0.4, material: 'brick' },
  ];

  // trees: a wood in the north-west, around the pond, conifers on the hills (clear of the tunnel line), a row along the road
  const trees: TreeSpec[] = [];
  const grove = (c: Vec2, r: number, n: number, kind: 'd' | 'c' | 'mix', keep: (p: Vec2) => boolean = () => true): void => {
    for (let k = 0, tries = 0; k < n && tries < n * 20; tries++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r, p = { x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d };
      if (!keep(p) || trees.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < 4.5)) continue;
      const k2 = kind === 'mix' ? (rnd() < 0.5 ? 'd' : 'c') : kind, h = 8 + rnd() * 9;
      trees.push({ x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, h: Math.round(h * 10) / 10, r: Math.round((k2 === 'd' ? h * 0.32 : h * 0.22) * 10) / 10, kind: k2 });
      k++;
    }
  };
  const inPond = (p: Vec2): boolean => ((p.x + 85) / 34) ** 2 + ((p.z - 80) / 25) ** 2 < 1;
  grove({ x: -110, z: -30 }, 26, 26, 'mix', (p) => Math.abs(p.x + 125) > 7 && Math.hypot(p.x + 80, p.z - 10) > 12);
  grove({ x: -85, z: 80 }, 44, 18, 'd', (p) => !inPond(p) && p.x < -58 && p.z < 128);
  grove({ x: 100, z: 95 }, 40, 22, 'c', (p) => Math.abs(p.z - 91) > 9 && p.z < 136 && p.x < 150);
  for (let z = 36; z <= 126; z += 9) trees.push({ x: 11, z, h: 12, r: 3.6, kind: 'd' });
  s.trees = trees;
  for (const p of [{ x: -58, z: 100 }, { x: -60, z: 66 }, { x: -9, z: 40 }, { x: 8, z: -30 }, { x: -70, z: -60 }, { x: 60, z: 70 }]) put('abando/bush', p, rnd() * 360, { s: 1.2 + rnd() });

  // every block of the catalogue is somewhere in here
  const missing = cat.map((b) => (b as { id: string }).id).filter((id) => !used.has(id));
  if (missing.length) throw new Error('Playground does not use ' + missing.join(', '));
  finish(s, 'example-playground', 'Playground', ROOT + '/library/bandos/playground.json', 'A made-up works on the edge of the fields, with no real place: a barrel-vault store, a warehouse with a basement, a ruined tower and farmhouse, a pond, hills with a tunnel, and every block of the library, from gates to cranes.');
}
