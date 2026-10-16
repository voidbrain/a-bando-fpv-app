import type { GeoSample, Telemetry } from '../models';

export interface ParsedLog {
  pts: GeoSample[];
  tel: Telemetry | null;
}

/** Parse a flight log: Betaflight Blackbox CSV (any delimiter), GPX or JSON. Throws on unusable input. */
export function parseLog(input: string): ParsedLog {
  const text = input.trim();
  const first = text[0];
  let pts: GeoSample[];
  let tel: Telemetry | null = null;
  if (first === '<') pts = parseGpx(text);
  else if (first === '[' || first === '{') pts = parseJson(text);
  else {
    const csv = parseCsv(text);
    pts = csv.pts;
    tel = csv.tel;
  }
  pts = pts.filter((p) => isFinite(p.lat) && isFinite(p.lon) && isFinite(p.t));
  if (pts.length < 2) throw new Error('fewer than 2 GPS points');
  return { pts, tel };
}

function parseGpx(text: string): GeoSample[] {
  const pts: GeoSample[] = [];
  const re = /<trkpt[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const body = m[3] ?? '';
    const ele = /<ele>([-\d.]+)/.exec(body);
    const time = /<time>([^<]+)/.exec(body);
    pts.push({ lat: +(m[1] as string), lon: +(m[2] as string), alt: ele ? +(ele[1] as string) : 0, t: time ? Date.parse(time[1] as string) / 1e3 : pts.length * 0.1 });
  }
  return pts;
}

type JsonPoint = Record<string, unknown>;

function parseJson(text: string): GeoSample[] {
  const j = JSON.parse(text) as unknown;
  const obj = j as Record<string, unknown>;
  const arr = (Array.isArray(j) ? j : (obj['points'] ?? obj['track'] ?? obj['samples'] ?? [])) as JsonPoint[];
  return arr.map((o, i) => {
    const t = o['t'] ?? o['time'];
    return {
      lat: +((o['lat'] ?? o['latitude']) as number),
      lon: +((o['lon'] ?? o['lng'] ?? o['longitude']) as number),
      alt: +((o['alt'] ?? o['altitude'] ?? o['ele'] ?? 0) as number),
      t: typeof t === 'number' ? t : i * 0.1,
    };
  });
}

interface CsvColumns {
  lat: number;
  lon: number;
  alt: number;
  t: number;
  names: string[];
}

function parseCsv(text: string): { pts: GeoSample[]; tel: Telemetry | null } {
  const lines = text.split(/\r?\n/);
  let headerRow = -1;
  let cols: CsvColumns | null = null;
  let delim = ',';
  for (let i = 0; i < lines.length && headerRow < 0; i++) {
    const l = lines[i] as string;
    if (l.length < 8 || !/lat|coord/i.test(l)) continue;
    const d = [',', ';', '\t'].sort((a, b) => l.split(b).length - l.split(a).length)[0] as string;
    const names = l.split(d).map((h) => h.replace(/"/g, '').trim().toLowerCase());
    if (names.length < 3) continue;
    const find = (...res: RegExp[]): number => {
      for (const re of res) {
        const k = names.findIndex((h) => re.test(h));
        if (k >= 0) return k;
      }
      return -1;
    };
    const c: CsvColumns = {
      lat: find(/^(gps_)?lat(itude)?(\s|\(|$)/, /coord\[0\]/),
      lon: find(/^(gps_)?(lon|lng|long)(gitude)?(\s|\(|$)/, /coord\[1\]/),
      alt: find(/^gps_alt/, /^(alt|altitude|ele|elevation|height)(\s|\(|$)/),
      t: find(/^time/, /^t$/, /timestamp/),
      names,
    };
    if (c.lat >= 0 && c.lon >= 0) {
      headerRow = i;
      cols = c;
      delim = d;
    }
  }
  if (headerRow < 0 || !cols) throw new Error('no latitude/longitude columns found');

  const timeHeader = cols.t >= 0 ? (cols.names[cols.t] as string) : '';
  let unit = /\(us\)|µs/.test(timeHeader) ? 1e6 : /\(ms\)/.test(timeHeader) ? 1e3 : 1;
  let raw = false;
  let lastKey = '';
  const pts: GeoSample[] = [];
  for (let i = headerRow + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const c = line.split(delim);
    const la0 = parseFloat(c[cols.lat] as string);
    const lo0 = parseFloat(c[cols.lon] as string);
    if (!isFinite(la0) || !isFinite(lo0)) continue;
    if (Math.abs(la0) > 90) raw = true;
    const lat = Math.abs(la0) > 90 ? la0 / 1e7 : la0;
    const lon = Math.abs(lo0) > 180 ? lo0 / 1e7 : lo0;
    const key = `${lat},${lon}`;
    if (!lat || !lon || key === lastKey) continue;
    lastKey = key;
    let t = NaN;
    if (cols.t >= 0) {
      t = parseFloat(c[cols.t] as string);
      if (isNaN(t)) t = (Date.parse((c[cols.t] as string).replace(/"/g, '')) / 1e3) * unit;
    }
    pts.push({ lat, lon, alt: cols.alt >= 0 ? parseFloat(c[cols.alt] as string) || 0 : 0, t });
  }
  // Betaflight "time" has no unit in its header: it is microseconds.
  if (pts.length > 1 && unit === 1 && /^time$/.test(timeHeader) && (pts[pts.length - 1] as GeoSample).t - (pts[0] as GeoSample).t > 1e5) unit = 1e6;
  pts.forEach((p, i) => {
    p.t = isNaN(p.t) ? i * 0.1 : p.t / unit;
    if (raw) p.alt /= 10; // raw Betaflight GPS_altitude is in decimetres
  });

  const tel = pts.length > 1 ? parseTelemetry(lines, headerRow, delim, cols, unit, (pts[0] as GeoSample).t) : null;
  return { pts, tel };
}

const TELEMETRY_COLUMNS = [
  'heading[0]', 'heading[1]', 'heading[2]',
  'rccommand[0]', 'rccommand[1]', 'rccommand[2]', 'rccommand[3]',
  'motor[0]', 'motor[1]', 'motor[2]', 'motor[3]',
  'gyroadc[0]', 'gyroadc[1]', 'gyroadc[2]',
] as const;

/** Blackbox rows are ~800 Hz: keep every 8th (~100 Hz), plenty for replay and instruments. */
const DECIMATION = 8;

function parseTelemetry(lines: string[], headerRow: number, delim: string, cols: CsvColumns, unit: number, t0: number): Telemetry | null {
  const idx = TELEMETRY_COLUMNS.map((n) => cols.names.indexOf(n));
  if (cols.t < 0 || idx.some((k) => k < 0)) return null;
  const vbatCol = cols.names.indexOf('vbatlatest');
  const courseCol = cols.names.indexOf('gps_ground_course');
  const speedCol = cols.names.indexOf('gps_speed');
  const t: number[] = [], att: number[] = [], rc: number[] = [], mot: number[] = [], gyro: number[] = [], vbat: number[] = [];
  let sinSum = 0;
  let cosSum = 0;
  let n = 0;
  for (let i = headerRow + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || ++n % DECIMATION) continue;
    const c = line.split(delim);
    const v = idx.map((k) => parseFloat(c[k] as string)) as number[];
    const tt = parseFloat(c[cols.t] as string) / unit - t0;
    if (tt < 0 || isNaN(tt) || v.some(isNaN)) continue;
    t.push(tt);
    att.push(v[0]!, v[1]!, v[2]!);
    rc.push(v[3]!, v[4]!, v[5]!, v[6]!);
    mot.push(v[7]!, v[8]!, v[9]!, v[10]!);
    gyro.push(v[11]!, v[12]!, v[13]!);
    vbat.push(vbatCol >= 0 ? parseFloat(c[vbatCol] as string) || 0 : 0);
    // The IMU yaw has an arbitrary zero: align it to the GPS course while moving (> 6 m/s).
    if (courseCol >= 0 && speedCol >= 0 && parseFloat(c[speedCol] as string) > 600 && !isNaN(parseFloat(c[courseCol] as string))) {
      const d = ((parseFloat(c[courseCol] as string) / 10) * Math.PI) / 180 - (v[2] as number);
      sinSum += Math.sin(d);
      cosSum += Math.cos(d);
    }
  }
  if (t.length <= 10) return null;
  const maxV = vbat.reduce((m, x) => Math.max(m, x), 0);
  return {
    t: Float32Array.from(t),
    att: Float32Array.from(att),
    rc: Float32Array.from(rc),
    mot: Float32Array.from(mot),
    gyro: Float32Array.from(gyro),
    vbat: Float32Array.from(maxV > 100 ? vbat.map((x) => x / 100) : vbat),
    yawOff: Math.atan2(sinSum, cosSum),
  };
}
