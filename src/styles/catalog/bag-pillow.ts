import type { StyleDefinition } from '../schema.js';

/**
 * Pillow bag — fin seal, VFFS.
 *
 * Film comes off the roll flat, is formed into a tube, and its two edges are
 * brought together and sealed as a fin down the back. End seals are crimped
 * across the tube top and bottom.
 *
 *   columns   fin(F) | back½(W/2) | FRONT(W) | back½(W/2) | fin(F)
 *   rows      end_top    (E)
 *             body       (L − 2E)
 *             end_bottom (E)
 *
 * Web = 2F + 2W, because the tube circumference is front W + back W and each
 * fin strip is added outside that.
 *
 * ON FOLDING BAGS. A bag has no rigid folded state — a filled pillow bag is a
 * billowed soft body, which the fold traversal does not model and v1 does not
 * try to. What it folds to here is the LAY-FLAT bag, which is a real and
 * checkable state: the two lay-flat edges fold 180° so front and back meet, and
 * each fin folds 90° so the two fin strips stand up face to face. Folded
 * extents are therefore W × L × F. The formed, filled shape is out of scope.
 *
 * ASSUMPTION TO CHECK: end seals are counted inside the cutoff length, not
 * added to it, so bagL is the finished bag length including both seal bands.
 */
export const bagPillow: StyleDefinition = {
  id: 'bag.pillow',
  name: 'Pillow Bag',
  family: 'bag',
  description: 'Fin-seal VFFS bag. Front and back panels with a back fin and crimped end seals.',

  // Wrap folds are the vertical column creases, which leave flat-pattern y
  // untouched — a standing bag's length is up, same as a wrap-style case.
  upAxis: 'y',

  params: [
    {
      id: 'bagW',
      label: 'Bag width',
      group: 'internal',
      unit: 'mm',
      default: 150,
      min: 20,
      step: 1,
      hint: 'Lay-flat width of the finished bag.',
    },
    {
      id: 'bagL',
      label: 'Bag length',
      group: 'internal',
      unit: 'mm',
      default: 240,
      min: 40,
      step: 1,
      hint: 'Cutoff length, including both end seal bands.',
    },
    {
      id: 'bagD',
      label: 'Bag depth',
      group: 'internal',
      unit: 'mm',
      default: 60,
      min: 10,
      step: 1,
      hint: 'Filled depth at the midpoint, front to back. 3D view only — does not affect the dieline.',
    },
    {
      id: 'caliper',
      label: 'Film gauge',
      group: 'material',
      unit: 'mm',
      default: 0.09,
      min: 0.01,
      max: 0.5,
      step: 0.005,
      hint: 'Laminate thickness. 90 µm = 0.09 mm.',
    },
    {
      id: 'finSeal',
      label: 'Fin seal',
      group: 'allowance',
      unit: 'mm',
      default: 10,
      min: 3,
      step: 0.5,
      hint: 'Back seal strip, one per web edge.',
    },
    {
      id: 'endSeal',
      label: 'End seal',
      group: 'allowance',
      unit: 'mm',
      default: 12,
      min: 3,
      max: 'bagL/2 - 5',
      step: 0.5,
      hint: 'Crimp band at each end, inside the cutoff.',
    },
  ],

  grid: {
    columns: [
      { id: 'fin_l', size: 'finSeal' },
      { id: 'back_l', size: 'bagW/2' },
      { id: 'front', size: 'bagW' },
      { id: 'back_r', size: 'bagW/2' },
      { id: 'fin_r', size: 'finSeal' },
    ],
    rows: [
      { id: 'end_bottom', size: 'endSeal' },
      { id: 'body', size: 'bagL - 2*endSeal' },
      { id: 'end_top', size: 'endSeal' },
    ],
    cells: [
      { row: 'body', col: 'fin_l', role: 'fin_left', kind: 'seal' },
      { row: 'body', col: 'back_l', role: 'back_panel_left', kind: 'panel' },
      { row: 'body', col: 'front', role: 'front_panel', kind: 'panel', base: true },
      { row: 'body', col: 'back_r', role: 'back_panel_right', kind: 'panel' },
      { row: 'body', col: 'fin_r', role: 'fin_right', kind: 'seal' },

      { row: 'end_bottom', col: 'fin_l', role: 'fin_left_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'back_l', role: 'back_left_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'front', role: 'front_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'back_r', role: 'back_right_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'fin_r', role: 'fin_right_end_bottom', kind: 'seal' },

      { row: 'end_top', col: 'fin_l', role: 'fin_left_end_top', kind: 'seal' },
      { row: 'end_top', col: 'back_l', role: 'back_left_end_top', kind: 'seal' },
      { row: 'end_top', col: 'front', role: 'front_end_top', kind: 'seal' },
      { row: 'end_top', col: 'back_r', role: 'back_right_end_top', kind: 'seal' },
      { row: 'end_top', col: 'fin_r', role: 'fin_right_end_top', kind: 'seal' },
    ],
    boundaries: [
      // Lay-flat: the tube's two side edges fold right over.
      { axis: 'v', kind: 'crease', angle: 180 },
      // The fins stand up off the back, face to face.
      { axis: 'v', after: ['fin_l', 'back_r'], kind: 'crease', angle: 90 },
      // A seal band boundary is a crease that does not fold — the film creases
      // where the jaws close, but the band stays in the plane of its panel.
      { axis: 'h', kind: 'crease', angle: 0 },
    ],
  },

  // A filled pillow bag is a loft: flat crimp at the bottom seal, out to an
  // oval bagW x bagD at the body's midpoint, back down to a flat crimp at the
  // top seal — five stations, one shared engine (see formedShape.ts). Every
  // face sharing the front/back columns rides that same lofted surface,
  // including the end-band panels themselves (front_end_bottom etc.): they
  // are the SAME material as the body panel, just at a y inside the flat
  // crimp region, so the loft already draws them flat with no separate cap
  // case. The fin is not part of that surface at all — it folds flat against
  // the body at double film thickness, toward flapFold, rather than standing
  // out from it (sealStyle: 'lap' is the no-protrusion overlap alternative).
  formedShape: {
    kind: 'lofted_profile',
    faceRoles: [
      'front_panel', 'front_end_bottom', 'front_end_top',
      'back_panel_left', 'back_left_end_bottom', 'back_left_end_top',
      'back_panel_right', 'back_right_end_bottom', 'back_right_end_top',
    ],
    flapFaceRoles: [
      'fin_left', 'fin_left_end_bottom', 'fin_left_end_top',
      'fin_right', 'fin_right_end_bottom', 'fin_right_end_top',
    ],
    flapFold: 'left',
    sealStyle: 'fin',
    // halfWidth is bagW/2 at every station, flat crimp and midpoint alike —
    // side to side, the bag is exactly the front panel's own width the whole
    // way down (matching the rigid lay-flat fold's own W x L x fin extent);
    // only halfDepth (front to back) opens up toward the midpoint.
    stations: [
      { y: '0', halfWidth: 'bagW/2', halfDepth: 'caliper' },
      { y: 'endSeal', halfWidth: 'bagW/2', halfDepth: 'caliper' },
      { y: 'bagL/2', halfWidth: 'bagW/2', halfDepth: 'bagD/2' },
      { y: 'bagL - endSeal', halfWidth: 'bagW/2', halfDepth: 'caliper' },
      { y: 'bagL', halfWidth: 'bagW/2', halfDepth: 'caliper' },
    ],
    fill: '0.85',
  },

  seals: [
    {
      id: 'bag.pillow:fin',
      kind: 'fin',
      role: 'back_fin_seal',
      boundFaceRoles: ['fin_left', 'fin_right'],
      width: 'finSeal',
      plies: 2,
    },
    {
      id: 'bag.pillow:end_bottom',
      kind: 'fin',
      role: 'bottom_end_seal',
      boundFaceRoles: ['front_end_bottom', 'back_left_end_bottom', 'back_right_end_bottom'],
      width: 'endSeal',
      plies: 2,
    },
    {
      id: 'bag.pillow:end_top',
      kind: 'fin',
      role: 'top_end_seal',
      boundFaceRoles: ['front_end_top', 'back_left_end_top', 'back_right_end_top'],
      width: 'endSeal',
      plies: 2,
    },
  ],
};
