import { describe, expect, it } from 'vitest';
import { parseBlockReply, slug } from './ai-blocks';
import { expandShapes, sanitizeShapes } from './shapes';

describe('blocks described to the AI', () => {
  it("turns a fenced JSON answer into one of the pilot's blocks, checked like any other", () => {
    const r = parseBlockReply('Sure!\n```json\n{"name":"Rusty kiosk","tags":["shop"],"shapes":[{"prim":"box","at":{"x":0,"y":1.2,"z":0},"size":{"x":2,"y":2.4,"z":2},"color":"#8b5a3c"},{"prim":"array","of":{"prim":"cylinder","at":{"x":-1,"y":0,"z":1.2},"radius":0.05,"height":2.6,"color":"#555555"},"count":2,"step":{"x":2,"y":0,"z":0}},{"prim":"teapot"}]}\n```');
    expect(r.block?.id).toBe('local/ai-rusty-kiosk');
    expect(r.block?.tags).toEqual(['shop', 'ai']);
    expect(expandShapes(sanitizeShapes(r.block!.content.shapes))).toHaveLength(3);
  });

  it('says why an answer is unusable', () => {
    expect(parseBlockReply('no idea').error).toMatch(/not JSON/);
    expect(parseBlockReply('{"name":"Nothing","shapes":[]}').error).toMatch(/usable/);
  });

  it('makes file-safe ids from names, accents dropped', () => {
    expect(slug('Ça va, Torre!')).toBe('ca-va-torre');
    expect(slug('!!!')).toBe('block');
  });
});
