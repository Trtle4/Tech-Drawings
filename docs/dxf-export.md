# DXF export

`src/export/`. `npm run export:dxf` writes one file per style to `out/dxf/`.

These are files to cut. Cutting a blank and folding it validates the geometry
core physically, which is worth more than the test suite.

## What it writes

DXF **R12 (AC1009)**, millimetres, y-up, **1:1**. No transform is applied
anywhere in the exporter — the geometry model is already mm with y increasing
upward, which is the DXF convention, so "1:1" is a property of the code rather
than a claim about it.

R12 only: `LINE`, `ARC`, `CIRCLE`, `POLYLINE`/`VERTEX`/`SEQEND`, `TEXT`. No
`LWPOLYLINE` (R13+), no splines. A test asserts none of those strings appear.

| layer | carries |
| --- | --- |
| `CUT` | knife paths, including slits |
| `CREASE` | fold lines, and `score` (see below) |
| `PERF` | perforations |
| `BLEED` | artwork bleed guides |
| `DIMENSIONS` | overall blank dimensions, witness lines, arrowheads |
| `TEXT` | one panel label per resolved face |
| `TITLEBLOCK` | bordered block: style, code, blank, caliper, board, scale, date, note |

Two mappings are not one-to-one, and both are counted in the export report
rather than done silently:

- **`score` goes to `CREASE`.** The requested layer set has no SCORE layer and
  a score is a fold assist, so CREASE is the closest honest home.
- **`construction` is dropped.** Reference geometry has no business on a
  cutting table.

## Exported from the lines, not the arrangement

The exporter reads `graph.lines`, never the resolved arrangement. The
arrangement flattens arcs to chords and splits every line at its intersections
— both exactly what a table should not receive.

Three consequences, each with a test:

- **Arcs stay arcs.** The SUP pinch exports as 4 `ARC` entities. The report's
  `chordApproximated` list must be empty; if a curve ever cannot be written
  exactly it is named there rather than quietly flattened.
- **Slits still cut.** An open cut chain terminating on a crease is pruned from
  the *material boundary* — that is how a locking tab stays board — but it is
  still a knife path. The slit corner tray rebuilt from its own DXF resolves to
  the same 9 faces, which only happens if the slits are present.
- **Zero-width slots do not collapse.** With `slot: 0` the two flap walls land
  on the same line. Coincident paths are merged so the knife does not run the
  same line twice, but never to nothing: both 75 mm walls survive as one entity
  each. Their end caps, which genuinely have zero length, are dropped and
  reported — a zero-length knife path is junk.

## Verified, not eyeballed

`dxf-read.ts` is a narrow R12 reader covering exactly what the writer emits. It
exists so the export can be checked by round trip: write the file, read it back,
rebuild a geometry graph from the entities alone, resolve that, and compare.

All eight styles pass, at defaults:

- same face count, same hinge count, same unresolved items
- every face area equal to 1e-6
- **the same face roles** — seeds are carried across, so a role only matches if
  the geometry landed in exactly the same place
- board area equal to 1e-6

Styles with no arcs match the model's bounds exactly. Styles with arcs are
allowed to land outside by up to the chord tolerance, and only outside:
`blankBounds` is measured on the flattened polygon and the true arc in the DXF
contains it. That is the export being more accurate than the in-memory
approximation, not a scale error.

## Annotation is strippable

Passing `{ labels: false, dimensions: false, titleBlock: false }` leaves only
structure, and a test confirms the geometry round trip is unaffected.
