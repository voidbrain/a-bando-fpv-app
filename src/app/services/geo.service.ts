import { Injectable } from '@angular/core';
import type { BuildingSpec, PadSpec, TreeSpec } from '../core/site-spec';
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
  type: 'node' | 'way' | 'relation';
  lat?: number;
  lon?: number;
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

  private static lastGood = '';

  /** Public Overpass instances, tried in turn: any of them answers 429 / 504 when busy. */
  private static readonly MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  /**
   * One Overpass query, resilient to a busy server: each mirror gets a 25 s budget; a 429 / 5xx / network failure
   * moves on to the next mirror, and the whole round is retried once after a short pause. (A 429 comes back without
   * CORS headers, so the browser reports it as an opaque "access control" error — this hides that.)
   */
  private async overpass(ql: string): Promise<{ elements: OsmElement[] }> {
    for (let round = 0; round < 2; round++) {
      // start with the mirror that worked last time: the failing ones only add delay and console noise
      const order = [...GeoService.MIRRORS].sort((a, b) => (a === GeoService.lastGood ? -1 : b === GeoService.lastGood ? 1 : 0));
      for (const url of order) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 25000);
        try {
          const res = await fetch(url, { method: 'POST', body: `data=${encodeURIComponent(ql)}`, signal: ctl.signal });
          if (res.ok) {
            GeoService.lastGood = url;
            return (await res.json()) as { elements: OsmElement[] };
          }
        } catch {
          /* blocked / rate-limited / timed out: try the next mirror */
        } finally {
          clearTimeout(timer);
        }
      }
      if (round === 0) await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error('OpenStreetMap data servers are busy or unreachable. Try again in a minute.');
  }

  /**
   * Everything the generator needs for a rectangular zone, in ONE Overpass request (three parallel requests are what
   * trips the rate limit): building footprints (biggest first), trees and roads. Throws when no server answers.
   */
  async areaData(lat: number, lon: number, halfE: number, halfN: number): Promise<{ footprints: Footprint[]; trees: TreeSpec[]; roads: PadSpec[] }> {
    const dLat = halfN / M_LAT;
    const dLon = halfE / metresPerDegLon(lat);
    const bbox = `${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon}`; // Overpass order: south,west,north,east
    const ql =
      `[out:json][timeout:25];(` +
      `way["building"]["building"!~"^(roof|hangar)$"](${bbox});` +
      `node["natural"="tree"](${bbox});way["natural"="tree_row"](${bbox});` +
      `way["highway"~"^(primary|secondary|tertiary|residential|unclassified|service)$"](${bbox});` +
      `);out geom 1500;`;
    const data = await this.overpass(ql);
    const footprints: Footprint[] = [];
    const trees: TreeSpec[] = [];
    const roads: PadSpec[] = [];
    const mLon = metresPerDegLon(lat);
    for (const el of data.elements) {
      const tags = el.tags ?? {};
      if (el.type === 'node' && tags['natural'] === 'tree' && el.lat !== undefined && el.lon !== undefined) {
        if (trees.length >= 250) continue;
        const h = Math.min(30, Math.max(3, parseFloat(tags['height'] ?? '') || 8));
        trees.push({ x: (el.lon - lon) * mLon, z: -(el.lat - lat) * M_LAT, h, r: Math.max(1.2, h * 0.22), kind: tags['leaf_type'] === 'needleleaved' ? 'c' : 'd' });
      } else if (el.type === 'way' && tags['natural'] === 'tree_row' && el.geometry) {
        // a row of trees: one tree every ~7 m along it
        const g = el.geometry;
        for (let i = 0; i + 1 < g.length && trees.length < 250; i++) {
          const a = g[i]!, b = g[i + 1]!;
          const len = Math.hypot((b.lon - a.lon) * mLon, (b.lat - a.lat) * M_LAT);
          for (let t = 0; t < len; t += 7) {
            const f = len ? t / len : 0;
            const la = a.lat + (b.lat - a.lat) * f, lo = a.lon + (b.lon - a.lon) * f;
            trees.push({ x: (lo - lon) * mLon, z: -(la - lat) * M_LAT, h: 8, r: 1.8, kind: 'd' });
          }
        }
      } else if (el.type === 'way' && tags['highway'] && el.geometry && el.geometry.length >= 2) {
        // every segment of the road becomes one rotated pad (so bends and diagonals follow the map)
        const g = el.geometry;
        const width = tags['highway'] === 'service' ? 4 : tags['highway'] === 'residential' || tags['highway'] === 'unclassified' ? 6 : 8;
        for (let i = 0; i + 1 < g.length && roads.length < 120; i++) {
          const a = g[i]!, b = g[i + 1]!;
          const dx = (b.lon - a.lon) * mLon, dz = -(b.lat - a.lat) * M_LAT;
          const len = Math.hypot(dx, dz);
          if (len < 1) continue;
          roads.push({ x: (((a.lon + b.lon) / 2) - lon) * mLon, z: -(((a.lat + b.lat) / 2) - lat) * M_LAT, w: len + 0.6, d: width, rotDeg: (Math.atan2(dz, dx) * 180) / Math.PI, color: '#4a4d4b' });
        }
      } else if (el.type === 'way' && tags['building']) {
        if ('building:part' in tags || 'boundary' in tags || 'place' in tags || 'admin_level' in tags) continue;
        const ring = this.ringOf(el);
        if (!ring || ring.length < 4) continue;
        if (this.polyArea(ring) > 1_000_000) continue; // a district outline, not a building
        footprints.push(this.toFootprint(ring, tags));
      }
    }
    footprints.sort((p, q) => this.polyArea(q.ring) - this.polyArea(p.ring));
    return { footprints, trees, roads };
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
