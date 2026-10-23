import { Service, inject } from '@angular/core';
import { makeBackup, readBackup, restoreAction } from '../core/backup';
import { decodeHeights } from '../core/share';
import { emptyGrid, getTerrainBase } from '../core/terrain';
import { BlockLibraryService } from './block-library.service';
import { ElevationService, cacheBase } from './elevation.service';
import { SiteLibraryService } from './site-library.service';

/** Back up every bando and the pilot's own blocks to one file, and restore such a file (the newer copy of a bando wins). */
@Service()
export class BackupService {
  private readonly sites = inject(SiteLibraryService);
  private readonly blocks = inject(BlockLibraryService);
  private readonly elevation = inject(ElevationService);

  /** The backup as text, and how many bandos and blocks it holds. */
  async backup(now = Date.now()): Promise<{ name: string; text: string; bandos: number; blocks: number }> {
    const bandos = this.sites.records();
    // ground that came inside a shared file lives only in the cache: load it so it goes into the backup
    for (const b of bandos) if (b.spec.terrain?.base?.source === 'embedded') await this.elevation.ensure(b.spec);
    const own = this.blocks.own();
    const file = makeBackup(bandos, own, (k) => getTerrainBase(k), now);
    const day = new Date(now).toISOString().slice(0, 10);
    return { name: `abando-backup-${day}.json`, text: JSON.stringify(file), bandos: bandos.length, blocks: own.length };
  }

  /** Restore a backup file; null when the text is not a backup. */
  async restore(text: string): Promise<{ added: number; replaced: number; kept: number; blocks: number; dropped: number } | null> {
    const b = readBackup(text);
    if (!b) return null;
    const out = { added: 0, replaced: 0, kept: 0, blocks: 0, dropped: b.dropped };
    for (const { savedAt, spec } of b.bandos) {
      const act = restoreAction(this.sites.savedAt(spec.id), savedAt);
      if (act === 'keep') {
        out.kept++;
        continue;
      }
      const base = spec.terrain?.base;
      if (spec.terrain && base?.data) {
        const h = decodeHeights(base.data, emptyGrid(spec.terrain).h.length);
        delete base.data; // the spec is cloned on every edit: the heights live in the cache
        if (h) await cacheBase(base.key, h);
        else delete spec.terrain.base;
      }
      this.sites.save(spec, savedAt);
      out[act === 'add' ? 'added' : 'replaced']++;
    }
    for (const blk of b.blocks) if (this.blocks.restoreOwn(blk)) out.blocks++;
    return out;
  }
}
