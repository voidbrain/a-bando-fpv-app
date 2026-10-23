# Panel

Panel is the app's floating window: a translucent `panel` box with a draggable title bar, transparent (◐), tips on hover (?, `accent` while on), collapse (▾) and close (×, not on Views, which shows the others again) buttons, and projected content.

## Use

- Every tool of the app lives in a panel (Studio, Flights, Radio, Timeline...). The title is one or two words, set in `panel-title` (uppercase).
- Fill `panel` over `backdrop-filter: blur(6px)`, border `line`, `radius`, `shadow-panel`; body padding `space-8`.
- Collapsed (`.min`): only the title bar shows. Ghost: background and border go; only content marked `.keep` stays.
- Resizable panels add a bottom-left grip of two `dim` diagonal hairlines.
- A panel that shows eases in (0.22 s, fading up 8 px; none with reduced motion).
- Panels that open at the same first place step 26 px aside (down, and right for right-anchored ones) for each one already there.
- Show / hide toggles in lists use the eye icons (`eye`, `eyeOff`, `eyeHalf` for a mixed section) from `tool-icon.ts`, `accent` when shown.

## Consumer provides

The title, the content, and (in the app) an id in `PANEL_BY_ID` with its anchor and default size. Position and size are remembered by `LayoutStore`.

Source: `src/app/ui/panel/panel.ts`.
