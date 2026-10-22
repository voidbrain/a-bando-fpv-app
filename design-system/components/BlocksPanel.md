# BlocksPanel

BlocksPanel is the float box listing placeable blocks (the pilot's own and the online catalogue), searchable by name, tag
and kind.

## Use

- Opened from the editor bar (`▦ Blocks`). A row shows the block's picture (a tool icon), name and `vN` (or "mine").
  Clicking a row expands it: description, author and licence, its parameters as fields, then the actions.
- Actions: **Place** (then click the map; the hint and a dashed ring follow the pointer; Esc stops), **Apply to floor**
  for patterns (needs a selected building), **Copy to mine**, **Export**, **Delete** (own blocks only).
- "Updates in this bando" (a `warn` border) lists placed blocks with a newer version: Update or Detach.
- The sync button (↻) shows a spinner while checking; offline, a `dim` line says the saved catalogue is shown.
- Placed elements show "From block … vN" in the inspector, with Update, Detach and Remove placement.

## Consumer provides

The selected building and structure (for patterns and "Save selection as block"); it emits `arm` and `apply`.

Source: `src/app/ui/studio/blocks-box.ts`.
