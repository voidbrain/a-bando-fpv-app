# Block catalogue

Every file in `blocks/` is one block of the online catalogue. On every push to `main` the deploy builds them into
`public/library/catalog.json` (`node tools/build-catalog.mjs`), runs the tests (which check every block with the app's
own `sanitizeBlock`, and place or apply each one) and publishes the app with it. The app downloads the catalogue in the
background (ETag) and keeps it for offline use.

## Adding or changing a block

1. Add or edit `blocks/<name>.json`. The file name is the id's name: `abando/water-tower-legs` → `water-tower-legs.json`.
   Ids are `namespace/name`, lowercase letters, digits and dashes; `local/` is reserved for the pilot's own blocks.
2. Changing a published block: raise `version`. Bandos that placed the older version offer "Update to vN".
3. `node tools/build-catalog.mjs && npx ng test --watch=false` locally, then open a pull request. CI runs the same.

## The format (`core/blocks.ts`, `core/shapes.ts`)

```jsonc
{
  "schema": 1, "id": "abando/billboard", "version": 1, "name": "Billboard",
  "kind": "structure",               // structure | building | group | pattern
  "tags": ["sign"], "author": "A Bando", "licence": "CC-BY-4.0",   // CC-BY-4.0 | CC0 | ODbL
  "description": "One line.", "thumbnail": "icon:structure",      // a tool-icon key, or a small data: URI
  "params": [{ "key": "w", "label": "Width", "type": "number", "min": 2, "max": 20, "step": 0.5, "default": 8 }],
  "content": { "shapes": [ ... ] }    // and / or buildings, structures, walls, trees, or a pattern
}
```

- Any number in `content` may be a parameter: `{ "$": "w", "mul": 0.5, "add": 1 }` = w × 0.5 + 1.
- Metres; x east, y up, z south; the insertion point is (0, 0).
- Shapes: `box` (`at` = its centre, `size`, optional `rotDeg`), `cylinder` (`at` = the centre of its bottom, `radius`,
  `height`), `extrude` (an `outline` of x / z points raised `height` from `at`), `array` (`of` one shape, `count`, `step`).
  At most 400 primitives once arrays are expanded; sizes are clamped. Colours are `#rrggbb`.
- `buildings`, `structures`, `walls`, `trees` are ordinary site elements (see `core/site-spec.ts`), positioned around (0, 0).
- A `pattern` applies to the selected building's floor: `{ "facade": { "pattern": "store|panels|doors", "bay": 5 } }`,
  `{ "columns": { "rows": 4, "step": 10, "inset": 4 } }`, `{ "store": { "bay": 5, "step": 10, "rows": 4, "inset": 4 } }`.

Hand-made blocks are CC-BY-4.0 unless stated; blocks built from OpenStreetMap data are ODbL.
