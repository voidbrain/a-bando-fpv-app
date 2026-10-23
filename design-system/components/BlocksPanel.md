# BlocksPanel

BlocksPanel is the float box listing placeable blocks (the pilot's own and the online catalogue), searchable by name, tag
and kind.

## Use

- Opened from the editor bar (`▦ Library`; the float box is titled Library). The list is grouped under small caption
  headers (`groupBlocks` in `core/catalog.ts`): My blocks, FPV gates and poles, Bridges ramps and lines, Bushes and
  hedges, Vehicles, Street, Yard and building site, Towers, Industrial, Ruins, Buildings, Patterns, Other. A block's
  group comes from its tags; a new block needs a tag one of the groups knows, or it lands in Other.
- A row shows the block's picture (a tool icon), name, its size (`w × d × h m`, measured from the built model,
  `three/block-size.ts`) and `vN` (or "mine").
  Clicking a row expands it: description, author and licence, its parameters as fields, then the actions.
- Actions: **Place** (then click the map; the hint and a dashed ring follow the pointer; Esc stops), **Apply to floor**
  for patterns (needs a selected building), **Copy to mine**, **Export**, **Delete** (own blocks only).
- "Updates in this bando" (a `warn` border) lists placed blocks with a newer version: Update or Detach.
- The sync button (↻) shows a spinner while checking; offline, a `dim` line says the saved catalogue is shown.
- Placed elements show "From block … vN" in the inspector, with Update, Detach and Remove placement.

## Consumer provides

The selected building and structure (for patterns and "Save selection as block"); it emits `arm` and `apply`.

Source: `src/app/ui/studio/blocks-box.ts`.
