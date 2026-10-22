# FloatBox

FloatBox is a small window inside a panel's work area (the elements list, the AI assistant), draggable and resizable within its parent.

## Use

- Same language as Panel, one step smaller: `radius-box`, `shadow-box`, a 3px header with an uppercase title and one ▾ / ▸ toggle.
- `cols` lays short controls side by side in wrapping rows.
- Double-clicking the header restores the default place and size.

## Consumer provides

`fid` (the key its geometry is remembered under), `title`, default `x y w h`, minimum size, and a `position: relative` parent.

Source: `src/app/ui/float-box.ts`.
