/**
 * The online block catalogue (Stage 1: read-only, published from the repository's `library/blocks/*.json` as
 * `library/catalog.json`). Checking, merging into the cached copy, and searching. Pure.
 */
import { sanitizeBlock, type BlockKind, type BlockSpec } from './blocks';

export interface Catalog {
  schema: 1;
  blocks: BlockSpec[];
}

/** Every block of a downloaded catalogue that passes the same check as everywhere else; `local/` ids are the pilot's, never the catalogue's. */
export function sanitizeCatalog(raw: unknown): { blocks: BlockSpec[]; rejected: string[] } {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as Partial<Catalog>).blocks) ? (raw as Catalog).blocks : [];
  const blocks: BlockSpec[] = [], rejected: string[] = [];
  const seen = new Set<string>();
  for (const b of list.slice(0, 500)) {
    const ok = sanitizeBlock(b);
    const id = (b as { id?: unknown })?.id;
    if (!ok || ok.id.startsWith('local/') || seen.has(ok.id)) {
      rejected.push(typeof id === 'string' ? id : '?');
      continue;
    }
    seen.add(ok.id);
    blocks.push(ok);
  }
  return { blocks, rejected };
}

/** The new cached catalogue: the published one wins (Stage 1 has no local edits to catalogue entries). Reports what changed. */
export function mergeCatalog(cached: readonly BlockSpec[], incoming: readonly BlockSpec[]): { blocks: BlockSpec[]; added: string[]; updated: string[]; removed: string[] } {
  const old = new Map(cached.map((b) => [b.id, b]));
  const now = new Set(incoming.map((b) => b.id));
  return {
    blocks: [...incoming],
    added: incoming.filter((b) => !old.has(b.id)).map((b) => b.id),
    updated: incoming.filter((b) => old.has(b.id) && old.get(b.id)!.version !== b.version).map((b) => b.id),
    removed: cached.filter((b) => !now.has(b.id)).map((b) => b.id),
  };
}

/** Blocks matching a free-text query (name, tags, description, id) and optionally a kind, best matches first. */
export function searchBlocks(list: readonly BlockSpec[], q: string, kind?: BlockKind | ''): BlockSpec[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const score = (b: BlockSpec): number => {
    if (kind && b.kind !== kind) return -1;
    if (!words.length) return 1;
    let s = 0;
    for (const w of words) {
      if (b.name.toLowerCase().includes(w)) s += 3;
      else if (b.tags.some((t) => t.includes(w))) s += 2;
      else if ((b.description ?? '').toLowerCase().includes(w) || b.id.includes(w)) s += 1;
      else return -1; // every word must match somewhere
    }
    return s;
  };
  return list
    .map((b) => ({ b, s: score(b) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.b.name.localeCompare(b.b.name))
    .map((x) => x.b);
}

/** Block id → newest version known (for "update available"). */
export const latestVersions = (list: readonly BlockSpec[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const b of list) m.set(b.id, Math.max(m.get(b.id) ?? 0, b.version));
  return m;
};

/**
 * The Library's sub-categories, in the order they are listed: what a block is for, read from its tags (the first rule
 * that matches wins). Patterns and buildings go by kind, the pilot's own blocks by their `local/` id.
 */
export const BLOCK_CATEGORIES: readonly { id: string; label: string; tags: readonly string[] }[] = [
  { id: 'fpv', label: 'FPV gates and poles', tags: ['fpv', 'freestyle', 'pole'] },
  { id: 'lines', label: 'Bridges, ramps and lines', tags: ['bridge', 'ramp', 'stairs', 'skate', 'line', 'wire'] },
  { id: 'vegetation', label: 'Bushes and hedges', tags: ['vegetation', 'bush', 'hedge'] },
  { id: 'vehicles', label: 'Vehicles', tags: ['vehicle'] },
  { id: 'street', label: 'Street', tags: ['street', 'sign', 'station', 'shelter', 'barrier', 'light', 'entrance'] },
  { id: 'yard', label: 'Yard and building site', tags: ['yard', 'container', 'construction', 'wood'] },
  { id: 'towers', label: 'Towers', tags: ['tower', 'power', 'water'] },
  { id: 'industrial', label: 'Industrial', tags: ['industrial', 'tank', 'farm', 'crane'] },
  { id: 'ruins', label: 'Ruins', tags: ['ruin'] },
];

/** The sub-category of a block (`buildings`, `patterns`, `mine` or one of {@link BLOCK_CATEGORIES}; `other` when none fits). */
export function blockCategory(b: Pick<BlockSpec, 'id' | 'kind' | 'tags'>): string {
  if (b.id.startsWith('local/')) return 'mine';
  if (b.kind === 'pattern') return 'patterns';
  if (b.kind === 'building') return 'buildings';
  return BLOCK_CATEGORIES.find((c) => b.tags.some((t) => c.tags.includes(t)))?.id ?? 'other';
}

/** A list of blocks under their sub-category headings, in Library order, each group by name. */
export function groupBlocks(list: readonly BlockSpec[]): { id: string; label: string; blocks: BlockSpec[] }[] {
  const order = [{ id: 'mine', label: 'My blocks' }, ...BLOCK_CATEGORIES, { id: 'buildings', label: 'Buildings' }, { id: 'patterns', label: 'Patterns' }, { id: 'other', label: 'Other' }];
  return order
    .map((c) => ({ id: c.id, label: c.label, blocks: list.filter((b) => blockCategory(b) === c.id).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((g) => g.blocks.length);
}
