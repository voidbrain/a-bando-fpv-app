/**
 * Build the example bandos in `library/bandos/` from map data and on-site survey: `npm run examples`.
 *
 * Inputs (`tools/examples/data/`): what the app's own generator made from OpenStreetMap for each place (`*.osm.json`,
 * the spec as generated, before any edit) and two Overpass answers for waterways OSM has only as centre lines. The
 * refinements below come from the pilot's photos and survey points (lat / lon of corners, a ladder, passages); each is
 * commented with what it is. Blocks come from the published catalogue (`public/library/catalog.json`).
 *
 * Outputs: `villetta.json`, `chiari-e-forti.json` and `villetta-no-place.json` (Villetta shared without its place, made
 * with the app's own `shareCopy`; its real ground is taken from the previous file, since only the app can download
 * it). Generated ids are renumbered the same way on every run, so rebuilding does not churn the files. Then run
 * `node tools/build-catalog.mjs` (the npm script does) to publish them.
 *
 * Map data © OpenStreetMap contributors (ODbL).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { stripOutline, unionOutline } from '../../src/app/core/layers';
import { baseKey } from '../../src/app/core/elevation';
import { applyStore } from '../../src/app/core/modules';
import { placeBlock, sanitizeBlock, type BlockSpec } from '../../src/app/core/blocks';
import { toLocalAt } from '../../src/app/core/geo';
import { decodeHeights, shareCopy } from '../../src/app/core/share';
import { emptyGrid } from '../../src/app/core/terrain';
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
function finish(spec: SiteSpec, id: string, name: string, file: string, about: string): SiteSpec {
  spec.id = id;
  spec.name = name;
  spec.createdAt = Date.UTC(2026, 9, 23);
  const t = spec.terrain?.base;
  if (t) delete (t as { fetchedAt?: number }).fetchedAt;
  const ok = sanitizeSpec(stableIds(round(spec), id));
  if (!ok) throw new Error(name + ' does not pass sanitizeSpec');
  writeFileSync(file, JSON.stringify({ about, ...ok }, null, 1) + '\n');
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
const localOf = (spec: SiteSpec, lat: number, lon: number): Vec2 => { const [x, z] = toLocalAt(spec.origin, lat, lon, { rot: 0, dx: 0, dz: 0 }); return { x, z }; };
/** A polyline cut to a rectangle: the pieces inside it. */
function clipLine(pts: readonly Vec2[], r: { x0: number; x1: number; z0: number; z1: number }): Vec2[][] {
  const inside = (p: Vec2): boolean => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1;
  const out: Vec2[][] = [];
  let cur: Vec2[] = [];
  const cross = (a: Vec2, b: Vec2): Vec2 => {
    let t = 1;
    for (const [v, lo, hi, d] of [[a.x, r.x0, r.x1, b.x - a.x], [a.z, r.z0, r.z1, b.z - a.z]] as const) {
      if (d > 0 && v + d * t > hi) t = Math.min(t, (hi - v) / d);
      if (d < 0 && v + d * t < lo) t = Math.min(t, (lo - v) / d);
    }
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  };
  pts.forEach((p, i) => {
    const prev = pts[i - 1];
    if (inside(p)) {
      if (prev && !inside(prev)) cur.push(cross(p, prev));
      cur.push(p);
    } else if (prev && inside(prev)) {
      cur.push(cross(prev, p));
      out.push(cur);
      cur = [];
    }
  });
  if (cur.length) out.push(cur);
  return out.filter((l) => l.length >= 2);
}
function treeLine(spec: SiteSpec, a: Vec2, b: Vec2, step: number, seed: number, kind: 'd' | 'c' = 'd'): void {
  const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / step));
  for (let i = 0; i <= n; i++) {
    const r = Math.abs(Math.sin(seed * 97 + i * 13.7));
    spec.trees.push({ x: a.x + ((b.x - a.x) * i) / n + (r - 0.5) * 2, z: a.z + ((b.z - a.z) * i) / n + (r - 0.5) * 2, h: 9 + r * 6, r: 2.6 + r * 1.6, kind });
  }
}

let villetta!: SiteSpec; // the place-hidden copy below is made from it
// ---------- Bando Villetta ----------
{
  const s = JSON.parse(readFileSync(DATA + '/villetta.osm.json', 'utf8')) as SiteSpec;
  const B = (n: number) => s.buildings.find((b) => b.name === 'Building ' + n)!;
  // surveyed on site: the main store's four corners (its place, size and turn), the greenhouse's SW and NE corners
  const sSW = localOf(s, 45.52775013857078, 12.134013408697143), sNE = localOf(s, 45.52904004167317, 12.134938334231775);
  const sSE = localOf(s, 45.52770317763605, 12.134707829580833), sNW = localOf(s, 45.529099225191516, 12.134225258899455);
  const gSW = localOf(s, 45.52916763814051, 12.13336506941329), gNE = localOf(s, 45.529296941523256, 12.134036837649042);
  const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
  const south = mid(sSW, sSE), north = mid(sNW, sNE), west = mid(sSW, sNW), east = mid(sSE, sNE);
  const shedRot = ((((Math.atan2(north.z - south.z, north.x - south.x) * 180) / Math.PI) % 360) + 360) % 360; // its length runs north
  const shedAt = mid(south, north);
  // everything below is laid out in the store's own frame: x along it to the north, z across to the east
  const at = (x: number, z: number): Vec2 => rot({ x, z }, shedAt, shedRot);
  const inFrame = (p: Vec2): Vec2 => { const a = (shedRot * Math.PI) / 180, dx = p.x - shedAt.x, dz = p.z - shedAt.z; return { x: dx * Math.cos(a) + dz * Math.sin(a), z: -dx * Math.sin(a) + dz * Math.cos(a) }; };
  const C = { x: 0, z: 0 }, HL = Math.hypot(north.x - south.x, north.z - south.z) / 2, HW = Math.hypot(east.x - west.x, east.z - west.z) / 2; // half sizes, from the survey
  const across = (shedRot + 90) % 360; // a building whose length runs east - west
  s.buildings = s.buildings.filter((b) => ![1, 2, 3, 4].includes(+b.name.replace('Building ', '')));
  // the main store: four barrel halls, the store shell (long walls 2 windows + 1 door, all windows north) with the
  // window module raised as on site, and four rows of square columns under the roof valleys, one every third pier
  const hall = (2 * HW) / 4;
  placeBlock(s, block('abando/vault-shed'), { len: 2 * HL, hall, h: 6 }, at(C.x, C.z), shedRot);
  const store = s.buildings.at(-1)!;
  store.name = 'Main store';
  // windows half and half: a solid lower half, glass from mid-height up to the eaves (the same everywhere)
  applyStore(store, 0, { doorEnd: 'min', panel: 3, lintel: 0.3 });
  // the south end: under each barrel a big door between two windows
  store.levels[0]!.doors['w'] = Array.from({ length: 4 }, (_, k) => [
    { kind: 'window' as const, c: hall * k + hall * 0.2, w: 3.2, h: 2.7, sill: 3 },
    { kind: 'door' as const, c: hall * k + hall * 0.5, w: 3.6, h: 5.4 },
    { kind: 'window' as const, c: hall * k + hall * 0.8, w: 3.2, h: 2.7, sill: 3 },
  ]).flat();
  // the caged ladder up to the roof, at its surveyed place: part of the store (a fixture in its frame), so it shows in
  // the store's inspector and moves with it
  placeBlock(s, block('abando/cage-ladder'), { h: 7.8 }, { x: 0, z: 0 }, 0);
  const ladder = s.structures!.pop()!, lp = inFrame(localOf(s, 45.52792659907344, 12.134393408710572));
  store.fixtures = [{ ...ladder, x: lp.x, z: lp.z, rotDeg: 0 }];
  // the small electrical cabin against its east wall (42 m from the north end), as tall as the top of the store's roof
  const storeTop = 6 + (hall / 2) * 0.58;
  s.buildings.push({ id: 'b-cabin', name: 'Electrical cabin', pos: at(HL - 41.9, HW + 2.45), rotDeg: shedRot, length: 4.4, width: 4, color: '#cfc8b8', levels: [lv(0, storeTop, 'flat', { roofRise: 0.5, roofColor: '#8f8d86', doors: { e: [door(2)] } })] });
  // the greenhouse frame, from its surveyed corners
  const g0 = inFrame(gSW), g1 = inFrame(gNE);
  const ghC = { x: (g0.x + g1.x) / 2, z: (g0.z + g1.z) / 2 }, ghDepth = Math.abs(g1.x - g0.x), ghLen = Math.abs(g1.z - g0.z);
  s.buildings.push({ id: 'b-greenhouse', name: 'Greenhouse frame', pos: at(ghC.x, ghC.z), rotDeg: across, length: ghLen, width: ghDepth, frame: 'greenhouse', glass: false, levels: [lv(0, 3.5, 'gable', { roofRise: 2 })] });
  // the annex between them, touching the store's north wall and the greenhouse's east end: a barrel roof (closed at both
  // ends) over an upper storey with small windows under the eaves and a door-size opening in the east end, standing on
  // a ground-floor colonnade on the north side and both ends. Behind the columns, set back, walls with big doors (one
  // every two bays) on the north and two door-size openings on the east; the west end, toward the greenhouse, is open
  // in line with the greenhouse (the same north and south walls)
  const aw = ghC.z + ghLen / 2, aLen = 52.3, aDepth = ghDepth, aC = { x: ghC.x, z: aw + aLen / 2 }, back = 2.5;
  const free = Math.max(0, -HW - aw); // the stretch of its south side west of the store, open to the air
  const bays = Math.round((aLen - back) / 5.2), pitch = (aLen - back) / bays;
  // small windows under the eaves, in pairs
  const clerestory = Array.from({ length: bays }, (_, k) => [-0.75, 0.75].map((o) => ({ kind: 'window' as const, c: pitch * (k + 0.5) + o, w: 1.0, h: 0.6, sill: 2.6 }))).flat();
  const eastCols = Math.max(2, Math.round(aDepth / 5));
  const southCols = Math.max(1, Math.round(free / 5.2));
  s.buildings.push({
    id: 'b-annex', name: 'Annex', pos: at(aC.x, aC.z), rotDeg: across, length: aLen, width: aDepth, color: '#d7d3c8',
    levels: [
      {
        ...lv(0, 3, 'none'),
        sides: { n: false, s: false, e: false, w: false },
        doors: {},
        columns: [
          ...Array.from({ length: bays + 1 }, (_, k) => ({ x: Math.max(0.3, pitch * k), z: 0.3, size: 0.5 })),
          ...Array.from({ length: eastCols }, (_, k) => ({ x: aLen - 0.3, z: 0.3 + ((aDepth - 0.6) * (k + 1)) / eastCols, size: 0.5 })),
          ...Array.from({ length: eastCols }, (_, k) => ({ x: 0.3, z: 0.3 + ((aDepth - 0.6) * (k + 1)) / eastCols, size: 0.5 })),
          ...Array.from({ length: southCols }, (_, k) => ({ x: (free * (k + 1)) / southCols, z: aDepth - 0.3, size: 0.5 })),
        ],
      },
      { ...lv(3, 3.6, 'vault', { roofTurn: true, roofCount: 1, vaultK: 0.35, roofRise: 2, roofColor: '#b0563d' }), doors: { n: clerestory, s: clerestory, e: [{ kind: 'door', c: aDepth / 2, w: 1.2, h: 2.2 }] } },
    ],
  });
  const aRot = (p: Vec2): Vec2 => rot({ x: p.x - aLen / 2, z: p.z - aDepth / 2 }, at(aC.x, aC.z), across);
  const setBack = (a: Vec2, b: Vec2): void => void (s.walls ??= []).push({ a: aRot(a), b: aRot(b), height: 3, thick: 0.3, material: 'masonry' });
  // north: two bays of wall, then a big door (a gap), repeated
  for (let k = 0; k < bays; k++) if (k % 3 !== 2) setBack({ x: pitch * k, z: back }, { x: pitch * (k + 1), z: back });
  // south, west of the store: a wall with one opening in the middle, closed against the store's corner
  if (free > 3) {
    const zs = aDepth - back, mid2 = free / 2;
    setBack({ x: 0, z: zs }, { x: mid2 - 1.2, z: zs });
    setBack({ x: mid2 + 1.2, z: zs }, { x: free, z: zs });
    setBack({ x: free, z: zs }, { x: free, z: aDepth });
  }
  // east: a wall with two door-size openings
  const ez = (aDepth - back) / 3;
  setBack({ x: aLen - back, z: back }, { x: aLen - back, z: back + ez - 0.7 });
  setBack({ x: aLen - back, z: back + ez + 0.7 }, { x: aLen - back, z: back + 2 * ez - 0.7 });
  setBack({ x: aLen - back, z: back + 2 * ez + 0.7 }, { x: aLen - back, z: aDepth });
  // the houses south of the road
  const houses: [number, string][] = [[5, '#e3d6bd'], [6, '#d8c3a0'], [7, '#e7e1d2']];
  for (const [n, c] of houses) {
    const lv2 = floors(2, 3, 'gable', { roofRise: 2.2, roofColor: '#9a4f3a' });
    lv2[0]!.doors = { s: [door(3)] };
    Object.assign(B(n), { name: 'House', color: c, levels: lv2 });
  }
  // concrete aprons west, east and south of the store
  const apron = (x0: number, x1: number, z0: number, z1: number) => ({ kind: 'concrete' as const, pts: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }].map((p) => at(p.x, p.z)) });
  s.surfaces = [apron(-HL + 0.75, 19.7, C.z - HW - 37, C.z - HW), apron(-HL - 4, -2.8, C.z + HW + 8.9, C.z + HW + 48.3), apron(-HL - 26.5, -HL, C.z - HW - 17.7, C.z + HW + 29)];
  // the take-off pad on the west apron
  s.droneStart = at(-27, C.z - HW - 18);
  // the area: wide enough for the Scolo Ruviego channel north of the greenhouse and its two footbridges; the terrain
  // grows with it (the app downloads the missing ground the first time the bando opens)
  const area = { x0: -150, x1: 245, z0: -180, z1: 130 };
  s.terrain!.half = { e: 250, n: 180 };
  s.terrain!.base!.key = baseKey(s.origin, s.terrain!);
  s.zone = { ...s.zone!, halfE: 250, halfN: 180 };
  // roads cut to the area; OSM's footpath along the channel is the channel itself (water, below)
  s.roads = (s.roads ?? []).filter((r) => r.kind !== 'path').flatMap((r) => clipLine(r.pts, area).map((pts) => ({ ...r, pts }))).filter((r) => r.pts.length >= 2);
  // the Scolo Ruviego: a 4 m channel along its OSM centre line, west and north of the site
  const DV = JSON.parse(readFileSync(DATA + '/villetta.drain.overpass.json', 'utf8')) as { elements: { geometry?: { lat: number; lon: number }[] }[] };
  const drainLine = (DV.elements[0]!.geometry ?? []).map((g) => localOf(s, g.lat, g.lon));
  const inArea = clipLine(drainLine, area);
  s.waters = inArea.map((pts) => ({ pts: stripOutline(pts, 4), depth: 1.2 }));
  // two footbridges over it (seen from above: north-west, and north-east past the field), across the channel
  const bridgeAt = (p: Vec2): void => {
    const all = inArea.flat();
    let k = 0;
    all.forEach((q, i) => { if (Math.hypot(q.x - p.x, q.z - p.z) < Math.hypot(all[k]!.x - p.x, all[k]!.z - p.z)) k = i; });
    const a = all[Math.max(0, k - 1)]!, b = all[Math.min(all.length - 1, k + 1)]!;
    const deg = (Math.atan2(b.z - a.z, b.x - a.x) * 180) / Math.PI + 90; // across the channel
    placeBlock(s, block('abando/bridge'), { l: 10, w: 3, h: 2, style: 'beam' }, all[k]!, ((deg % 360) + 360) % 360);
    s.structures!.at(-1)!.name = 'Footbridge';
  };
  bridgeAt(at(166.9, -94.7));
  bridgeAt(at(139, 158.8));
  // trees on the site's side of the channel: a dense row along the water, then sparser ones further in
  s.trees = [];
  const toward = at(0, 0);
  for (const line of inArea)
    line.slice(1).forEach((b, k) => {
      const a = line[k]!, len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1) return;
      let nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
      if (nx * (toward.x - a.x) + nz * (toward.z - a.z) < 0) ((nx = -nx), (nz = -nz)); // the site's side
      const row = (off: number, step: number, seed: number): void => treeLine(s, { x: a.x + nx * off, z: a.z + nz * off }, { x: b.x + nx * off, z: b.z + nz * off }, step, seed);
      row(5, 6, 10 + k);
      row(13, 14, 40 + k);
      row(24, 26, 70 + k);
    });
  treeLine(s, { x: -60, z: 92 }, { x: 100, z: 120 }, 14, 2);
  villetta = finish(s, 'example-villetta', 'Bando Villetta', ROOT + '/library/bandos/villetta.json', 'The famous main store: four barrel-vault halls with the store shell and columns inside, its annex and old greenhouse frame, concrete aprons, in the fields near Treviso.');
}

// ---------- Villetta without its place ----------
{
  // the app's own place-hidden export of the example above; its real ground comes from the previous file (only the app
  // can download it), so the terrain must keep its size
  const file = ROOT + '/library/bandos/villetta-no-place.json';
  const old = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as SiteSpec) : null;
  const heights = old?.terrain?.base?.data && villetta.terrain ? decodeHeights(old.terrain.base.data, emptyGrid(villetta.terrain).h.length) : null;
  if (!heights) console.warn('villetta-no-place: no usable ground in the previous file; export it from the app instead (Bandos → Export, place hidden)');
  else {
    const hidden = shareCopy(villetta, 'hidden', heights);
    hidden.terrain!.base!.key = 'embedded:example-villetta-no-place';
    finish(hidden, 'example-villetta-no-place', 'Villetta (place hidden)', file, 'The Villetta main store shared without its place: no map and no map data, its real ground travels inside. Open a copy, edit it, load your flights: they start on the take-off pad, and pins and the compass fit them.');
  }
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

