# WelcomePanel

The first thing a visitor sees, over the empty world turning slowly: what OpenBando is for, and where to start. A
`Panel` (`tools` group in Views), centred across the window (`anchor.center`), about 1080 px wide.

## Use

- Head: the name **OpenBando** (26 px, 600), the tagline "Build, Fly, Share." in `accent` (18 px, 600), one `dim`
  line under it.
- Three columns, Build / Fly / Share (one column under 760 px): a bordered card (`line`, `radius`) with a 16:10 film
  (muted, looped, no controls; dimmed until its column is in focus), a 17 px title, two or three lines of text, and
  link buttons ("Open the bandos →") that open the panels for that job and close Welcome. The column under the pointer
  or the keyboard focus gets an `accent` border and plays its film.
- Footer: the primary `▶ Watch the welcome tour`, `Guide me`, and a `dim` note on privacy.
- Closing it shows Views.

## Voice

Plain and concrete, for pilots: what you do and what you get ("Drop your Blackbox log and your DVR: they sync
themselves"), no feature lists, no superlatives.

Source: `src/app/ui/panels/welcome-panel.ts` (films: `public/welcome/`, `npm run films`).
