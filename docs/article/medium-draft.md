<!-- Draft for Medium. Media are the guide's own clips (docs/guide/clips/*.webm, `npm run clips`); Medium takes GIFs:
     ffmpeg -i step.webm -vf "fps=12,scale=720:-1" step.gif -->

# OpenBando: build your bando in 3D, then fly it

*Build, Fly, Share: a free browser app that turns an abandoned place into a 3D model you can edit, fly through and
replay your real flights in.*

<!-- Cover: docs/guide/clips/look-3d.webm (or a still of Chiari e Forti in the 3D view) -->

OpenBando runs in the browser: no install, no account. Everything you make stays on your computer until you export it.
This article walks through building a bando from scratch, the way you would on a free evening before a session.

## 1. Create the bando and find the place

Open the **Bandos** panel and press **＋ New bando**. A map opens with a dashed frame on it.

- Type the place in the search box, or paste its coordinates (`45.6469, 12.3002`, or `45°38'49"N 12°18'01"E`
  straight from Google Maps), and press **Go**.
- Pan the map until the frame sits on the place. Drag the frame's edges and corners to size it: the size is written
  under it in metres. Turn it with the yellow knob if the buildings run at an angle.
- A long site, or two buildings far apart? **Add area** pins the frame and lets you draw another one; they are
  downloaded together.

<!-- clip: docs/guide/clips/place.webm -->

## 2. Generate the model

Press **Generate 3D**. OpenBando downloads, from OpenStreetMap, every building footprint, road, tree row and water
inside the frame, and the real ground heights from the free worldwide elevation tiles, then builds the model. A
factory block of 300 × 300 m takes a few seconds.

The result is drawn over the map, in true position, on the **2 · Model** tab. The map can be the street map or the
satellite picture, at any opacity; **3D** switches to an orbit view of the whole bando, and the satellite picture can
be laid on the 3D ground too, which is the quickest way to see what OpenStreetMap got wrong.

<!-- clip: docs/guide/clips/generate.webm -->

## 3. Make it look like the real place

OpenStreetMap knows footprints, not ruins. This is where the bando becomes yours. The tools sit in a palette on the
left, one button per group; the options of the active tool appear next to it.

**Buildings.** Select one and the inspector shows its length, width, rotation, wall height, floors and roof. Drag it to
move it, pull its corners to resize it, turn it with its knob; with the magnet on, it snaps flush to its neighbours.
**Cut** takes a notch out (U, L and H shapes), **Wing** adds one, **Merge** joins two buildings into one outline.

- *Floors and roofs*: add floors (G, L1, L2…), choose a gable, a barrel vault, a flat roof or none.
- *Façades*: the Modules section repeats doors, windows and panels along a wall, so a 60 m shed gets its twelve bays
  in one click.
- *Indoors*: **Edit indoors** takes the roof off and lets you draw interior walls, doors, windows, holes in the floor,
  columns and stairs, floor by floor. Columns snap to each other and can be copied as a row or a grid.
- *Ruins*: set a building to 40 % ruined and its roof gets holes you can fly through; past 60 % the roof is gone and
  the walls lose their top along a broken line. One wall can be more ruined than the others; battlements are a tick
  box.

**Structures and the library.** Water towers, sign towers, chimneys, silos, cranes, containers, bridges, race gates and
a caged roof ladder are ready-made blocks: open the **Library**, pick one, click the map. A block placed on a
building belongs to it and moves with it.

<!-- clip: docs/guide/clips/library.webm -->

**The ground.** The terrain is real, and you can sculpt it the way Populous did: hold the left button to raise the
ground, the right one to lower it, longer for higher and wider. Ramps, hills, craters, flattening and smoothing are
brushes of their own; a ramp shows its slope while you draw it. **Tunnel** digs a culvert or an underground room that
opens where the ground cuts it.

**Roads, water, trees.** Roads, surfaces (asphalt, gravel, rubble…) and water are outlines you can reshape point by
point; a canal is drawn as a line with a width. The tree brush plants along a stroke or fills a square, a circle or a
hand-drawn area, broadleaf, conifer or mixed.

**Exact positions.** Surveyed a ladder or a corner on site? Right-click it → *Move to coordinates…* and paste the
point. The **Measure** tool chains distances and shows the angles between them, snapping to corners and columns.

**The AI assistant.** Select a building and write what you want: "a door in the middle of the north wall, and eight
windows on the east side". The assistant turns it into the same edits the tools make, and the review list shows what
actually changed, with Undo one click away. It can run on a model in your browser or on your own server (Ollama, LM
Studio); nothing is sent anywhere you did not choose.

Every change is one Undo step, and **Save** keeps the bando in the browser.

## 4. Fly it

Your real flights go back into the model. Drop a Betaflight Blackbox log (or a GPX, or JSON) on the page: the flight
appears as a path through the bando, coloured by speed. Load the DVR of the same flight and press **Auto-sync**: the
app matches how the picture moves with the gyro in the log. Press play and the drone flies its real line, with the
video, the sticks, the motors, the attitude and four cameras (chase, FPV, top, orbit) in step. Two pins (start and
end) fix the GPS drift.

No flight yet? Plug in your radio (USB joystick mode) and fly the bando in the simulator, with collisions.

<!-- clip: docs/guide/clips/replay.webm -->

## 5. Share it, or keep the place to yourself

**Export** writes the bando as a file. **Export hidden** writes a copy without its place: no coordinates, no map, no
street names, its ground carried inside the file. Whoever opens it gets the model and can replay their own flights on
it (they start on the take-off pad), but cannot find the place. A hidden bando stays hidden: exporting it again can
never put the address back.

**Back up all** saves every bando and your own blocks in one file, and the replay can be rendered as an MP4 at 1080p
or 4K.

## Try it

Open OpenBando, close the welcome screen, and open **Chiari e Forti** from the examples: an old oil factory on the
river Sile with its battlemented mill tower. Or play the welcome tour from the welcome screen.

OpenBando is open source. Build your bando, fly it, and share it only with the people who should know where it is.

---

*Map data © OpenStreetMap contributors (ODbL). Elevation: AWS Terrain Tiles. Satellite imagery © Esri, Maxar.*
