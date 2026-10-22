# ToolPalette

ToolPalette is the editor's vertical tool strip: one 32px icon button per tool group, with a flyout for the group's other tools.

## Use

- Each tool has its own colour (`tool-*`), shown as a 6px dot in the button's corner and as the active border. Never reuse a tool colour for another tool or for the area frame.
- The palette shows ONE button per group (the active tool, else the last used); a `dim` corner triangle (`.tri`) says more tools are in the flyout (long press, right click or the triangle).
- Active: `wash-on` fill and a border in the tool colour. Hover: `wash-hover`.
- `.psep` hairlines separate outdoor, indoor and measuring groups.
- Icons are 20px outlines on a 24 grid, stroke 1.7, round caps, in `currentColor` (see the Icons assets).

## Consumer provides

The tool list (id, icon, name, colour, hint, group), the active tool, and a `title` on each button with the tool's name and hint.

Source: `src/app/ui/studio/bando-editor.ts (.palette, .pbtn, .fly), tool-icon.ts`.
