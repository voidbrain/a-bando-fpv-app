/**
 * Translation check: every piece of English the templates show (static text, title / aria-label / placeholder), every
 * toast and every `tr()` text must have its Italian in `src/app/i18n/it.ts`, through the same `translate()` the app uses.
 * Text with bindings is checked with the bound parts as holes, so a `{0}` pattern covers it. Words that are not
 * translated on purpose (names, units, product names) are listed in `tools/i18n/keep-english.txt`.
 *
 *   npm run check:i18n
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { compileDict, translate } from '../../src/app/core/i18n';
import { IT } from '../../src/app/i18n/it';

const ROOT = process.cwd();
const dict = compileDict(IT);
const keep = new Set(
  readFileSync(`${ROOT}/tools/i18n/keep-english.txt`, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#')),
);

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = `${dir}/${f}`;
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|html)$/.test(f) && !f.endsWith('.spec.ts') ? [p] : [];
  });

/** The templates of a file: a whole .html, or the inline `template:` of a component. */
const templates = (path: string, src: string): string[] => {
  if (path.endsWith('.html')) return [src];
  const out: string[] = [];
  for (const m of src.matchAll(/template:\s*`([\s\S]*?)`/g)) out.push(m[1]!);
  return out;
};

const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"' };
const decode = (s: string): string => s.replace(/&(amp|lt|gt|nbsp|quot);/g, (m) => ENT[m]!);
const wanted = (s: string): boolean => /[A-Za-z]{3}/.test(s) && !keep.has(s);

const found = new Map<string, string>();
const see = (s: string, where: string): void => {
  const t = decode(s).replace(/\s+/g, ' ').trim();
  if (wanted(t) && !found.has(t)) found.set(t, where);
};

/**
 * The text an Angular expression shows: a ternary (or anything with a condition) shows one of its string literals, a
 * concatenation joins literals and holes ("'Show ' + name" → "Show X"). Returns the texts to check.
 */
const exprTexts = (raw: string): string[] => {
  // literals compared or looked for are values, not text: `x === 'ready'`, `id.startsWith('local/')`
  const e = raw.replace(/(?:[!=]==?)\s*'(?:[^'\\]|\\.)*'|'(?:[^'\\]|\\.)*'\s*(?:[!=]==?)|\.(?:startsWith|endsWith|includes)\(\s*'(?:[^'\\]|\\.)*'\s*\)/g, ' 0 ');
  const lits = [...e.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]!.replace(/\\'/g, "'"));
  if (!lits.length) return [];
  if (/\?|\|\||&&|\(/.test(e.replace(/'(?:[^'\\]|\\.)*'/g, "''"))) return lits;
  return [e.split(/\s*\+\s*/).map((part) => (/^'.*'$/s.test(part.trim()) ? part.trim().slice(1, -1) : '0')).join('')];
};
for (const path of files(`${ROOT}/src/app`)) {
  if (path.includes('/i18n/')) continue;
  const src = readFileSync(path, 'utf8');
  const rel = path.slice(ROOT.length + 1);
  for (const tpl of templates(path, src)) {
    // what svg, textarea and translate="no" hold is never translated
    const t = tpl.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<textarea[\s\S]*?<\/textarea>/g, '').replace(/<(\w+)[^>]*translate="no"[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<!--[\s\S]*?-->/g, '');
    // static attributes; a bound one is an expression
    for (const m of t.matchAll(/(?<![[\w.(-])(title|aria-label|placeholder)="([^"]*)"/g)) see(m[2]!, rel);
    for (const m of t.matchAll(/\[(?:title|attr\.aria-label|attr\.title|placeholder)\]="([^"]*)"/g)) for (const x of exprTexts(m[1]!)) see(x, rel);
    // text between tags: interpolations become holes (their literals are checked on their own), attributes and
    // control flow go
    const bits: string[] = [];
    const body = t
      .replace(/\{\{([\s\S]*?)\}\}/g, (_m, e: string) => {
        bits.push(e);
        return '\u0001';
      })
      .replace(/"[^"]*"/g, '""')
      .replace(/@let[^;]*;/g, ' ')
      .replace(/@(?:if|else if|for|switch|case|default|defer|placeholder|empty)\b[^{]*\{|@else\s*\{|[{}]/g, ' ');
    for (const e of bits) for (const x of exprTexts(e)) see(x, rel);
    for (const m of body.matchAll(/>([^<>]+)</g)) see(m[1]!.replace(/\u0001/g, '0'), rel);
  }
  // toasts and native dialogs with plain text
  for (const m of src.matchAll(/(?:toast\.show|tr)\(\s*'((?:[^'\\]|\\.)+)'/g)) see(m[1]!.replace(/\\'/g, "'"), rel);
}

const missing = [...found].filter(([s]) => translate(s, dict) === null);
for (const [s, where] of missing) console.log(`${where}: ${s}`);
console.log(`${found.size} texts checked, ${missing.length} without Italian.`);
process.exit(missing.length ? 1 : 0);
