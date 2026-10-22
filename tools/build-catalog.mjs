#!/usr/bin/env node
/**
 * Build the published block catalogue: every `library/blocks/*.json` into `public/library/catalog.json`, sorted by id.
 * The app checks every block again when it downloads the catalogue (core/catalog.ts), and the test suite checks the
 * built file (core/catalog.spec.ts), so a broken block fails CI before it is published. Run: node tools/build-catalog.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'library', 'blocks');
const blocks = [];
const errors = [];
for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
  try {
    const b = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (typeof b.id !== 'string' || !/^[a-z0-9-]{1,32}\/[a-z0-9-]{1,64}$/.test(b.id)) errors.push(`${f}: bad or missing id`);
    else if (b.id.startsWith('local/')) errors.push(`${f}: local/ ids are for the pilot's own blocks`);
    else if (`${b.id.split('/')[1]}.json` !== f) errors.push(`${f}: the file name must be the id's name (${b.id.split('/')[1]}.json)`);
    else blocks.push(b);
  } catch (e) {
    errors.push(`${f}: ${e.message}`);
  }
}
const ids = blocks.map((b) => b.id);
const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dup.length) errors.push(`duplicate ids: ${dup.join(', ')}`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
blocks.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(join(root, 'public', 'library', 'catalog.json'), JSON.stringify({ schema: 1, blocks }) + '\n');
console.log(`catalog.json: ${blocks.length} blocks`);
