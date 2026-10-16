/** One telemetry message from the bridge, normalised: SI-ish units, degrees. Missing fields are null. */
export interface LiveSample {
  lat: number | null;
  lon: number | null;
  alt: number | null;
  /** Heading / course, degrees. */
  heading: number | null;
  sats: number | null;
  vbat: number | null;
  lq: number | null;
  rssi: number | null;
  mode: string | null;
  /** Ground speed, m/s. */
  speed: number | null;
  /** Attitude, degrees. */
  roll: number | null;
  pitch: number | null;
  yaw: number | null;
}

type Flat = Record<string, unknown>;

function flatten(obj: Flat, prefix: string, out: Flat): Flat {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Flat, `${prefix}${k}.`, out);
    else out[(prefix + k).toLowerCase()] = v;
  }
  return out;
}

/**
 * Tolerant input: flat or nested JSON, common field names, latitude/longitude as degrees or degrees * 1e7,
 * speed in m/s (or km/h when the field says so), angles in degrees (or radians when the field says so).
 */
export function normalizeLive(input: unknown): LiveSample | null {
  if (!input || typeof input !== 'object') return null;
  let msg = input as Flat;
  if (msg['data'] && typeof msg['data'] === 'object') msg = msg['data'] as Flat;
  const flat = flatten(msg, '', {});
  const pickNumber = (...keys: string[]): number | null => {
    for (const k of keys) {
      for (const f of Object.keys(flat)) {
        if (f === k || f.endsWith(`.${k}`)) {
          const v = flat[f];
          if (v != null && v !== '' && isFinite(+(v as number))) return +(v as number);
        }
      }
    }
    return null;
  };
  const pickString = (...keys: string[]): string | null => {
    for (const k of keys) {
      for (const f of Object.keys(flat)) {
        if (f === k || f.endsWith(`.${k}`)) {
          const v = flat[f];
          if (typeof v === 'string' && v) return v;
        }
      }
    }
    return null;
  };

  let speed = pickNumber('speed', 'speed_ms', 'groundspeed_ms', 'gs_ms', 'velocity');
  if (speed == null) {
    const kmh = pickNumber('speed_kmh', 'speed_kph', 'groundspeed_kmh', 'groundspeed', 'gs');
    if (kmh != null) speed = kmh / 3.6;
  }
  let roll = pickNumber('roll', 'roll_deg', 'roll_rad', 'rollrad');
  let pitch = pickNumber('pitch', 'pitch_deg', 'pitch_rad', 'pitchrad');
  let yaw = pickNumber('yaw', 'yaw_deg', 'yaw_rad', 'yawrad');
  if (Object.keys(flat).some((k) => /(roll|pitch|yaw)_?rad/.test(k))) {
    const d = 180 / Math.PI;
    if (roll != null) roll *= d;
    if (pitch != null) pitch *= d;
    if (yaw != null) yaw *= d;
  }
  let lat = pickNumber('lat', 'latitude');
  let lon = pickNumber('lon', 'lng', 'long', 'longitude');
  if (lat != null && Math.abs(lat) > 90) lat /= 1e7;
  if (lon != null && Math.abs(lon) > 180) lon /= 1e7;
  return {
    lat,
    lon,
    alt: pickNumber('alt', 'altitude', 'alt_m', 'gps_alt', 'height'),
    heading: pickNumber('heading', 'course', 'cog', 'hdg'),
    sats: pickNumber('sats', 'satellites', 'numsat', 'num_sats'),
    vbat: pickNumber('vbat', 'voltage', 'batt_v', 'battery_voltage'),
    lq: pickNumber('lq', 'link_quality', 'uplink_lq'),
    rssi: pickNumber('rssi', 'rssi1', 'uplink_rssi'),
    mode: pickString('mode', 'flightmode', 'flight_mode'),
    speed,
    roll,
    pitch,
    yaw,
  };
}

/** A fix is usable when both coordinates are clearly non-zero (no GPS fix yet gives 0,0). */
export const hasFix = (m: LiveSample): m is LiveSample & { lat: number; lon: number } =>
  m.lat != null && m.lon != null && Math.abs(m.lat) > 1 && Math.abs(m.lon) > 1;

/** Human readable summary line of the values present in a sample. */
export function summarizeLive(m: LiveSample): string {
  const bits: string[] = [];
  if (m.sats != null) bits.push(`${m.sats} sats`);
  if (m.speed != null) bits.push(`${(m.speed * 3.6).toFixed(0)} km/h`);
  if (m.alt != null) bits.push(`alt ${m.alt.toFixed(0)} m`);
  if (m.vbat != null) bits.push(`${m.vbat.toFixed(1)} V`);
  if (m.lq != null) bits.push(`LQ ${m.lq}`);
  if (m.mode) bits.push(m.mode);
  return bits.join(' · ');
}
