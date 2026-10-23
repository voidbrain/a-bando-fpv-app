<!-- Written by tools/build-guide.mjs from src/app/core/tour.ts: edit the tour, then run the script. -->

# A Bando guide

The app plays these as animated tours on the real interface: open **Guide me** (shown on the first visit, then from Views). Every step is also a short clip, used in these pages, in the hover tips (Guide me → Show tips on hover) and for articles.

## Tours

- **Full tour** (~1 min): From a new bando to a synced replay. Steps: start a bando: find the place, generate the 3d model, look around in 3d, select a building, change a building, draw a building, plant trees with the brush, place a block from the library, edit with the ai assistant, load a flight log, load the flight video, sync the video with the log, replay the flight.
- **Build a bando** (~1 min): Find the place, generate the model, edit it. Steps: start a bando: find the place, generate the 3d model, look around in 3d, select a building, change a building, draw a building, plant trees with the brush, place a block from the library.
- **Fly and sync** (~1 min): Load a flight and its video, sync them, replay. Steps: load a flight log, load the flight video, sync the video with the log, replay the flight.

## Sections

- [Bandos and the map](01-bandos.md)
- [Editing the model](02-model.md)
- [The AI assistant](03-ai.md)
- [Flights, video and sync](04-flight.md)

## Clips

`npm run clips` plays every step in a headless browser, keeps each as `docs/guide/clips/<step>.webm` and rewrites these pages to embed them (a GIF for an article: `ffmpeg -i step.webm -vf "fps=12,scale=720:-1" step.gif`).
