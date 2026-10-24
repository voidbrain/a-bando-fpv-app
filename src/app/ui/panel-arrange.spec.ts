import { describe, expect, it } from 'vitest';
import { arrangeRows } from './panel-arrange';

describe('panels opened together', () => {
  const area = { x: 260, y: 40, w: 1000, h: 800 };
  it('sit side by side, centred in the free area', () => {
    expect(arrangeRows([{ w: 300, h: 200 }, { w: 400, h: 100 }], area)).toEqual([{ x: 404, y: 40 }, { x: 716, y: 40 }]);
  });
  it('wrap to a new row instead of overlapping', () => {
    const p = arrangeRows([{ w: 600, h: 200 }, { w: 600, h: 150 }], area);
    expect(p[0]!.y).toBe(40);
    expect(p[1]!.y).toBe(252);
    expect(p[1]!.x).toBe(460);
  });
});
