import { RADIO_PRESETS, SwitchTracker, axisValue, pickGamepad, readPilotInput, type PadLike } from './radio-input';

const pad = (axes: number[], id = 'Generic'): PadLike => ({ id, axes });

describe('radio input', () => {
  it('reads the keyboard when no pad is connected', () => {
    const r = readPilotInput({ KeyD: true, KeyW: true, KeyQ: true, ArrowUp: true }, null, RADIO_PRESETS.radio());
    expect(r.gamepad).toBe(false);
    expect(r.roll).toBe(1);
    expect(r.pitch).toBe(1);
    expect(r.yaw).toBe(-1);
    expect(r.throttle).toBe(1);
  });

  it('down / shift cancel up / space on the throttle', () => {
    expect(readPilotInput({ Space: true, ShiftLeft: true }, null, RADIO_PRESETS.radio()).throttle).toBe(0);
    expect(readPilotInput({ ArrowDown: true }, null, RADIO_PRESETS.radio()).throttle).toBe(-1);
  });

  it('applies axis assignment and inversion', () => {
    const m = RADIO_PRESETS.radio();
    expect(axisValue(pad([0.5, 0.25]), { a: 1, inv: true })).toBe(-0.25);
    expect(axisValue(pad([0.5]), { a: 3, inv: false })).toBe(0); // out of range
    expect(axisValue(pad([0.5]), { a: -1, inv: false })).toBe(0); // unassigned
    const r = readPilotInput({}, pad([0.1, 0.2, -1, 0.4, 1]), m);
    expect(r.roll).toBeCloseTo(0.1, 9);
    expect(r.pitch).toBeCloseTo(-0.2, 9); // inverted
    expect(r.yaw).toBeCloseTo(0.4, 9);
    expect(r.throttle).toBeCloseTo(0, 9); // absolute throttle: -1..1 -> 0..1
    expect(r.armSwitch).toBe(true);
    expect(r.modeSwitch).toBeNull();
  });

  it('a spring throttle stays -1..1', () => {
    const r = readPilotInput({}, pad([0, 0, 0, 0]), RADIO_PRESETS.gamepad());
    expect(r.spring).toBe(true);
    expect(r.throttle).toBeCloseTo(-0, 9);
  });

  it('prefers a named radio over other devices, otherwise any pad with 4+ axes', () => {
    const a = pad([0, 0, 0, 0], 'Xbox controller');
    const b = pad([0, 0, 0, 0, 0, 0], 'RadioMaster Zorro (Vendor: 1209)');
    expect(pickGamepad([null, a, b])).toBe(b);
    expect(pickGamepad([a])).toBe(a);
    expect(pickGamepad([pad([0, 0]), null])).toBeNull();
  });
});

describe('switch tracker', () => {
  const read = (arm: boolean | null, mode: boolean | null = null, throttle = 0, spring = false) => ({
    roll: 0, pitch: 0, yaw: 0, throttle, gamepad: true, spring, armSwitch: arm, modeSwitch: mode,
  });

  it('never arms just because a radio was connected with the switch already up', () => {
    const t = new SwitchTracker();
    expect(t.update(read(true))).toEqual({});
    expect(t.update(read(true))).toEqual({});
  });

  it('arms on the up edge and disarms on the down edge', () => {
    const t = new SwitchTracker();
    t.update(read(false));
    expect(t.update(read(true)).arm).toBe(true);
    expect(t.update(read(true))).toEqual({});
    expect(t.update(read(false)).arm).toBe(false);
  });

  it('refuses to arm with the throttle up (absolute throttle only)', () => {
    const t = new SwitchTracker();
    t.update(read(false, null, 0.8));
    const a = t.update(read(true, null, 0.8));
    expect(a.armRefused).toBe(true);
    expect(a.arm).toBe(undefined);
    const t2 = new SwitchTracker();
    t2.update(read(false, null, 0.8, true));
    expect(t2.update(read(true, null, 0.8, true)).arm).toBe(true); // spring throttle: allowed
  });

  it('reports the mode on the first reading and on each change', () => {
    const t = new SwitchTracker();
    expect(t.update(read(null, true)).mode).toBe('acro');
    expect(t.update(read(null, true))).toEqual({});
    expect(t.update(read(null, false)).mode).toBe('angle');
  });

  it('forgets the switch positions when the pad disappears', () => {
    const t = new SwitchTracker();
    t.update(read(false));
    t.update({ ...read(null), gamepad: false });
    expect(t.update(read(true))).toEqual({}); // first reading again: no edge
  });
});
