import { findFlips, findLiftoff } from '../flight/analysis';
import type { FlipEvent, Flight } from '../models';
import {
  type Confidence, type LogFeatureKey, type VideoFeatureKey, type VideoSample,
  confidenceOf, crossCorrelate, detectVideoOnset, gridFromSamples, logGrid, upGrid,
} from './features';

/** Everything the alignment plot needs. */
export interface SyncFeatures {
  vt0: number;
  V: Record<VideoFeatureKey, Float32Array>;
  F: Record<LogFeatureKey, Float32Array>;
  /** Log time where the plot starts. */
  L0: number;
  logFeature: LogFeatureKey;
  videoFeature: VideoFeatureKey;
}

export interface SyncOutcome {
  /** Video time = log time + offset. Null when no reliable match was found. */
  offset: number | null;
  confidence: Confidence | null;
  description: string;
  /** Log time of lift-off (or 0) to park the replay on after a successful sync. */
  anchor: number;
  features: SyncFeatures | null;
}

interface Candidate {
  videoFeature: VideoFeatureKey;
  logFeature: LogFeatureKey;
  off: number;
  r1: number;
  r2: number;
  score: number;
  flip?: FlipEvent;
}

/** Pairs of (video feature, log feature) that should move together. */
const PAIRS: readonly (readonly [VideoFeatureKey, LogFeatureKey])[] = [
  ['pan', 'yp'],
  ['diff', 'g'],
  ['pan', 'g'],
  ['tb', 'up'],
  ['tbn', 'up'],
];

/**
 * Find the video <-> log time offset from the scanned video samples: cross-correlate camera motion with gyro rotation
 * (and sky/ground brightness with the drone's uprightness) over the first minute of flight, refine on the first
 * flip/roll, and fall back to the lift-off onset when the whole-flight match is weak.
 */
export function matchVideoToLog(samples: readonly VideoSample[], flight: Flight): SyncOutcome {
  const lift = findLiftoff(flight);
  const anchor = lift ?? 0;
  const t0 = samples[0]!.t;
  const t1 = samples[samples.length - 1]!.t;
  const pan = gridFromSamples(samples, 'pan', t0, t1);
  const diff = gridFromSamples(samples, 'diff', t0, t1);
  const tb = gridFromSamples(samples, 'tb', t0, t1);
  const V: Record<VideoFeatureKey, Float32Array> = { pan, diff, tb, tbn: tb.map((x) => -x) };

  let best: Candidate | null = null;
  let features: SyncFeatures | null = null;
  const T = flight.tel;
  if (T) {
    const F: Record<LogFeatureKey, Float32Array> = { yp: logGrid(T, 'yp'), g: logGrid(T, 'g'), up: upGrid(T) };
    const L0 = Math.max(0, (lift ?? 0) - 2);
    const L1 = Math.min(flight.dur, L0 + 60); // first minute of flight
    for (const [vf, lf] of PAIRS) {
      const x = crossCorrelate(F[lf], V[vf], t0, L0, L1, t0 - 5, t1);
      const c: Candidate = { videoFeature: vf, logFeature: lf, off: x.off, r1: x.r1, r2: x.r2, score: x.r1 + Math.max(0, x.r1 - x.r2) };
      if (!best || c.score > best.score) best = c;
    }
    const flip = findFlips(flight)[0];
    if (flip && best && best.r1 > 0.3) {
      const x2 = crossCorrelate(F[best.logFeature], V[best.videoFeature], t0, Math.max(0, flip.t - 4), Math.min(flight.dur, flip.t + 6), best.off - 1.5, best.off + 1.5);
      if (x2.r1 >= 0.5 && Math.abs(x2.off - best.off) < 1.5) {
        best.off = x2.off;
        best.flip = flip;
      }
    }
    if (best) features = { vt0: t0, V, F, L0, logFeature: best.logFeature, videoFeature: best.videoFeature };
  }

  if (best && confidenceOf(best) !== 'low') {
    const conf = confidenceOf(best);
    const refined = best.flip ? ` · refined on the ${best.flip.kind} at ${best.flip.t.toFixed(1)} s` : '';
    return {
      offset: best.off,
      confidence: conf,
      description: `whole-flight match (${best.logFeature} vs ${best.videoFeature}), r=${best.r1.toFixed(2)}, ${conf} confidence${refined}`,
      anchor,
      features,
    };
  }
  const onset = lift != null ? detectVideoOnset(samples) : null;
  if (onset && lift != null) {
    const why = best ? `whole-flight match weak, r=${best.r1.toFixed(2)}` : 'no telemetry';
    return { offset: onset.t - lift, confidence: 'low', description: `lift-off onset only (${why}): low confidence`, anchor, features };
  }
  return { offset: null, confidence: null, description: 'no reliable match', anchor, features };
}
