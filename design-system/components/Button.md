# Button

Button is the one push control: a compact dark pill-ish box (`.btn`) with `on`, `primary`, `danger` and `cur` variants.

## Use

- `<button class="btn">` for every command in a panel. Labels are short verbs in sentence case ("Save", "Unload", "Clear all").
- `.btn.primary` (accent fill, 600 weight) for the one action that finishes a flow (Apply, Save). At most one per panel row.
- `.btn.on` for a toggle that is currently active: same fill as primary, normal weight.
- `.btn.cur` marks the current choice in a set of buttons without filling it: accent border only.
- `.btn.danger` (`danger-fill` / `danger-line`) for destructive commands; the label stays `text`.
- Disabled buttons drop to 45% opacity and stop reacting to hover.

## Consumer provides

The label (or a glyph with a `title` / `aria-label`), the click handler, and `disabled` when the command does not apply.

## Don't

- Don't put plain `text` on an accent fill: accent fills always pair with `accent-ink`.
- Don't add icons inside buttons as decoration; tool icons belong on the palette.

Source: `src/styles.scss (.btn)`.
