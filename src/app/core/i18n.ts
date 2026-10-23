/**
 * Languages: which one to use and how a piece of English UI text is translated. The app is written in English; a
 * dictionary maps English text to the other language, either exactly or as a pattern with `{0}`, `{1}` ... holes for
 * the parts that change ("{0} buildings"). Pure: the DOM layer that applies it lives in services/i18n.service.ts.
 */

export type Lang = 'en' | 'it';

export const LANGS: readonly { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'it', name: 'Italiano' },
];

const isLang = (v: unknown): v is Lang => LANGS.some((l) => l.id === v);

/**
 * What the AI is told about the language, appended to its system prompt: English needs nothing; otherwise the text it
 * writes for the pilot (the reply, names, descriptions) is in that language, while the JSON keys and command names stay
 * as they are.
 */
export function replyLanguage(lang: Lang): string {
  if (lang === 'en') return '';
  const name = lang === 'it' ? 'Italian' : lang;
  return `\n\nThe user speaks ${name}: write every text meant for them (the reply, names, descriptions) in ${name}. Keep the JSON keys, command names and values from the schema in English.`;
}

/** The pilot's saved choice first, then the browser's languages in order, then English. */
export function pickLang(saved: unknown, browser: readonly string[]): Lang {
  if (isLang(saved)) return saved;
  for (const b of browser) {
    const code = b.toLowerCase().split('-')[0];
    if (isLang(code)) return code;
  }
  return 'en';
}

export interface Dict {
  exact: Map<string, string>;
  patterns: { re: RegExp; to: string }[];
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HOLE = /\{(\d)\}/g;

/** Turn `{ english: translation }` into lookups; keys with `{0}` holes become patterns (longest first). */
export function compileDict(entries: Readonly<Record<string, string>>): Dict {
  const exact = new Map<string, string>();
  const patterns: { re: RegExp; to: string; len: number }[] = [];
  for (const [en, to] of Object.entries(entries)) {
    if (!/\{\d\}/.test(en)) {
      exact.set(en, to);
      continue;
    }
    const order: number[] = [];
    const src = en
      .split(HOLE)
      .map((part, i) => {
        if (i % 2 === 0) return esc(part);
        order.push(+part);
        return '(.+?)';
      })
      .join('');
    // the translation refers to holes by number; map them to capture groups in the order they appear in English
    const out = to.replace(HOLE, (_m, n: string) => `$${order.indexOf(+n) + 1}`);
    patterns.push({ re: new RegExp(`^${src}$`, 's'), to: out, len: en.length });
  }
  patterns.sort((a, b) => b.len - a.len);
  return { exact, patterns: patterns.map(({ re, to }) => ({ re, to })) };
}

/** One trimmed phrase: exact, then a pattern. */
function phrase(s: string, d: Dict): string | null {
  const ex = d.exact.get(s);
  if (ex !== undefined) return ex;
  for (const p of d.patterns) if (p.re.test(s)) return s.replace(p.re, p.to);
  return null;
}

/**
 * Translate UI text, keeping its surrounding white space. Tries the whole text, then each part of a " · " list (the UI
 * joins clauses that way). Returns null when nothing matched, so callers keep the English.
 */
export function translate(text: string, d: Dict): string | null {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  const core = m[2]!;
  if (!/[A-Za-z]{2}/.test(core)) return null;
  const whole = phrase(core, d);
  if (whole !== null) return m[1] + whole + m[3];
  if (!core.includes(' · ')) return null;
  let hit = false;
  const parts = core.split(' · ').map((p) => {
    const t = phrase(p.trim(), d);
    if (t === null) return p;
    hit = true;
    return t;
  });
  return hit ? m[1] + parts.join(' · ') + m[3] : null;
}
