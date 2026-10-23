# TourOverlay

What the guided tour draws over the whole app (above the version badge): a cursor, click rings, an outline round the
current target, the caption bar, and the hover tips.

## Use

- Cursor: a white arrow with a dark outline and a soft drop shadow; it glides in a slight arc and shrinks while pressed.
- Click ring: a 2px `accent` circle that grows and fades in 0.5s. Target outline: 2px dashed `accent`, `radius-box`.
  These are the only animations besides the toast and the spinner, and they exist to show where the action is.
- Caption bar: next to the action, just below the target (above it when there is no room; bottom centre without a
  target, `captionPlace`), at most 520px wide (phone width minus 32px), `panel-solid`, 2px `accent` border, `radius`,
  a deep shadow; it glides to its new place. Head: tour title (bold), `n / total` in `mono` `dim`, then Back / Pause /
  Next / Stop buttons. The caption is 14px. A 3px progress line in `accent` on `line` runs along the bottom. `role="status"`, `aria-live="polite"`.
- Hover tip: 260px card next to the control (`panel-solid`, 2px `accent` border, `radius-box`, `shadow-menu`): step
  title, its first caption in `dim`, a primary `▶ Show me`. Tips are turned on by the `?` in any panel's title bar.
- Panels a step works in open in the middle of the window when they were closed; when the guide ends, every panel goes
  back to how it was (shown or not, place, collapsed).
- Esc stops a tour at any time. While recording a clip only Stop is shown.

Source: `src/app/ui/tour-overlay.ts`.
