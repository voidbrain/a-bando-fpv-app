/**
 * "Describe a block to the AI": the prompt and JSON schema for a model that answers with a {@link BlockSpec} made of
 * primitive shapes, and the parsing of its answer. The answer is only a proposal: it goes through `sanitizeBlock` like a
 * file or the catalogue, and the pilot sees the result before keeping it.
 */
import { sanitizeBlock, type BlockSpec } from './blocks';

const SHAPE = {
  type: 'object',
  properties: {
    prim: { type: 'string', enum: ['box', 'cylinder', 'extrude', 'array'] },
    at: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
    size: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
    rotDeg: { type: 'number' },
    radius: { type: 'number' },
    height: { type: 'number' },
    color: { type: 'string' },
    count: { type: 'number' },
    step: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
    of: { type: 'object' },
  },
  required: ['prim'],
};

export const BLOCK_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    shapes: { type: 'array', items: SHAPE, maxItems: 40 },
  },
  required: ['name', 'shapes'],
};

export const BLOCK_PROMPT = `You design small 3D objects for a site editor of abandoned places, made only of primitive shapes. Answer with JSON {"name", "description", "tags", "shapes"} and nothing else.

Units are metres. x is east, y is up, z is south; the object stands on the ground at y = 0, centred near x = 0, z = 0.
Shapes:
- {"prim":"box","at":{x,y,z},"size":{x,y,z},"rotDeg":0,"color":"#rrggbb"}: "at" is the CENTRE of the box (a 2 m tall box on the ground has at.y = 1).
- {"prim":"cylinder","at":{x,y,z},"radius":r,"height":h,"color":"#rrggbb"}: upright; "at" is the centre of its BOTTOM.
- {"prim":"array","of":<one shape>,"count":n,"step":{x,y,z}}: n copies, each moved by step (legs, posts, windows).
Use real-world sizes, muted realistic colours (rust, concrete, faded paint), at most 40 shapes. Prefer arrays for repeated parts.

Example: "a picnic table" ->
{"name":"Picnic table","description":"Wooden table with two benches","tags":["park","wood"],"shapes":[{"prim":"box","at":{"x":0,"y":0.74,"z":0},"size":{"x":1.8,"y":0.06,"z":0.8},"color":"#8a6440"},{"prim":"box","at":{"x":0,"y":0.45,"z":-0.65},"size":{"x":1.8,"y":0.05,"z":0.3},"color":"#8a6440"},{"prim":"box","at":{"x":0,"y":0.45,"z":0.65},"size":{"x":1.8,"y":0.05,"z":0.3},"color":"#8a6440"},{"prim":"array","of":{"prim":"box","at":{"x":-0.75,"y":0.36,"z":0},"size":{"x":0.08,"y":0.72,"z":1.6},"color":"#6e4f33"},"count":2,"step":{"x":1.5,"y":0,"z":0}}]}`;

/** A file-safe slug of a name ("Rusty water tower!" -> "rusty-water-tower"). */
export const slug = (s: string): string => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'block';

/** The model's answer as one of the pilot's own blocks (`local/ai-...`), or the reasons it could not be used. */
export function parseBlockReply(text: string, author = 'AI'): { block: BlockSpec | null; error?: string } {
  let body = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a >= 0 && b > a) body = body.slice(a, b + 1);
  let o: { name?: unknown; description?: unknown; tags?: unknown; shapes?: unknown };
  try {
    o = JSON.parse(body) as typeof o;
  } catch {
    return { block: null, error: 'The answer was not JSON.' };
  }
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 60) : 'AI object';
  const block = sanitizeBlock({
    schema: 1,
    id: `local/ai-${slug(name)}`,
    version: 1,
    name,
    kind: 'structure',
    tags: [...(Array.isArray(o.tags) ? o.tags : []), 'ai'],
    author,
    licence: 'CC-BY-4.0',
    description: typeof o.description === 'string' ? o.description : undefined,
    thumbnail: 'icon:blocks',
    params: [],
    content: { shapes: Array.isArray(o.shapes) ? o.shapes : [] },
  });
  return block ? { block } : { block: null, error: 'The shapes did not make a usable object.' };
}
