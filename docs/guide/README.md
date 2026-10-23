<!-- Written by tools/build-guide.mjs from src/app/core/tour.ts: edit the tour, then run the script. -->

# A Bando guide

The app plays these as animated tours on the real interface: open **Guide me** (shown on the first visit, then from Views). Every step is also a short clip, used in these pages, in the hover tips (Guide me → Show tips on hover) and for articles.

## Tours

- **Full tour** (~2 min): From a new bando to a synced replay, in about three minutes. Steps: welcome, open the bandos panel, create a bando, place the area on the map, generate the 3d model, look around in 3d, select a building, change a building, draw a building, plant trees with the brush, place a block from the library, edit with the ai assistant, load a flight log, load the flight video, sync the video with the log, replay the flight, where to go next.
- **Build a bando** (~1 min): Find the place, generate the model, edit it. Steps: open the bandos panel, create a bando, place the area on the map, generate the 3d model, look around in 3d, select a building, change a building, draw a building, plant trees with the brush, place a block from the library.
- **Fly and sync** (~1 min): Load a flight and its video, sync them, replay. Steps: load a flight log, load the flight video, sync the video with the log, replay the flight.

## Sections

- [Getting started](01-start.md)
- [Bandos and the map](02-bandos.md)
- [Editing the model](03-model.md)
- [The AI assistant](04-ai.md)
- [Flights, video and sync](05-flight.md)

## Recording clips

1. Run the app (`npm start`); the flight steps use the demo flight in `public/guide-demo/`.
2. Guide me → ⏺ next to a step: the browser asks to share the tab, the step plays, `<step>.webm` is downloaded.
3. Save it as `docs/guide/clips/<step>.webm` (or convert: `ffmpeg -i step.webm -vf "fps=12,scale=720:-1" step.gif`) and run `node tools/build-guide.mjs`: the pages embed it.
