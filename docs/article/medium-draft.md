<!-- Draft for Medium. Clips: docs/guide/clips/*.webm (npm run clips); Medium takes GIFs: ffmpeg -i step.webm -vf "fps=12,scale=720:-1" step.gif -->

# Flying the places nobody goes anymore: building A Bando

*A browser app that turns an abandoned building into a 3D model you can fly, replay and share, without giving the place away.*

<!-- Cover: a frame from docs/guide/clips/look-3d.webm, or a still of Chiari e Forti in the 3D view -->

FPV pilots have a name for the places we love most: *bandos*. Abandoned factories, half-collapsed farm sheds, the old
oil mill by the river with no roof left. They are wonderful to fly and terrible to plan for. You arrive, look up at a
gap between two beams, and wonder whether the quad fits. You fly, and back home the video tells you what happened but
not where. And when a friend asks where it is, you hesitate, because a good bando stays good only while nobody
vandalises it.

A Bando started as a way to answer three questions: what does the place look like before I get there, where exactly
did I fly, and how do I share all of that without sharing the address.

## From a map to a model in a minute

You open a new bando, search the place (or paste its coordinates), frame the area on the map and press **Generate**.
The app asks OpenStreetMap for the buildings, roads, trees and water inside the frame, downloads the real ground
heights, and builds a 3D model in the browser.

<!-- clip: docs/guide/clips/place.webm, then generate.webm -->

OpenStreetMap knows footprints, not ruins. So the model is a starting point, and the editor is where it becomes your
bando:

- **Buildings** can be moved, resized, reshaped (cut a notch, add a wing), given floors, roofs, doors and windows.
  Indoors you draw walls, voids and columns, floor by floor.
- **Ruins are a property**, not a separate kind of building. Push a building to 40 % ruined and its roof gets holes you
  can fly through; past 60 % the roof is gone and the walls lose their upper part along a broken line, never with
  random holes lower down, because that is not how walls fall.
- **The ground** is real terrain you can sculpt: raise, lower, flatten, stamp a ramp, dig a tunnel that opens where
  the ground is cut. Roads, water and surfaces are outlines you can reshape point by point, and the satellite picture
  can be laid on the 3D ground to check the model against reality.
- **A library** of ready-made blocks (a water tower, a sign tower, a race gate, a caged roof ladder) places in one
  click, and each block can be updated when the catalogue gets a newer version.

Anything can be put at exact coordinates (right-click → *Move to coordinates…*), which is how a surveyed ladder on a
roof ends up exactly where it is.

Everything you change is an ordinary edit of one plain data file, the *spec*. The 3D view, the 2D plan, the
inspector's little preview and the collisions of the simulator are all built from it, so they never disagree.

## An assistant that edits, and does not claim

There is an AI assistant, and it is deliberately humble. You select a building and write "a door in the middle of the
north wall, and eight windows on the east side". The model answers with commands, the app runs them through the same
code the mouse tools use, and the review list shows what *actually* changed, with a link to each change and one-click
Undo. The model's own reply is only a claim; the app reports what it did.

It runs on a model in your browser, or on your own server (Ollama, LM Studio, any OpenAI-compatible endpoint).
Nothing has to leave your machine.

<!-- clip: docs/guide/clips/ai.webm -->

## Replaying a flight where it happened

Drop a Betaflight Blackbox log (or a GPX, or JSON) on the page and the flight appears as a coloured path through the
model, blue where you were slow and red where you were not. Load the video of the same flight and press
**Auto-sync**: the app measures how the picture pans and rolls and lines it up with the gyro in the log. Flips and
rolls are the best markers. Then press play: the drone flies its real path through the model, with the video in step,
the sticks, motors and attitude beside it.

<!-- clip: docs/guide/clips/sync.webm, replay.webm -->

GPS is never quite right, so two pins fix it: pin where the flight started and where it ended, and the path turns
into place. The alignment is saved with the bando.

A few things made this work on real flights rather than demos: the log is parsed off the main thread (a 30 MB
Blackbox CSV no longer freezes the page), a 4K video is scanned at a speed the browser can actually decode, and the 3D
view merges each building into one mesh per material, so a large factory draws in about a hundred calls instead of
over a thousand.

## Sharing a bando without sharing the place

This is the part I care about most. Every bando can be exported as a file. A bando can also be **hidden**: the copy
drops its coordinates, the map area, the GPS landmarks, the pilot's alignment and every name that came from the map
(street names give a place away faster than coordinates). Its real ground travels inside the file, since nobody could
download it again without knowing where it is.

Open a hidden bando and there is no map under it, just the model. Load your own flight on it and the app puts its
start on the take-off pad; the pins and the compass do the rest. A hidden bando stays hidden: exporting it again can
never put a place back.

The app ships with two examples: Chiari e Forti, an old oil factory on the river Sile with its battlemented mill
tower, in public; and Villetta, shared without its place.

## Learning it by watching it

The app has a guide that plays on the real interface: a drawn cursor moves, clicks and drags, and a caption next to
the action says what happens. Every step plays on its own, and every step is also a short clip, recorded by a script
that plays the same steps in a headless browser. The same script checks, on every pull request, that each step still
works and that the main screens pass the accessibility checks.

## What is next

National elevation models would give sharper ground than the free worldwide tiles. A shared library where any pilot
can publish blocks and bandos needs accounts and moderation, and a careful answer to the question this whole app is
built around: what should travel with a place, and what should not.

A Bando is open source. Fly safe, leave the place as you found it, and keep the good ones to yourself.

---

*Built with Angular, Three.js and OpenStreetMap data (© OpenStreetMap contributors, ODbL). Elevation from the AWS
Terrain Tiles.*
