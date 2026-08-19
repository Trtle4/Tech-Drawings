import type { ExtraLineSpec, StyleDefinition } from '../schema.js';

/**
 * Stand-up pouch (doypack) — bottom gusset, built WITHOUT the grid.
 *
 * A single web: front panel, a W-fold bottom gusset, back panel. Side seals
 * down both edges. The blank is NOT a rectangle — its sides curve inward
 * through the gusset region, which is what gives a doypack blank its
 * hourglass pinch and what stops the grid from expressing it.
 *
 *   y 0 .. L            front panel
 *   y L .. L+G          gusset, front half
 *   y L+G .. L+2G       gusset, back half   (y = L+G is the pouch's bottom)
 *   y L+2G .. 2L+2G     back panel
 *
 * Deliberately gridless. Two things force it:
 *
 *  1. The pinch is a pair of arcs on the outline. A grid track has one width.
 *  2. The gusset halves span the pinched width while the panels span the full
 *     width, so the vertical side-seal creases stop at the gusset rather than
 *     running the height of the blank. Grid boundaries run the whole track.
 *
 * ON FOLDING. It folds to LAY-FLAT: 180° at each of the three horizontal folds
 * puts the back panel exactly on the front with the gusset W-folded between,
 * and the side seals stay in plane at 0°. Extents are (W+2S) × L × 0.
 *
 * The FORMED standing pouch is not a rigid fold — the base opens into the
 * classic doypack oval and the walls billow, which is a forming problem the
 * fold traversal does not model. v1 does not attempt it. That is a real
 * limitation of showing bags in the 3D pane, not an oversight.
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
    'Doypack with a W-fold bottom gusset and a pinched, radiused side profile through the gusset.',

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
      hint: 'How far each side curves in at the gusset. Bounded by the side seal.',
    },
  ],

  extraLines: [
    // ---- outline, counter-clockwise from the bottom-left ----
    cut('blank.bottom_edge', ['0', '0'], [RIGHT, '0']),
    cut('blank.right_edge_lower', [RIGHT, '0'], [RIGHT, GUSSET_LO]),
    // The pinch is TWO arcs meeting at an explicit vertex, not one arc with the
    // narrowest point at its tangent. The gusset fold terminates on that
    // vertex, and a shared vertex welds exactly — a tangent point does not,
    // because the flattened chords fall just inside the true arc and the fold
    // would land a hair outside the material.
    {
      type: 'cut',
      role: 'blank.right_pinch_lower',
      arcThrough: {
        from: pt(RIGHT, GUSSET_LO),
        to: pt(`${RIGHT} - pinch`, GUSSET_MID),
        sagitta: 'pinch*0.35',
      },
    },
    {
      type: 'cut',
      role: 'blank.right_pinch_upper',
      arcThrough: {
        from: pt(`${RIGHT} - pinch`, GUSSET_MID),
        to: pt(RIGHT, GUSSET_HI),
        sagitta: 'pinch*0.35',
      },
    },
    cut('blank.right_edge_upper', [RIGHT, GUSSET_HI], [RIGHT, TOP]),
    cut('blank.top_edge', [RIGHT, TOP], ['0', TOP]),
    cut('blank.left_edge_upper', ['0', TOP], ['0', GUSSET_HI]),
    {
      type: 'cut',
      role: 'blank.left_pinch_upper',
      arcThrough: {
        from: pt('0', GUSSET_HI),
        to: pt('pinch', GUSSET_MID),
        sagitta: 'pinch*0.35',
      },
    },
    {
      type: 'cut',
      role: 'blank.left_pinch_lower',
      arcThrough: {
        from: pt('pinch', GUSSET_MID),
        to: pt('0', GUSSET_LO),
        sagitta: 'pinch*0.35',
      },
    },
    cut('blank.left_edge_lower', ['0', GUSSET_LO], ['0', '0']),

    // ---- gusset folds, full width where the blank is full width ----
    fold('fold.front_to_gusset', ['0', GUSSET_LO], [RIGHT, GUSSET_LO], '180'),
    fold('fold.gusset_to_back', ['0', GUSSET_HI], [RIGHT, GUSSET_HI], '180'),
    // The pouch's bottom. Spans only the pinched width.
    fold('fold.gusset_centre', ['pinch', GUSSET_MID], [`${RIGHT} - pinch`, GUSSET_MID], '180'),

    // ---- side seal folds, stopping at the gusset ----
    fold('fold.side_left_front', ['S', '0'], ['S', GUSSET_LO], '0'),
    fold('fold.side_right_front', [`S + W`, '0'], [`S + W`, GUSSET_LO], '0'),
    fold('fold.side_left_back', ['S', GUSSET_HI], ['S', TOP], '0'),
    fold('fold.side_right_back', [`S + W`, GUSSET_HI], [`S + W`, TOP], '0'),
  ],

  extraSeeds: [
    { role: 'front_panel', point: pt('S + W/2', 'L/2'), kind: 'panel' },
    { role: 'front_seal_left', point: pt('S/2', 'L/2'), kind: 'seal' },
    { role: 'front_seal_right', point: pt(`S + W + S/2`, 'L/2'), kind: 'seal' },
    { role: 'gusset_front', point: pt('S + W/2', 'L + G/2'), kind: 'panel' },
    { role: 'gusset_back', point: pt('S + W/2', 'L + G + G/2'), kind: 'panel' },
    { role: 'back_panel', point: pt('S + W/2', `${GUSSET_HI} + L/2`), kind: 'panel' },
    { role: 'back_seal_left', point: pt('S/2', `${GUSSET_HI} + L/2`), kind: 'seal' },
    { role: 'back_seal_right', point: pt(`S + W + S/2`, `${GUSSET_HI} + L/2`), kind: 'seal' },
  ],

  baseFaceRole: 'front_panel',

  // Declared, not consumed. The base opens from the gusset fold and the walls
  // bow out; the side seals stay flat and the panels keep their flat UVs.
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
