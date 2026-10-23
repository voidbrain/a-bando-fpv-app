import * as THREE from 'three';
import type { GeoPoint } from '../core/models';
import { satelliteTiles, tileUrl } from '../core/satellite';
import type { HeightGrid } from '../core/terrain';

/** Pixels per metre at most, and the largest canvas side: a 600 m bando gets about 1 px for every 0.25 m. */
const PX_PER_M = 4;
const MAX_SIDE = 4096;

const loadImage = (url: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // the tile server sends CORS headers: the canvas stays usable as a texture
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });

/**
 * The satellite picture of the ground under the terrain grid, as a texture laid with the terrain's own uv (u east, v
 * south from the grid's north-west corner). Tiles that fail to load stay dark; null when none loads (offline).
 */
export function satelliteTexture(origin: GeoPoint, g: HeightGrid): Promise<THREE.Texture | null> {
  // the model is rebuilt on every edit: the same place and grid reuse the picture
  const key = `${origin.lat},${origin.lon},${g.x0},${g.z0},${g.nx},${g.nz},${g.cell}`;
  if (last?.key !== key) last = { key, tex: draw(origin, g) };
  return last.tex;
}
let last: { key: string; tex: Promise<THREE.Texture | null> } | null = null;

async function draw(origin: GeoPoint, g: HeightGrid): Promise<THREE.Texture | null> {
  const w = (g.nx - 1) * g.cell, d = (g.nz - 1) * g.cell;
  const k = Math.min(PX_PER_M, MAX_SIDE / w, MAX_SIDE / d);
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(d * k);
  const cx = c.getContext('2d');
  if (!cx) return null;
  cx.fillStyle = '#3b4a3a';
  cx.fillRect(0, 0, c.width, c.height);
  const tiles = satelliteTiles(origin, { x0: g.x0, z0: g.z0, x1: g.x0 + w, z1: g.z0 + d }, 96);
  const imgs = await Promise.all(tiles.map((t) => loadImage(tileUrl(t))));
  let drawn = 0;
  tiles.forEach((t, i) => {
    const img = imgs[i];
    if (!img) return;
    cx.drawImage(img, (t.x0 - g.x0) * k, (t.z0 - g.z0) * k, (t.x1 - t.x0) * k, (t.z1 - t.z0) * k);
    drawn++;
  });
  if (!drawn) return null;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false; // v grows southwards, like the canvas rows
  tex.anisotropy = 8;
  return tex;
}
