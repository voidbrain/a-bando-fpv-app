# Panel

Panel is the app's floating window: a translucent `panel` box with a draggable title bar, collapse (▾) and transparent (◐) buttons, and projected content.

## Use

- Every tool of the app lives in a panel (Studio, Flights, Radio, Timeline...). The title is one or two words, set in `panel-title` (uppercase).
- Fill `panel` over `backdrop-filter: blur(6px)`, border `line`, `radius`, `shadow-panel`; body padding `space-8`.
- Collapsed (`.min`): only the title bar shows. Ghost: background and border go; only content marked `.keep` stays.
- Resizable panels add a bottom-left grip of two `dim` diagonal hairlines.

## Consumer provides

The title, the content, and (in the app) an id in `PANEL_BY_ID` with its anchor and default size. Position and size are remembered by `LayoutStore`.

Source: `src/app/ui/panel/panel.ts`.
