import { Service, effect, inject, signal } from '@angular/core';
import { compileDict, pickLang, translate, type Dict, type Lang } from '../core/i18n';
import { IT } from '../i18n/it';
import { StorageService } from './storage.service';

const KEY = 'abando-lang';
const ATTRS = ['title', 'placeholder', 'aria-label'] as const;
/** Never translated: the pilot's own text, chat messages, code (attributes such as a textarea's placeholder still are). */
const SKIP = 'script, style, textarea, svg, [contenteditable], [translate="no"]';
const SKIP_ATTR = 'svg, [translate="no"]';

const DICTS: Partial<Record<Lang, Readonly<Record<string, string>>>> = { it: IT };

let active: Dict | null = null;

/** Translate one string for the current language (native dialogs, the AI prompt): the English when there is no entry. */
export function tr(s: string): string {
  return active ? (translate(s, active) ?? s) : s;
}

/**
 * The interface language. The templates are written in English; for another language this service rewrites what the
 * page shows (text, title, placeholder, aria-label) through a dictionary and keeps doing so as Angular updates the DOM.
 * The original English of every node it touched is kept, so switching back restores it without a reload. Choice: the
 * saved setting, else the browser's language, else English; the flag menu on the version badge changes it.
 */
@Service()
export class I18nService {
  private readonly storage = inject(StorageService);
  readonly lang = signal<Lang>(pickLang(this.storage.readRaw(KEY), typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]));
  /** English text seen on screen with no translation (for the dictionary's maintainers: `ng.getInjector` in dev tools). */
  readonly missing = new Set<string>();

  private dict: Dict | null = null;
  private observer: MutationObserver | null = null;
  /** English source and the translation we wrote, per text node / attribute, to restore and to ignore our own writes. */
  private readonly texts = new Map<Text, { en: string; out: string }>();
  private readonly attrs = new Map<Element, Map<string, { en: string; out: string }>>();
  private readonly cache = new Map<string, string | null>();

  constructor() {
    effect(() => {
      const lang = this.lang();
      if (typeof document === 'undefined') return;
      document.documentElement.lang = lang;
      this.apply(lang);
    });
  }

  set(lang: Lang): void {
    this.storage.write(KEY, lang);
    this.lang.set(lang);
  }

  private apply(lang: Lang): void {
    this.observer?.disconnect();
    this.observer = null;
    this.restore();
    this.cache.clear();
    const entries = DICTS[lang];
    this.dict = entries ? compileDict(entries) : null;
    active = this.dict;
    if (!this.dict || typeof MutationObserver === 'undefined') return;
    this.walk(document.body);
    this.observer = new MutationObserver((list) => this.onMutations(list));
    this.observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  }

  private onMutations(list: MutationRecord[]): void {
    for (const m of list) {
      if (m.type === 'characterData') this.text(m.target as Text);
      else if (m.type === 'attributes') this.attr(m.target as Element, m.attributeName!);
      else m.addedNodes.forEach((n) => this.walk(n));
    }
    if (this.texts.size > 4000) for (const n of this.texts.keys()) if (!n.isConnected) this.texts.delete(n);
    if (this.attrs.size > 4000) for (const e of this.attrs.keys()) if (!e.isConnected) this.attrs.delete(e);
  }

  private walk(root: Node): void {
    if (root.nodeType === Node.TEXT_NODE) {
      this.text(root as Text);
      return;
    }
    if (!(root instanceof Element) || root.closest(SKIP_ATTR)) return;
    for (const a of ATTRS) if (root.hasAttribute(a)) this.attr(root, a);
    for (const el of root.querySelectorAll('[title], [placeholder], [aria-label]')) if (!el.closest(SKIP_ATTR)) for (const a of ATTRS) if (el.hasAttribute(a)) this.attr(el, a);
    if (root.closest(SKIP)) return;
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = it.nextNode(); n; n = it.nextNode()) this.text(n as Text);
  }

  private lookup(s: string): string | null {
    let t = this.cache.get(s);
    if (t === undefined) {
      t = translate(s, this.dict!);
      if (this.cache.size > 5000) this.cache.clear();
      this.cache.set(s, t);
      if (t === null && /[A-Za-z]{3}/.test(s) && this.missing.size < 3000) this.missing.add(s.trim());
    }
    return t;
  }

  private text(n: Text): void {
    const cur = n.nodeValue ?? '';
    const known = this.texts.get(n);
    if (known && known.out === cur) return; // our own write
    if (n.parentElement?.closest(SKIP)) return;
    const t = this.lookup(cur);
    if (t === null || t === cur) {
      this.texts.delete(n);
      return;
    }
    this.texts.set(n, { en: cur, out: t });
    n.nodeValue = t;
  }

  private attr(el: Element, name: string): void {
    const cur = el.getAttribute(name);
    if (cur === null || el.closest(SKIP_ATTR)) return;
    const map = this.attrs.get(el);
    if (map?.get(name)?.out === cur) return;
    const t = this.lookup(cur);
    if (t === null || t === cur) {
      map?.delete(name);
      return;
    }
    if (map) map.set(name, { en: cur, out: t });
    else this.attrs.set(el, new Map([[name, { en: cur, out: t }]]));
    el.setAttribute(name, t);
  }

  /** Put the English back wherever the page still shows our translation. */
  private restore(): void {
    for (const [n, v] of this.texts) if (n.nodeValue === v.out) n.nodeValue = v.en;
    for (const [el, m] of this.attrs) for (const [a, v] of m) if (el.getAttribute(a) === v.out) el.setAttribute(a, v.en);
    this.texts.clear();
    this.attrs.clear();
  }
}
