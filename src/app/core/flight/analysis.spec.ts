import { makeFlight, makeTelemetry } from '../testing/fixtures';
import { findFirstYawFlick, findFlips, findLiftoff } from './analysis';

describe('flight analysis', () => {
  it('finds lift-off from the motor output', () => {
    const f = makeFlight(makeTelemetry({ duration: 30, liftoff: 3.9 }));
    expect(findLiftoff(f)).toBeCloseTo(3.9, 1);
  });

  it('falls back to GPS movement when there is no telemetry', () => {
    const f = makeFlight(null, 30);
    const l = findLiftoff(f);
    expect(l).toBeTruthy();
  });

  it('detects rolls and flips, with the time of the inverted middle', () => {
    const f = makeFlight(makeTelemetry({ duration: 30, liftoff: 3, flips: [{ at: 6, axis: 'roll' }, { at: 12, axis: 'pitch' }] }));
    const ev = findFlips(f);
    expect(ev.length).toBe(2);
    expect(ev[0]?.kind).toBe('roll');
    expect(ev[0]?.t).toBeCloseTo(6, 0);
    expect(ev[1]?.kind).toBe('flip');
    expect(ev[1]?.t).toBeCloseTo(12, 0);
    expect(ev[0]!.deg).toBeGreaterThan(300);
  });

  it('ignores moves later than 25 s after lift-off and logs without telemetry', () => {
    const f = makeFlight(makeTelemetry({ duration: 50, liftoff: 3, flips: [{ at: 40, axis: 'roll' }] }), 50);
    expect(findFlips(f).length).toBe(0);
    expect(findFlips(makeFlight(null)).length).toBe(0);
  });

  it('finds the first sharp yaw flick after lift-off', () => {
    const f = makeFlight(makeTelemetry({ duration: 30, liftoff: 3, flicks: [1, 7.2] }));
    expect(findFirstYawFlick(f)).toBeCloseTo(7.2, 0); // the flick at 1 s is before lift-off
  });
});
