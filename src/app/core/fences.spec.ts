import { describe, expect, it } from 'vitest';
import { FENCES, fenceDef, newFence, postsAlong, setFenceMaterial } from './fences';

describe('fence materials', () => {
  it('every material has distinct ids and sane sizes; unknown falls back to masonry', () => {
    expect(new Set(FENCES.map((f) => f.id)).size).toBe(FENCES.length);
    for (const f of FENCES) {
      expect(f.height).toBeGreaterThan(0.5);
      expect(f.thick).toBeGreaterThan(0);
    }
    expect(fenceDef(undefined).id).toBe('masonry');
  });

  it('a new fence takes the material defaults; masonry stays implicit (old specs)', () => {
    const w = newFence({ x: 0, z: 0 }, { x: 10, z: 0 }, 'chainlink');
    expect(w.material).toBe('chainlink');
    expect(w.height).toBe(fenceDef('chainlink').height);
    expect(newFence({ x: 0, z: 0 }, { x: 1, z: 0 }).material).toBeUndefined();
  });

  it('switching material keeps a hand-set height but follows untouched defaults', () => {
    const w = newFence({ x: 0, z: 0 }, { x: 10, z: 0 }, 'masonry');
    setFenceMaterial(w, 'wood');
    expect(w.height).toBe(fenceDef('wood').height);
    expect(w.thick).toBe(fenceDef('wood').thick);
    w.height = 3;
    setFenceMaterial(w, 'metal');
    expect(w.height).toBe(3);
    setFenceMaterial(w, 'masonry');
    expect(w.material).toBeUndefined();
  });

  it('places posts at both ends and about every post step', () => {
    expect(postsAlong(10, 'masonry')).toEqual([]);
    const p = postsAlong(9, 'chainlink');
    expect(p[0]).toBe(0);
    expect(p[p.length - 1]).toBe(1);
    expect(p).toHaveLength(4);
  });
});
