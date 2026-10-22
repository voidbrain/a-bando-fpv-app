/**
 * Real ground heights from elevation tiles (AWS Terrain Tiles, "terrarium" PNG encoding, ~30 m source data): the tile
 * maths, the pixel decoding and the resampling onto a terrain grid. Fetching and caching live in ElevationService; this
 * file is pure so it can be tested.
 */
import { emptyGrid, type TerrainSpec } from './terrain';

export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const ELEVATION_ATTRIBUTION = 'Elevation: AWS Terrain Tiles (Mapzen; SRTM, Copernicus GLO-30 and others)';
/** Tile zoom used for bandos: ~4 m per pixel at mid latitudes, finer than the source data. */
export const ELEVATION_ZOOM = 15;
const TILE = 256;
const M_LAT = 111132;

/** Height in metres of one terrarium pixel. */
export const terrariumHeight = (r: number, g: number, b: number): number => r * 256 + g + b / 256 - 32768;

/** Web Mercator: a lat / lon to global pixel coordinates at zoom `z` (tile = floor(px / 256)). */
export function lonLatToPixel(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = TILE * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

/** The tiles (x, y at zoom z) covering a lat / lon box. */
export function tilesFor(south: number, west: number, north: number, east: number, z: number): { x: number; y: number }[] {
  const a = lonLatToPixel(north, west, z), b = lonLatToPixel(south, east, z);
  const out: { x: number; y: number }[] = [];
  for (let y = Math.floor(a.y / TILE); y <= Math.floor(b.y / TILE); y++) for (let x = Math.floor(a.x / TILE); x <= Math.floor(b.x / TILE); x++) out.push({ x, y });
  return out;
}

/** Site metres around `origin` (x east, z south) to lat / lon. */
export function siteToLonLat(origin: { lat: number; lon: number }, x: number, z: number): { lat: number; lon: number } {
  return { lat: origin.lat - z / M_LAT, lon: origin.lon + x / (111320 * Math.cos((origin.lat * Math.PI) / 180)) };
}

/** The lat / lon box a terrain grid covers (with a small margin). */
export function terrainBox(t: Pick<TerrainSpec, 'half'>, origin: { lat: number; lon: number }): { south: number; west: number; north: number; east: number } {
  const ne = siteToLonLat(origin, t.half.e + 10, -(t.half.n + 10)), sw = siteToLonLat(origin, -(t.half.e + 10), t.half.n + 10);
  return { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon };
}

/**
 * Sample real heights onto the terrain grid. `sample(lat, lon)` answers metres above sea level (or NaN where no data);
 * the result is relative to the height at `datumAt` (the site origin by default), NaN replaced by the datum.
 */
export function resampleToGrid(t: Pick<TerrainSpec, 'cell' | 'half'>, origin: { lat: number; lon: number }, sample: (lat: number, lon: number) => number, datumAt = { x: 0, z: 0 }): { heights: Float32Array; datum: number } {
  const g = emptyGrid(t);
  const d0 = siteToLonLat(origin, datumAt.x, datumAt.z);
  const datum = sample(d0.lat, d0.lon);
  const base = isFinite(datum) ? datum : 0;
  for (let j = 0; j < g.nz; j++) {
    for (let i = 0; i < g.nx; i++) {
      const p = siteToLonLat(origin, g.x0 + i * g.cell, g.z0 + j * g.cell);
      const h = sample(p.lat, p.lon);
      g.h[j * g.nx + i] = isFinite(h) ? h - base : 0;
    }
  }
  return { heights: g.h, datum: base };
}

/** A stable key for one fetched base: place, size and cell (the registry and the cache use it). */
export const baseKey = (origin: { lat: number; lon: number }, t: Pick<TerrainSpec, 'cell' | 'half'>): string =>
  `terrarium:${origin.lat.toFixed(5)},${origin.lon.toFixed(5)}:${t.half.e}x${t.half.n}@${t.cell}`;

/**
 * A sampler over decoded tiles: `tiles` maps "x/y" to the RGBA pixels of a 256 × 256 tile. Bilinear between pixels;
 * NaN where a tile is missing.
 */
export function tileSampler(tiles: ReadonlyMap<string, Uint8ClampedArray>, z = ELEVATION_ZOOM): (lat: number, lon: number) => number {
  const px = (gx: number, gy: number): number => {
    const tx = Math.floor(gx / TILE), ty = Math.floor(gy / TILE);
    const d = tiles.get(`${tx}/${ty}`);
    if (!d) return NaN;
    const k = ((gy - ty * TILE) * TILE + (gx - tx * TILE)) * 4;
    return terrariumHeight(d[k]!, d[k + 1]!, d[k + 2]!);
  };
  return (lat, lon) => {
    const p = lonLatToPixel(lat, lon, z);
    const x = p.x - 0.5, y = p.y - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), u = x - x0, v = y - y0;
    return (px(x0, y0) * (1 - u) + px(x0 + 1, y0) * u) * (1 - v) + (px(x0, y0 + 1) * (1 - u) + px(x0 + 1, y0 + 1) * u) * v;
  };
}
