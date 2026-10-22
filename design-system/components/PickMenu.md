# PickMenu

PickMenu is a select with a picture for every choice: structure kinds, tree species, fence materials, brush and column
shapes.

## Use

- `<app-pick-menu label="Material" [options]="…" [value]="…" (valueChange)="…" />`. The button shows the current
  picture and name and a `dim` ▾; the list shows every option with its picture, its name and an optional `dim` hint.
- Pictures are tool-icon keys (`tool-icon.ts`), the same 24-grid outlines as the palette. A new kind of thing gets an
  icon there, never an emoji.
- Use it for choosing between kinds of things. For two or three words (Box / Lasso) a `.seg` is enough; for numbers use
  inputs.
- The list is the menu layer (`z-index` 1300) on `panel-solid`, `radius-menu`, `shadow-menu`; the current option has an
  `accent` border, the one under the pointer or keyboard a `wash-menu` fill.

## Accessibility

A select-only combobox: the button has `aria-haspopup="listbox"` and `aria-expanded`; the list is a `listbox` with
`aria-activedescendant`. Enter, Space or the arrows open it and move the focus into the list; arrows, Home and End move;
Enter or Space picks; Escape closes and returns the focus to the button; Tab closes.

## Consumer provides

The options (`id`, `label`, `icon`, `hint?`), the current id and the change handler; `label` is the accessible name.
`compact` shows only the picture on the button.

Source: `src/app/ui/studio/pick-menu.ts`.
