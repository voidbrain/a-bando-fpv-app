/**
 * Satellite imagery for the 3D ground: which Web Mercator tiles cover the terrain, and where each lands in site metres
 * (x east, z south, around the bando's origin). Pure; the texture is drawn in three/satellite-ground.ts.
 */
import { toGeoAt, toLocalAt } from './geo';
import type { GeoPoint } from './models';

export const SAT_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const SAT_ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics and the GIS user community';

const NO_CAL = { rot: 0, dx: 0, dz: 0 };
export const lonToTileX = (lon: number, z: number): number => ((lon + 180) / 360) * 2 ** z;
export const latToTileY = (lat: number, z: number): number => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
export const tileXToLon = (x: number, z: number): number => (x / 2 ** z) * 360 - 180;
export const tileYToLat = (y: number, z: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

export interface SatTile {
  z: number;
  x: number;
  y: number;
  /** Where the tile lies, in site metres. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/**
 * The tiles covering the site rectangle `r` (metres), at the sharpest zoom (up to 19) that needs at most `max` tiles.
 */
export function satelliteTiles(origin: GeoPoint, r: { x0: number; z0: number; x1: number; z1: number }, max = 64): SatTile[] {
  // the rectangle's corners in degrees (north-west and south-east), by the same projection as everything else
  const [latN, lonW] = toGeoAt(origin, r.x0, r.z0, NO_CAL), [latS, lonE] = toGeoAt(origin, r.x1, r.z1, NO_CAL);
  for (let z = 19; z >= 10; z--) {
    const tx0 = Math.floor(lonToTileX(lonW, z)), tx1 = Math.floor(lonToTileX(lonE, z));
    const ty0 = Math.floor(latToTileY(latN, z)), ty1 = Math.floor(latToTileY(latS, z));
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > max && z > 10) continue;
    const out: SatTile[] = [];
    for (let x = tx0; x <= tx1; x++)
      for (let y = ty0; y <= ty1; y++) {
        const [ax, az] = toLocalAt(origin, tileYToLat(y, z), tileXToLon(x, z), NO_CAL);
        const [bx, bz] = toLocalAt(origin, tileYToLat(y + 1, z), tileXToLon(x + 1, z), NO_CAL);
        out.push({ z, x, y, x0: ax, z0: az, x1: bx, z1: bz });
      }
    return out;
  }
  return [];
}

export const tileUrl = (t: Pick<SatTile, 'x' | 'y' | 'z'>): string => SAT_TILE_URL.replace('{z}', String(t.z)).replace('{y}', String(t.y)).replace('{x}', String(t.x));
