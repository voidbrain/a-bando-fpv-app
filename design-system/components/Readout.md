# Readout

Readout is the mono pill at the bottom of the map showing live distances and angles while drawing or measuring.

## Use

- `readout` type style on `overlay-soft`, `radius`, `line` border. `.read.warn` turns text and border `warn` (e.g. a snap failed or a size is out of range).
- Values with units, separated by " · ". No pointer events.

## Consumer provides

The text; position it centred 12px above the map's bottom edge.

Source: `src/app/ui/studio/bando-editor.scss (.read)`.
