import type { StyleDefinition } from '../schema.js';

/**
 * Block-bottom (SOS / satchel) gusseted bag — fin seal, flat box base.
 *
 * The SAME side-gusseted tube as bag-gusseted.ts — a pillow bag with a V-fold
 * gusset in each side, forming a rectangular tube W wide by D deep — but
 * closed differently at the two ends. The top is a simple crimped seal, same
 * as the gusseted bag's own top. The BOTTOM is not a crimp at all: it is a
 * flat rectangular box floor, the tube's own corners folded inward and up a
 * short distance (`bagD/2*0.5`) before the walls take over as a boxy,
 * rounded-rectangle body — the shape a paper grocery sack or a block-bottom
 * coffee bag actually has, not a pinched flat band.
 *
 *   columns   fin(F) | back½(W/2) | gusset_l_back(D/2) | gusset_l_front(D/2)
 *             | FRONT(W) |
 *             gusset_r_front(D/2) | gusset_r_back(D/2) | back½(W/2) | fin(F)
 *
 * Web = 2F + 2W + 2D, identical to the gusseted bag.
 *
 * Folds to the LAY-FLAT bag, as the gusseted bag does — 180° at every tube
 * fold so the gussets tuck flat between front and back, 90° at each fin so
 * the two fin strips stand face to face. Extents are W × L × F. The formed,
 * filled shape (flat base, boxy body, corner folds running up from the base,
 * crimped top) is out of scope for the rigid fold and lives in formedShape.
 *
 * ASSUMPTIONS TO CHECK: gusset depth D is the formed front-to-back depth, and
 * each gusset contributes D of flat material folded at its centre. The top
 * end seal counts inside the cutoff length; the base fold's own height does
 * not reduce the fill capacity (real construction glues/tucks it, using no
 * NET extra length beyond the tube's own bottom row).
 */
export const bagBlockBottom: StyleDefinition = {
  id: 'bag.block_bottom',
  name: 'Block-Bottom Bag',
  family: 'bag',
  description: 'Side-gusseted, fin-seal bag with a flat rectangular block bottom and a crimped top seal.',

  // Same reasoning as the other wrap-style bags: vertical wrap creases leave y alone.
  upAxis: 'y',

  params: [
    {
      id: 'bagW',
      label: 'Bag width',
      group: 'internal',
      unit: 'mm',
      default: 100,
      min: 20,
      step: 1,
      hint: 'Front panel width of the formed bag.',
    },
    {
      id: 'bagD',
      label: 'Gusset depth',
      group: 'internal',
      unit: 'mm',
      default: 60,
      min: 10,
      step: 1,
      hint: 'Formed front-to-back depth, and the flat base’s own depth.',
    },
    {
      id: 'bagL',
      label: 'Bag length',
      group: 'internal',
      unit: 'mm',
      default: 280,
      min: 60,
      step: 1,
      hint: 'Cutoff length, including the top end seal and the base fold.',
    },
    {
      id: 'caliper',
      label: 'Film gauge',
      group: 'material',
      unit: 'mm',
      default: 0.11,
      min: 0.01,
      max: 0.5,
      step: 0.005,
    },
    { id: 'finSeal', label: 'Fin seal', group: 'allowance', unit: 'mm', default: 10, min: 3 },
    {
      id: 'endSeal',
      label: 'Top end seal',
      group: 'allowance',
      unit: 'mm',
      default: 14,
      min: 3,
      max: 'bagL/2 - 5',
    },
  ],

  grid: {
    columns: [
      { id: 'fin_l', size: 'finSeal' },
      { id: 'back_l', size: 'bagW/2' },
      { id: 'gusset_l_back', size: 'bagD/2' },
      { id: 'gusset_l_front', size: 'bagD/2' },
      { id: 'front', size: 'bagW' },
      { id: 'gusset_r_front', size: 'bagD/2' },
      { id: 'gusset_r_back', size: 'bagD/2' },
      { id: 'back_r', size: 'bagW/2' },
      { id: 'fin_r', size: 'finSeal' },
    ],
    rows: [
      // Not a crimp band — the tube's own corner-fold zone into the flat
      // base. Sized off bagD, the natural scale for how far a real
      // block-bottom's corner fold runs up the bag.
      { id: 'end_bottom', size: 'bagD/2*0.5' },
      { id: 'body', size: 'bagL - endSeal - bagD/2*0.5' },
      { id: 'end_top', size: 'endSeal' },
    ],
    cells: [
      { row: 'body', col: 'fin_l', role: 'fin_left', kind: 'seal' },
      { row: 'body', col: 'back_l', role: 'back_panel_left', kind: 'panel' },
      { row: 'body', col: 'gusset_l_back', role: 'gusset_left_back', kind: 'panel' },
      { row: 'body', col: 'gusset_l_front', role: 'gusset_left_front', kind: 'panel' },
      { row: 'body', col: 'front', role: 'front_panel', kind: 'panel', base: true },
      { row: 'body', col: 'gusset_r_front', role: 'gusset_right_front', kind: 'panel' },
      { row: 'body', col: 'gusset_r_back', role: 'gusset_right_back', kind: 'panel' },
      { row: 'body', col: 'back_r', role: 'back_panel_right', kind: 'panel' },
      { row: 'body', col: 'fin_r', role: 'fin_right', kind: 'seal' },

      { row: 'end_bottom', col: 'fin_l', role: 'fin_left_base', kind: 'seal' },
      { row: 'end_bottom', col: 'back_l', role: 'back_left_base', kind: 'panel' },
      { row: 'end_bottom', col: 'gusset_l_back', role: 'gusset_left_back_base', kind: 'panel' },
      { row: 'end_bottom', col: 'gusset_l_front', role: 'gusset_left_front_base', kind: 'panel' },
      { row: 'end_bottom', col: 'front', role: 'front_base', kind: 'panel' },
      { row: 'end_bottom', col: 'gusset_r_front', role: 'gusset_right_front_base', kind: 'panel' },
      { row: 'end_bottom', col: 'gusset_r_back', role: 'gusset_right_back_base', kind: 'panel' },
      { row: 'end_bottom', col: 'back_r', role: 'back_right_base', kind: 'panel' },
      { row: 'end_bottom', col: 'fin_r', role: 'fin_right_base', kind: 'seal' },

      { row: 'end_top', col: 'fin_l', role: 'fin_left_end_top', kind: 'seal' },
      { row: 'end_top', col: 'back_l', role: 'back_left_end_top', kind: 'seal' },
      { row: 'end_top', col: 'gusset_l_back', role: 'gusset_left_back_end_top', kind: 'seal' },
      { row: 'end_top', col: 'gusset_l_front', role: 'gusset_left_front_end_top', kind: 'seal' },
      { row: 'end_top', col: 'front', role: 'front_end_top', kind: 'seal' },
      { row: 'end_top', col: 'gusset_r_front', role: 'gusset_right_front_end_top', kind: 'seal' },
      { row: 'end_top', col: 'gusset_r_back', role: 'gusset_right_back_end_top', kind: 'seal' },
      { row: 'end_top', col: 'back_r', role: 'back_right_end_top', kind: 'seal' },
      { row: 'end_top', col: 'fin_r', role: 'fin_right_end_top', kind: 'seal' },
    ],
    boundaries: [
      { axis: 'v', kind: 'crease', angle: 180 },
      { axis: 'v', after: ['fin_l', 'back_r'], kind: 'crease', angle: 90 },
      { axis: 'h', kind: 'crease', angle: 0 },
    ],
  },

  // Same lofted-cross-section engine as the other bags (see formedShape.ts),
  // on the `rounded_rect` profile: a true rounded rectangle, not a
  // superellipse's continuously-curving approximation — a boxy body needs
  // FLAT sides meeting a genuine constant-radius corner, and a flat-bottomed
  // box base is that SAME family with its corner radius shrunk to 0 at one
  // station, not a different code path.
  //
  // halfWidth is explicit (bagW/2) at every station, never derived — the
  // base is a real, separately-built flat panel in a block-bottom bag, not
  // girth-conserving excess the way a pillow's crimp is, so there is no
  // dog-ear flare to build here; the tube simply holds its own width.
  formedShape: {
    kind: 'lofted_profile',
    faceRoles: [
      'front_panel', 'front_base', 'front_end_top',
      'back_panel_left', 'back_left_base', 'back_left_end_top',
      'back_panel_right', 'back_right_base', 'back_right_end_top',
      'gusset_left_front', 'gusset_left_front_base', 'gusset_left_front_end_top',
      'gusset_left_back', 'gusset_left_back_base', 'gusset_left_back_end_top',
      'gusset_right_front', 'gusset_right_front_base', 'gusset_right_front_end_top',
      'gusset_right_back', 'gusset_right_back_base', 'gusset_right_back_end_top',
    ],
    flapFaceRoles: [
      'fin_left', 'fin_left_base', 'fin_left_end_top',
      'fin_right', 'fin_right_base', 'fin_right_end_top',
    ],
    flapFold: 'left',
    sealStyle: 'fin',
    girthPhaseDeg: -90,
    stations: [
      // The flat base itself: full depth, sharp (unrounded) corners — a real
      // box floor's own corners are creases, not roundovers.
      { y: '0', halfWidth: 'bagW/2', halfDepth: 'bagD/2', profile: { family: 'rounded_rect', cornerRadius: 0 } },
      // Corner folds running up from the base: over the short transition
      // zone the row itself is sized for, the corner radius opens from 0 to
      // the body's own rounding — the fold reading as the corner visibly
      // turning over as you move up from the flat floor.
      { y: 'bagD/2*0.5', halfWidth: 'bagW/2', halfDepth: 'bagD/2', profile: { family: 'rounded_rect', cornerRadius: 'bagD*0.25' } },
      { y: 'bagL - endSeal - (bagL - endSeal - bagD/2*0.5)*0.15', halfWidth: 'bagW/2', halfDepth: 'bagD/2', profile: { family: 'rounded_rect', cornerRadius: 'bagD*0.25' } },
      { y: 'bagL - endSeal', halfWidth: 'bagW/2', halfDepth: 'max(caliper, bagD*0.06)', profile: { family: 'rounded_rect', cornerRadius: 'bagD*0.25' } },
      { y: 'bagL', halfWidth: 'bagW/2', halfDepth: 'max(caliper, bagD*0.06)', profile: { family: 'rounded_rect', cornerRadius: 'bagD*0.25' } },
    ],
    fill: '0.85',
  },

  seals: [
    {
      id: 'bag.block_bottom:fin',
      kind: 'fin',
      role: 'back_fin_seal',
      boundFaceRoles: ['fin_left', 'fin_right'],
      width: 'finSeal',
      plies: 2,
    },
    {
      id: 'bag.block_bottom:base',
      kind: 'fin',
      role: 'base_fold',
      boundFaceRoles: ['front_base', 'back_left_base', 'back_right_base'],
      width: 'bagD/2*0.5',
      // Six plies through the gusset corner fold, where four layers of film
      // are tucked and glued flat.
      plies: 6,
    },
    {
      id: 'bag.block_bottom:end_top',
      kind: 'fin',
      role: 'top_end_seal',
      boundFaceRoles: ['front_end_top', 'back_left_end_top', 'back_right_end_top'],
      width: 'endSeal',
      plies: 6,
    },
  ],
};
