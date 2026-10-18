import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeoService } from './geo.service';

const LAT = 45.5, LON = 12.0;
const dLat = (m: number): number => m / 111132;
const dLon = (m: number): number => m / (111320 * Math.cos((LAT * Math.PI) / 180));
const pt = (east: number, north: number): { lat: number; lon: number } => ({ lat: LAT + dLat(north), lon: LON + dLon(east) });

const rect = (e: number, n: number, w: number, h: number): { lat: number; lon: number }[] => [pt(e, n), pt(e + w, n), pt(e + w, n + h), pt(e, n + h), pt(e, n)];

describe('OpenStreetMap import of other structure types', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns greenhouses, chimneys, pylons and bridges into the right things', async () => {
    const elements = [
      { id: 1, type: 'way', tags: { building: 'greenhouse' }, geometry: rect(-60, -20, 40, 12) },
      { id: 2, type: 'way', tags: { building: 'yes', name: 'Barn' }, geometry: rect(20, 10, 20, 10) },
      { id: 3, type: 'node', tags: { man_made: 'chimney', height: '42' }, ...pt(-10, 40) },
      { id: 4, type: 'node', tags: { power: 'tower' }, ...pt(70, 30) },
      { id: 5, type: 'node', tags: { man_made: 'tower', 'tower:type': 'observation' }, ...pt(-70, 50) }, // not a lattice mast: skipped
      { id: 6, type: 'way', tags: { highway: 'residential', bridge: 'yes', layer: '1' }, geometry: [pt(-30, -60), pt(30, -60)] },
      { id: 7, type: 'way', tags: { highway: 'residential' }, geometry: [pt(-30, -80), pt(30, -80)] },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements }), { status: 200 })));
    const d = await new GeoService().areaData(LAT, LON, 150, 120);

    expect(d.footprints.map((f) => f.type)).toContain('greenhouse');
    expect(d.footprints.length).toBe(2);

    const kinds = d.structures.map((s) => s.kind).sort();
    expect(kinds).toEqual(['bridge', 'chimney', 'lattice_tower']);
    const ch = d.structures.find((s) => s.kind === 'chimney')!;
    expect(ch.height).toBe(42);
    expect(ch.x).toBeCloseTo(-10, 0);
    expect(ch.z).toBeCloseTo(-40, 0); // north is -z
    const br = d.structures.find((s) => s.kind === 'bridge')!;
    expect(br.length).toBeCloseTo(60, 0);
    expect(Math.abs(br.rotDeg)).toBeLessThan(1); // runs east-west
    // the road on the bridge is a bridge, not a ground pad; the plain road still is
    expect(d.roads.length).toBe(1);
  });
});
