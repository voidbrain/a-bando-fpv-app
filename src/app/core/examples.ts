/** The example bandos published with the app (`public/library/bandos.json`, built by tools/build-catalog.mjs). Pure. */
export interface ExampleBando {
  /** Path of the bando file, relative to `library/`. */
  file: string;
  name: string;
  about: string;
  origin: { lat: number; lon: number };
  buildings: number;
  /** Shared without its place: the list does not show coordinates then. */
  privacy?: 'hidden';
  /** Raised when the example changes: copies made from an older release are told a newer one is out. */
  release: number;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);

/** Check the downloaded index: only well-formed rows, files inside `bandos/`, at most 50. */
export function sanitizeExamples(raw: unknown): ExampleBando[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { bandos?: unknown }).bandos) ? (raw as { bandos: unknown[] }).bandos : [];
  const out: ExampleBando[] = [];
  for (const r of list.slice(0, 50)) {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
    const origin = (o['origin'] ?? {}) as Record<string, unknown>;
    if (typeof o['file'] !== 'string' || !/^bandos\/[a-z0-9-]{1,64}\.json$/.test(o['file'])) continue;
    if (typeof o['name'] !== 'string' || !isNum(origin['lat']) || !isNum(origin['lon'])) continue;
    out.push({
      file: o['file'],
      name: o['name'].slice(0, 80),
      about: typeof o['about'] === 'string' ? o['about'].slice(0, 300) : '',
      origin: { lat: origin['lat'], lon: origin['lon'] },
      buildings: isNum(o['buildings']) ? Math.max(0, Math.round(o['buildings'])) : 0,
      release: isNum(o['release']) ? Math.max(1, Math.round(o['release'])) : 1,
      ...(o['privacy'] === 'hidden' ? { privacy: 'hidden' as const } : {}),
    });
  }
  return out;
}

/** A newer release of the example a bando was copied from, or null (not a copy, or up to date, or the example is gone). */
export function newerExample(spec: { derivedFrom?: { example: string; release: number } }, examples: readonly ExampleBando[]): ExampleBando | null {
  const d = spec.derivedFrom;
  const e = d ? examples.find((x) => x.file === d.example) : undefined;
  return e && d && e.release > d.release ? e : null;
}
