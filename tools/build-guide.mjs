#!/usr/bin/env node
/**
 * Write the help pages from the guided tour (src/app/core/tour.ts): docs/guide/README.md (the tours, the sections) and
 * one page per section, listing its snippets with their captions and the clip to embed. The clips are recorded by
 * `npm run clips` (Playwright plays every step in a headless browser and keeps the video as docs/guide/clips/<step>.webm).
 * Run: node tools/build-guide.mjs
 */
import { buildSync } from 'esbuild';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `abando-tour-${process.pid}.mjs`);
buildSync({ entryPoints: [join(root, 'src/app/core/tour.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { SECTIONS, SNIPPETS, TOURS, playTime, tourBeats } = await import(pathToFileURL(out).href);
rmSync(out);

const dir = join(root, 'docs', 'guide');
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) if (/^\d\d-.*\.md$/.test(f)) rmSync(join(dir, f)); // sections renamed or removed
const page = (s) => `${String(SECTIONS.findIndex((x) => x.id === s.id) + 1).padStart(2, '0')}-${s.id}.md`;
const clip = (sn) => {
  for (const ext of ['gif', 'webm', 'mp4']) if (existsSync(join(dir, 'clips', `${sn.id}.${ext}`))) return `clips/${sn.id}.${ext}`;
  return null;
};
const head = '<!-- Written by tools/build-guide.mjs from src/app/core/tour.ts: edit the tour, then run the script. -->\n\n';

let index = `${head}# A Bando guide\n\nThe app plays these as animated tours on the real interface: open **Guide me** (shown on the first visit, then from Views). Every step is also a short clip, used in these pages, in the hover tips (Guide me → Show tips on hover) and for articles.\n\n## Tours\n\n`;
for (const t of TOURS) {
  const min = Math.max(1, Math.round(playTime(tourBeats(t).map((b) => b.beat)) / 60000));
  index += `- **${t.title}** (~${min} min): ${t.about} Steps: ${t.snippets.map((id) => SNIPPETS.find((s) => s.id === id).title.toLowerCase()).join(', ')}.\n`;
}
index += `\n## Sections\n\n`;
for (const s of SECTIONS) index += `- [${s.title}](${page(s)})\n`;
index += `\n## Clips\n\n\`npm run clips\` plays every step in a headless browser, keeps each as \`docs/guide/clips/<step>.webm\` and rewrites these pages to embed them (a GIF for an article: \`ffmpeg -i step.webm -vf "fps=12,scale=720:-1" step.gif\`).\n`;
writeFileSync(join(dir, 'README.md'), index);

for (const s of SECTIONS) {
  let md = `${head}# ${s.title}\n\n[← Guide](README.md)\n`;
  for (const sn of SNIPPETS.filter((x) => x.section === s.id)) {
    md += `\n## ${sn.title}\n\n`;
    const c = clip(sn);
    md += c ? (c.endsWith('.gif') ? `![${sn.title}](${c})\n\n` : `<video src="${c}" controls muted loop width="720"></video>\n\n`) : `_Clip: not recorded yet (\`npm run clips\`)._\n\n`;
    for (const b of sn.beats) if (b.say) md += `- ${b.say}\n`;
    if (sn.hover?.length) md += `\nShown as a tip over: ${sn.hover.map((h) => `\`${h}\``).join(', ')}.\n`;
  }
  writeFileSync(join(dir, page(s)), md);
}
console.log(`docs/guide: README.md + ${SECTIONS.length} pages, ${SNIPPETS.length} steps`);
