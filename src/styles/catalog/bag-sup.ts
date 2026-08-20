import type { ExtraLineSpec, StyleDefinition } from '../schema.js';

/**
 * Stand-up pouch (doypack) — bottom gusset, built WITHOUT the grid.
 *
 * A single web: back panel, a W-fold bottom gusset, front panel. Side seals
 * down both edges. The blank is NOT a rectangle — its sides notch inward
 * through the gusset region, which is what gives a doypack blank its
 * hourglass pinch and what stops the grid from expressing it.
 *
 *   y 0 .. L            back panel   (bottom of the 2D layout)
 *   y L .. L+G          gusset, back half
 *   y L+G .. L+2G       gusset, front half   (y = L+G is the pouch's bottom)
 *   y L+2G .. 2L+2G     front panel   (top of the 2D layout)
 *
 * Front on top, back on bottom is a layout choice, not a physical one — either
 * panel could sit at either end of the web. It is set by which region a face
 * seed names "front_panel" versus "back_panel"; the y-formulas themselves
 * don't change, only which name attaches to which end.
 *
 * Deliberately gridless. Two things force it:
 *
 *  1. The pinch is a notch on the outline, straight-sided here (see below), but
 *     still not a track a single grid column could describe.
 *  2. The gusset halves span the pinched width while the panels span the full
 *     width, so the vertical side-seal creases stop at the gusset rather than
 *     running the height of the blank. Grid boundaries run the whole track.
 *
 * PINCH IS STRAIGHT, NOT AN ARC. Two straight segments per side meet at an
 * explicit vertex at the gusset's centre line, chamfering the corner rather
 * than rounding it. `arcThrough` and the rest of the arc pipeline are untouched
 * — peg holes, tear notches and radiused corners still need it — this is a
 * choice for this style's outline only. The shared-vertex rule still applies:
 * the gusset's centre fold terminates exactly on the pinch vertex, and a
 * shared vertex welds exactly where a tangent point would not.
 *
 * ON FOLDING. It folds to LAY-FLAT: 180° at each of the three horizontal folds
 * puts the back panel exactly on the front with the gusset W-folded between,
 * and the side seals stay in plane at 0°. Extents are (W+2S) × L × 0. Wrap-free
 * (this is a flat bag, not a tube), so 'y' up is a layout choice matching a
 * standing pouch's length, not a consequence of any fold preserving it.
 *
 * The FORMED standing pouch is not this rigid fold at all — see formedShape.
 */

const pt = (x: string, y: string) => ({ x, y });

/** Straight cut along the outline. */
const cut = (role: string, a: [string, string], b: [string, string]): ExtraLineSpec => ({
  type: 'cut',
  role,
  points: [pt(a[0], a[1]), pt(b[0], b[1])],
});

/** Fold line. `angle` in degrees; 0 means it creases but does not fold. */
const fold = (
  role: string,
  a: [string, string],
  b: [string, string],
  angle: string,
): ExtraLineSpec => ({
  type: 'crease',
  role,
  points: [pt(a[0], a[1]), pt(b[0], b[1])],
  angle,
});

// Blank extents, as expressions.
const RIGHT = 'W + 2*S';
const TOP = '2*L + 2*G';
const GUSSET_LO = 'L';
const GUSSET_MID = 'L + G';
const GUSSET_HI = 'L + 2*G';

export const bagSup: StyleDefinition = {
  id: 'bag.sup',
  name: 'Stand-Up Pouch',
  family: 'bag',
  description:
    'Doypack with a W-fold bottom gusset and a straight-chamfered pinch through the gusset.',

  // A layout choice (see file header), not a consequence of any fold.
  upAxis: 'y',

  params: [
    {
      id: 'W',
      label: 'Pouch width',
      group: 'internal',
      unit: 'mm',
      default: 140,
      min: 30,
      step: 1,
      hint: 'Between the side seals.',
    },
    {
      id: 'L',
      label: 'Panel height',
      group: 'internal',
      unit: 'mm',
      default: 200,
      min: 40,
      step: 1,
      hint: 'Front and back panel height above the gusset.',
    },
    {
      id: 'G',
      label: 'Gusset half-depth',
      group: 'internal',
      unit: 'mm',
      default: 35,
      min: 8,
      step: 1,
      hint: 'Half the flat gusset; the blank carries 2G of gusset material.',
    },
    {
      id: 'caliper',
      label: 'Film gauge',
      group: 'material',
      unit: 'mm',
      default: 0.12,
      min: 0.01,
      max: 0.5,
      step: 0.005,
    },
    {
      id: 'S',
      label: 'Side seal',
      group: 'allowance',
      unit: 'mm',
      default: 10,
      min: 4,
      step: 0.5,
      hint: 'Sealed strip down each edge.',
    },
    {
      id: 'pinch',
      label: 'Gusset pinch',
      group: 'allowance',
      unit: 'mm',
      default: 8,
      min: 0,
      // Never narrower than the side seals, or the seal would be cut away.
      max: 'S - 1',
      step: 0.5,
      hint: 'How far each side chamfers in at the gusset. Bounded by the side seal.',
    },
  ],

  extraLines: [
    // ---- outline, counter-clockwise from the bottom-left ----
    cut('blank.bottom_edge', ['0', '0'], [RIGHT, '0']),
    cut('blank.right_edge_lower', [RIGHT, '0'], [RIGHT, GUSSET_LO]),
    // The pinch: two straight segments meeting at an explicit vertex on the
    // gusset centre line, not one curve with its narrowest point at a tangent.
    // The gusset fold terminates on that vertex — a shared vertex welds
    // exactly, where a tangent point would leave a hairline gap.
    cut('blank.right_pinch_lower', [RIGHT, GUSSET_LO], [`${RIGHT} - pinch`, GUSSET_MID]),
    cut('blank.right_pinch_upper', [`${RIGHT} - pinch`, GUSSET_MID], [RIGHT, GUSSET_HI]),
    cut('blank.right_edge_upper', [RIGHT, GUSSET_HI], [RIGHT, TOP]),
    cut('blank.top_edge', [RIGHT, TOP], ['0', TOP]),
    cut('blank.left_edge_upper', ['0', TOP], ['0', GUSSET_HI]),
    cut('blank.left_pinch_upper', ['0', GUSSET_HI], ['pinch', GUSSET_MID]),
    cut('blank.left_pinch_lower', ['pinch', GUSSET_MID], ['0', GUSSET_LO]),
    cut('blank.left_edge_lower', ['0', GUSSET_LO], ['0', '0']),

    // ---- gusset folds, full width where the blank is full width ----
    fold('fold.back_to_gusset', ['0', GUSSET_LO], [RIGHT, GUSSET_LO], '180'),
    fold('fold.gusset_to_front', ['0', GUSSET_HI], [RIGHT, GUSSET_HI], '180'),
    // The pouch's bottom. Spans only the pinched width.
    fold('fold.gusset_centre', ['pinch', GUSSET_MID], [`${RIGHT} - pinch`, GUSSET_MID], '180'),

    // ---- side seal folds, stopping at the gusset ----
    fold('fold.side_left_back', ['S', '0'], ['S', GUSSET_LO], '0'),
    fold('fold.side_right_back', [`S + W`, '0'], [`S + W`, GUSSET_LO], '0'),
    fold('fold.side_left_front', ['S', GUSSET_HI], ['S', TOP], '0'),
    fold('fold.side_right_front', [`S + W`, GUSSET_HI], [`S + W`, TOP], '0'),
  ],

  extraSeeds: [
    // Front on top of the 2D layout, at the high-y end of the web.
    { role: 'front_panel', point: pt('S + W/2', `${GUSSET_HI} + L/2`), kind: 'panel', ply: 1 },
    { role: 'front_seal_left', point: pt('S/2', `${GUSSET_HI} + L/2`), kind: 'seal' },
    { role: 'front_seal_right', point: pt(`S + W + S/2`, `${GUSSET_HI} + L/2`), kind: 'seal' },
    { role: 'gusset_front', point: pt('S + W/2', 'L + G + G/2'), kind: 'panel' },
    { role: 'gusset_back', point: pt('S + W/2', 'L + G/2'), kind: 'panel' },
    // Back on the bottom, at the low-y end.
    { role: 'back_panel', point: pt('S + W/2', 'L/2'), kind: 'panel', ply: 0 },
    { role: 'back_seal_left', point: pt('S/2', 'L/2'), kind: 'seal' },
    { role: 'back_seal_right', point: pt(`S + W + S/2`, 'L/2'), kind: 'seal' },
  ],

  baseFaceRole: 'front_panel',

  // Declared, not consumed by the rigid fold. The formed standing pouch is a
  // separate parametric mesh entirely — see formedShape.ts.
  formedShape: {
    kind: 'gusseted_pouch',
    faceRoles: ['front_panel', 'back_panel', 'gusset_front', 'gusset_back'],
    flatFaceRoles: ['front_seal_left', 'front_seal_right', 'back_seal_left', 'back_seal_right'],
    fill: '0.75',
    params: { baseDepth: 'G' },
  },

  seals: [
    {
      id: 'bag.sup:side_left',
      kind: 'fin',
      role: 'side_seal_left',
      boundFaceRoles: ['front_seal_left', 'back_seal_left'],
      width: 'S',
      plies: 2,
    },
    {
      id: 'bag.sup:side_right',
      kind: 'fin',
      role: 'side_seal_right',
      boundFaceRoles: ['front_seal_right', 'back_seal_right'],
      width: 'S',
      plies: 2,
    },
    {
      id: 'bag.sup:gusset',
      kind: 'fin',
      role: 'bottom_gusset_seal',
      boundFaceRoles: ['gusset_front', 'gusset_back'],
      width: 'pinch',
      // Four layers meet where the gusset is pinched into the side seal.
      plies: 4,
    },
  ],
};
