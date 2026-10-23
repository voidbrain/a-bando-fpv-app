import { describe, expect, it } from 'vitest';
import { optionsPlace, palettePlace } from './toolbar-dock';

describe('editor toolbars', () => {
  const size = { w: 800, h: 500 };
  it('the palette stays inside the editor, top-left by default', () => {
    expect(palettePlace(null, size)).toEqual({ x: 8, y: 8 });
    expect(palettePlace({ x: 2000, y: -5 }, size)).toEqual({ x: 754, y: 0 });
  });
  it('the options bar sits beside the active tool, on the side with more room', () => {
    const btn = { top: 100, palW: 46 };
    expect(optionsPlace(null, { x: 8, y: 8 }, btn, size)).toEqual({ left: 60, right: null, top: 108, max: 732 });
    expect(optionsPlace(null, { x: 700, y: 8 }, btn, size)).toEqual({ left: null, right: 106, top: 108, max: 686 });
  });
  it('where it was dragged, kept inside', () => {
    expect(optionsPlace({ x: 790, y: 600 }, { x: 8, y: 8 }, { top: 0, palW: 46 }, size)).toEqual({ left: 680, right: null, top: 464, max: 112 });
  });
});
