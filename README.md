# OpenBando

**Build, Fly, Share.** A browser app for **FPV pilots who fly abandoned places** ("bandos"): build the place in 3D from the
map, fly it (replay your real flights from Betaflight Blackbox logs and their DVR, or the simulator with your radio), and
share it, with or without its address.

Everything runs in the browser (Angular 22, Three.js, signals). There is no backend. Bandos, blocks and the cached real ground
stay in the browser (IndexedDB); videos and logs are read from your disk and never uploaded.

**The welcome tour**, a minute, played by itself: 
[English](https://voidbrain.github.io/a-bando-fpv-app/?tour=showcase&lang=en) ·
[Italiano](https://voidbrain.github.io/a-bando-fpv-app/?tour=showcase&lang=it). Any address of the app takes
`?tour=showcase` and `lang=en` / `lang=it`.

## What it does

- **Flights**: load blackbox / telemetry logs, replay them in several camera views (orbit, top, chase, FPV), with instruments
  (speed, attitude, compass, timeline, radio sticks). The path is coloured by speed; the part already flown is dimmed.
- **Simulator**: fly the same site with a physics model and a radio / gamepad; collisions use the real model.
- **Bandos** (the map and model editor): create a site from OpenStreetMap, then edit it.
  1. *Area*: search a place, pan the map, drag the dashed frame's edges to set the area (metres, independent of the window
     size). **Generate** pulls buildings, trees, roads, greenhouses, towers, bridges, steps and cranes from OpenStreetMap.
  2. *Model*: the 3D model's plan is drawn over the map (street / satellite / hidden, adjustable opacity) in its real position.
     Move, resize, rotate and reshape buildings (cut notches, add wings, merge), plant trees, draw fences, place structures.
     **Edit indoors** takes the roof off and edits one floor at a time: interior walls, doors and windows (open or closed),
     voids (water on the ground floor), columns (duplicate, row, fill the floor), stairs and ramps (with the stairwell cut in the
     floor above). While placing, a ghost shows where the thing will go, on a grid in the building's own axes, with guides to
     other columns (same line, equal spacing, rhythm) and distances to walls and neighbours. Only the tools that make sense
     are shown: outdoor tools while outdoors, floor tools while editing a floor. The palette groups related tools Photoshop-style (hold or use the corner mark for the others) and a right click offers what can be done with whatever is under the pointer. 2D / 3D switch (3D: click to select, draw and place on the ground, roofs on / off), compass, chained measures with angle arcs (select, move, delete), the flight path with start / end markers,
     flight-path start / end pins, floating inspector with a 3D preview of the selection.
- **Terrain**: the real ground (AWS Terrain Tiles) under every bando, sculpted by holding the mouse (left raises, right
  lowers) or with brushes (raise, lower, smooth, flatten, hill, crater, ramp, with construction lines); roads, surfaces and water (drawn as an outline or along a canal's centre line); tunnels and basements.
- **Library**: ready-made blocks (objects, buildings, façade and column patterns, FPV gates) from an online catalogue that
  works offline, plus your own blocks made from a selection.
- **Ruins**: any building can be ruined (holes in the roof, then walls broken along their top), an open shell, or carry
  battlements; one wall at a time if needed.
- **Examples**: ready bandos to open as a copy: Chiari e Forti; Villetta, shared without its place; and Playground, a made-up works with every block of the library, hills, water and a tunnel.
- **Sharing**: export a bando with its exact place or hidden (no coordinates, no map names; its real
  ground travels inside the file); a bando whose place is hidden stays hidden. Flights on a bando without its place start on its take-off pad; pins fit them.
- **Backup**: save every bando and your own blocks in one file, and restore it (the newer copy of a bando wins).
- **Video**: load the flight's video, sync it with the log automatically, replay both together, render an MP4.
- **AI assistant** (optional): a chat that turns sentences like "3 rooms with doors, close the north windows, add a crane"
  into editor commands. See *AI assistant* below.
- **Welcome**: a first visit opens on the empty world turning slowly, with Build / Fly / Share and their short films
  (`public/welcome/`, recorded by `npm run films`), and the welcome tour.
- **Guide me**: animated tours that use the real interface, every step on its own too, hover tips; help pages and clips in
  `docs/guide/` (`npm run clips`).
- **Languages**: English and Italian (the flag next to the version); the AI answers in the chosen language.

## Structure types

| Kind | Notes |
|---|---|
| Building | rectangle or shaped (L, T, U, H: rectilinear outline), several floors, gable / vault / flat roof (turnable, repeatable) |
| Greenhouse | the arched steel-skeleton tunnel (`frame: 'greenhouse'`); convert to / from a building (loses the interior) |
| Tower | chimney, silo, storage tank, water tower (fly under the tank), lattice mast / pylon, tower crane |
| Bridge | beam on piers or arch, you can fly under it |
| Stairs, ramp | optionally raised (`y`), e.g. on a floor |
| Container, car, truck, excavator | stackable with `y` |
| Fence | free-standing wall (masonry, concrete, brick, wood, metal, chain-link) |
| Fixture | a structure that belongs to a building (a roof ladder): moves and turns with it |

Collision uses axis-aligned boxes and vertical cylinders only; long or rotated parts are cut into short boxes.

## Run it

```bash
npm install
npm start          # http://localhost:4200
npm test           # Vitest through the Angular builder
npm run build      # production build into dist/
npx tsc -p tsconfig.app.json --noEmit --noUnusedLocals --noUnusedParameters   # dead-code check
```

## Where things are

```
src/app/
  core/        framework-free logic (pure TypeScript, unit-tested): site spec, footprints, openings, building ops,
               AI commands, flight analysis, sim physics, geo / calibration
  three/       Three.js: site builder (site-model), structures, path renderer, camera rig, 3D previews
  state/       signal stores (layout, view, calibration, playback, flights, radio)
  services/    services: SiteService (generate / library), GeoService (Overpass), AiService, StudioService, SceneService ...
  ui/          panels and widgets; ui/studio is the Bandos editor
  i18n/        translations (Italian), applied by services/i18n.service.ts
library/       the online catalogue: blocks/*.json and example bandos/*.json (built by tools/build-catalog.mjs)
docs/guide/    help pages, written from the guided tour by tools/build-guide.mjs
design-system/ colours, type, spacing and component guidelines (read before UI changes)
```

Key files: `core/site-spec.ts` (the data model), `three/site-model.ts` (spec to 3D + colliders), `ui/studio/bando-editor.ts`
(the editor), `services/geo.service.ts` (OpenStreetMap), `core/ai-commands.ts` (what the assistant may do).

## Data and units

- Site coordinates: metres, **x east, z south** (north is up the map), y up. `SiteSpec.origin` is the lat / lon of (0, 0).
- Generated bandos are not rotated, so the plan lines up with the map; `bearingDeg` is only non-zero for old specs.
- Buildings: `pos` is the centre, `rotDeg` follows the SVG convention (x axis to (cos, sin) in x, z). Interior elements
  (partitions, voids, columns) are in a frame **from the bounding box's min corner**; openings of shaped buildings and
  footprints are **centred** on the building.
- A floor's walls stand on `levels[i].baseY`. Only the top floor has a roof (the others use `roof: 'none'`).

## OpenStreetMap data (Overpass)

`GeoService.areaData` makes one Overpass request for the whole area (buildings, trees, roads, structures), caches it for 12 h
in the browser, and falls back to buildings only. The public servers are often busy and answer 429 / 500 without CORS
headers; the browser then shows an opaque "access control" error. Mitigations:

- several mirrors are tried in turn;
- **Data server...** in the Area tab sets your own endpoint, e.g. [`tools/overpass-proxy.php`](tools/overpass-proxy.php) on shared hosting
  (it caches answers on disk and adds CORS for your site).

## AI assistant

The assistant never writes geometry. A language model answers with JSON `{ reply, commands }`; the app validates the commands
(`core/ai-commands.ts`), runs them through the same helpers the mouse tools use, and records one undo step. Only the
application result counts: the chat shows "Nothing was changed" when no command ran, and "what I understood" lists the commands.

Two providers, one chat:

- **In this browser**: WebLLM on WebGPU (Qwen2.5 / Llama / Phi / Qwen3). Nothing leaves the machine; the first load downloads
  the model (1 to 5 GB, cached). Loaded lazily, so it does not affect the normal start-up.
- **Server / home PC**: any OpenAI-compatible endpoint: Ollama or LM Studio on your PC over HTTPS (e.g. Tailscale; set
  `OLLAMA_ORIGINS` to your site), or [`tools/ai-proxy.php`](tools/ai-proxy.php) on shared hosting, which keeps an API key off the browser.
  The token typed in the app is stored in `localStorage`.

The model sees text only (building names, sizes, floors, counts, structures), not images.

## Deploying to GitHub Pages

This repository includes a GitHub Actions workflow
([`.github/workflows/deploy-gh-pages.yml`](.github/workflows/deploy-gh-pages.yml))
that builds the app and publishes it to GitHub Pages automatically on every
push to `main` (it can also be triggered manually from the **Actions** tab).

### One-time setup

1. In the repository, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.

No further configuration is required — the workflow uses the built-in
`GITHUB_TOKEN`, so no secrets are needed.

### How it works

- Runs `npm ci` and `npm run build` (production build, with
  `"baseHref": "/a-bando-fpv-app/"` set in `angular.json` so asset URLs
  resolve correctly under the project-page subpath).
- Adds a `.nojekyll` file so GitHub Pages does **not** process the bundle
  with Jekyll (without it, Pages renders the README instead of the app).
- Uploads `dist/a-bando-fpv-app/browser` as the Pages artifact.
- Deploys it with `actions/deploy-pages`.

The site will be available at `https://<username>.github.io/<repo>/`.

### Alternative: deploy from your machine

A `deploy` target backed by
[`angular-cli-ghpages`](https://github.com/angular/angular-cli-ghpages) is
already configured in `angular.json`. To use it locally:

```bash
npm i -D angular-cli-ghpages   # one-time install of the builder dependency
npx ng deploy --base-href /<repo-name>/
```

This pushes the production build to the `gh-pages` branch. Note that if you go
this route, set **Settings → Pages → Source** to the `gh-pages` branch instead
of GitHub Actions.

## Known limits

- Rectilinear footprints only (no diagonal walls); shaped buildings have flat roofs.
- Curved bridges become one straight deck; bell / observation towers are not imported.
- The AI does not check for overlapping buildings.
- Satellite tiles come from Esri World Imagery; check its terms before any bulk or automated use.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
