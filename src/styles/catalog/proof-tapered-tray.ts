import type { ExtraLineSpec, ExtraSeedSpec, StyleDefinition } from '../schema.js';

/**
 * THROWAWAY PROOF STYLE — not a real catalogue entry, not a FEFCO code.
 *
 * Exists to hold the grid honest. It is defined entirely through `extraLines`
 * and `extraSeeds`, touching no part of the grid schema, and it deliberately
 * breaks every assumption a grid-shaped model might have leaked downstream:
 *
 *   - faces are trapezoids, not axis-aligned rectangles
 *   - the fold angles are 62°, not 90°
 *   - one panel's outer edge is an arc, not a straight line
 *   - the blank has no rows, no columns and no cells
 *
 * A tapered tray: a rectangular base with four walls that splay outward, open
 * at the corners. The south wall has a curved lip.
 *
 * If this ever stops resolving, something downstream has started assuming the
 * grid. Delete it once the real curved styles (SUP, tapered trays, ECMA tuck
 * flaps) exist and cover the same ground.
 */

const wallAngle = 'wallAngle';

/** Trapezoid wall on each base edge, splaying out by `splay` per side. */
const wall = (
  id: string,
  fold: [string, string, string, string],
  left: [string, string, string, string],
  right: [string, string, string, string],
): ExtraLineSpec[] => [
  {
    type: 'crease',
    role: `${id}.fold`,
    points: [
      { x: fold[0], y: fold[1] },
      { x: fold[2], y: fold[3] },
    ],
    angle: wallAngle,
  },
  {
    type: 'cut',
    role: `${id}.left_edge`,
    points: [
      { x: left[0], y: left[1] },
      { x: left[2], y: left[3] },
    ],
  },
  {
    type: 'cut',
    role: `${id}.right_edge`,
    points: [
      { x: right[0], y: right[1] },
      { x: right[2], y: right[3] },
    ],
  },
];

const seed = (role: string, x: string, y: string): ExtraSeedSpec => ({
  role,
  point: { x, y },
  kind: 'panel',
});

export const proofTaperedTray: StyleDefinition = {
  id: 'proof.tapered_tray',
  name: 'Tapered tray (proof)',
  family: 'tray',
  description:
    'Throwaway proof that a style can bypass the grid entirely: trapezoid faces, 62° folds, one arc edge.',

  params: [
    { id: 'W', label: 'Base width', group: 'internal', unit: 'mm', default: 140, min: 20 },
    { id: 'D', label: 'Base depth', group: 'internal', unit: 'mm', default: 100, min: 20 },
    { id: 'wall', label: 'Wall height', group: 'internal', unit: 'mm', default: 45, min: 5 },
    {
      id: 'splay',
      label: 'Splay per side',
      group: 'allowance',
      unit: 'mm',
      default: 12,
      min: 0,
      hint: 'How much wider each wall gets at its outer edge.',
    },
    {
      id: 'lip',
      label: 'Lip bow',
      group: 'allowance',
      unit: 'mm',
      default: 14,
      min: 0,
      hint: 'Sagitta of the curved south lip.',
    },
    {
      id: 'wallAngle',
      label: 'Wall angle',
      group: 'internal',
      unit: 'deg',
      default: 62,
      min: 5,
      max: 175,
      hint: 'Under 90° leans the wall outward. Nothing here is square.',
    },
    { id: 'caliper', label: 'Caliper', group: 'material', unit: 'mm', default: 0.6, min: 0.1 },
  ],

  extraLines: [
    // Base outline is made entirely of the four fold lines; there is no cut
    // between the base and its walls.
    ...wall(
      'south_wall',
      ['0', '0', 'W', '0'],
      ['0', '0', '-splay', '-wall'],
      ['W', '0', 'W + splay', '-wall'],
    ),
    ...wall(
      'north_wall',
      ['0', 'D', 'W', 'D'],
      ['0', 'D', '-splay', 'D + wall'],
      ['W', 'D', 'W + splay', 'D + wall'],
    ),
    ...wall(
      'west_wall',
      ['0', '0', '0', 'D'],
      ['0', '0', '-wall', '-splay'],
      ['0', 'D', '-wall', 'D + splay'],
    ),
    ...wall(
      'east_wall',
      ['W', '0', 'W', 'D'],
      ['W', '0', 'W + wall', '-splay'],
      ['W', 'D', 'W + wall', 'D + splay'],
    ),

    // Straight outer edges for three walls.
    {
      type: 'cut',
      role: 'north_wall.outer_edge',
      points: [
        { x: '-splay', y: 'D + wall' },
        { x: 'W + splay', y: 'D + wall' },
      ],
    },
    {
      type: 'cut',
      role: 'west_wall.outer_edge',
      points: [
        { x: '-wall', y: '-splay' },
        { x: '-wall', y: 'D + splay' },
      ],
    },
    {
      type: 'cut',
      role: 'east_wall.outer_edge',
      points: [
        { x: 'W + wall', y: '-splay' },
        { x: 'W + wall', y: 'D + splay' },
      ],
    },

    // The one arc. Bows away from the base, so the wall reads as a curved lip.
    {
      type: 'cut',
      role: 'south_wall.outer_edge',
      arcThrough: {
        from: { x: 'W + splay', y: '-wall' },
        to: { x: '-splay', y: '-wall' },
        sagitta: 'lip',
      },
    },
  ],

  extraSeeds: [
    { role: 'base', point: { x: 'W/2', y: 'D/2' }, kind: 'panel' },
    seed('south_wall', 'W/2', '-wall/2'),
    seed('north_wall', 'W/2', 'D + wall/2'),
    seed('west_wall', '-wall/2', 'D/2'),
    seed('east_wall', 'W + wall/2', 'D/2'),
  ],

  baseFaceRole: 'base',
};
