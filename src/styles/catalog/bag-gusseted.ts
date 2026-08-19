import type { StyleDefinition } from '../schema.js';

/**
 * Side-gusseted bag — fin seal.
 *
 * A pillow bag with a V-fold gusset tucked into each side, so the formed bag is
 * a rectangular tube W wide by D deep rather than a flat pillow.
 *
 *   columns   fin(F) | back½(W/2) | gusset_l_back(D/2) | gusset_l_front(D/2)
 *             | FRONT(W) |
 *             gusset_r_front(D/2) | gusset_r_back(D/2) | back½(W/2) | fin(F)
 *
 * Web = 2F + 2W + 2D. Tube circumference is front W + back W plus D of material
 * per gusset, and the two fin strips sit outside that.
 *
 * Folds to the LAY-FLAT bag, as the pillow does — 180° at every tube fold so
 * the gussets tuck flat between front and back, 90° at each fin so the two fin
 * strips stand face to face. Extents are W × L × F. In lay-flat the two fins
 * land together over the centre of the front panel, which is where the back
 * seam sits when the bag is viewed flat.
 *
 * ASSUMPTIONS TO CHECK: gusset depth D is the formed front-to-back depth, and
 * each gusset contributes D of flat material folded at its centre. End seals
 * count inside the cutoff length.
 */
export const bagGusseted: StyleDefinition = {
  id: 'bag.gusseted',
  name: 'Side Gusseted Bag',
  family: 'bag',
  description: 'Fin-seal bag with a V-fold gusset in each side, forming a rectangular tube.',

  params: [
    {
      id: 'bagW',
      label: 'Bag width',
      group: 'internal',
      unit: 'mm',
      default: 120,
      min: 20,
      step: 1,
      hint: 'Front panel width of the formed bag.',
    },
    {
      id: 'bagD',
      label: 'Gusset depth',
      group: 'internal',
      unit: 'mm',
      default: 70,
      min: 10,
      step: 1,
      hint: 'Formed front-to-back depth.',
    },
    {
      id: 'bagL',
      label: 'Bag length',
      group: 'internal',
      unit: 'mm',
      default: 300,
      min: 40,
      step: 1,
      hint: 'Cutoff length, including both end seal bands.',
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
      label: 'End seal',
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
      { id: 'end_bottom', size: 'endSeal' },
      { id: 'body', size: 'bagL - 2*endSeal' },
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

      { row: 'end_bottom', col: 'fin_l', role: 'fin_left_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'back_l', role: 'back_left_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'gusset_l_back', role: 'gusset_left_back_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'gusset_l_front', role: 'gusset_left_front_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'front', role: 'front_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'gusset_r_front', role: 'gusset_right_front_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'gusset_r_back', role: 'gusset_right_back_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'back_r', role: 'back_right_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'fin_r', role: 'fin_right_end_bottom', kind: 'seal' },

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

  seals: [
    {
      id: 'bag.gusseted:fin',
      kind: 'fin',
      role: 'back_fin_seal',
      boundFaceRoles: ['fin_left', 'fin_right'],
      width: 'finSeal',
      plies: 2,
    },
    {
      id: 'bag.gusseted:end_bottom',
      kind: 'fin',
      role: 'bottom_end_seal',
      boundFaceRoles: ['front_end_bottom', 'back_left_end_bottom', 'back_right_end_bottom'],
      width: 'endSeal',
      // Six plies through the gusset, where four layers of film are crimped.
      plies: 6,
    },
    {
      id: 'bag.gusseted:end_top',
      kind: 'fin',
      role: 'top_end_seal',
      boundFaceRoles: ['front_end_top', 'back_left_end_top', 'back_right_end_top'],
      width: 'endSeal',
      plies: 6,
    },
  ],
};
