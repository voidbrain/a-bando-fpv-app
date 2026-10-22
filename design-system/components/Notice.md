# Notice

Notice is a boxed message on top of the map for something the pilot must read (no network, map data failed, a model is loading).

## Use

- `panel-solid` with a 1px `warn` border, `radius-box`, 8 × 10px padding.
- Inline status text: `.ok` in `accent`, `.err` / `.bad` in `warn`. Say what happened and what to do next.
- Overpass 429 / 500 answers reach the browser as CORS errors: word the notice as "map data busy, try again", not as a bug.

## Consumer provides

The message and, if any, one action button.

Source: `src/app/ui/studio/bando-editor.ts (.notice), assistant-box.ts (.err, .ok)`.
