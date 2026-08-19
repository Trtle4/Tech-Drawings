import { describe, expect, it } from 'vitest';
import { compileStyle } from '../compile.js';
import { proofTaperedTray } from '../catalog/proof-tapered-tray.js';
import { fefco0201 } from '../catalog/fefco0201.js';
import { blankSize, materialArea, resolveGeometry } from '../../geometry/resolve.js';
import { foldedFacePoints } from '../../geometry/fold.js';
import type { GeometryGraph } from '../../geometry/types.js';

const DEG = Math.PI / 180;

/** Rotate a whole graph about the origin. Topology must be unaffected. */
function rotateGraph(g: GeometryGraph, deg: number): GeometryGraph {
  const t = deg * DEG;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const rot = (p: { x: number; y: number }) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c });
  return {
    ...g,
    lines: g.lines.map((l) => ({
      ...l,
      geometry:
        l.geometry.kind === 'polyline'
          ? { ...l.geometry, points: l.geometry.points.map(rot) }
          : {
              ...l.geometry,
              center: rot(l.geometry.center),
              startAngle: l.geometry.startAngle + t,
              endAngle: l.geometry.endAngle + t,
            },
    })),
    faceSeeds: g.faceSeeds?.map((sd) => ({ ...sd, point: rot(sd.point) })),
  };
}

/**
 * Extents of the folded solid. `unrotateDeg` spins the result back about z
 * before measuring: turning the flat blank turns the folded solid with it, so
 * its axis-aligned box is not comparable until the turn is undone.
 */
function foldedExtents(g: GeometryGraph, ratio = 1, unrotateDeg = 0): number[] {
  const folded = foldedFacePoints(resolveGeometry(g, { reanchorSeeds: false }), ratio);
  const t = -unrotateDeg * DEG;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { points } of folded.values()) {
    for (const q of points) {
      const v = [q.x * c - q.y * s, q.x * s + q.y * c, q.z];
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i]!, v[i]!);
        max[i] = Math.max(max[i]!, v[i]!);
      }
    }
  }
  return max.map((m, i) => m - min[i]!);
}

describe('a style can bypass the grid entirely', () => {
  const compiled = compileStyle(proofTaperedTray);
  const resolved = resolveGeometry(compiled.graph);

  it('declares no grid at all', () => {
    expect(proofTaperedTray.grid).toBeUndefined();
    expect(proofTaperedTray.extraLines!.length).toBeGreaterThan(0);
    expect(proofTaperedTray.extraSeeds!.length).toBe(5);
  });

  it('compiles to the same kind of geometry graph a grid style does', () => {
    const grid = compileStyle(fefco0201).graph;
    expect(Object.keys(compiled.graph).sort()).toEqual(Object.keys(grid).sort());
    expect(compiled.graph.units).toBe('mm');
    for (const line of compiled.graph.lines) {
      expect(line.sourceStyle).toBe('proof.tapered_tray');
      expect(line.role.length).toBeGreaterThan(0);
      expect(line.id.length).toBeGreaterThan(0);
    }
    expect(compiled.warnings).toEqual([]);
  });

  it('derives a blank size without any tracks to measure', () => {
    // wall + W + wall across, and (wall + lip) + D + wall up.
    expect(compiled.blank.width).toBeCloseTo(230, 6);
    expect(compiled.blank.height).toBeCloseTo(45 + 14 + 100 + 45, 1);
    const measured = blankSize(resolved)!;
    expect(measured.width).toBeCloseTo(compiled.blank.width, 6);
    expect(measured.height).toBeCloseTo(compiled.blank.height, 6);
  });

  it('resolves five faces and four hinges, cleanly', () => {
    expect(resolved.faces).toHaveLength(5);
    expect(resolved.hinges).toHaveLength(4);
    expect(resolved.unresolved).toEqual([]);
    expect(resolved.unreachableFaceIds).toEqual([]);
    expect(resolved.foldTree!.closingHinges).toEqual([]);
  });

  it('resolves non-rectangular faces to their exact trapezoid areas', () => {
    const area = (role: string) => resolved.faces.find((f) => f.role === role)!.area;
    expect(area('base')).toBeCloseTo(140 * 100, 6);
    // Trapezoid: parallel sides D and D+2·splay, height wall.
    expect(area('west_wall')).toBeCloseTo(((100 + 124) / 2) * 45, 6);
    expect(area('east_wall')).toBeCloseTo(((100 + 124) / 2) * 45, 6);
    expect(area('north_wall')).toBeCloseTo(((140 + 164) / 2) * 45, 6);
  });

  it('carries the arc through the whole pipeline', () => {
    const south = resolved.faces.find((f) => f.role === 'south_wall')!;
    const north = resolved.faces.find((f) => f.role === 'north_wall')!;
    // The straight-edged wall is a quad; the curved one is not.
    expect(north.outer.points.length).toBe(4);
    expect(south.outer.points.length).toBeGreaterThan(12);

    // Its area is the trapezoid plus the circular segment, within the chord
    // tolerance the arc was flattened at.
    const R = (164 * 164 * 0.25 + 196) / 28;
    const half = Math.asin(82 / R);
    const segment = (R * R * 0.5) * (2 * half - Math.sin(2 * half));
    const exact = ((140 + 164) / 2) * 45 + segment;
    expect(south.area).toBeLessThan(exact);
    expect(south.area).toBeGreaterThan(exact - 8);
  });

  it('folds every wall to its own non-90 angle', () => {
    for (const h of resolved.hinges) expect(h.angle).toBeCloseTo(62 * DEG, 12);
    const folded = foldedFacePoints(resolved, 1);
    const maxZ = (role: string) => {
      const id = resolved.faces.find((f) => f.role === role)!.id;
      return Math.max(...folded.get(id)!.points.map((q) => q.z));
    };
    expect(maxZ('base')).toBeCloseTo(0, 9);
    for (const role of ['north_wall', 'west_wall', 'east_wall']) {
      expect(maxZ(role)).toBeCloseTo(45 * Math.sin(62 * DEG), 6);
    }
    // The curved lip reaches further because it bows out by the sagitta.
    expect(maxZ('south_wall')).toBeCloseTo(59 * Math.sin(62 * DEG), 0);
  });

  it('lies flat at fold ratio zero', () => {
    expect(foldedExtents(compiled.graph, 0)[2]).toBeCloseTo(0, 9);
  });

  it('opens and closes with the wall angle', () => {
    // Standing the walls straight up does not square the tray off — they are
    // trapezoids, so each top edge is still splay wider than its base edge.
    const upright = foldedExtents(compileStyle(proofTaperedTray, { params: { wallAngle: 90 } }).graph);
    expect(upright[0]).toBeCloseTo(140 + 2 * 12, 6);
    expect(upright[1]).toBeCloseTo(100 + 2 * 12, 6);
    expect(upright[2]).toBeCloseTo(59, 1);

    // Height follows sin(angle) either side of vertical.
    for (const deg of [40, 62, 90, 130]) {
      const e = foldedExtents(compileStyle(proofTaperedTray, { params: { wallAngle: deg } }).graph);
      expect(e[2], `height at ${deg}°`).toBeCloseTo(59 * Math.sin(deg * DEG), 0);
    }

    // The declared range still governs: an angle below the minimum clamps.
    const under = compileStyle(proofTaperedTray, { params: { wallAngle: 0 } });
    expect(under.params.wallAngle).toBe(5);
    expect(under.warnings.join(' ')).toContain('clamped');
  });
});

describe('nothing downstream assumes axis-aligned rectangles', () => {
  // If face detection, hinge extraction or the fold traversal leaned on the
  // grid's right angles, rotating the blank off-axis would change the answer.
  const cases: [string, GeometryGraph][] = [
    ['grid style (RSC)', compileStyle(fefco0201).graph],
    ['gridless style (tapered tray)', compileStyle(proofTaperedTray).graph],
  ];

  for (const [name, graph] of cases) {
    it(`${name} resolves identically at any rotation`, () => {
      const base = resolveGeometry(graph, { reanchorSeeds: false });
      const baseAreas = base.faces.map((f) => f.area).sort((a, b) => a - b);
      const baseExtents = foldedExtents(graph).sort((a, b) => a - b);

      for (const deg of [7, 31, 90, 137, 214, 359]) {
        const turned = rotateGraph(graph, deg);
        const r = resolveGeometry(turned, { reanchorSeeds: false });

        expect(r.faces, `faces at ${deg}°`).toHaveLength(base.faces.length);
        expect(r.hinges, `hinges at ${deg}°`).toHaveLength(base.hinges.length);
        expect(r.unresolved.length, `unresolved at ${deg}°`).toBe(base.unresolved.length);
        expect(r.faces.map((f) => f.role).sort()).toEqual(base.faces.map((f) => f.role).sort());

        const areas = r.faces.map((f) => f.area).sort((a, b) => a - b);
        areas.forEach((a, i) => expect(a).toBeCloseTo(baseAreas[i]!, 3));

        // A rotated blank folds to a congruent solid: spin it back and the
        // box is the same one.
        const extents = foldedExtents(turned, 1, deg).sort((a, b) => a - b);
        extents.forEach((e, i) => expect(e, `extent ${i} at ${deg}°`).toBeCloseTo(baseExtents[i]!, 3));
      }
    });
  }

  it('keeps hinge angles independent of the blank orientation', () => {
    const graph = compileStyle(proofTaperedTray).graph;
    for (const deg of [23, 118, 271]) {
      const r = resolveGeometry(rotateGraph(graph, deg), { reanchorSeeds: false });
      for (const h of r.hinges) expect(h.angle).toBeCloseTo(62 * DEG, 12);
      expect(r.hinges.every((h) => h.collinear)).toBe(true);
    }
  });

  it('conserves board area under rotation', () => {
    const graph = compileStyle(fefco0201).graph;
    const base = materialArea(resolveGeometry(graph, { reanchorSeeds: false }));
    for (const deg of [11, 67, 203]) {
      expect(materialArea(resolveGeometry(rotateGraph(graph, deg), { reanchorSeeds: false }))).toBeCloseTo(base, 3);
    }
  });
});

describe('arcThrough solves the arc a drafter would dimension', () => {
  it('bows by exactly the requested sagitta', () => {
    for (const lip of [4, 20, 55]) {
      const g = compileStyle(proofTaperedTray, { params: { lip } }).graph;
      const arc = g.lines.find((l) => l.role === 'south_wall.outer_edge')!;
      expect(arc.geometry.kind).toBe('arc');
      // The lip bows away from the base, so it sets the blank's overall height.
      expect(blankSize(resolveGeometry(g))!.height).toBeCloseTo(45 + lip + 100 + 45, 1);
    }
  });

  it('puts the bulge on the left of the from -> to direction', () => {
    const g = compileStyle(proofTaperedTray).graph;
    const arc = g.lines.find((l) => l.role === 'south_wall.outer_edge')!;
    if (arc.geometry.kind !== 'arc') throw new Error('expected an arc');
    // Drawn right-to-left along y = -wall, so "left" is further from the base.
    const lowest = arc.geometry.center.y - arc.geometry.radius;
    expect(lowest).toBeCloseTo(-(45 + 14), 1);
  });

  it('degrades a zero bulge to a straight line rather than erroring', () => {
    const g = compileStyle(proofTaperedTray, { params: { lip: 0 } }).graph;
    const arc = g.lines.find((l) => l.role === 'south_wall.outer_edge')!;
    expect(arc.geometry.kind).toBe('polyline');
    const r = resolveGeometry(g);
    expect(r.faces).toHaveLength(5);
    // With no bulge the south wall is the same trapezoid as the north.
    const south = r.faces.find((f) => f.role === 'south_wall')!;
    expect(south.area).toBeCloseTo(((140 + 164) / 2) * 45, 6);
  });
});
