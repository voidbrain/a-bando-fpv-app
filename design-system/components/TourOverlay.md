# TourOverlay

What the guided tour draws over the whole app (above the version badge): a cursor, click rings, an outline round the
current target, the caption bar, and the hover tips.

## Use

- Cursor: a white arrow with a dark outline and a soft drop shadow; it glides in a slight arc and shrinks while pressed.
- Click ring: a 2px `accent` circle that grows and fades in 0.5s. Target outline: 2px dashed `accent`, `radius-box`.
  These are the only animations besides the toast and the spinner, and they exist to show where the action is.
- Caption bar: bottom centre, at most 560px wide (phone width minus 32px), `panel-solid`, `line` border, `radius`,
  `shadow-panel`. Head: tour title (bold), `n / total` in `mono` `dim`, then Pause / Next / Stop buttons. The caption
  is 13px. A 3px progress line in `accent` on `line` runs along the bottom. `role="status"`, `aria-live="polite"`.
- Hover tip: 240px card next to the control (`panel-solid`, `line`, `radius-box`, `shadow-menu`): step title, its
  first caption in `dim`, `▶ Show me`.
- Esc stops a tour at any time. While recording a clip only Stop is shown.

Source: `src/app/ui/tour-overlay.ts`.
