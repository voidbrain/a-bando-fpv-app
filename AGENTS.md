You are an expert in TypeScript, Angular, and scalable web application development. You write functional, maintainable, performant, and accessible code following Angular and TypeScript best practices.

## TypeScript Best Practices

- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain

## Angular Best Practices

- Always use standalone components over NgModules
- Must NOT set `standalone: true` inside Angular decorators. It's the default in Angular v20+.
- Do NOT set `changeDetection: ChangeDetectionStrategy.OnPush` explicitly. `OnPush` is the default in Angular v22+.
- Use signals for state management
- Implement lazy loading for feature routes
- Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead
- Use `NgOptimizedImage` for all static images.
  - `NgOptimizedImage` does not work for inline base64 images.

## Accessibility Requirements

- It MUST pass all AXE checks.
- It MUST follow all WCAG AA minimums, including focus management, color contrast, and ARIA attributes.

### Components

- Keep components small and focused on a single responsibility
- Use `input()` and `output()` functions instead of decorators
- Use `model()` for two-way bound properties with `[(prop)]` syntax instead of pairing `input()` with `output()`
- Use `computed()` for derived state
- Use `linkedSignal()` for state derived from multiple reactive sources that must stay synchronized
- Prefer inline templates for small components
- Prefer Signal Forms (`@angular/forms/signals`) for new forms. They are stable in Angular v22+ and provide signal-based state, type-safe field access, and schema-based validation
- When not using Signal Forms, prefer Reactive forms instead of Template-driven ones
- Do NOT use `ngClass`, use `class` bindings instead
- Do NOT use `ngStyle`, use `style` bindings instead
- Do NOT import `CommonModule`, import only the directives and pipes the template uses, such as `AsyncPipe` or `DatePipe`
- When using external templates/styles, use paths relative to the component TS file.

## State Management

- Use signals for local component state
- Use `computed()` for derived state
- Keep state transformations pure and predictable
- Do NOT use `mutate` on signals, use `update` or `set` instead

## Templates

- Keep templates simple and avoid complex logic
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`
- Use the async pipe to handle observables
- Do not assume globals like (`new Date()`) are available.

## Services

- Design services around a single responsibility
- Use the `providedIn: 'root'` option for singleton services
- Prefer the `@Service` decorator over `@Injectable({providedIn: 'root'})` for new singleton services (Angular v22+)
- Use the `inject()` function instead of constructor injection

## Project conventions (a-bando-fpv-app)

### Architecture

- `core/` is plain TypeScript with no Angular imports: keep it that way so it stays unit-testable. Put logic there, keep
  components thin. `three/` builds Three.js objects from the spec; `services/` and `state/` hold signals; `ui/` is templates.
- The **spec is the source of truth** (`core/site-spec.ts`). The 3D model, the plan overlay, the inspector preview and the
  AI context are all derived from it. Edit the spec through `SiteEditor` (`commitSite` = one undo step; `beginGesture` +
  `live` for drags) and then `SiteService.applyDraft()` to rebuild the 3D scene.
- Coordinates: x east, z south, y up, metres. Building-local frames differ by element (see README, "Data and units"); mixing
  the min-corner frame (partitions, voids, columns) with the centred frame (openings of shaped buildings, footprints) is the
  usual source of bugs. Convert in one place and test it.
- Every wall builder must add `level.baseY`. A new geometry builder needs a collider: the collider only knows axis-aligned
  boxes and vertical cylinders (ground based); cut long or rotated parts into short boxes.

### Design system

- Before any UI change (templates, styles, user-facing text) read [design-system/README.md](design-system/README.md) and the
  guideline of the component you touch in `design-system/components/`. Follow its colours, type styles, spacing, radii and
  voice; use `var(--…)` tokens from `src/styles.scss`, never a new literal colour.
- A new token, tool colour or shared component updates `design-system/` in the same change (see "Keeping it in step" there).

### Adding things

- **A structure kind**: add it to `StructureKind` and `STRUCTURE_DEFAULTS` / `RECT_KINDS` (`three/structures.ts`), build it
  in `buildStructure` (geometry + collider), list it in `structKinds` and the plan symbol in `ui/studio/bando-editor.ts`,
  add it to `STRUCTURE_KINDS` in `core/ai-commands.ts` if the assistant may place it, optionally map an OSM tag in
  `GeoService.areaData`. Add a case to `three/structures.spec.ts`.
- **An AI command**: add the op to `OPS`, fields to `AiCommand` + `normalizeCommands` (clamp every number), a `case` in
  `runCommands`, the property to `AI_SCHEMA`, a line (and ideally an example) to `SYSTEM_PROMPT`. Cover it in
  `core/ai-commands.spec.ts`. The model's `reply` is only a claim: report from `RunResult`.
- **A spec field**: add it to the type, keep `sanitizeSpec` (it rebuilds the object) and `cloneSpec` (JSON) in step, and
  make old saved specs load (optional field with a default).

### Checks before you finish

```bash
npx ng test --watch=false
npx ng build
npx tsc -p tsconfig.app.json --noEmit --noUnusedLocals --noUnusedParameters
```

- A test that fails because the code changed is stale: fix the test deliberately and say why. Tests that encoded the old
  demo site now set their site up explicitly (origin, take-off pad).
- UI code (templates, pointer handling) is not covered by tests; keep logic in `core/` so it is.
- Do not leave dead code behind when replacing a feature: a panel removed means its store, helpers and tests go too.

### Known pitfalls

- Angular signals in `effect()` that write other signals are fine in v22, but wrap reads you do not want tracked in
  `untracked()`.
- WebGL canvases (inspector preview, 3D editor view) skip rendering while hidden; they must not be assumed to exist in tests
  (the scene builders are testable without a renderer).
- Overpass answers 429 / 500 without CORS headers: do not treat the browser's "access control" error as a code bug.
- Never claim an AI edit worked from the model's own words.
- `SiteService.applySpec` re-applies the calibration every time (Save, every edit). The pilot's own alignment (pins, compass)
  therefore lives in `SiteSpec.calibration`; an effect in `SiteService` copies live changes into the spec. Do not set the
  calibration anywhere without going through the store, or it will be undone on the next edit.
- Meshes that can be clicked in the 3D editor carry `userData.pick` (`{ kind, id | i }`); keep it when adding a new builder.

## Modules and the tree brush
- `core/modules.ts`: façade patterns (`doors` / `panels` / `store` = 2 lower-panel bays + 1 full-height door, repeated), column rows and the "industrial store" preset. They only write ordinary openings and columns, and replace what was there, so applying twice never stacks. AI ops: `set_facade`, `set_columns`, `industrial_store`.
- `core/scatter.ts`: random trees inside a pen strip / square / circle / lasso outline (dart throwing, seedable). One stroke = one undo step.
- Level 0 is labelled "G" in the UI (`levelName`), the others L1, L2 ...

## Aids, measures, review
- `core/align.ts`: `snapBeside` / `autoAlign` put a (new or merging) building flush against close neighbours (closes gaps up to 3 m, straightens angles up to 10°, lines up almost-aligned edges). `mergeBuildings` uses it first and restores the building if the merge fails.
- `core/measure.ts`: magnet targets (corners, wall middles, columns, trees, structures, wall ends, other measures), axis straightening and the angle between measures that share a point. The editor keeps the measures (cyan, `meas`): every click continues the chain (B of one is A of the next; the same point twice, Esc, a right click or closing on the chain's start ends it). A line click selects (`measSel`) and drags it, the white knobs move one end (measures sharing the point follow), Delete / the Delete button removes the selection, Clear all removes everything. Angles between measures sharing a point are drawn as a filled arc with the value inside (`arcOf`). The area frame stays yellow.
- Area frame: `half` + `off` (centre offset in the frame's own axes) + `rot`. Dragging an edge moves only that edge. `ZoneSpec.rotDeg` is carried to `GeoService.areaData`, which asks for the bounding box and keeps only what is inside the turned rectangle.
- Columns: `colSet` (+ primary pick) is the selection; `duplicateColumns` copies it as a module, `fillModule` continues its lattice over the floor. Dragging on the empty floor with Select rubber-bands them (Shift adds); there is no separate pick tool.
- `AiService.changes`: one entry per command that changed something, with a link (`show`) that selects the building, opens the floor and flies the map there, a reviewed flag and `acceptAll`.
- `ui/studio/elements-box.ts`: list of all elements with outline thumbnails; trees are grouped in 60 m cells.

## Tool palette, modules, picking, menus
- The 2D/3D editor has a vertical tool palette. `tools` in `bando-editor.ts` lists every tool with an icon key (`ui/studio/tool-icon.ts`, plain SVG strokes on a 24 grid), a colour (`tc(id)`; never reuse a colour between tools or with the area frame) and a `group`. The palette shows ONE button per group (the active tool of the group, else the last used); the others are in a flyout opened by the corner mark, a long press or a right click (`groups`, `pickEntry`, `fly`). The tree brush is expanded to four entries (pen / square / circle / lasso) in the Trees group. Tool options show in the `.opts` chip bar. A new tool = a `tools` entry + an icon + (maybe) a group.
- Select is the default tool: click selects, drag on empty floor = marquee (columns indoors), drag on the map = pan.
- Right click opens a context menu (`onContext` / `ctxItems`) built from what is under the pointer: hit elements carry `data-pk="kind:id"`; no `data-pk` = the ground. A capture-phase listener drops right-button `pointerdown`s so a right click can never start a drag, and `move()` ends any drag whose mouse button is no longer down.
- Repeatable blocks live in the Modules section (columns rows, façade pattern, bay). "Main store preset" (`applyStore`, 4 rows = 1-2-1) is only a shortcut composing those blocks; it is not applied to every building.
- Floors: clicking a floor button (`pickLevel`) sets `floorFocus`: the inspector preview and the 3D view (`SiteView.focus` → `focusFloor`) show that floor solid and the rest of the building ghosted; clicking it again, or selecting another building, clears it. Indoor mode always focuses the edited floor.
- 3D picks: columns and partitions carry `userData.pick` (`SitePick` kinds `column`/`wall`); the inspector preview forwards clicks through `onPick`.
- Inspector: sections (`.sec`, caption `.st`, fields `.fld` two to a row). `FloatBox` has `right` (default x measured from the right edge). Remember: Angular's emulated encapsulation does not apply a component's CSS to projected content, so layout CSS for projected children lives in the component that owns them.
- Lesson: `buildSide` in `site-model.ts` once built wall segments too long when a side had 2+ openings (walls reached neighbouring buildings). Covered by "walls with several openings stay inside the building outline".
- Lesson: panel height must be bound as `[style.height.px]`; a unit-less `[style.height]` is ignored.
- Lesson: in an `effect`, read the signal BEFORE any `if (renderer)` guard (`const on = this.spin(); if (r) r.spin = on`); a signal read behind a false guard is never tracked and the effect never re-runs.
- Layout: the studio panel defaults to 760 × 540; "Reset UI" clears all remembered sizes. Showing a panel (`LayoutStore.setVisible/toggle`) also raises it.
- Patches: when diffing a working copy, exclude `node_modules` (a symlink there gets into the diff and breaks `git apply` on a real folder).

## Elements panel
- `core/elements.ts` holds the grouping (pure, tested): `treeZones` (single-linkage, 14 m: one brush stroke stays one zone), `columnGroups` (rows of one floor; stragglers "loose"), `stairsIn` (stairs / ramps inside a building and their floor), `convexHull`.
- `ui/studio/elements-box.ts` has two tabs: by category (buildings, structures, walls, columns per row, trees per zone) and as a tree (building → floor → doors & windows, interior walls, voids, column rows, stairs). Columns are never listed one by one. Rows emit `ElementGo`; `goTo` in the editor selects the building, opens the floor and selects the thing. Hovering a tree zone outlines it on the map (`zoneHover`), clicking keeps it (`zoneSel`, cleared by any other selection / Esc), "show tree zones" outlines all of them.

## Selection, pickers, toolbars, areas
- Selection: Shift-click adds trees / columns; a drag selects with a box or a lasso (`selShape`, Select options): indoors on the floor (columns), outdoors with Shift held (trees; `shiftHeld` makes the plan take the pointer, Leaflet box-zoom is off). `pointsInside` / `columnsInLine` (`core/elements.ts`) do the hits; a column's row / line / "all alike" is in the inspector, the context menu and on double-click. `treeSet` is cleared whenever the pick is not a tree.
- Option choices between kinds of things use `PickMenu` (`ui/studio/pick-menu.ts`) with tool-icon pictures. Tree species for new trees: broadleaf / conifer / mixed (`treeMix`); more species belong in the shared library. Fence materials: `core/fences.ts` (`WallSpec.material`, absent = masonry; posts and a see-through mesh for chain-link in `site-model.ts`).
- The palette and the options bar are draggable by their `⠿` grip (positions in `abando-float-palette` / `-opts`, cleared by Reset UI through `uiResets`). The options bar sits beside the active tool's button unless dragged. Both are above the float boxes (z 1250).
- Magnet (Select options): moving a building runs `autoAlign` live (reach ~16 px), rotating sticks to neighbours' and the map's axes (`magnetAngle`); Alt drags freely. The outline turns cyan while it holds.
- Toasts render in `app-toast-host`, last in the app root: a toast inside `position: fixed` stage was trapped under the panels.
- Several map areas (`StudioService.areas`, "Add area"): one Overpass request for `boundingZone`, then `keepInsideAreas` unless "fill the gaps". Stored as `SiteSpec.areas` / `fillGaps`. Pinned outlines need their own Leaflet renderer created at init (a lazily created one clipped the first outline away).

## Terrain (docs/terrain-and-library.md, Part 1)
- `core/terrain.ts`: the height grid (`TerrainSpec`: cell, half, base, strokes). The base heights are NOT in the spec (it is JSON-cloned on every edit): `setTerrainBase(key, heights)` registers them; `ElevationService` downloads (AWS terrarium tiles), caches them in IndexedDB and re-registers them when a saved bando opens.
- `core/site-ground.ts` `siteGround(spec)` is the one place the ground is built, in order: base + strokes (feathered edges) → water basins dug → roads levelled across → building / take-off pads levelled → underground cut mask. It is memoised on its inputs; everything (3D model, collider, editor contours, height readout, flight paths through `activeGround`) reads it. A spec without `terrain` is flat at y = 0 and must build exactly as before.
- `core/layers.ts`: roads (`RoadSpec`, centre lines), surfaces, water; `sanitizeLayers` checks them and migrates old road pads. `core/underground.ts`: volumes cut the terrain between floor and ceiling (`cutMask`), `floorUnder` gives the floor inside one; the collider's `groundAt(x, z, y)` uses it, so physics passes the drone's y.
- A new element that stands on the ground lifts its mesh AND its collider boxes by `ground.at(...)` (see `liftSolids`, `liftCylinder`).
- Editor: Terrain group (7 brushes + Tunnel), Layers group (Road, Surface, Water). One drag = one undo step; layers and tunnels create a flat terrain when the bando has none.

## Blocks and the library (docs/terrain-and-library.md, Parts 2–3)
- `core/blocks.ts`: `BlockSpec` (params, content with `{ "$": key, mul, add }` references), `sanitizeBlock` (every block from a file, the catalogue or the AI goes through it), `placeBlock` (writes ordinary elements tagged `block: BlockRef`), `applyPattern`, `updateInstance` / `detachInstance` / `removeInstance`, `blockFrom` (selection → block). `core/shapes.ts`: primitives for the `shapes` structure kind, capped, with colliders.
- The catalogue lives in `library/blocks/*.json` (see `library/README.md`); `tools/build-catalog.mjs` writes `public/library/catalog.json`, and `core/catalog.spec.ts` imports it and checks every block. Add a block = a file + a version bump when changing one.
- `LibraryStore` (IndexedDB, localStorage fallback in tests) is loaded by an app initializer before anything reads it. `SiteLibraryService` and `BlockLibraryService` read it synchronously from memory. The pilot's own blocks are `local/…` and are never touched by a sync.
- The Blocks panel (`ui/studio/blocks-box.ts`) arms a placement (`armed` in the editor: the next click on the map places it, Esc stops); patterns apply to the selected building's current floor.

## Sharing bandos
- `core/share.ts` `shareCopy(spec, 'exact' | 'rounded' | 'hidden', heights)`: rounded / hidden copies drop the zone, areas, GPS landmarks, the pilot's calibration and the datum; hidden puts the origin at 0, 0. A copy that is not exact carries its real ground as `terrain.base.data` (Int16 decimetres, base64, source `embedded`). Export: Bandos list → place choice → Export (`SiteService.exportShared`).
- Import (`SiteService.importJson`) moves `data` out of the spec into the elevation cache (`cacheBase`): the spec is JSON-cloned on every edit, a 1 MB string in it would slow every drag. A clashing id gets a new one; the import is saved.
- `spec.privacy === 'hidden'`: no map under the editor, no Area mode. With `privacy` set and no pilot calibration yet, the next loaded flight is shifted so its first fix lands on the take-off pad (`autoAlignFlights`, once).
- The inspector's Modules section lists the library's pattern blocks (`kind: 'pattern'`); there are no hard-coded presets any more. The catalogue syncs in the background at start-up.
- Basements: `BuildingSpec.basement = { height }` → `basementVolume` (core/underground.ts) under the levelled pad, added to `SiteGround.vols` (terrain cut + collider floor); walls and floor in `buildBasement`. Reached through a void in the ground floor; not editable indoors.
- Ground styles: `SiteModel.setGroundStyle('natural' | 'height' | 'wire')` recolours the terrain mesh from `heightColor` / toggles wireframe; the editor's "ground" picker also draws the height map under the 2D plan. The 3D editor view reports `hover` ground points in draw mode (height readout, `SiteViewRenderer.setCursor` brush ring).
- `SiteEditor.canUndo / canRedo` read the draft signal on purpose: the history lists are plain arrays.
