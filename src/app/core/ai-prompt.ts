import { OPS, COMPASS, normalizeCommands, type AiCommand } from './ai-commands';
import { listOpenings } from './openings';
import type { SiteSpec } from './site-spec';

/** JSON schema the model is forced to follow (WebLLM compiles it into a grammar, so the output always parses). */
export const AI_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    commands: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: [...OPS] },
          building: { type: 'string' },
          level: { type: 'integer' },
          side: { type: 'string', enum: [...COMPASS] },
          position: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          sill: { type: 'number' },
          count: { type: 'integer' },
          axis: { type: 'string', enum: ['length', 'width'] },
          doors: { type: 'boolean' },
          x0: { type: 'number' },
          z0: { type: 'number' },
          x1: { type: 'number' },
          z1: { type: 'number' },
          size: { type: 'number' },
          depth: { type: 'number' },
          length: { type: 'number' },
          value: { type: 'number' },
          name: { type: 'string' },
          roof: { type: 'string', enum: ['gable', 'flat', 'vault'] },
          degrees: { type: 'number' },
          east: { type: 'number' },
          north: { type: 'number' },
        },
        required: ['op'],
      },
    },
  },
  required: ['reply', 'commands'],
} as const;

export const SYSTEM_PROMPT = `You are the editing assistant of a 3D site editor (buildings seen from above, on a map; north is up). You never describe geometry yourself: you answer with JSON {"reply": short text for the user, "commands": [...]} and the app performs the commands.

Commands (all fields optional except op; distances in metres; "position" and x0..z1 are fractions 0..1):
- add_door / add_window: side (north|south|east|west), position (0 = west or north end, 0.5 = middle), width, height, sill (windows: bottom height), level (1 = ground floor).
- remove_openings: side (optional), level.
- split_rooms: count (rooms), axis ("length" or "width": which dimension is divided), doors (true = leave a door gap in each wall), level.
- add_partition: x0,z0,x1,z1 (fractions of the building's length / width, x to the east, z to the south), doors, level.
- clear_partitions: level.
- add_floor. set_wall_height: value, level (omit = all floors). set_roof: roof (gable|flat|vault).
- cut_notch: side or corner (north, northeast, east ...), size (along the side), depth (into the building), position. Makes L, U, T, H shapes.
- add_wing: side (north|south|east|west), size, depth, position.
- rename: name. rotate: degrees. move: east, north. resize: length, depth.
"building" is the building's name; leave it out for the selected one.

Rules: use only these commands. Do not invent buildings. Prefer a few simple commands. If the request is unclear or impossible, return "commands": [] and ask one short question in "reply". Windows go on walls, doors on walls; a door gap is the way to connect rooms.

Examples
User: "split the warehouse into 3 rooms with doors" -> {"reply":"Splitting it into three rooms.","commands":[{"op":"split_rooms","building":"warehouse","count":3,"doors":true}]}
User: "a door in the middle of the south wall and two windows on the north wall" -> {"reply":"Added a door and two windows.","commands":[{"op":"add_door","side":"south","position":0.5},{"op":"add_window","side":"north","position":0.3},{"op":"add_window","side":"north","position":0.7}]}
User: "make it an L: cut the north-east corner, 10 by 8 metres" -> {"reply":"Cutting the corner.","commands":[{"op":"cut_notch","side":"northeast","size":10,"depth":8}]}`;

/** A compact description of the site for the model: what exists, what is selected. */
export function buildContext(spec: SiteSpec, selectedId: string): string {
  const items = spec.buildings.slice(0, 40).map((b) => {
    const all = b.levels.flatMap((_, i) => listOpenings(b, i));
    return {
      name: b.name,
      selected: b.id === selectedId,
      size: `${b.length.toFixed(0)} x ${b.width.toFixed(0)} m`,
      shape: b.footprint ? 'shaped' : 'rectangle',
      floors: b.levels.length,
      doors: all.filter((o) => o.kind === 'door').length,
      windows: all.filter((o) => o.kind === 'window').length,
      interior_walls: b.levels.reduce((n, l) => n + l.partitions.length, 0),
    };
  });
  return `Site "${spec.name}", ${spec.buildings.length} building(s):\n${JSON.stringify(items)}`;
}

export interface AiReply {
  reply: string;
  commands: AiCommand[];
  errors: string[];
}

/** Tolerant parse of the model's answer (code fences, text around the JSON), then strict command checking. */
export function parseReply(text: string): AiReply {
  let body = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a >= 0 && b > a) body = body.slice(a, b + 1);
  try {
    const o = JSON.parse(body) as { reply?: unknown; commands?: unknown };
    const { cmds, errors } = normalizeCommands(o.commands ?? []);
    return { reply: typeof o.reply === 'string' ? o.reply.slice(0, 400) : '', commands: cmds, errors };
  } catch {
    return { reply: '', commands: [], errors: ['The model did not answer in the expected format. Try rephrasing.'] };
  }
}
