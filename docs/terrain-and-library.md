# Terrain and the blocks library — plan

Status: Part 1 (terrain) is built, see "Part 1 — what was built" below; Parts 2 and 3 are not started. The questions
at the end are decided (2026-10-22); each section names the ones it depends on as **Q1, Q2…**.

## Part 1 — what was built

| Plan step | Where | Notes |
| --- | --- | --- |
| 1 grid + `heightAt` + brushes | `core/terrain.ts`, Terrain group in `bando-editor.ts` | raise, lower, smooth, flatten, hill, crater, ramp; contours on the plan |
| 2 everything on the terrain | `core/site-ground.ts`, `three/site-model.ts`, `core/sim/*` | buildings on levelled pads, trees, structures, fences, pad, simulator, picks, flight paths |
| 3 real elevation | `core/elevation.ts`, `services/elevation.service.ts` | AWS terrarium tiles at z15, cached in IndexedDB, loaded on generation, "Real ground" button |
| 4 roads as lines | `core/layers.ts` (`RoadSpec`), Road tool | road / track / path / rail; old road pads migrate to two-point roads |
| 5 surfaces | `core/layers.ts` (`SurfaceSpec`), Surface tool | polygons (Q8); OSM landuse / natural / parking |
| 6 water | `core/layers.ts` (`WaterSpec`), Water tool | dug basin, flat surface, touching it crashes the drone (Q13) |
| 7 underground | `core/underground.ts`, Tunnel tool | tunnel or room, box / pipe / vault, cut where the ground passes through |

Not done from Part 1: building basements through a negative `baseY` (1.6, last paragraph), 3D measures (1.4), a
section view along a tunnel (1.6), national DEMs (Q6). The terrain tools work in the 2D editor only.

## Goals

1. **Terrain** that starts from the real ground of the place picked on the map, then lets the pilot raise and lower it
   (hills, holes), and carries roads, surface types and water.
2. **Building blocks**: reusable, parametric items (a building, a structure, a group, a pattern) that can be placed in any
   bando.
3. **Sharing**: blocks and whole bandos in an online library, synced with the offline one, updatable from JSON written by
   Claude (or another model) without shipping app code.

## Where the code stands

| Area            | Today                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| Ground          | One flat box at y = 0 (`three/site-model.ts`, `spec.groundColor`, `spec.extent`).                            |
| Heights         | Everything assumes ground y = 0: `level.baseY`, tree and structure placement, the take-off pad.              |
| Simulator       | `core/sim/drone-physics.ts` treats y = 0 as the ground; `SiteCollider` has boxes and ground-based cylinders. |
| Roads           | OSM roads become rectangles (`PadSpec`, optional `rotDeg`).                                                  |
| OSM import      | `GeoService.areaData`: footprints, trees, roads, structures inside the (turnable) area frame.                |
| Reusable pieces | `core/modules.ts` (façade patterns, column rows, store preset): code, not data.                              |
| Structure kinds | A fixed union `StructureKind`; each kind is a builder in `three/structures.ts`.                              |
| Library         | `SiteLibraryService`: whole `SiteSpec`s in localStorage, one key per site plus an index. No blocks, no sync. |

## Part 1 — Terrain

### 1.1 Model

The terrain is **base + edits**, rebuilt on demand, never stored as one baked mesh:

```ts
interface TerrainSpec {
  /** Grid over the site, centred on the origin, x east / z south, metres. */
  cell: number; // metres per cell, e.g. 1 (Q4)
  half: { e: number; n: number }; // half extents, metres
  /** Where the real ground came from; the heights themselves live in a cache, not in the spec. */
  base?: {
    source: 'aws-terrarium' | 'copernicus-glo30' | 'flat';
    zone: ZoneSpec;
    fetchedAt: number;
  };
  /** Height of the real ground at the origin, so the site stays near y = 0. */
  datum: number;
  /** Pilot edits, replayed in order over the base. One stroke = one undo step. */
  strokes: TerrainStroke[];
}

type TerrainStroke =
  | {
      op: 'raise' | 'lower' | 'smooth';
      pts: Vec2[];
      radius: number;
      strength: number;
      falloff: 'smooth' | 'linear' | 'flat';
    }
  | { op: 'flatten'; pts: Vec2[]; radius: number; height: number }
  | {
      op: 'stamp';
      kind: 'hill' | 'crater' | 'ramp' | 'ditch';
      at: Vec2;
      size: number;
      depth: number;
      rotDeg?: number;
    };
```

- `SiteSpec.terrain?: TerrainSpec` is optional; an old site without it loads as flat ground (AGENTS: "make old saved specs
  load"). `sanitizeSpec` clamps every number; `cloneSpec` stays JSON.
- A pure `core/terrain.ts`: `buildHeights(spec, base): Float32Array`, `heightAt(heights, x, z)` (bilinear), `slopeAt`,
  `minUnder(polygon)`. Covered by `core/terrain.spec.ts`. Everything else asks `heightAt`.
- The base heights are cached (IndexedDB, keyed by source + zone + cell) so the spec stays small and shareable; a shared
  bando re-fetches its base from the recorded source (**Q5**).

### 1.2 Real ground

- Sources: AWS Terrain Tiles (terrarium PNG, global, free, CORS) as the default; Copernicus GLO-30 as an alternative.
  Both are ~30 m: most bandos come out almost flat, the value is in the edits. A higher-resolution national DEM could be a
  per-country option later (**Q6**).
- Fetched once when a site is generated from the map frame (same moment as `areaData`), resampled to the grid, then
  re-centred with `datum`.
- "Re-fetch real ground" replaces the base and replays the strokes, so edits survive.

### 1.3 Editing tools

- New palette group **Terrain** (one colour per tool, never reused): Raise, Lower, Smooth, Flatten (samples the height
  under the first click), Stamp (hill / crater / ramp / ditch).
- Options bar: radius, strength, falloff. Plan view shows contour lines every 1 m (bolder every 5 m) and a hillshade under
  the map; the readout shows the height under the cursor.
- One stroke = one `commitSite` undo step; live preview during the drag via `beginGesture` + `live`.

### 1.4 Everything stands on the terrain (the expensive step)

- **Buildings**: base = `minUnder(footprint)`; the terrain under the footprint is flattened to it (an implicit pad, not a
  stroke, so moving the building moves the pad). Option: keep the lowest floor partly buried instead (**Q7**).
- **Trees, structures, walls, take-off pad**: y from `heightAt` at their foot.
- **Three.js**: the ground box becomes a grid mesh (one vertex per cell, LOD by distance if needed); `userData.pick` for
  the ground stays "ground".
- **Simulator**: the ground test in `drone-physics.ts` becomes `p.y < heightAt(x, z) + DRONE_REST_HEIGHT`;
  `SiteCollider` gets a heightfield (`CollisionWorld.groundAt`). Tree cylinders start at their foot height.
- **Measures**: optionally 3D (slope distance, height difference).

### 1.5 Layers on top

Each layer is seeded from OSM when the site is generated, then editable like everything else.

| Layer         | Model                                                                                                                                                                                             | OSM seed                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Roads & paths | Polylines with width, kind (road / track / path / rail) and surface; drape on the terrain and level it slightly across their width. Replaces `PadSpec` roads (old ones migrate to 2-point lines). | `highway=*`, `railway=*`, `width`, `surface`           |
| Surfaces      | Polygons (or a coarse paint grid, **Q8**) of grass, asphalt, concrete, gravel, dirt, sand, rubble. Drives ground colour/texture.                                                                  | `landuse`, `surface`, `natural=sand/scrub`             |
| Water         | Polygons with a water level; terrain inside is dug out to a bed depth; flat transparent surface (as the ground-floor void basin does today). Drone crash on contact.                              | `natural=water`, `waterway=riverbank`, `landuse=basin` |

### 1.6 Underground: tunnels, culverts, underpasses, basements (Q3)

**The limit.** A heightfield stores ONE ground height per point of the map. A tunnel needs two at the same point: ground
on top of the hill, and air (then a floor) inside the tunnel below it. No brush on a heightfield can make that, so the
underground is not terrain: it is a separate element that the terrain makes room for.

**The element: an underground volume.** A prism: an outline on the plan (polygon or a centre line with a width), a floor
height and a ceiling height, plus a style (concrete box, round pipe, brick vault) and wall / slab thickness.

```ts
interface UndergroundSpec {
  id: string;
  name: string;
  /** Plan outline, site metres; a tunnel is usually a long thin quad drawn as a line + width. */
  outline: Vec2[];
  floor: number; // y of the inside floor, metres
  ceiling: number; // y of the inside ceiling
  shape: 'box' | 'pipe' | 'vault';
  wall: number; // wall and slab thickness
  /** Water in the bottom (culverts); 0 = dry. */
  water?: number;
}
```

`SiteSpec.underground?: UndergroundSpec[]`, optional (old sites load). It can also be a block (Part 2), so a "railway
underpass" or "drainage culvert" is a library item with parameters.

**One rule does the whole job: the terrain is cut wherever it passes through the inside of a volume.** For every grid cell
inside the outline:

| Terrain height at that cell       | What happens                                                         | Where you see it                   |
| --------------------------------- | -------------------------------------------------------------------- | ---------------------------------- |
| above the ceiling + slab          | terrain kept: the tunnel is covered                                  | the hill over the tunnel           |
| between the floor and the ceiling | terrain cut out: a hole in the ground mesh                           | the tunnel mouths (portals)        |
| below the floor                   | terrain kept; the volume's walls and floor stand above it, uncovered | a culvert crossing a ditch, a ramp |

So the entrances are never drawn by hand: dig a ditch or lower the ground where the tunnel meets the slope and the mouth
opens by itself; raise it and the mouth closes. Moving the volume moves the openings.

Side view of a tunnel through a hill:

```
        terrain kept (above ceiling)
          ______________
   ______/              \______
  |      ==================     |   <- ceiling slab
  | cut  :   inside: air  :  cut|   <- terrain cut between floor and ceiling = portals
  |______==================_____|   <- floor
```

**Rendering.** The ground mesh drops the cut cells (cells on the edge of the cut are clipped to the outline so the hole is
clean, not stair-stepped). The volume is built like a structure: floor, walls, ceiling as boxes (pipe = cylinder segments,
vault = boxes in an arc); inner faces visible, with a dark material and optional lights so FPV footage inside reads.
`userData.pick = { kind: 'underground', id }`.

**Simulator.** Two small changes to the collider:

- `groundAt(x, y, z)`: inside an outline and below that volume's ceiling → the volume's floor; otherwise `heightAt(x, z)`.
  The drone can land on a tunnel floor that is under a hill.
- The walls and slabs are ordinary boxes (cut into short ones when the tunnel is turned or curved, as AGENTS requires).

**Editing.** A "Tunnel" tool draws the centre line (like Fence) with width, floor and ceiling in the options bar; "Room"
draws a polygon for a basement or bunker. In the plan view the outline is dashed where it is covered and solid where the
terrain is cut, so the portals are visible from above. The section view (a cut along the line) shows terrain, slab and
floor, which is where floor and ceiling are adjusted.

**Building basements** use the same mechanism: a level with a negative `baseY` creates an underground volume under the
footprint, and the ground-floor void (today the water basin) can open into it.

**What it does not do, by choice:** caves with free-form walls, arches of rock, overhanging cliffs. Those need a voxel or
signed-distance terrain (3D grid, much heavier to store, edit and render). If one is wanted, it is a block made of
primitive shapes placed on top of the terrain, not terrain.

### 1.7 Order

1. Terrain grid + `heightAt` + brushes on **flat** ground.
2. Buildings, trees, structures, pad, simulator and collider on the terrain.
3. Real elevation (fetch, cache, datum, re-fetch).
4. Roads as polylines.
5. Surfaces.
6. Water.
7. Underground volumes (tunnels, culverts, basements), then their library blocks.

Each step ships on its own and keeps old sites loading.

## Part 2 — Building blocks

### 2.1 What a block is

A block is a **template**: placing it writes ordinary spec elements (the way `core/modules.ts` writes ordinary openings and
columns). The site spec stays the source of truth; nothing at render time depends on the block.

```ts
interface BlockSpec {
  schema: 1;
  id: string; // stable, e.g. "abando/water-tower-riveted"
  version: number; // bumps on every published change
  name: string;
  kind: 'building' | 'structure' | 'group' | 'pattern';
  tags: string[];
  author: string;
  licence: 'CC-BY-4.0' | 'CC0' | 'ODbL'; // Q10
  thumbnail?: string; // data URI or library URL
  params: BlockParam[]; // e.g. { key: 'floors', type: 'int', min: 1, max: 12, default: 3 }
  /** Content in block-local metres, origin at the insertion point; may reference params as {"$": "floors"}. */
  content: Partial<Pick<SiteSpec, 'buildings' | 'structures' | 'walls' | 'trees'>> & {
    shapes?: ShapeSpec[];
  };
}
```

- Placing: pick a block, set params, click the map (snaps with `core/align.ts` like a new building). One undo step.
- Placed elements keep `fromBlock: "id@version"` so the library can offer "update to v4" or "detach".
- A `pattern` block is today's façade / column / bay modules expressed as data; the existing presets become the first
  library entries.

### 2.2 New items without app code: primitive shapes

Today a new structure kind needs a builder in `three/structures.ts`. For items written by Claude (or described to the AI)
to be usable without a release, add **one** generic structure built from primitives:

```ts
type ShapeSpec =
  | { prim: 'box'; at: Vec3; size: Vec3; rotDeg?: number; color: string }
  | { prim: 'cylinder'; at: Vec3; radius: number; height: number; segments?: number; color: string }
  | { prim: 'extrude'; outline: Vec2[]; at: Vec3; height: number; color: string }
  | { prim: 'array'; of: ShapeSpec; count: number; step: Vec3 };
```

- Colliders come for free: the collider already knows axis-aligned boxes and vertical cylinders; rotated boxes and
  extrusions are cut into short boxes (AGENTS rule).
- Caps (number of shapes, size, array count) keep a malicious or broken block from freezing the app.
- The hand-written kinds (`chimney`, `silo`, `tower_crane`…) stay; they can later be re-expressed as blocks.

### 2.3 AI and JSON flows

- **Described to the AI**: "a rusty water tower on four legs, 18 m" → the model returns a `BlockSpec` (new AI schema, same
  pattern as `core/ai-commands.ts`: schema, normalise, clamp) → preview in the inspector → save locally → optional publish.
  As with AI edits, report what validated, never the model's own words.
- **Generated with Claude Code**: Claude writes block JSON files into the catalogue repo (2.4) and opens a PR; CI validates
  them with the same `sanitizeBlock` the app uses.
- **Export / import**: a block or a bando as `.json`; a bando with its blocks, thumbnail and terrain cache as `.abando`
  (zip) (**Q11**).

## Part 3 — Library, online and offline

### 3.1 Local

- Move the library from localStorage to IndexedDB (terrain caches and thumbnails will not fit in localStorage). Migrate the
  existing `abando-ng-sites` keys once.
- Three collections: `sites`, `blocks`, `catalog` (cached online entries with their version and ETag).

### 3.2 Online, in two stages

**Stage 1 — read-only catalogue (recommended first).** A public Git repository (e.g. `a-bando-library`) of block files and
an `index.json` (id, version, name, tags, thumbnail, hash), served as static files (GitHub Pages or the existing host).

- Updating = a PR (by you, or by Claude from a description); CI runs the app's validator and builds `index.json`. Merge =
  published.
- The app fetches `index.json` on start (ETag), downloads new versions in the background, works fully offline from the
  cache.
- A block edited locally becomes a **fork** (`id` → `local/…`), never overwritten by a sync.

**Stage 2 — user sharing (only if Q9 says "everyone").** Needs accounts, per-user rights and moderation: Supabase (Postgres

- auth + row-level security + storage) is the shortest path; the existing PHP host is possible but means writing auth and
  rights by hand. Bandos and blocks get an owner, a visibility (private / link / public) and a licence.

### 3.3 Sync rules

- Catalogue entries: last published version wins; placed elements keep their `fromBlock` version until the pilot updates.
- Own items (Stage 2): local edits queue while offline, upload on reconnect; a conflict keeps both (rename one), never a
  silent overwrite.

## Legal and safety

- OSM-derived content (footprints, roads, landuse) is ODbL: shared bandos need attribution and share-alike; blocks drawn by
  hand can be CC-BY or CC0 (**Q10**).
- Copernicus DEM and AWS Terrain Tiles need attribution.
- Abandoned places: exact coordinates can lead people to private or dangerous sites. A shared bando defaults to coordinates
  hidden (origin rounded or removed) unless the author chooses otherwise (**Q12**).

## Decisions

| #   | Question                                                                                                    | Decision                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Q1  | Typical bando size (metres across)? Drives grid size and memory.                                            | up to 600 × 600 m                                                            |
| Q2  | Do terrain edits need to follow the map frame when it is moved / turned after generation?                   | no: frame change = new base, strokes kept                                    |
| Q3  | Underground / overhangs (tunnels, culverts)? A heightfield cannot do them; they would be blocks.            | underground volumes cut into the terrain (1.6); free-form caves out of scope |
| Q4  | Grid cell size: 0.5, 1 or 2 m?                                                                              | 1 m                                                                          |
| Q5  | Store base heights inside a shared bando (bigger, exact) or re-fetch them (smaller, depends on the source)? | re-fetch, keep a hash to detect drift                                        |
| Q6  | Any country with a better free DEM worth supporting (e.g. Italy's regional LiDAR)?                          | not in the first version                                                     |
| Q7  | Buildings on slopes: flatten a pad, or bury the lower floor?                                                | flatten a pad                                                                |
| Q8  | Surfaces as polygons or as a painted grid?                                                                  | polygons (match OSM, edit like buildings)                                    |
| Q9  | Who publishes: only you (Stage 1 is enough) or any user (Stage 2)?                                          | only you                                                                     |
| Q10 | Licence for hand-made blocks?                                                                               | CC-BY-4.0                                                                    |
| Q11 | Is a `.abando` zip needed, or is plain JSON enough at first?                                                | JSON first                                                                   |
| Q12 | Coordinate privacy for shared bandos: hidden, rounded, or the author's choice?                              | author's choice, hidden by default                                           |
| Q13 | Should the drone fly over / into water (splash = crash) and do surfaces change anything in the simulator?   | water = crash, surfaces visual only                                          |
