import { Injectable } from '@angular/core';
import type { BuildingSpec, LocationInfo, PadSpec, TreeSpec } from '../core/site-spec';
import { uid } from '../core/site-spec';

/** One geocoding result (Nominatim / Google — display + generation only, see the licence notes below). */
export interface GeoResult {
  label: string;
  lat: number;
  lon: number;
}

/** A building footprint polygon in longitude/latitude order. */
export type Ring = [number, number][];

/** A building footprint with the derived metrics the generator needs. */
export interface Footprint {
  ring: Ring;
  name?: string;
  levels?: number;
  heightM?: number;
  roof?: string;
  /** Bounding size along / across the longest edge, metres. */
  dx: number;
  dz: number;
  /** Heading of the longest edge, degrees clockwise from north (0..180). */
  headingDeg: number;
}

interface OsmElement {
  id: number;
  type: 'way' | 'relation';
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  center?: { lat: number; lon: number };
}

/** Metres per degree of latitude. */
const M_LAT = 111132;
const metresPerDegLon = (lat: number): number => 111320 * Math.cos((lat * Math.PI) / 180);

/**
 * Open data, open licences: geocoding through Nominatim and footprints through the public Overpass API.
 * The results are facts (coordinates, sizes), which the ODbL allows storing and editing with attribution;
 * scraping or caching Google Maps content is not allowed, so Google stays an optional display-only backdrop.
 * Both endpoints ask for a Referer and modest use; every call here is one request per user action.
 */
@Injectable({ providedIn: 'root' })
export class GeoService {
  private static readonly NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  private static readonly OVERPASS = 'https://overpass-api.de/api/interpreter';

  /** Address / place search (Nominatim). Free-form input -> up to `limit` coordinates. */
  async geocode(query: string, limit = 6): Promise<GeoResult[]> {
    const q = query.trim();
    if (!q) return [];
    const url = `${GeoService.NOMINATIM}?format=jsonv2&limit=${limit}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Nominatim replied ${res.status}`);
    const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
    return rows.map((r) => ({ label: r.display_name.split(',').slice(0, 3).join(','), lat: +r.lat, lon: +r.lon }));
  }

  /** Reverse lookup for a map click (Nominatim reverse). Best effort: empty label when nothing is known. */
  async reverse(lat: number, lon: number): Promise<GeoResult> {
    try {
      const url = `${GeoService.NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return { label: '', lat, lon };
      const j = (await res.json()) as { display_name?: string };
      return { label: (j.display_name ?? '').split(',').slice(0, 3).join(','), lat, lon };
    } catch {
      return { label: '', lat, lon };
    }
  }

  /**
   * Building footprints around a point (Overpass). Returns them centred on their centroid with size, heading,
   * levels and height when tagged. Missing heights fall back to defaults by building type (the user corrects them).
   */
  async footprints(lat: number, lon: number, radiusM = 250): Promise<Footprint[]> {
    const dLat = radiusM / M_LAT;
    const dLon = radiusM / metresPerDegLon(lat);
    const bbox = `${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat}`;
    const ql = `[out:json][timeout:20];(way["building"](bbox:${bbox});relation["building"](bbox:${bbox}););out geom center;`;
    const res = await fetch(GeoService.OVERPASS, { method: 'POST', body: `data=${encodeURIComponent(ql)}` });
    if (!res.ok) throw new Error(`Overpass replied ${res.status}`);
    const data = (await res.json()) as { elements: OsmElement[] };
    const out: Footprint[] = [];
    for (const el of data.elements) {
      const ring = this.ringOf(el);
      if (!ring || ring.length < 4) continue;
      out.push(this.toFootprint(ring, el.tags ?? {}));
    }
    // biggest first: the dominant structure becomes the main building
    return out.sort((a, b) => b.ring.length * 0 + this.polyArea(b.ring) - this.polyArea(a.ring));
  }

  /** Trees near a point (Overpass), kept sparse so the model does not drown in instances. */
  async trees(lat: number, lon: number, radiusM = 250): Promise<TreeSpec[]> {
    const dLat = radiusM / M_LAT;
    const dLon = radiusM / metresPerDegLon(lat);
    const bbox = `${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat}`;
    const ql = `[out:json][timeout:20];(node["natural"="tree"]["height"](bbox:${bbox});way["natural"="tree_row"](bbox:${bbox}););out center;`;
    try {
      const res = await fetch(GeoService.OVERPASS, { method: 'POST', body: `data=${encodeURIComponent(ql)}` });
      if (!res.ok) return [];
      const data = (await res.json()) as { elements: OsmElement[] };
      const out: TreeSpec[] = [];
      for (const el of data.elements.slice(0, 120)) {
        const c = el.center ?? el.geometry?.[0];
        if (!c) continue;
        const h = Math.min(30, Math.max(3, parseFloat(el.tags?.['height'] ?? '') || 8));
        out.push({ x: (c.lon - lon) * metresPerDegLon(lat), z: -(c.lat - lat) * M_LAT, h, r: Math.max(1.2, h * 0.22), kind: 'd' });
      }
      return out;
    } catch {
      return [];
    }
  }

  /** One road nearby -> a long thin pad, so the generated site has some context. */
  async roads(lat: number, lon: number, radiusM = 250): Promise<PadSpec[]> {
    const dLat = radiusM / M_LAT;
    const dLon = radiusM / metresPerDegLon(lat);
    const bbox = `${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat}`;
    const ql = `[out:json][timeout:20];way["highway"~"primary|secondary|tertiary|residential|unclassified"](bbox:${bbox});out geom;`;
    try {
      const res = await fetch(GeoService.OVERPASS, { method: 'POST', body: `data=${encodeURIComponent(ql)}` });
      if (!res.ok) return [];
      const data = (await res.json()) as { elements: OsmElement[] };
      const out: PadSpec[] = [];
      for (const el of data.elements.slice(0, 6)) {
        const g = el.geometry;
        if (!g || g.length < 2) continue;
        const a = g[0]!, b = g[g.length - 1]!;
        const mx = (((a.lon + b.lon) / 2) - lon) * metresPerDegLon(lat);
        const mz = -(((a.lat + b.lat) / 2) - lat) * M_LAT;
        const len = Math.hypot((b.lon - a.lon) * metresPerDegLon(lat), (b.lat - a.lat) * M_LAT);
        if (len < 20) continue;
        out.push({ x: mx, z: mz, w: len, d: 7, color: '#4a4d4b' });
      }
      return out;
    } catch {
      return [];
    }
  }

  /** Turn the biggest footprint into the location info that seeds {@link generateSite}. */
  async locationInfo(lat: number, lon: number, label: string): Promise<LocationInfo> {
    const base: LocationInfo = { label, lat, lon };
    try {
      const fps = await this.footprints(lat, lon);
      const best = fps[0];
      if (!best) return base;
      return { ...base, footprintLength: Math.max(best.dx, best.dz), footprintWidth: Math.min(best.dx, best.dz), footprintHeading: best.headingDeg };
    } catch {
      return base; // offline / endpoint down: plausible defaults still give an editable starter site
    }
  }

  // ---- helpers ----

  /** Outer ring of a way (its geometry) or of a relation's members (approximated by its bounding box). */
  private ringOf(el: OsmElement): Ring | null {
    if (el.type === 'way' && el.geometry) return el.geometry.map((p) => [p.lon, p.lat] as [number, number]);
    if (el.type === 'relation' && el.center) {
      // relations come without member geometry in "out geom center": a small default box around the centre
      const s = 30;
      const { lat, lon } = el.center;
      const dLat = s / M_LAT, dLon = s / metresPerDegLon(lat);
      return [
        [lon - dLon, lat - dLat],
        [lon + dLon, lat - dLat],
        [lon + dLon, lat + dLat],
        [lon - dLon, lat + dLat],
      ];
    }
    return null;
  }

  /** Ring (lon/lat) -> local metres relative to the ring centroid, plus size / heading / height guesses. */
  private toFootprint(ring: Ring, tags: Record<string, string>): Footprint {
    let clon = 0, clat = 0;
    for (const [lo, la] of ring) {
      clon += lo;
      clat += la;
    }
    clon /= ring.length;
    clat /= ring.length;
    const mLon = metresPerDegLon(clat);
    const pts = ring.map(([lo, la]) => ({ x: (lo - clon) * mLon, z: -(la - clat) * M_LAT }));
    // longest edge direction = heading of the building's length axis (degrees clockwise from north)
    let bestLen = 0, bx = 1, bz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
      const dx = b.x - a.x, dz = b.z - a.z;
      const l = Math.hypot(dx, dz);
      if (l > bestLen) {
        bestLen = l;
        bx = dx / l;
        bz = dz / l;
      }
    }
    // project every corner on the length axis to get true dx / dz extents
    let mn = Infinity, mx = -Infinity, mn2 = Infinity, mx2 = -Infinity;
    for (const p of pts) {
      const u = p.x * bx + p.z * bz;
      const v = -p.x * bz + p.z * bx;
      mn = Math.min(mn, u);
      mx = Math.max(mx, u);
      mn2 = Math.min(mn2, v);
      mx2 = Math.max(mx2, v);
    }
    const levels = parseInt(tags['levels'] ?? tags['building:levels'] ?? '', 10);
    const taggedH = parseFloat(tags['height'] ?? '');
    const type = tags['building'] ?? 'yes';
    const defaultLevels = /^(house|residential|farm|detached|semis)$/.test(type) ? 2 : /^(shed|garage|barn|warehouse|industrial|hut|greenhouse|roof|bridge|station)$/.test(type) ? 1 : 2;
    const nlev = Number.isFinite(levels) && levels > 0 ? levels : defaultLevels;
    const heightM = Number.isFinite(taggedH) && taggedH > 0 ? taggedH : nlev * 3.2;
    let headingDeg = (Math.atan2(bx, -bz) * 180) / Math.PI; // direction (east, north-ish) -> compass bearing of the length axis
    headingDeg = ((headingDeg % 180) + 180) % 180;
    return { ring, name: tags['name'] || undefined, levels: nlev, heightM, roof: tags['roof:shape'], dx: mx - mn, dz: mx2 - mn2, headingDeg };
  }

  /** Shoelace area of a lon/lat ring, square metres (for sorting). */
  private polyArea(ring: Ring): number {
    let s = 0;
    const lat = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    const mLon = metresPerDegLon(lat);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      s += a[0] * mLon * (-(b[1] * M_LAT)) - b[0] * mLon * (-(a[1] * M_LAT));
    }
    return Math.abs(s / 2);
  }

  /** A fresh id for generated buildings / sites. */
  newId(prefix: string): string {
    return uid(prefix);
  }

  /** Attribute line required by the ODbL when exporting / saving generated data. */
  readonly attribution = '© OpenStreetMap contributors (ODbL)';
}

/** Convenience re-export so panels can type buildings without importing the core twice. */
export type { BuildingSpec };
