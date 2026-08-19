import type { StyleDefinition } from '../schema.js';
import { fefco0201 } from './fefco0201.js';

/**
 * FEFCO 0200 — Half Slotted Container.
 *
 * An RSC with no top flaps: a four-panel tube with a glue flap, bottom flaps
 * that meet at the centre, and an open top.
 *
 * DERIVED FROM 0201, and the derivation is a single cell: the `flap_top` row is
 * marked absent. Its four top-flap cells fall away on their own, because
 * `placeCells` skips any cell whose track was omitted. Nothing else changes —
 * the columns, the other cells, the slot override, the glue seam and every
 * parameter carry over untouched.
 *
 * That is the grid's whole claim, so it is worth stating plainly: if this had
 * needed the cells edited, or the boundary override rewritten, or the blank
 * height recomputed by hand, the grid would not be doing its job.
 */
export const fefco0200: StyleDefinition = {
  ...fefco0201,

  id: 'fefco.0200',
  name: 'Half Slotted Container',
  code: '0200',
  description:
    'An RSC without the top flaps. Open-top shipping case, often used with a separate lid.',

  grid: {
    ...fefco0201.grid!,
    // The one change.
    rows: fefco0201.grid!.rows.map((row) =>
      row.id === 'flap_top' ? { ...row, presentIf: '0' } : row,
    ),
  },

  seals: [
    {
      id: 'fefco.0200:joint',
      kind: 'glue_flap',
      role: 'manufacturers_joint',
      boundFaceRoles: ['glue_flap', 'right_panel'],
      width: 'glueFlap',
      plies: 2,
    },
  ],
};
