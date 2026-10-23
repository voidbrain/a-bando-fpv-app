import { describe, expect, it } from 'vitest';
import { compileDict, pickLang, replyLanguage, translate } from './i18n';
import { IT } from '../i18n/it';
import { SECTIONS, SNIPPETS, TOURS } from './tour';

describe('languages', () => {
  it('uses the saved choice, then the browser, then English', () => {
    expect(pickLang('it', ['en-GB'])).toBe('it');
    expect(pickLang('xx', ['de-DE', 'it-IT', 'en'])).toBe('it');
    expect(pickLang(null, ['fr'])).toBe('en');
  });

  it('translates exact text, patterns (holes may move) and " · " lists, keeping white space', () => {
    const d = compileDict({ Save: 'Salva', '{0} buildings': '{0} edifici', 'from {0} to {1}': 'a {1} da {0}', Delete: 'Elimina' });
    expect(translate('  Save ', d)).toBe('  Salva ');
    expect(translate('12 buildings', d)).toBe('12 edifici');
    expect(translate('from A to B', d)).toBe('a B da A');
    expect(translate('Save · 3 m · Delete', d)).toBe('Salva · 3 m · Elimina');
    expect(translate('Nothing here', d)).toBeNull();
    expect(translate('12.5 m', d)).toBeNull(); // no words: never looked up
  });

  it('the Italian dictionary compiles, and every hole in a key is used in its translation', () => {
    const d = compileDict(IT);
    expect(d.exact.size).toBeGreaterThan(300);
    for (const [en, it] of Object.entries(IT)) {
      const holes = (s: string) => (s.match(/\{\d\}/g) ?? []).sort().join();
      expect(holes(it), en).toBe(holes(en));
    }
    expect(translate('Imported “Bando Villetta”.', d)).toBe('Importato “Bando Villetta”.');
    expect(translate('Building · Drag a rectangle on the map; it snaps flush to close neighbours unless auto-align is off · hold or click the corner for the other tools', d)).toBe(
      'Edificio · Trascina un rettangolo sulla mappa; si accosta ai vicini se l’allineamento automatico è attivo · tieni premuto o clicca l’angolo per gli altri strumenti',
    );
  });

  it('every caption and title of the guided tour has its Italian', () => {
    const texts = [...SECTIONS.map((x) => x.title), ...TOURS.flatMap((t) => [t.title, t.about]), ...SNIPPETS.flatMap((s) => [s.title, ...s.beats.flatMap((b) => (b.say ? [b.say] : []))])];
    expect(texts.filter((t) => !(t in IT))).toEqual([]);
  });

  it('tells the AI which language to answer in', () => {
    expect(replyLanguage('en')).toBe('');
    expect(replyLanguage('it')).toContain('Italian');
  });
});
