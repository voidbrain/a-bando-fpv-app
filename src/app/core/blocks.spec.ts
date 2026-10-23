import { describe, expect, it } from 'vitest';
import { applyPattern, placedHead, blockFrom, blockInstances, detachInstance, forkBlock, outdated, paramValues, placeBlock, removeInstance, resolveParams, sanitizeBlock, updateInstance, type BlockSpec } from './blocks';
import { SiteCollider } from './sim/collider';
import { Vec3 } from './math3d';
import { MAX_PRIMS, expandShapes, sanitizeShapes, shapeSolids } from './shapes';
import { emptySpec, sanitizeSpec, type BuildingSpec } from './site-spec';

const tower = (version = 1, legH = 12): BlockSpec => ({
  schema: 1,
  id: 'abando/test-tower',
  version,
  name: 'Test tower',
  kind: 'structure',
  tags: ['tower'],
  author: 'test',
  licence: 'CC-BY-4.0',
  params: [{ key: 'h', label: 'Leg height', type: 'number', min: 4, max: 30, default: legH }],
  content: {
    shapes: [
      { prim: 'array', count: 2, step: { x: 4, y: 0, z: 0 }, of: { prim: 'array', count: 2, step: { x: 0, y: 0, z: 4 }, of: { prim: 'box', at: { x: -2, y: { $: 'h', mul: 0.5 } as never, z: -2 }, size: { x: 0.4, y: { $: 'h' } as never, z: 0.4 }, color: '#555555' } } },
      { prim: 'cylinder', at: { x: 0, y: { $: 'h' } as never, z: 0 }, radius: 3, height: 5, color: '#8899aa' },
    ],
  },
});

const shed: BlockSpec = {
  schema: 1,
  id: 'abando/shed',
  version: 1,
  name: 'Shed and fence',
  kind: 'group',
  tags: [],
  author: 'test',
  licence: 'CC0',
  params: [{ key: 'floors', label: 'Floors', type: 'int', min: 1, max: 4, default: 1 }],
  content: {
    buildings: [{ id: 'x', name: 'Shed', pos: { x: 10, z: 0 }, rotDeg: 0, length: 8, width: 5, levels: [{ baseY: 0, height: { $: 'floors', mul: 3 } as never, sides: { n: true, s: true, e: true, w: true }, doors: {}, partitions: [], roof: 'gable', roofRise: 1.5 }] }],
    walls: [{ a: { x: 0, z: 5 }, b: { x: 20, z: 5 }, height: 2, thick: 0.2 }],
    trees: [{ x: 0, z: -5, h: 8, r: 2, kind: 'd' }],
  },
};

describe('blocks: checking', () => {
  it('keeps a well-formed block and refuses bad ids, unknown parameters and empty content', () => {
    expect(sanitizeBlock(tower())).not.toBeNull();
    expect(sanitizeBlock(shed)).not.toBeNull();
    expect(sanitizeBlock({ ...tower(), id: 'No Namespace' })).toBeNull();
    expect(sanitizeBlock({ ...tower(), content: { shapes: [{ prim: 'box', at: { x: { $: 'nope' } }, size: { x: 1, y: 1, z: 1 }, color: '#ffffff' }] } })).toBeNull();
    expect(sanitizeBlock({ ...tower(), content: {} })).toBeNull();
    expect(sanitizeBlock({ ...tower(), kind: 'pattern', content: {} })).toBeNull();
    const t = sanitizeBlock({ ...tower(), licence: 'MIT', tags: ['A', 3], thumbnail: 'javascript:alert(1)' })!;
    expect(t.licence).toBe('CC-BY-4.0');
    expect(t.tags).toEqual(['a']);
    expect(t.thumbnail).toBeUndefined();
  });

  it('clamps parameter values and resolves references', () => {
    const b = tower();
    expect(paramValues(b, { h: 99 })['h']).toBe(30);
    expect(paramValues(b, { h: 'x' })['h']).toBe(12);
    expect(resolveParams({ a: { $: 'h', mul: 2, add: 1 }, b: [1, { $: 'h' }] }, { h: 5 })).toEqual({ a: 11, b: [1, 5] });
  });
});

describe('primitive shapes', () => {
  it('expands arrays, caps the count and clamps sizes', () => {
    const p = expandShapes(sanitizeShapes(resolveParams(tower().content.shapes, { h: 12 })));
    expect(p).toHaveLength(5); // 2 × 2 legs + the tank
    const huge = sanitizeShapes([{ prim: 'array', count: 60, step: { x: 1, y: 0, z: 0 }, of: { prim: 'array', count: 60, step: { x: 0, y: 0, z: 1 }, of: { prim: 'box', at: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 }, color: '#000000' } } }]);
    expect(expandShapes(huge).length).toBeLessThanOrEqual(MAX_PRIMS);
    const one = sanitizeShapes([{ prim: 'box', at: { x: 1e9, y: 0, z: 0 }, size: { x: -5, y: 1e6, z: 1 }, color: 'red' }, { prim: 'teapot' }])[0]!;
    expect(one.prim === 'box' && one.at.x).toBe(300);
    expect(one.prim === 'box' && one.size.y).toBe(200);
    expect(one.prim === 'box' && one.color).toBe('#9a9a92');
  });

  it('collides like it looks: legs and tank solid, the space between the legs free', () => {
    const prims = expandShapes(sanitizeShapes(resolveParams(tower().content.shapes, { h: 12 })));
    const s = shapeSolids(prims, 100, 50, 0);
    const c = new SiteCollider(s.boxes, s.cylinders);
    expect(c.hit(new Vec3(98, 6, 48))).toBe(true); // a leg
    expect(c.hit(new Vec3(100, 6, 50))).toBe(false); // between the legs
    expect(c.hit(new Vec3(100, 14, 50))).toBe(true); // the tank on top
    expect(c.hit(new Vec3(100, 18, 50))).toBe(false); // above it
    const turned = shapeSolids(expandShapes(sanitizeShapes([{ prim: 'box', at: { x: 0, y: 1, z: 0 }, size: { x: 10, y: 2, z: 0.4 }, color: '#000000' }])), 0, 0, 45);
    expect(turned.boxes.length).toBeGreaterThan(5); // a turned wall is cut into pieces
  });

  it('a stored spec keeps a shapes structure but checks its primitives', () => {
    const s = sanitizeSpec({ ...emptySpec(), structures: [{ id: 'a', kind: 'shapes', name: 'x', x: 0, z: 0, rotDeg: 0, height: 3, size: 1, shapes: [{ prim: 'box', at: { x: 0, y: 1, z: 0 }, size: { x: 1, y: 2, z: 1 }, color: '#112233' }, { prim: 'virus' }] }] })!;
    expect(s.structures![0]!.shapes).toHaveLength(1);
  });
});

describe('placing blocks', () => {
  it('writes ordinary elements at the insertion point, turned, each tagged with the placement', () => {
    const spec = emptySpec();
    const r = placeBlock(spec, shed, { floors: 2 }, { x: 100, z: 0 }, 90);
    expect(r.placed).toBe(3);
    const b = spec.buildings[0]!;
    expect(b.pos.x).toBeCloseTo(100);
    expect(b.pos.z).toBeCloseTo(10); // (10, 0) turned 90° clockwise → (0, 10)
    expect(b.rotDeg).toBe(90);
    expect(b.levels[0]!.height).toBe(6);
    expect(b.block?.id).toBe('abando/shed');
    expect(spec.walls![0]!.block?.inst).toBe(r.inst);
    expect(spec.trees[0]!.block?.params['floors']).toBe(2);
    const t = emptySpec();
    placeBlock(t, tower(), {}, { x: 0, z: 0 }, 0);
    expect(t.structures![0]!.kind).toBe('shapes');
    expect(t.structures![0]!.height).toBeCloseTo(17);
  });

  it('finds outdated placements, updates them in place with their values, removes and detaches them', () => {
    const spec = emptySpec();
    const { inst } = placeBlock(spec, tower(1), { h: 20 }, { x: 5, z: 5 }, 30);
    placeBlock(spec, shed, {}, { x: -50, z: 0 }, 0);
    expect(blockInstances(spec)).toHaveLength(2);
    expect(outdated(spec, new Map([['abando/test-tower', 2]]))).toHaveLength(1);
    expect(outdated(spec, new Map([['abando/test-tower', 1]]))).toHaveLength(0);
    expect(updateInstance(spec, inst, tower(2))).toBe(true);
    const st = spec.structures![0]!;
    expect(st.block?.v).toBe(2);
    expect(st.block?.params['h']).toBe(20);
    expect(st.rotDeg).toBe(30);
    detachInstance(spec, inst);
    expect(spec.structures![0]!.block).toBeUndefined();
    const shedInst = blockInstances(spec)[0]!.ref.inst;
    removeInstance(spec, shedInst);
    expect(spec.buildings).toHaveLength(0);
    expect(spec.trees).toHaveLength(0);
  });

  it('applies a pattern block to a floor; a fork is a local copy', () => {
    const b: BuildingSpec = { id: 'b', name: 'Hall', pos: { x: 0, z: 0 }, rotDeg: 0, length: 40, width: 20, levels: [{ baseY: 0, height: 6, sides: { n: true, s: true, e: true, w: true }, doors: {}, partitions: [], roof: 'flat', roofRise: 0 }] };
    const pat: BlockSpec = { schema: 1, id: 'abando/rows', version: 1, name: 'Rows', kind: 'pattern', tags: [], author: 't', licence: 'CC0', params: [{ key: 'rows', label: 'Rows', type: 'int', min: 1, max: 8, default: 2 }], content: { pattern: { columns: { rows: { $: 'rows' } as never, step: 10, inset: 4 } } } };
    expect(sanitizeBlock(pat)).not.toBeNull();
    const done = applyPattern(b, 0, pat, { rows: 2 });
    expect(done[0]).toMatch(/columns/);
    expect(b.levels[0]!.columns!.length).toBeGreaterThan(2);
    const f = forkBlock(tower(3), 'me');
    expect(f.id).toBe('local/test-tower');
    expect(f.version).toBe(1);
    expect(f.author).toBe('me');
  });
});

describe('a block from a selection', () => {
  it('stores the elements around the anchor, turned back, and places them again where they were', () => {
    const spec = emptySpec();
    placeBlock(spec, shed, {}, { x: 40, z: 20 }, 30);
    const b = spec.buildings[0]!;
    const own = blockFrom('My shed', 'me', { buildings: [b] }, b.pos, b.rotDeg)!;
    expect(own.id).toBe('local/my-shed');
    expect(own.kind).toBe('building');
    expect(own.content.buildings![0]!.pos).toEqual({ x: 0, z: 0 });
    expect(own.content.buildings![0]!.rotDeg).toBe(0);
    expect(own.content.buildings![0]!.block).toBeUndefined();
    const again = emptySpec();
    placeBlock(again, own, {}, b.pos, b.rotDeg);
    expect(again.buildings[0]!.pos.x).toBeCloseTo(b.pos.x);
    expect(again.buildings[0]!.rotDeg).toBeCloseTo(b.rotDeg);
    expect(blockFrom('Nothing', 'me', {}, { x: 0, z: 0 })).toBeNull();
  });
});

describe('what a placement selects', () => {
  it('its building, else its first structure, else nothing', () => {
    const s = emptySpec();
    s.buildings.push({ id: 'b1', name: 'B', pos: { x: 0, z: 0 }, rotDeg: 0, length: 10, width: 8, levels: [], block: { id: 'x', v: 1, inst: 'i1', params: {}, at: { x: 0, z: 0 }, rot: 0 } });
    s.structures = [{ kind: 'silo', x: 0, z: 0, rotDeg: 0, block: { id: 'y', v: 1, inst: 'i2', params: {}, at: { x: 0, z: 0 }, rot: 0 } } as never];
    expect(placedHead(s, 'i1')).toEqual({ building: 'b1' });
    expect(placedHead(s, 'i2')).toEqual({ structure: 0 });
    expect(placedHead(s, 'zz')).toBeNull();
  });
});
