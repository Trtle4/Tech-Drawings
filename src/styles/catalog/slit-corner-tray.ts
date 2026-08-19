import type { StyleDefinition } from '../schema.js';

/**
 * Slit corner tray — a one-piece tray.
 *
 * Rectangular base, four walls folded up, and a corner tab at each corner that
 * stays attached to the end wall and folds in behind the side wall. The corners
 * are slit, not slotted: a knife cut with board on both sides, removing
 * nothing.
 *
 *   columns   wall_left(wallH) | base(L) | wall_right(wallH)
 *   rows      wall_back  (wallH)
 *             base       (W)
 *             wall_front (wallH)
 *
 * The only override the grid needs is that the vertical boundaries in the front
 * and back rows are cuts rather than creases. That frees each corner tab from
 * the front/back wall while leaving it hinged to the left/right wall.
 *
 * Those corner slits are exactly the locking-tab case: an open cut chain that
 * terminates on a crease. They classify correctly only because material is
 * decided by whether cuts close, not by whether a chain is open.
 *
 * CATALOGUE CODE: deliberately unassigned.
 *
 * This was briefly and wrongly published as FEFCO 0300. It is not: FEFCO 03xx
 * is the telescope group — two or more pieces, a lid and a bottom telescoping
 * over a body — and 0301 and 0306 are two-piece as well. This is one piece.
 * A one-piece tray most likely belongs in the 04xx folder/tray family, but
 * rather than guess a second time the code is left off until someone confirms
 * it against the catalogue. `standard` and `code` are omitted so nothing
 * downstream can print an unverified number on a drawing.
 *
 * KNOWN GAP: the corner tabs are creased at a fixed 90° to their side wall,
 * which is right only while `wallAngle` is 90°. Splay the walls and the tabs
 * swing wide of the front/back wall instead of lying flat against it — the
 * fold is doing exactly what the data says, but the data is wrong for a
 * tapered tray. The correct tab angle is the dihedral between two splayed
 * walls, and the corner cut needs to be angled to match. That is a solved
 * dimension depending on another fold, which is constraint territory and out
 * of scope for v1. Until then, treat non-90° wall angles here as a preview.
 */
export const slitCornerTray: StyleDefinition = {
  id: 'tray.slit_corner',
  name: 'Slit Corner Tray',
  family: 'tray',
  description:
    'One-piece tray with slit corners; each corner tab folds in behind the adjacent wall.',

  params: [
    {
      id: 'L',
      label: 'Length',
      group: 'internal',
      unit: 'mm',
      default: 300,
      min: 30,
      step: 1,
      hint: 'Internal, along the front wall.',
    },
    { id: 'W', label: 'Width', group: 'internal', unit: 'mm', default: 220, min: 30, step: 1 },
    {
      id: 'wallH',
      label: 'Wall height',
      group: 'internal',
      unit: 'mm',
      default: 75,
      min: 10,
      step: 1,
      hint: 'Also the depth of each corner tab.',
    },
    {
      id: 'caliper',
      label: 'Board caliper',
      group: 'material',
      unit: 'mm',
      default: 3,
      min: 0.2,
      max: 12,
      step: 0.1,
    },
    {
      id: 'wallAngle',
      label: 'Wall angle',
      group: 'internal',
      unit: 'deg',
      default: 90,
      min: 30,
      max: 120,
      step: 1,
      hint: 'Under 90° gives a splayed, stackable tray. Corner tabs assume 90°.',
    },
  ],

  grid: {
    columns: [
      { id: 'wall_left', size: 'wallH' },
      { id: 'base', size: 'L' },
      { id: 'wall_right', size: 'wallH' },
    ],
    rows: [
      { id: 'wall_front', size: 'wallH' },
      { id: 'base', size: 'W' },
      { id: 'wall_back', size: 'wallH' },
    ],
    cells: [
      { row: 'base', col: 'base', role: 'base', kind: 'panel', base: true },

      { row: 'base', col: 'wall_left', role: 'left_wall', kind: 'panel' },
      { row: 'base', col: 'wall_right', role: 'right_wall', kind: 'panel' },
      { row: 'wall_front', col: 'base', role: 'front_wall', kind: 'panel' },
      { row: 'wall_back', col: 'base', role: 'back_wall', kind: 'panel' },

      // Corner tabs stay hinged to the left/right walls above and below them.
      { row: 'wall_front', col: 'wall_left', role: 'corner_front_left', kind: 'flap' },
      { row: 'wall_front', col: 'wall_right', role: 'corner_front_right', kind: 'flap' },
      { row: 'wall_back', col: 'wall_left', role: 'corner_back_left', kind: 'flap' },
      { row: 'wall_back', col: 'wall_right', role: 'corner_back_right', kind: 'flap' },
    ],
    boundaries: [
      // Every wall folds up by the same angle.
      { axis: 'v', within: ['base'], kind: 'crease', angle: 'wallAngle' },
      { axis: 'h', within: ['base'], kind: 'crease', angle: 'wallAngle' },
      // The corner tabs are slit free of the front and back walls, and stay
      // creased to the side walls at a right angle so they tuck in flat.
      { axis: 'v', within: ['wall_front', 'wall_back'], kind: 'cut' },
    ],
  },

  seals: [],
};
