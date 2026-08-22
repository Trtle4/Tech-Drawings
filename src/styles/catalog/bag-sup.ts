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
  //
  // A stand-up pouch is NOT a wrap-formed tube: front and back are two
  // panels pinched at two FIXED side seals, not a continuous web wrapped
  // around a girth. The lofted engine's default x -> girth-fraction t
  // mapping assumes the latter (one continuous slice of x per round face);
  // front_panel and back_panel instead sit at the SAME flat x range,
  // stacked in y, so `faceAngularSpan` gives each its own half of the loop
  // explicitly: front traces t = 0 -> 0.5 through the front pole, back
  // traces t = 1 -> 0.5 (the reversed order walks the loop's OTHER half)
  // through the back pole — both ends land on the SAME two physical pinch
  // points, +/-W/2, by construction of the `lens` family itself.
  //
  // `halfWidth` is explicit ('W/2') at every station, never derived — the
  // pinch points are a FIXED physical width, not girth-constrained the way
  // a crimp band is. Depth is greatest near the base (where the gusset
  // welds on) and tapers to near zero at the top seal, with a shoulder
  // station holding it near-full for most of each panel's own height and
  // only cinching in over the last 15%, the same reasoning as the pillow's
  // own shoulder stations — a smooth two-station taper reads as a wedge,
  // not a bag that stands mostly full and only narrows at the seal.
  //
  // gusset_front/gusset_back are not swept along the loft at all — each
  // opens into a flat oval welded to the wall's own rim at the base
  // (baseFaceRoles), sharing that wall's own faceAngularSpan so the base's
  // opened edge is read directly off the SAME surfaceAt formula the wall
  // uses, guaranteeing an exact weld rather than a re-derived approximation.
  formedShape: {
    kind: 'lofted_profile',
    faceRoles: ['front_panel', 'back_panel'],
    flapFaceRoles: ['front_seal_left', 'front_seal_right', 'back_seal_left', 'back_seal_right'],
    baseFaceRoles: ['gusset_front', 'gusset_back'],
    sealStyle: 'fin',
    faceAngularSpan: {
      front_panel: [0, 0.5],
      back_panel: [1, 0.5],
      gusset_front: [0, 0.5],
      gusset_back: [1, 0.5],
    },
    // Both side seals sit at the SAME two physical pinch points regardless
    // of which panel's own flat x-range they're read from.
    flapAttachT: {
      front_seal_left: 0,
      back_seal_left: 1,
      front_seal_right: 0.5,
      back_seal_right: 0.5,
    },
    // The assembled pouch's own length axis: world y = 0 at the base
    // (matching a standing pouch — base on the table, seal on top), world
    // y = L at the top seal. Neither panel's own flat y already reads that
    // way, so both need a remap ([world y at the face's own min flat-y,
    // world y at its own max flat-y]):
    // back_panel is flat y 0..L, with 0 its own top-seal edge and L its own
    // base-adjacent edge — the reverse of the assembled axis, so reflected.
    // front_panel is flat y GUSSET_HI..TOP, with GUSSET_HI its own
    // base-adjacent edge and TOP its own top-seal edge — already increasing
    // in the assembled direction, so a plain shift (GUSSET_HI -> 0).
    // The two side-seal pairs ride along with whichever panel they're
    // flat-pattern-adjacent to.
    faceWorldY: {
      back_panel: ['L', '0'],
      back_seal_left: ['L', '0'],
      back_seal_right: ['L', '0'],
      front_panel: ['0', 'L'],
      front_seal_left: ['0', 'L'],
      front_seal_right: ['0', 'L'],
    },
    baseWeldY: {
      // Each panel's own edge nearest the gusset in the FLAT pattern (see
      // the file header: back_panel is y 0..L, front_panel is y L+2G..2L+2G)
      // — back's is its max, front's is its min. Loft-space (flat-y domain):
      // which station's rim shape the base reads, not where it ends up.
      gusset_back: 'L',
      gusset_front: GUSSET_HI,
    },
    // Both halves of the base collapse onto the SAME assembled y as the
    // walls' own base-adjacent edge, 0.
    baseWorldY: { gusset_back: '0', gusset_front: '0' },
    stations: [
      { y: '0', halfWidth: 'W/2', halfDepth: 'max(caliper, G*0.06)', profile: { family: 'lens' } },
      { y: 'L*0.15', halfWidth: 'W/2', halfDepth: 'G*0.85', profile: { family: 'lens' } },
      { y: 'L', halfWidth: 'W/2', halfDepth: 'G', profile: { family: 'lens' } },
      { y: GUSSET_HI, halfWidth: 'W/2', halfDepth: 'G', profile: { family: 'lens' } },
      { y: `${GUSSET_HI} + L*0.85`, halfWidth: 'W/2', halfDepth: 'G*0.85', profile: { family: 'lens' } },
      { y: TOP, halfWidth: 'W/2', halfDepth: 'max(caliper, G*0.06)', profile: { family: 'lens' } },
    ],
    fill: '0.75',
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
