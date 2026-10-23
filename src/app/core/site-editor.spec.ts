import { describe, expect, it } from 'vitest';
import { SiteEditor } from './site-editor';
import { emptySpec } from './site-spec';

const editor = (): SiteEditor => {
  const ed = new SiteEditor();
  ed.load(emptySpec({ lat: 0, lon: 0 }, 'test'));
  return ed;
};

describe('undo and redo bring the selection back', () => {
  it('adding: undo goes back to what was selected before, never to a building that is gone', () => {
    const ed = editor();
    const a = ed.addBuilding({ pos: { x: 0, z: 0 } });
    const b = ed.addBuilding({ pos: { x: 40, z: 0 } });
    expect(ed.selectedId()).toBe(b);
    ed.undo();
    expect(ed.selectedId()).toBe(a);
    ed.redo();
    expect(ed.selectedId()).toBe(b); // redo brings back the moment after the add, the new building selected
    expect(ed.draft().buildings.length).toBe(2);
  });

  it('deleting: undo brings the building back, selected', () => {
    const ed = editor();
    const a = ed.addBuilding({ pos: { x: 0, z: 0 } });
    ed.select(a);
    ed.removeBuilding(a);
    expect(ed.selectedId()).toBe('');
    ed.undo();
    expect(ed.draft().buildings.map((x) => x.id)).toEqual([a]);
    expect(ed.selectedId()).toBe(a);
  });

  it('a duplicate undone leaves no dangling selection', () => {
    const ed = editor();
    const a = ed.addBuilding({ pos: { x: 0, z: 0 } });
    ed.duplicateSelected();
    expect(ed.selectedId()).not.toBe(a);
    ed.undo();
    expect(ed.selectedId()).toBe(a);
    expect(ed.draft().buildings.some((x) => x.id === ed.selectedId())).toBe(true);
  });
});
