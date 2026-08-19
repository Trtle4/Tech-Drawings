import type { FaceSeed, GeometryGraph, Vec2 } from './types.js';
import { circle, graph, line, rect, resetIds, seg } from './build.js';

/**
 * Test blanks for the face detection pass. Shared by the unit tests and the
 * `demo:faces` script so both exercise exactly the same geometry.
 */

const p = (x: number, y: number): Vec2 => ({ x, y });

/**
 * The smoke test from the build order: a rectangle with two creases must
 * resolve into three faces and two hinges, with nothing named.
 */
export function rectangleTwoCreases(): GeometryGraph {
  resetIds();
  return graph([
    rect('cut', 'blank.outline', 0, 0, 300, 100),
    seg('crease', 'crease.a', p(100, 0), p(100, 100)),
    seg('crease', 'crease.b', p(200, 0), p(200, 100)),
  ]);
}

/**
 * FEFCO 201 regular slotted case, 200 x 150 x 250 mm internal, drawn by hand
 * rather than generated, so face detection has to work it out unaided.
 *
 * Four body panels plus a glue flap across the bottom, top and bottom flaps on
 * each panel, and slots between adjacent flaps.
 */
export function rsc201(): GeometryGraph {
  resetIds();
  const L = 200;
  const W = 150;
  const H = 250;
  const caliper = 3;
  const glue = 35;
  const slot = caliper; // Slots are punched a board thickness wide.
  const flap = W / 2; // Meeting flaps: each is half the case width.

  const xs: number[] = [glue];
  for (const w of [L, W, L, W]) xs.push(xs[xs.length - 1]! + w);
  const right = xs[xs.length - 1]!;
  const yBot = 0;
  const yScoreB = flap;
  const yScoreT = flap + H;
  const yTop = flap + H + flap;

  const lines = [
    // Glue flap, hanging off the left of the first body panel.
    seg('cut', 'glue_flap.outer_edge', p(0, yScoreB), p(0, yScoreT)),
    seg('cut', 'glue_flap.bottom_edge', p(0, yScoreB), p(glue, yScoreB)),
    seg('cut', 'glue_flap.top_edge', p(0, yScoreT), p(glue, yScoreT)),
    seg('crease', 'glue_flap.fold', p(glue, yScoreB), p(glue, yScoreT)),
    // Body panel folds, and the cut edge the glue flap laps onto.
    ...xs
      .slice(1, -1)
      .map((x, i) => seg('crease', `body.fold_${i + 1}`, p(x, yScoreB), p(x, yScoreT))),
    seg('cut', 'body.right_edge', p(right, yScoreB), p(right, yScoreT)),
  ];

  // Flaps, one pair per body panel, with a real slot between neighbours.
  for (let i = 0; i < 4; i++) {
    const fx0 = xs[i]! + (i === 0 ? 0 : slot / 2);
    const fx1 = xs[i + 1]! - (i === 3 ? 0 : slot / 2);
    const n = i + 1;
    lines.push(
      seg('cut', `bottom_flap_${n}.outer_edge`, p(fx0, yBot), p(fx1, yBot)),
      seg('cut', `bottom_flap_${n}.left_edge`, p(fx0, yBot), p(fx0, yScoreB)),
      seg('cut', `bottom_flap_${n}.right_edge`, p(fx1, yBot), p(fx1, yScoreB)),
      seg('crease', `bottom_flap_${n}.fold`, p(fx0, yScoreB), p(fx1, yScoreB)),
      seg('cut', `top_flap_${n}.outer_edge`, p(fx0, yTop), p(fx1, yTop)),
      seg('cut', `top_flap_${n}.left_edge`, p(fx0, yTop), p(fx0, yScoreT)),
      seg('cut', `top_flap_${n}.right_edge`, p(fx1, yTop), p(fx1, yScoreT)),
      seg('crease', `top_flap_${n}.fold`, p(fx0, yScoreT), p(fx1, yScoreT)),
    );
  }

  // The knife closes each slot across its inner end, on the score line.
  for (let i = 1; i < 4; i++) {
    const x = xs[i]!;
    lines.push(
      seg('cut', `slot_${i}.bottom_end`, p(x - slot / 2, yScoreB), p(x + slot / 2, yScoreB)),
      seg('cut', `slot_${i}.top_end`, p(x - slot / 2, yScoreT), p(x + slot / 2, yScoreT)),
    );
  }

  // Panel names, as points inside the panels. Placed by the style, not guessed
  // from the geometry.
  const names = ['back', 'left', 'front', 'right'];
  const faceSeeds: FaceSeed[] = [
    { role: 'glue_flap', point: p(glue / 2, (yScoreB + yScoreT) / 2), kind: 'seal' },
  ];
  for (let i = 0; i < 4; i++) {
    const mid = (xs[i]! + xs[i + 1]!) / 2;
    const name = names[i]!;
    faceSeeds.push(
      { role: `${name}_panel`, point: p(mid, (yScoreB + yScoreT) / 2), kind: 'panel' },
      { role: `${name}_flap_bottom`, point: p(mid, yScoreB / 2), kind: 'flap' },
      { role: `${name}_flap_top`, point: p(mid, (yScoreT + yTop) / 2), kind: 'flap' },
    );
  }

  return graph(lines, {
    caliper,
    faceSeeds,
    baseFaceRole: 'front_panel',
    meta: { style: 'fefco.201', L, W, H },
  });
}

/**
 * The awkward one. Every case here is something a user can produce by accident
 * or on purpose, and none of it should crash or silently vanish:
 *
 *  a. L-shaped outline, so the blank is concave and its centroid falls outside
 *     the material.
 *  b. Two creases crossing in a plus, which subdivides one region into four.
 *  c. A crease that stops halfway across a panel, dividing nothing.
 *  d. A round peg hole cut inside a panel.
 *  e. A closed crease loop, which must NOT read as a hole — only cuts remove
 *     material.
 *  f. A separate island blank with its own crease, connected to nothing.
 *  g. A stray crease floating outside every blank.
 *  h. A bleed rectangle and a dimension line, which must be ignored entirely.
 */
export function awkwardBlank(): GeometryGraph {
  resetIds();
  const outline = line({
    type: 'cut',
    role: 'blank.outline',
    closed: true,
    points: [
      p(0, 0),
      p(200, 0),
      p(200, 60),
      p(120, 60),
      p(120, 140),
      p(0, 140),
    ],
  });

  return graph(
    [
      outline,
      // (b) crossing creases in the tall left arm
      seg('crease', 'cross.vertical', p(60, 0), p(60, 140)),
      seg('crease', 'cross.horizontal', p(0, 100), p(120, 100)),
      // (c) crease that stops short of the far edge
      seg('crease', 'stub.dangler', p(160, 0), p(160, 30)),
      // (d) peg hole cut into the right arm
      circle('cut', 'peg_hole.round', p(170, 45), 6),
      // (e) closed crease loop — a fold, not a cut, so no material is lost
      rect('crease', 'emboss.loop', 20, 20, 25, 25),
      // (f) island blank with its own crease
      rect('cut', 'island.outline', 240, 0, 80, 60),
      seg('crease', 'island.fold', p(280, 0), p(280, 60)),
      // (g) crease in mid-air
      seg('crease', 'orphan.floating', p(240, 100), p(320, 100)),
      // (h) non-structural furniture
      rect('bleed', 'blank.bleed', -3, -3, 206, 146),
      seg('dimension', 'dim.overall_width', p(0, -20), p(200, -20)),
    ],
    { caliper: 0.45 },
  );
}

/**
 * Open cut chains that terminate on a crease.
 *
 * An RSC slot and a locking tab are topologically identical — a region bounded
 * by cuts on three sides and something else on the fourth. What separates them
 * is whether the cut chain closes on itself:
 *
 *  a. closed slot        cuts close into a loop            → void
 *  b. locking tab        three cuts ending on a crease     → material, hinged
 *  c. thumb notch        open chain, both ends on the cut  → void
 *                        outline, so the cuts still close
 *  d. hand hole flap     arc cut ending on a crease        → material, hinged
 *
 * (b) and (d) are the interesting pair: nothing is removed, the panel is only
 * slit, so the region stays board and folds on its crease.
 */
export function openCutChains(): GeometryGraph {
  resetIds();
  return graph(
    [
      // Blank outline, indented by the thumb notch on the top edge.
      line({
        type: 'cut',
        role: 'blank.outline',
        closed: true,
        points: [
          p(0, 0),
          p(340, 0),
          p(340, 140),
          p(220, 140),
          p(200, 110), // (c) thumb notch, cut into the edge
          p(180, 140),
          p(0, 140),
        ],
      }),
      // (a) closed slot — a cut loop with nothing holding the middle
      rect('cut', 'slot.closed', 20, 60, 40, 20),
      // (b) locking tab — three cuts landing on the ends of a crease
      seg('crease', 'tab.fold', p(100, 40), p(140, 40)),
      line({
        type: 'cut',
        role: 'tab.outer',
        points: [p(100, 40), p(100, 75), p(140, 75), p(140, 40)],
      }),
      // (d) hand hole with a hinged flap — same topology, curved
      seg('crease', 'hand_hole.fold', p(250, 50), p(310, 50)),
      line({
        type: 'cut',
        role: 'hand_hole.flap_edge',
        path: { kind: 'arc', center: p(280, 50), radius: 30, startAngle: 0, endAngle: Math.PI },
      }),
    ],
    { caliper: 3 },
  );
}

/** Seal end carton, folded with non-90° hinges, for the fold traversal check. */
export function shallowTray(): GeometryGraph {
  resetIds();
  const w = 120;
  const d = 80;
  const wall = 25;
  return graph([
    rect('cut', 'tray.outline', 0, 0, w + 2 * wall, d + 2 * wall),
    seg('crease', 'base.fold_left', p(wall, 0), p(wall, d + 2 * wall)),
    seg('crease', 'base.fold_right', p(wall + w, 0), p(wall + w, d + 2 * wall)),
    seg('crease', 'base.fold_bottom', p(0, wall), p(w + 2 * wall, wall)),
    seg('crease', 'base.fold_top', p(0, wall + d), p(w + 2 * wall, wall + d)),
  ]);
}

export const FIXTURES = {
  rectangleTwoCreases,
  rsc201,
  awkwardBlank,
  shallowTray,
} as const;
