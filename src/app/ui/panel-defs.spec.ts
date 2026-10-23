import { describe, expect, it } from 'vitest';
import { PANELS, cascadeIndex, type PanelId } from './panel-defs';

const layout = (on: Partial<Record<PanelId, { z?: number; x?: number }>>) =>
  Object.fromEntries(PANELS.map((p) => [p.id, { visible: p.id in on, x: on[p.id]?.x ?? null, y: on[p.id]?.x ?? null, z: on[p.id]?.z ?? 10 }])) as Parameters<typeof cascadeIndex>[1];

describe('panels opened at the same place', () => {
  it('step aside in the order they were opened', () => {
    const l = layout({ vpOrbit: { z: 12 }, vpChase: { z: 11 }, vpTop: { z: 14 } });
    expect(cascadeIndex('vpChase', l)).toBe(0);
    expect(cascadeIndex('vpOrbit', l)).toBe(1);
    expect(cascadeIndex('vpTop', l)).toBe(2);
  });
  it('a dragged or hidden panel does not count, nor one at another place', () => {
    const l = layout({ vpOrbit: { z: 12, x: 300 }, vpChase: { z: 13 }, speed: { z: 11 } });
    expect(cascadeIndex('vpChase', l)).toBe(0);
    expect(cascadeIndex('vpFpv', l)).toBe(0);
  });
});
