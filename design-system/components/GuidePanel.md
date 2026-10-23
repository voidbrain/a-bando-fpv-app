# GuidePanel

"Guide me": the guided tours and every step on its own. A `Panel` (`tools` group in Views), opened from Welcome or Views.

## Use

- Sections fold like the Views panel's (a chevron and an uppercase `dim` title; closed ones are remembered, Reset UI
  opens them). Tours first, as bordered rows: title, `~n min` in `mono` `dim`, a one-line `dim` description, and one
  primary `▶ Play` button.
- Then one section per part of the app, a row per step: its title and a small `▶` button with an `aria-label`. Then
  the "Show tips on hover" checkbox (the same as the `?` in every panel's title bar).
- Buttons are disabled while a tour plays. A closing `dim` line says the tour works on a copy and that Esc stops it.

## Voice

Step titles are short imperatives ("Draw a building", "Sync the video with the log"); captions are one or two sentences
that say what happens and why, in the field-manual voice of the rest of the app.

Source: `src/app/ui/panels/guide-panel.ts` (data: `src/app/core/tour.ts`).
