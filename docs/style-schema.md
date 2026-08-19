# Style definition schema

Step 2 of the build order. `src/styles/`.

```
npm test              # 76 tests
npm run demo:styles   # compiles the catalogue, writes out/*.svg
```

The goal is that adding FEFCO 0203 or ECMA A20.20 is a **data task**. The
compiler (`compile.ts`) is the only code that understands the schema; a
catalogue entry is a plain object with no imperative geometry in it.

## Shape of a definition

```ts
StyleDefinition {
  id, name, family, standard?, code?, description?
  params:   ParamSpec[]        // what the user can set
  grid:     { columns, rows, cells, boundaries? }
  seals?:   SealSpec[]
  features?: FeatureSpec[]
  extraLines?, extraSeeds?     // geometry the grid cannot express
  baseFaceRole?
}
```

### Dimensions are expressions, not numbers

Every size is an `Expr` — a number, or a formula over the style's own declared
parameters, evaluated by a small parser in `expr.ts`. No `eval`, no callbacks
from the definition.

```ts
{ id: 'flap', label: 'Flap depth', default: 'W/2', min: 5 }
{ id: 'slot', label: 'Slot width', default: 'caliper' }
```

Supported: `+ - * / %`, parentheses, unary minus, and
`min max abs round floor ceil sqrt`. Unknown identifiers throw rather than
yielding `NaN`, so a typo in a definition fails loudly. Defaults may reference
other parameters in any order — resolution repeats until it stops making
progress, then reports circular references instead of hanging.

### The grid

A blank is columns × rows. Each cell is present (a face) or absent (air).

```
FEFCO 0201:

  columns   glue(35) | back(L) | left(W) | front(L) | right(W)
  rows      flap_top    (W/2)
            body        (H)
            flap_bottom (W/2)
```

The boundary between two present cells is a **90° crease by default**. A
definition only states its exceptions, which is what keeps entries short — the
entire RSC needs exactly one:

```ts
boundaries: [
  { axis: 'v', within: ['flap_bottom', 'flap_top'], kind: 'slot', width: 'slot' },
]
```

Boundary kinds: `crease` `score` `perf` (fold + hinge), `cut` (a slit — board
both sides, nothing removed), `slot` (a real punched gap of `width`, which
insets both neighbours and closes itself with a knife cut wherever there is
board beyond its end), and `none` (no line; the cells merge into one face).

Slots and slits both work because of the closing-cut rule in the geometry core
— a zero-width slot is exactly the locking-tab case, and the RSC still resolves
to 13 faces with `slot: 0`.

### What the schema carries from day one

| carried | consumed in v1 |
| --- | --- |
| line objects with `type` and `role` | yes |
| `faceSeeds`, one per cell, at its centre | yes |
| default hinge angle per crease, by line role | yes |
| derived flat blank size | yes |
| `SealZone` | no — carried, unread |
| `FeatureInstance` | no — carried, unread |

Fold angles are keyed by **crease line role**, not by hinge, because hinges are
discovered by face detection and do not exist when a style is generated.
`resolveGeometry` applies them weakest-first: the 90° a hinge is born with, then
the style's angle for that role, then any user override.

Blank size is reported twice on purpose — `compiled.blank` from the grid, and
`blankSize(resolved)` from the geometry that came out. A definition whose
geometry does not fill the grid it declared shows up as a mismatch.

## FEFCO 0201

`catalog/fefco0201.ts` — 7 parameters, 5 columns, 3 rows, 13 cells, 1 boundary
override, 1 seal. No geometry code.

Validated against the hand-drawn blank from step 1: **same 13 faces, same 12
hinges, same board area, and the same multiset of face areas.** Both fold to a
box of exactly 200 × 150 × 250 mm.

Parametric across the range, each folding to the dimensions it was generated
from:

| L × W × H | caliper | blank | board |
| --- | --- | --- | --- |
| 200 × 150 × 250 | 3.0 | 735 × 400 | 287 400 mm² |
| 400 × 300 × 120 | 5.0 | 1435 × 420 | 587 700 mm² |
| 80 × 80 × 400 | 1.5 | 355 × 480 | 167 240 mm² |

Out-of-range input clamps and warns rather than blanking the drawing.

## The grid is a convenience layer, not the model

`grid` is optional. A style may emit `extraLines` and `extraSeeds` directly and
never touch it — `proof-tapered-tray.ts` does exactly that, and is kept in the
tests for no other reason. It has trapezoid faces, 62° folds and an arc edge,
and it resolves and folds clean.

Both paths converge on the same `GeometryGraph`, and nothing downstream knows
which produced it. The test suite pins this: every style, grid or not, is
resolved at six rotations and must return the same faces, the same hinges, the
same areas and a congruent folded solid. The grid itself is axis-aligned by
construction — that is what a grid is — but face detection, hinge extraction and
the fold traversal are not.

### Arcs

Curved edges survive the whole pipeline. `arcThrough` takes two endpoints and a
sagitta, which is how a curved edge is actually dimensioned, and solves the
centre; a zero bulge degrades to a straight line rather than erroring. Arcs stay
arcs on the line object for DXF and dimensioning, and flatten only for topology.

## What the grid does not cover

Honest about the limits, since the point is whether the rest of the catalogue is
data:

- **Covers well** — FEFCO 02xx slotted cases, 03xx slotted trays, most ECMA A/B
  straight-tuck and reverse-tuck cartons.
- **Needed one extension** — the seal end carton's minor flaps are shorter than
  its major flaps while sharing a flap row, so `CellSpec.inset` shrinks a cell
  from named sides of its uniform track. Inset from the free edge, never the
  fold edge, or the crease leaves the track boundary its neighbour expects.
- **Goes through `extraLines`** — anything not a rectangle: curved gussets,
  tapered walls, tuck tongues, angled dust flaps. This is a supported path, not
  a fallback.
- **Not expressible at all** — a dimension solved from another fold's angle.
  The FEFCO 0300 corner tabs are the live example: creased at a fixed 90°, which
  is right only while the walls are square. Splay them and the tabs swing wide,
  because the correct angle is the dihedral between two splayed walls. That is
  constraint solving, explicitly out of scope for v1.

### How the bags landed

The pillow and the gusseted bag are grids and needed nothing new. The SUP is
gridless, and two things force it: the pinch is an arc pair on the outline, and
the gusset halves span the pinched width while the panels span the full width,
so the side-seal creases stop at the gusset rather than running the track. Both
are things a grid track cannot do.

Writing the SUP found one trap worth recording. Its gusset fold first
terminated on the *tangent point* of a single pinch arc. Flattened chords fall
just inside the true arc, so the fold landed a hair outside the material and
the face count silently dropped — and it passed or failed depending on the
sagitta, because whether a chord vertex happened to land on the apex is luck.
The fix is to make the narrowest point an explicit vertex where two arcs meet:
a shared vertex welds exactly, a tangency does not. Any style terminating a
line on a curve should do the same.

### Bags do not fold

A bag has no rigid folded state. All three fold to LAY-FLAT, which is real and
checkable — the pillow and gusseted bags to W x L x fin, the SUP to
(W + 2S) x L x 0. The formed, filled shape is a soft-body forming problem the
fold traversal does not model and v1 does not attempt. The 3D pane will show a
flat bag; that is a known limit, not a defect.

## Out of scope, as before

Nothing here consumes seals or features yet, and the override layer is still
designed-for rather than built: `sourceStyle` on every generated line
distinguishes template output from `'user'`, which is what regeneration will
key on.
