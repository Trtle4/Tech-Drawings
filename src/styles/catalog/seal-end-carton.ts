import type { StyleDefinition } from '../schema.js';

/**
 * Seal end carton.
 *
 * A four-panel tube with a glue flap, closed at both ends by folding the two
 * short minor flaps in first and the two full-depth major flaps over them, then
 * gluing. The classic glued-end folding carton — cereal, cosmetics, pharma.
 *
 *   columns   glue | back(L) | left(W) | front(L) | right(W)
 *   rows      flap_top    (majorFlap)
 *             body        (H)
 *             flap_bottom (majorFlap)
 *
 * This is the style that needed `CellSpec.inset`. Grid tracks are uniform, but
 * a seal end carton's minor flaps are shorter than its major flaps while
 * sharing the same flap row. The minor cells inset from the outer edge, so the
 * crease stays on the track boundary and only the free edge moves in.
 *
 * Not a FEFCO code — folding cartons are ECMA territory, and the ECMA code
 * depends on the closure detail. Left as a house id until that is pinned down.
 */
export const sealEndCarton: StyleDefinition = {
  id: 'carton.seal_end',
  name: 'Seal End Carton',
  family: 'carton',
  description:
    'Glued-end folding carton. Minor flaps fold in first, major flaps seal over them.',

  params: [
    {
      id: 'L',
      label: 'Length',
      group: 'internal',
      unit: 'mm',
      default: 90,
      min: 15,
      step: 1,
      hint: 'Internal, across the front panel.',
    },
    {
      id: 'W',
      label: 'Width',
      group: 'internal',
      unit: 'mm',
      default: 45,
      min: 10,
      step: 1,
      hint: 'Internal depth, front to back.',
    },
    { id: 'H', label: 'Height', group: 'internal', unit: 'mm', default: 160, min: 15, step: 1 },
    {
      id: 'caliper',
      label: 'Board caliper',
      group: 'material',
      unit: 'mm',
      default: 0.45,
      min: 0.1,
      max: 2,
      step: 0.05,
      hint: 'Folding boxboard, typically 0.3–0.6 mm.',
    },
    {
      id: 'glueFlap',
      label: 'Glue flap',
      group: 'allowance',
      unit: 'mm',
      default: 12,
      min: 5,
      step: 1,
      hint: 'Side seam, lapped inside the back panel.',
    },
    {
      id: 'majorFlap',
      label: 'Major flap',
      group: 'allowance',
      unit: 'mm',
      default: 'W - caliper',
      min: 5,
      step: 0.5,
      hint: 'On front and back. Full depth so it covers the opening.',
    },
    {
      id: 'minorFlap',
      label: 'Minor flap',
      group: 'allowance',
      unit: 'mm',
      default: 'min(majorFlap - 3, L/2 - caliper)',
      min: 3,
      step: 0.5,
      hint: 'On the sides, tucked in first. Kept under L/2 so the pair clears.',
    },
    { id: 'slot', label: 'Slot width', group: 'allowance', unit: 'mm', default: 'caliper', min: 0 },
  ],

  grid: {
    columns: [
      { id: 'glue', size: 'glueFlap' },
      { id: 'back', size: 'L' },
      { id: 'left', size: 'W' },
      { id: 'front', size: 'L' },
      { id: 'right', size: 'W' },
    ],
    rows: [
      { id: 'flap_bottom', size: 'majorFlap' },
      { id: 'body', size: 'H' },
      { id: 'flap_top', size: 'majorFlap' },
    ],
    cells: [
      { row: 'body', col: 'glue', role: 'glue_flap', kind: 'seal' },
      { row: 'body', col: 'back', role: 'back_panel', kind: 'panel' },
      { row: 'body', col: 'left', role: 'left_panel', kind: 'panel' },
      { row: 'body', col: 'front', role: 'front_panel', kind: 'panel', base: true },
      { row: 'body', col: 'right', role: 'right_panel', kind: 'panel' },

      // Major flaps fill the flap row.
      { row: 'flap_bottom', col: 'back', role: 'back_flap_bottom', kind: 'flap' },
      { row: 'flap_bottom', col: 'front', role: 'front_flap_bottom', kind: 'flap' },
      { row: 'flap_top', col: 'back', role: 'back_flap_top', kind: 'flap' },
      { row: 'flap_top', col: 'front', role: 'front_flap_top', kind: 'flap' },

      // Minor flaps share the row but stop short, inset from the free edge so
      // the crease stays where the body panel expects it.
      {
        row: 'flap_bottom',
        col: 'left',
        role: 'left_flap_bottom',
        kind: 'flap',
        inset: { bottom: 'majorFlap - minorFlap' },
      },
      {
        row: 'flap_bottom',
        col: 'right',
        role: 'right_flap_bottom',
        kind: 'flap',
        inset: { bottom: 'majorFlap - minorFlap' },
      },
      {
        row: 'flap_top',
        col: 'left',
        role: 'left_flap_top',
        kind: 'flap',
        inset: { top: 'majorFlap - minorFlap' },
      },
      {
        row: 'flap_top',
        col: 'right',
        role: 'right_flap_top',
        kind: 'flap',
        inset: { top: 'majorFlap - minorFlap' },
      },
    ],
    boundaries: [{ axis: 'v', within: ['flap_bottom', 'flap_top'], kind: 'slot', width: 'slot' }],
  },

  seals: [
    {
      id: 'carton.seal_end:seam',
      kind: 'glue_flap',
      role: 'side_seam',
      boundFaceRoles: ['glue_flap', 'right_panel'],
      width: 'glueFlap',
      plies: 2,
    },
    {
      id: 'carton.seal_end:bottom',
      kind: 'lap',
      role: 'bottom_seal',
      boundFaceRoles: ['front_flap_bottom', 'back_flap_bottom'],
      width: 'majorFlap',
      plies: 4,
    },
    {
      id: 'carton.seal_end:top',
      kind: 'lap',
      role: 'top_seal',
      boundFaceRoles: ['front_flap_top', 'back_flap_top'],
      width: 'majorFlap',
      plies: 4,
    },
  ],
};
