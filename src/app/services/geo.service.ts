import { Injectable } from '@angular/core';
import type { BuildingSpec, PadSpec, StructureSpec, TreeSpec } from '../core/site-spec';
import { STRUCTURE_DEFAULTS } from '../three/structures';
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
  /** OSM `building=*` value (e.g. 'greenhouse'). */
  type?: string;
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
  private static readonly ENDPOINT_KEY = 'abando-overpass-url';
  private static readonly CACHE = 'abando-overpass-v1';
  private static readonly CACHE_MS = 12 * 3600 * 1000;

  /** Public Overpass instances, tried in turn: any of them answers 429 / 5xx when busy. */
  private static readonly MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.openstreetmap.fr/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  /** A server of your own (e.g. the PHP proxy on your hosting) tried before the public ones; '' removes it. */
  static get endpoint(): string {
    try {
      return localStorage.getItem(GeoService.ENDPOINT_KEY) ?? '';
    } catch {
      return '';
    }
  }
  static set endpoint(url: string) {
    try {
      if (url.trim()) localStorage.setItem(GeoService.ENDPOINT_KEY, url.trim());
      else localStorage.removeItem(GeoService.ENDPOINT_KEY);
    } catch {
      /* no storage */
    }
  }

  private static hash(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /**
   * One Overpass query, resilient to a busy server. Answers are cached for 12 h (same area → no request at all). Each
   * server gets a 25 s budget; a 429 / 5xx / network failure moves on to the next, and the round is repeated once
   * after a pause. When everything fails the error names every server and its HTTP status, because the browser
   * itself only prints an opaque "access control" message for a 429 / 500 that carries no CORS header.
   */
  private async overpass(ql: string): Promise<{ elements: OsmElement[] }> {
    const key = `https://cache.local/overpass/${GeoService.hash(ql)}`;
    try {
      const cache = await caches.open(GeoService.CACHE);
      const hit = await cache.match(key);
      if (hit && Date.now() - Number(hit.headers.get('x-ts') ?? 0) < GeoService.CACHE_MS) return (await hit.json()) as { elements: OsmElement[] };
    } catch {
      /* Cache Storage unavailable: just fetch */
    }
    const mine = GeoService.endpoint;
    const base = [...GeoService.MIRRORS].sort((a, b) => (a === GeoService.lastGood ? -1 : b === GeoService.lastGood ? 1 : 0));
    const order = mine ? [mine, ...base] : base;
    const failures: string[] = [];
    for (let round = 0; round < 2; round++) {
      for (const url of order) {
        const host = new URL(url).host;
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 25000);
        try {
          const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(ql)}`, signal: ctl.signal });
          if (res.ok) {
            const data = (await res.json()) as { elements: OsmElement[] };
            GeoService.lastGood = url;
            try {
              const cache = await caches.open(GeoService.CACHE);
              await cache.put(key, new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'x-ts': String(Date.now()) } }));
            } catch {
              /* not cached: fine */
            }
            return data;
          }
          failures.push(`${host} HTTP ${res.status}`);
        } catch {
          failures.push(`${host} unreachable or blocked`);
        } finally {
          clearTimeout(timer);
        }
      }
      if (round === 0) await new Promise((r) => setTimeout(r, 3000));
    }
    const uniq = [...new Set(failures)];
    throw new Error(`OpenStreetMap data servers did not answer (${uniq.slice(0, 4).join('; ')}). They are usually only busy: wait a minute and retry, or set your own data server.`);
  }

  /**
   * Everything the generator needs for a rectangular zone: building footprints (biggest first), trees and roads.
   * One request for all of it; if every server refuses that, a second, much lighter request asks for buildings only
   * (the model is still built, `partial` says trees / roads are missing). The query box is snapped to a ~55 m grid so
   * that nearby frames share one cached answer; the result is then cut back to the real frame.
   */
  async areaData(lat: number, lon: number, halfE: number, halfN: number): Promise<{ footprints: Footprint[]; trees: TreeSpec[]; roads: PadSpec[]; structures: StructureSpec[]; partial: boolean }> {
    const mLon = metresPerDegLon(lat);
    const G = 0.0005;
    const south = Math.floor((lat - halfN / M_LAT) / G) * G, north = Math.ceil((lat + halfN / M_LAT) / G) * G;
    const west = Math.floor((lon - halfE / mLon) / G) * G, east = Math.ceil((lon + halfE / mLon) / G) * G;
    const bbox = `${south.toFixed(4)},${west.toFixed(4)},${north.toFixed(4)},${east.toFixed(4)}`; // south,west,north,east
    const buildingsQ = `way["building"]["building"!~"^(roof|hangar)$"](${bbox});`;
    const fullQ = `[out:json][timeout:25];(${buildingsQ}node["natural"="tree"](${bbox});way["natural"="tree_row"](${bbox});way["highway"~"^(primary|secondary|tertiary|residential|unclassified|service)$"](${bbox});` +
      `node["man_made"~"^(tower|mast|chimney|silo|storage_tank|water_tower)$"](${bbox});way["man_made"~"^(chimney|silo|storage_tank|water_tower)$"](${bbox});node["power"="tower"](${bbox});` +
      `way["bridge"]["bridge"!="no"](${bbox}););out geom 1500;`;
    let partial = false;
    let data: { elements: OsmElement[] };
    try {
      data = await this.overpass(fullQ);
    } catch (e) {
      try {
        data = await this.overpass(`[out:json][timeout:20];(${buildingsQ});out geom 1500;`);
        partial = true;
      } catch {
        throw e;
      }
    }
    const inZone = (la: number, lo: number): boolean => Math.abs((lo - lon) * mLon) <= halfE + 8 && Math.abs((la - lat) * M_LAT) <= halfN + 8;
    const footprints: Footprint[] = [];
    const trees: TreeSpec[] = [];
    const roads: PadSpec[] = [];
    const structures: StructureSpec[] = [];
    for (const el of data.elements) {
      const tags = el.tags ?? {};
      const bridge = tags['bridge'] && tags['bridge'] !== 'no' && el.type === 'way' && el.geometry && el.geometry.length >= 2;
      const manMade = tags['man_made'] ?? (tags['power'] === 'tower' ? 'pylon' : '');
      if (bridge) {
        // a bridge: its chord, as one oriented deck. (The road / rail under its length is not drawn as a ground pad.)
        const g = el.geometry!;
        const p0 = g[0]!, p1 = g[g.length - 1]!;
        const dx = (p1.lon - p0.lon) * mLon, dz = -(p1.lat - p0.lat) * M_LAT;
        const len = Math.hypot(dx, dz);
        const mid = { lat: (p0.lat + p1.lat) / 2, lon: (p0.lon + p1.lon) / 2 };
        if (len >= 8 && structures.length < 60 && inZone(mid.lat, mid.lon)) {
          const layer = Math.max(1, parseInt(tags['layer'] ?? '1', 10) || 1);
          const hw = tags['highway'];
          const width = hw === 'primary' || hw === 'secondary' ? 10 : hw === 'service' || hw === 'path' || hw === 'footway' ? 3.5 : tags['railway'] ? 5 : 7;
          structures.push({
            id: uid('st'),
            kind: 'bridge',
            name: tags['name'] ?? 'Bridge',
            x: (mid.lon - lon) * mLon,
            z: -(mid.lat - lat) * M_LAT,
            rotDeg: (Math.atan2(dz, dx) * 180) / Math.PI,
            height: 5 + (layer - 1) * 4,
            size: width,
            length: len,
            style: tags['bridge:structure'] === 'arch' ? 'arch' : 'beam',
          });
        }
      } else if (manMade && (el.type === 'node' || (el.type === 'way' && el.geometry && el.geometry.length >= 4)) && structures.length < 60) {
        const kind: StructureSpec['kind'] | null =
          manMade === 'chimney' ? 'chimney' : manMade === 'silo' ? 'silo' : manMade === 'storage_tank' ? 'tank' : manMade === 'water_tower' ? 'water_tower' :
          manMade === 'pylon' || ((manMade === 'tower' || manMade === 'mast') && (tags['tower:construction'] === 'lattice' || tags['tower:type'] === 'communication' || tags['tower:type'] === 'transmission' || manMade === 'mast')) ? 'lattice_tower' : null;
        if (!kind) continue;
        let tx: number, tz: number, radius: number | null = null;
        if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
          if (!inZone(el.lat, el.lon)) continue;
          tx = (el.lon - lon) * mLon;
          tz = -(el.lat - lat) * M_LAT;
        } else {
          const g = el.geometry!;
          const cl = g.reduce((a, q) => a + q.lat, 0) / g.length, co = g.reduce((a, q) => a + q.lon, 0) / g.length;
          if (!inZone(cl, co)) continue;
          tx = (co - lon) * mLon;
          tz = -(cl - lat) * M_LAT;
          radius = Math.sqrt(this.polyArea(g.map((q) => [q.lon, q.lat] as [number, number])) / Math.PI);
        }
        const d = STRUCTURE_DEFAULTS[kind];
        const height = parseFloat(tags['height'] ?? tags['tower:height'] ?? '') || (manMade === 'pylon' ? 28 : d.height);
        structures.push({
          id: uid('st'),
          kind,
          name: tags['name'] ?? d.name,
          x: tx,
          z: tz,
          rotDeg: 0,
          height: Math.min(300, Math.max(3, height)),
          size: radius && radius > 0.5 ? Math.min(30, radius) : manMade === 'pylon' ? 2.5 : d.size,
        });
      } else if (el.type === 'node' && tags['natural'] === 'tree' && el.lat !== undefined && el.lon !== undefined) {
        if (trees.length >= 250 || !inZone(el.lat, el.lon)) continue;
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
        const fp = this.toFootprint(ring, tags);
        if (inZone(fp.ring.reduce((a, q) => a + q[1], 0) / fp.ring.length, fp.ring.reduce((a, q) => a + q[0], 0) / fp.ring.length)) footprints.push(fp);
      }
    }
    footprints.sort((p, q) => this.polyArea(q.ring) - this.polyArea(p.ring));
    return { footprints, trees, roads, structures, partial };
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
    return { ring, name: tags['name'] || undefined, levels: nlev, heightM, roof: tags['roof:shape'], type: tags['building'], dx: mx - mn, dz: mx2 - mn2, headingDeg };
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
