# GuidePanel

"Guide me": the guided tours and every step on its own. A `Panel` (`tools` group in Views), visible on the first visit.

## Use

- Tours first, as bordered rows: title, `~n min` in `mono` `dim`, a one-line `dim` description, and one primary
  `▶ Play` button. Then the "Show tips on hover" checkbox.
- Then one `caption` per section, and a row per step: its title, `▶` (play) and `⏺` (record a clip), small buttons.
  Icon-only buttons carry an `aria-label`.
- Buttons are disabled while a tour plays. A closing `dim` line says the tour works on a copy and that Esc stops it.

## Voice

Step titles are short imperatives ("Draw a building", "Sync the video with the log"); captions are one or two sentences
that say what happens and why, in the field-manual voice of the rest of the app.

Source: `src/app/ui/panels/guide-panel.ts` (data: `src/app/core/tour.ts`).
