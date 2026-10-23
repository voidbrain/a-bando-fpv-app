/**
 * A backup of everything the pilot made: every bando and their own blocks, in one file. Bandos whose real ground came
 * inside a shared file (it cannot be downloaded again from coordinates) carry their heights; the others download them
 * again when opened. Restoring keeps the newer of two copies of the same bando. Pure.
 */
import { sanitizeBlock, type BlockSpec } from './blocks';
import { encodeHeights } from './share';
import { cloneSpec, sanitizeSpec, type SiteSpec } from './site-spec';

export const BACKUP_FORMAT = 'abando-backup';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  v: 1;
  savedAt: number;
  bandos: { savedAt: number; spec: SiteSpec }[];
  blocks: BlockSpec[];
}

/** The backup of `bandos` and `blocks`; `heights(key)` gives the registered ground of an embedded base (or null). */
export function makeBackup(bandos: readonly { savedAt: number; spec: SiteSpec }[], blocks: readonly BlockSpec[], heights: (key: string) => Float32Array | null, now: number): BackupFile {
  return {
    format: BACKUP_FORMAT,
    v: 1,
    savedAt: now,
    bandos: bandos.map(({ savedAt, spec }) => {
      const s = cloneSpec(spec);
      const base = s.terrain?.base;
      if (base?.source === 'embedded') {
        const h = heights(base.key);
        if (h) base.data = encodeHeights(h);
      }
      return { savedAt, spec: s };
    }),
    blocks: blocks.map((b) => JSON.parse(JSON.stringify(b)) as BlockSpec),
  };
}

/** Read a backup file: every bando and block checked as if imported one by one (bad ones are dropped); null if it is not a backup. */
export function readBackup(text: string): { bandos: { savedAt: number; spec: SiteSpec }[]; blocks: BlockSpec[]; dropped: number } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const o = raw as Partial<BackupFile> | null;
  if (!o || o.format !== BACKUP_FORMAT || !Array.isArray(o.bandos)) return null;
  let dropped = 0;
  const bandos = o.bandos.flatMap((b) => {
    const spec = b && typeof b === 'object' ? sanitizeSpec((b as { spec?: unknown }).spec) : null;
    if (!spec) return dropped++, [];
    const t = (b as { savedAt?: unknown }).savedAt;
    return [{ savedAt: typeof t === 'number' && isFinite(t) ? t : 0, spec }];
  });
  const blocks = (Array.isArray(o.blocks) ? o.blocks : []).flatMap((b) => {
    const s = sanitizeBlock(b);
    return s ? [s] : (dropped++, []);
  });
  return { bandos, blocks, dropped };
}

/** What restoring does with one bando: add it, replace an older copy, or keep the copy already here (same age or newer). */
export function restoreAction(here: number | null, backup: number): 'add' | 'replace' | 'keep' {
  if (here === null) return 'add';
  return backup > here ? 'replace' : 'keep';
}
