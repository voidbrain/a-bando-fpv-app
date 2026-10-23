# FloatBox

FloatBox is a small window inside a panel's work area (the elements list, the AI assistant), draggable and resizable within its parent.

## Use

- Same language as Panel, one step smaller: `radius-box`, `shadow-box`, a 3px header with an uppercase title and one ▾ / ▸ toggle.
- `cols` lays short controls side by side in wrapping rows.
- Double-clicking the header restores the default place and size.
- It stays hidden until it knows its place (no flash at the top-left), then opens on top of the other float boxes and
  toolbars; clicking it brings it to the front (`ui/stacking.ts`). Context menus stay above everything (z 9000).
- The body keeps 16px free at the bottom so the resize corners never cover the last row (resizable panels too).

## Consumer provides

`fid` (the key its geometry is remembered under), `title`, default `x y w h`, minimum size, and a `position: relative` parent.

Source: `src/app/ui/float-box.ts`.
