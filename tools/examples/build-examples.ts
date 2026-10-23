/**
 * Build the example bandos in `library/bandos/` from map data and on-site survey: `npm run examples`.
 *
 * Inputs (`tools/examples/data/`): what the app's own generator made from OpenStreetMap (`*.osm.json`, the spec as
 * generated, before any edit) and an Overpass answer for waterways OSM has only as centre lines. The
 * refinements below come from the pilot's photos and survey points (lat / lon of corners, a ladder, passages); each is
 * commented with what it is. Blocks come from the published catalogue (`public/library/catalog.json`).
 *
 * Output: `chiari-e-forti.json`. Generated ids are renumbered the same way on every run, so rebuilding does not churn
 * the file. Then run `node tools/build-catalog.mjs` (the npm script does) to publish it.
 *
 * `villetta-no-place.json` is not built here: that place is kept private, so its sources (map data, survey points)
 * are not in the repository. The file is the app's own export with the place hidden; change it in the app and export
 * it again (Bandos → Export, a bando whose place is hidden stays hidden).
 *
 * Map data © OpenStreetMap contributors (ODbL).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { stripOutline, unionOutline } from '../../src/app/core/layers';
import { placeBlock, sanitizeBlock, type BlockSpec } from '../../src/app/core/blocks';
import { toLocalAt } from '../../src/app/core/geo';
import { sanitizeSpec, type BuildingSpec, type SiteSpec, type Vec2, type LevelSpec } from '../../src/app/core/site-spec';

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

