import type { StyleDefinition } from '../schema.js';

/**
 * FEFCO 0201 — Regular Slotted Case.
 *
 * Four body panels round the case, a glue flap on one end, and top and bottom
 * flaps on every panel. The flaps are half the case width so the inner pair
 * meet at the centre; the slots between them are a board thickness wide.
 *
 * The whole style is data. The only exception the grid needs stating is that
 * vertical boundaries in the two flap rows are slots rather than creases —
 * everything else falls out of the default "crease between neighbours".
 *
 * Flaps carry a ply: minor flaps (left/right, the W panels) close first and
 * sit underneath; major flaps (front/back, the L panels) close second, on
 * top, and are the ones taped — the flaps visible from outside. The glue flap
 * is ply -1, laminated under the panel it laps, always hidden.
 *
 *   columns   glue |  back(L)  |  left(W)  |  front(L)  |  right(W)
 *   rows      flap_top    (W/2)
 *             body        (H)
 *             flap_bottom (W/2)
 */
export const fefco0201: StyleDefinition = {
  id: 'fefco.0201',
  name: 'Regular Slotted Case',
  family: 'case',
  standard: 'FEFCO',
  code: '0201',
  description:
    'All flaps the same length; outer flaps meet at the centre. The most common shipping case.',

  // The four body panels wrap around by folding about VERTICAL creases (the
  // column boundaries), which leaves flat-pattern y untouched — the case
  // height stands up along y with the wrap unchanged. 'y' is up.
  upAxis: 'y',

  params: [
    {
      id: 'L',
      label: 'Length',
      group: 'internal',
      unit: 'mm',
      default: 200,
      min: 20,
      step: 1,
      hint: 'Internal, along the front panel.',
    },
    { id: 'W', label: 'Width', group: 'internal', unit: 'mm', default: 150, min: 20, step: 1 },
    { id: 'H', label: 'Height', group: 'internal', unit: 'mm', default: 250, min: 20, step: 1 },
    {
      id: 'caliper',
      label: 'Board caliper',
      group: 'material',
      unit: 'mm',
      default: 3,
      min: 0.2,
      max: 12,
      step: 0.1,
      hint: 'Also the slot width.',
    },
    {
      id: 'glueFlap',
      label: 'Glue flap',
      group: 'allowance',
      unit: 'mm',
      default: 35,
      min: 10,
      step: 1,
      hint: 'Manufacturer’s joint, lapped inside the back panel.',
    },
    {
      id: 'flap',
      label: 'Flap depth',
      group: 'allowance',
      unit: 'mm',
      default: 'W/2',
      min: 5,
      step: 1,
      hint: 'W/2 makes the outer flaps meet. Reduce for a gap.',
    },
    {
      id: 'slot',
      label: 'Slot width',
      group: 'allowance',
      unit: 'mm',
      default: 'caliper',
      min: 0,
      step: 0.5,
    },
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
      { id: 'flap_bottom', size: 'flap' },
      { id: 'body', size: 'H' },
      { id: 'flap_top', size: 'flap' },
    ],
    cells: [
      // The glue flap exists only across the body row. Laminated to the
      // inside of the panel it laps, so it is always hidden behind it.
      { row: 'body', col: 'glue', role: 'glue_flap', kind: 'seal', ply: -1 },

      { row: 'body', col: 'back', role: 'back_panel', kind: 'panel' },
      { row: 'body', col: 'left', role: 'left_panel', kind: 'panel' },
      { row: 'body', col: 'front', role: 'front_panel', kind: 'panel', base: true },
      { row: 'body', col: 'right', role: 'right_panel', kind: 'panel' },

      // Minor flaps: attached to the W panels, close first, end up underneath.
      { row: 'flap_bottom', col: 'left', role: 'left_flap_bottom', kind: 'flap', ply: 0 },
      { row: 'flap_bottom', col: 'right', role: 'right_flap_bottom', kind: 'flap', ply: 0 },
      { row: 'flap_top', col: 'left', role: 'left_flap_top', kind: 'flap', ply: 0 },
      { row: 'flap_top', col: 'right', role: 'right_flap_top', kind: 'flap', ply: 0 },

      // Major flaps: attached to the L panels, close second over the minors,
      // and are the ones taped — the visible flaps from outside the case.
      { row: 'flap_bottom', col: 'back', role: 'back_flap_bottom', kind: 'flap', ply: 1 },
      { row: 'flap_bottom', col: 'front', role: 'front_flap_bottom', kind: 'flap', ply: 1 },
      { row: 'flap_top', col: 'back', role: 'back_flap_top', kind: 'flap', ply: 1 },
      { row: 'flap_top', col: 'front', role: 'front_flap_top', kind: 'flap', ply: 1 },
    ],
    boundaries: [
      // Flaps are separated by punched slots, not creases. Everything else
      // keeps the default 90° crease.
      { axis: 'v', within: ['flap_bottom', 'flap_top'], kind: 'slot', width: 'slot' },
    ],
  },

  seals: [
    {
      id: 'fefco.0201:joint',
      kind: 'glue_flap',
      role: 'manufacturers_joint',
      boundFaceRoles: ['glue_flap', 'right_panel'],
      width: 'glueFlap',
      plies: 2,
    },
  ],
};
