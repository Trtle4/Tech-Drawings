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

## What the grid does not cover

Honest about the limits, since the point is whether the rest of the catalogue is
data:

- **Covers well** — FEFCO 02xx slotted cases, 03xx slotted trays, most ECMA A/B
  straight-tuck and reverse-tuck cartons. These blanks genuinely are grids.
- **Needs `extraLines`** — dust flaps with angled edges, tuck tongues, locking
  slits, hex and round corners. The hook exists and takes expressions, but each
  such style writes its own points rather than getting them from the grid.
- **Not yet expressible** — non-rectangular cells (a trapezoidal tray wall),
  and cells whose size depends on a neighbour's fold angle. Both are additive:
  a `shape` field on `CellSpec` and a solved-dimension pass, neither of which
  changes what exists.

The bags are the real test of that boundary and are next in the build order.

## Out of scope, as before

Nothing here consumes seals or features yet, and the override layer is still
designed-for rather than built: `sourceStyle` on every generated line
distinguishes template output from `'user'`, which is what regeneration will
key on.
