import { makeFlight, makeTelemetry, seeded } from '../testing/fixtures';
import { GRID_DT, confidenceOf, crossCorrelate, detectVideoOnset, gridFromSamples, logGrid, upGrid, type VideoSample } from './features';
import { matchVideoToLog } from './matcher';

const FLICKS = [5, 8, 9.5, 14, 17, 22, 26, 31, 38, 44];
const FLIPS = [{ at: 11, axis: 'roll' as const }, { at: 29, axis: 'pitch' as const }];

/** Fake "video scan": camera motion follows the drone's rotation, shifted by `offset` (video = log + offset). */
function fakeVideo(offset: number, from: number, to: number): VideoSample[] {
  const tel = makeTelemetry({ duration: 60, liftoff: 3, flips: FLIPS, flicks: FLICKS });
  const yp = logGrid(tel, 'yp');
  const g = logGrid(tel, 'g');
  const up = upGrid(tel);
  const rnd = seeded(99);
  const at = (a: Float32Array, lt: number, dflt: number): number => {
    const k = Math.floor(lt / GRID_DT);
    return k >= 0 && k < a.length ? (a[k] as number) : dflt;
  };
  const out: VideoSample[] = [];
  for (let vt = from; vt < to; vt += 0.04) {
    const lt = vt - offset;
    out.push({
      t: vt,
      pan: at(yp, lt, 0) / 60 + rnd() * 0.3,
      diff: at(g, lt, 0) / 5000 + rnd() * 0.0004,
      mag: at(g, lt, 0) / 5000 + rnd() * 0.0004,
      tb: at(up, lt, 1) * 0.2 + rnd() * 0.01,
    });
  }
  return out;
}

describe('sync features', () => {
  it('cross-correlation recovers a known offset to a fraction of a grid step', () => {
    const n = 400;
    const F = new Float32Array(n);
    const rnd = seeded(5);
    for (let i = 0; i < n; i++) F[i] = rnd() < 0.08 ? 3 + rnd() : rnd() * 0.3; // sparse, non-repeating bursts
    const trueOff = 7.43;
    const V = new Float32Array(n + 300);
    for (let k = 0; k < V.length; k++) {
      const src = k - Math.round(trueOff / GRID_DT);
      V[k] = src >= 0 && src < n ? (F[src] as number) : 0;
    }
    const r = crossCorrelate(F, V, 0, 0, 19, 0, 15);
    expect(r.off).toBeCloseTo(trueOff, 1);
    expect(r.r1).toBeGreaterThan(0.9);
    expect(confidenceOf(r)).toBe('high');
  });

  it('is not confident about noise', () => {
    const rnd = seeded(11);
    const F = Float32Array.from({ length: 400 }, () => rnd());
    const V = Float32Array.from({ length: 700 }, () => rnd());
    expect(confidenceOf(crossCorrelate(F, V, 0, 0, 19, 0, 15))).toBe('low');
  });

  it('puts irregular video samples on a regular grid and fills gaps', () => {
    const s: VideoSample[] = [0, 0.04, 0.5, 0.54].map((t) => ({ t, pan: t < 0.3 ? 1 : 3, diff: 0, mag: 0, tb: 0 }));
    const g = gridFromSamples(s, 'pan', 0, 0.6);
    expect(g.length).toBe(13);
    expect(g[0]!).toBeLessThan(1.5); // (the 5-sample smoothing pulls the edges slightly towards the interpolated middle)
    expect(g[12]!).toBeGreaterThan(2.5);
    expect(g[6]! > 1.5 && g[6]! < 2.5).toBeTruthy(); // interpolated between the two clusters
  });

  it('detects the moment the picture starts moving, and ignores a short wave', () => {
    const quiet = (t: number): VideoSample => ({ t, pan: 0, diff: 0, mag: 0.001, tb: 0 });
    const moving = (t: number): VideoSample => ({ t, pan: 1, diff: 1, mag: 0.03, tb: 0 });
    const s: VideoSample[] = [];
    for (let i = 0; i < 200; i++) {
      const t = i * 0.04;
      s.push(t >= 4 && t < 4.4 ? moving(t) : t >= 6 ? moving(t) : quiet(t)); // 0.4 s wave at 4 s, real take-off at 6 s
    }
    const o = detectVideoOnset(s);
    expect(o).toBeTruthy();
    expect(o!.t).toBeCloseTo(6, 0);
    expect(detectVideoOnset(s.slice(0, 20))).toBeNull();
  });
});

describe('video <-> log matcher', () => {
  const flight = makeFlight(makeTelemetry({ duration: 60, liftoff: 3, flips: FLIPS, flicks: FLICKS }), 60);

  it('finds the offset of a synthetic clip with high confidence', () => {
    const r = matchVideoToLog(fakeVideo(7.3, 0, 60), flight);
    expect(r.offset).toBeTruthy();
    expect(r.offset!).toBeCloseTo(7.3, 0);
    expect(Math.abs(r.offset! - 7.3)).toBeLessThan(0.15);
    expect(r.confidence).toBe('high');
    expect(r.features).toBeTruthy();
  });

  it('also finds a video that started after the log (negative offset)', () => {
    const r = matchVideoToLog(fakeVideo(-2.1, 0, 58), flight);
    expect(r.offset).toBeTruthy();
    expect(Math.abs(r.offset! + 2.1)).toBeLessThan(0.2);
  });

  it('only searches offsets from 5 s before the scan start (documented limit of the method)', () => {
    // video 8 s into the file == log 10.1 s: offset -2.1 is outside [scanStart - 5, scanEnd], so it must not be reported as a good match
    const r = matchVideoToLog(fakeVideo(-2.1, 8, 58), flight);
    expect(r.offset === null || r.confidence === 'low' || Math.abs(r.offset! + 2.1) > 1).toBeTruthy();
  });

  it('gives up (or admits low confidence) on a clip with nothing in common', () => {
    const rnd = seeded(3);
    const noise: VideoSample[] = [];
    for (let t = 0; t < 60; t += 0.04) noise.push({ t, pan: rnd(), diff: rnd() * 0.01, mag: 0.001, tb: rnd() * 0.01 });
    const r = matchVideoToLog(noise, flight);
    expect(r.offset === null || r.confidence === 'low').toBeTruthy();
  });
});
