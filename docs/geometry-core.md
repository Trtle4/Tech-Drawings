# Geometry core

Step 1 of the build order: the geometry graph, line objects, face detection and
the hinge graph. No UI yet.

```
npm test            # 38 tests over four blanks
npm run demo:faces  # prints the resolve report and writes out/*.svg
```

## The one graph

`GeometryGraph` (`src/geometry/types.ts`) is the only representation. The 2D
canvas will draw its lines; the 3D viewer will fold the faces resolved from it;
every exporter reads it. There is no parallel 3D model to keep in sync.

`resolveGeometry(graph)` (`src/geometry/resolve.ts`) is the single pass both
views consume:

```
lines ──▶ arrangement ──▶ faces ──▶ hinges ──▶ fold tree
          (split, weld,   (planar   (crease   (spanning tree
           half-edges)     regions)  pairs)    from base face)
```

## How faces are found

`detectFaces` never consults the style library. Folding is decided by the
geometry alone, so a hand-drawn rectangle with two creases resolves exactly like
a generated RSC.

1. **Arrangement.** Every structural segment is split at every crossing and
   T-junction, endpoints within 0.1 µm weld into one vertex, and duplicate edges
   merge with the strongest line type winning. Arcs flatten under a 0.05 mm
   chord tolerance for topology but stay arcs in the line objects, so DXF export
   and dimensioning remain exact.
2. **Half-edges.** `next(e)` is the half-edge out of `head(e)` that immediately
   precedes `twin(e)` in counter-clockwise order — the sharpest right turn. That
   rule traces bounded regions counter-clockwise (positive area) and the outer
   boundary of each component clockwise, with no special-casing for winding
   direction of the input.
3. **Material test.** A positive region is board if a ray from a point inside it
   crosses **cut** segments an odd number of times. Cut lines are the only thing
   that defines material, which is what makes the peg hole disappear and the
   closed crease loop survive, without either being recognised as such.
4. **Hole rings.** A clockwise cycle with material just outside it is an inner
   ring of the smallest face containing it. Its area is subtracted, and its
   edges are registered against the owning face — otherwise a die-cut window or
   a crease loop looks like it borders only one face and can never hinge.

## Hinges

Every crease, score or perf separating exactly two faces becomes a `Hinge` with
its own `angle`, defaulting to 90°. Edges are grouped by (face pair, originating
line), so a crease chopped into pieces by geometry crossing it still folds as
one hinge with one angle, and two parallel creases between the same faces stay
separate.

A hinge whose merged segments are not collinear has no rigid fold axis. It is
still created and still folds approximately, but `collinear` is false and it is
reported — the closed crease loop in the awkward fixture is exactly this case.

Folding is a breadth-first traversal from the base face. Hinges outside the
spanning tree close a loop and are recorded in `closingHinges` rather than
applied. `foldTransforms(resolved, ratio)` drives the fold slider: 0 is flat, 1
puts every hinge at its own angle.

## Naming faces

Face detection assigns positional ids (`face.1`…). Names come from `faceSeeds` —
a point inside each panel, emitted by the style. Bounding line names cannot
identify a face, because a fold line borders two panels at once; an earlier
majority-vote heuristic labelled an RSC body panel `slot_1`, which is why it is
gone. A seed keeps naming the right panel across resizes and edits, and a seed
that lands on no face is reported rather than dropped.

## Nothing throws

Anything unresolvable lands in `resolved.unresolved` with a reason and a
message, for the "unfolded geometry" panel:

| reason | meaning |
| --- | --- |
| `dangling` | crease stops inside a panel, dividing nothing |
| `outside_blank` | structural line borders no face |
| `not_a_hinge` | crease runs along the blank edge, air on one side |
| `non_collinear_hinge` | crease between two faces is not straight |
| `unreachable_face` | face has no crease path to the base face |
| `zero_length` | line collapsed during welding |
| `degenerate_face` | region has no usable interior point, or a seed missed |

Empty graphs, open outlines, zero-length lines and exactly coincident duplicate
lines are all covered by tests.

## Validation

`rsc201` is drawn by hand as 46 raw lines — no template code, no panel
knowledge. It resolves to 13 faces and 12 hinges, and the fold traversal
produces a box measuring exactly 200 × 150 × 250 mm, the internal dimensions it
was drawn from.

## Deliberately not built yet

Types exist for `SealZone` and `FeatureInstance` so styles can carry them from
the start, but nothing consumes them yet. The `role` field on every line is
likewise unused in v1 and present so constraint-aware editing does not need a
rewrite. Out of scope for v1 and not stubbed: constraint solving, linked panel
propagation, AR, GLB import, colour management, nesting.

The override layer is designed for but not built: `sourceStyle` distinguishes
template output from `'user'` lines, and `ResolveOptions.angles` already carries
fold angles across a rebuild, keyed by hinge id or face pair.
