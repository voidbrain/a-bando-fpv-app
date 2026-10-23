# SegmentedControl

SegmentedControl switches between two to five exclusive views or modes (`.seg`); `.tabs` is the full-width variant used for panel tabs.

## Use

- The 2D / 3D switch, Category / Tree tabs, provider pickers.
- The selected segment fills with `accent` and `accent-ink` at weight 700; the rest are `dim` on no fill.
- Keep labels one word.

## Consumer provides

The options, the selected one (`.on`), and the change handler. Mark it up as buttons with `aria-pressed` (or a `role="tablist"` for `.tabs`).

Source: `src/app/ui/studio/bando-editor.scss (.seg), elements-box.ts (.tabs)`.
