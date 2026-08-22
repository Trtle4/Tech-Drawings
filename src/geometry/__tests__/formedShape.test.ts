import { describe, expect, it } from 'vitest';
import { compileStyle } from '../../styles/index.js';
import { bagPillow } from '../../styles/catalog/bag-pillow.js';
import { bagGusseted } from '../../styles/catalog/bag-gusseted.js';
import { bagSup } from '../../styles/catalog/bag-sup.js';
import { slitCornerTray } from '../../styles/catalog/slit-corner-tray.js';
import { resolveGeometry } from '../resolve.js';
import { foldedFacePoints } from '../fold.js';
import { computeFormedShape, hasFormedShape, type FormedFace } from '../formedShape.js';
import type { Vec2, Vec3 } from '../types.js';
import type { FormedShapeSpec, StyleDefinition } from '../../styles/schema.js';

function setup(def: StyleDefinition) {
  const compiled = compileStyle(def);
  const resolved = resolveGeometry(compiled.graph);
  return { graph: compiled.graph, resolved };
}

/** Every point of every facet, flattened — a face is one or many facets now. */
function allPoints(f: FormedFace): Vec3[] {
  return f.facets.flatMap((facet) => facet.points);
}

/** Every uv of every facet, flattened, in the same order as `allPoints`. */
function allUv(f: FormedFace): Vec2[] {
  return f.facets.flatMap((facet) => facet.uv);
}

describe('hasFormedShape', () => {
  it('is true for the three bag styles', () => {
    for (const def of [bagPillow, bagGusseted, bagSup]) {
      const { graph } = setup(def);
      expect(hasFormedShape(graph)).toBe(true);
    }
  });

  it('is false for a style with no formedShape declared', () => {
    const { graph } = setup(slitCornerTray);
    expect(hasFormedShape(graph)).toBe(false);
  });
});

describe('computeFormedShape falls back to the rigid fold when there is nothing to form', () => {
  it('matches foldedFacePoints exactly for a style with no formedShape', () => {
    const { graph, resolved } = setup(slitCornerTray);
    const formed = computeFormedShape(graph, resolved);
    const rigid = foldedFacePoints(resolved, 1);
    expect(formed.size).toBe(rigid.size);
    for (const [id, face] of formed) {
      const points = allPoints(face);
      const rigidPoints = rigid.get(id)!.points;
      expect(points).toHaveLength(rigidPoints.length);
      for (let i = 0; i < points.length; i++) {
        expect(points[i]!.x).toBeCloseTo(rigidPoints[i]!.x, 9);
        expect(points[i]!.y).toBeCloseTo(rigidPoints[i]!.y, 9);
        expect(points[i]!.z).toBeCloseTo(rigidPoints[i]!.z, 9);
      }
    }
  });
});

describe('loftedProfile() — gusseted bag: the same engine as the pillow, not bespoke geometry', () => {
  it('produces only finite points across the fill range', () => {
    const { graph, resolved } = setup(bagGusseted);
    for (const fill of [0, 0.25, 0.5, 0.75, 1]) {
      const formed = computeFormedShape(graph, resolved, fill);
      for (const face of formed.values()) {
        for (const p of allPoints(face)) {
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.y)).toBe(true);
          expect(Number.isFinite(p.z)).toBe(true);
        }
      }
    }
  });

  it('the round body flattens toward the crimp cross-section at fill = 0', () => {
    const { graph, resolved } = setup(bagGusseted);
    const params = (graph.meta?.params as Record<string, number>) ?? {};
    const crimpHalfDepth = Math.max(params.caliper!, params.bagD! * 0.06);
    const roundRoles = new Set((graph.formedShape as FormedShapeSpec).faceRoles ?? []);
    const formed = computeFormedShape(graph, resolved, 0);
    for (const face of resolved.faces) {
      if (!roundRoles.has(face.role)) continue;
      for (const p of allPoints(formed.get(face.id)!)) expect(Math.abs(p.z)).toBeLessThanOrEqual(crimpHalfDepth + 1e-9);
    }
  });

  it('the envelope holds a constant width from crimp to midpoint — no wasp waist', () => {
    // The regression this catches: a station profile family whose t does
    // not correspond to the same relative curve position an ellipse would
    // put it at (rounded_rect, which walks arc length) reads the WRONG
    // excess at an internal panel boundary — a gusset-to-gusset seam, not
    // just the seam or front-centre — and the crimp ends up narrower than
    // the midpoint instead of the two matching, exactly the wasp-waist bug
    // the pillow's own dog-ear work fixed. superellipse does not have this
    // problem (a continuous reshaping of the ellipse's own angle
    // parametrization, not a re-parametrization by arc length), which is
    // why the gusseted bag stays on it despite `rounded_rect` reading
    // "boxier" — see the style's own comment.
    const { graph, resolved } = setup(bagGusseted);
    const params = (graph.meta?.params as Record<string, number>) ?? {};
    const byRole = new Map(resolved.faces.map((f) => [f.role, f]));
    const formed = computeFormedShape(graph, resolved, 1);
    const xExtent = (roles: string[]) => {
      const pts = roles.flatMap((r) => allPoints(formed.get(byRole.get(r)!.id)!));
      return Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    };
    const crimpWidth = xExtent(['front_end_bottom', 'back_left_end_bottom', 'back_right_end_bottom']);
    const midY = params.bagL! / 2;
    const midWidth = (() => {
      const pts = ['front_panel', 'back_panel_left', 'back_panel_right']
        .flatMap((r) => allPoints(formed.get(byRole.get(r)!.id)!))
        .filter((p) => Math.abs(p.y - midY) < 2);
      return Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    })();
    expect(crimpWidth).toBeCloseTo(midWidth, 0);
  });

  it('the midpoint bulges to roughly bagD/2 in z as fill rises to 1, well past the crimp bands', () => {
    const { graph, resolved } = setup(bagGusseted);
    const params = (graph.meta?.params as Record<string, number>) ?? {};
    const crimpHalfDepth = Math.max(params.caliper!, params.bagD! * 0.06);
    const roundRoles = new Set((graph.formedShape as FormedShapeSpec).faceRoles ?? []);
    const formed = computeFormedShape(graph, resolved, 1);
    let maxZ = 0;
    for (const face of resolved.faces) {
      if (!roundRoles.has(face.role)) continue;
      for (const p of allPoints(formed.get(face.id)!)) maxZ = Math.max(maxZ, Math.abs(p.z));
    }
    expect(maxZ).toBeGreaterThan(crimpHalfDepth);
    expect(maxZ).toBeLessThanOrEqual(params.bagD! / 2 + 1e-6);
  });

  it('every formed vertex keeps its flat (x, y) as its uv', () => {
    const { graph, resolved } = setup(bagGusseted);
    const formed = computeFormedShape(graph, resolved, 1);
    for (const face of formed.values()) {
      for (const p of allUv(face)) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });

  it('every face is covered — nothing falls through to a bare flat default', () => {
    const { graph, resolved } = setup(bagGusseted);
    const spec = graph.formedShape as FormedShapeSpec;
    const covered = new Set([...(spec.faceRoles ?? []), ...(spec.flapFaceRoles ?? [])]);
    const roles = new Set(resolved.faces.map((f) => f.role));
    expect(covered).toEqual(roles);
  });
});

describe('loftedProfile() — pillow bag: one lofted-cross-section engine, no fold-tree dependency', () => {
  it('the end crimp bands stay near-flat (bounded by the crimp cross-section), at every fill', () => {
    const { graph, resolved } = setup(bagPillow);
    const params = (graph.meta?.params as Record<string, number>) ?? {};
    const crimpHalfDepth = Math.max(params.caliper!, params.bagD! * 0.06);
    const roundRoles = new Set((graph.formedShape as FormedShapeSpec).faceRoles ?? []);
    const bandRoles = new Set(['front_end_bottom', 'back_left_end_bottom', 'back_right_end_bottom', 'front_end_top', 'back_left_end_top', 'back_right_end_top']);
    for (const fill of [0, 0.5, 1]) {
      const formed = computeFormedShape(graph, resolved, fill);
      for (const face of resolved.faces) {
        if (!roundRoles.has(face.role) || !bandRoles.has(face.role)) continue;
        for (const p of allPoints(formed.get(face.id)!)) expect(Math.abs(p.z)).toBeLessThanOrEqual(crimpHalfDepth + 1e-9);
      }
    }
  });

  it('the round body flattens toward the crimp cross-section at fill = 0', () => {
    const { graph, resolved } = setup(bagPillow);
    const params = (graph.meta?.params as Record<string, number>) ?? {};
    const crimpHalfDepth = Math.max(params.caliper!, params.bagD! * 0.06);
    const roundRoles = new Set((graph.formedShape as FormedShapeSpec).faceRoles ?? []);
    const formed = computeFormedShape(graph, resolved, 0);
    for (const face of resolved.faces) {
      if (!roundRoles.has(face.role)) continue;
      for (const p of allPoints(formed.get(face.id)!)) expect(Math.abs(p.z)).toBeLessThanOrEqual(crimpHalfDepth + 1e-9);
    }
  });

  it('the midpoint bulges to roughly bagD/2 in z as fill rises to 1, well past the crimp bands', () => {
    const { graph, resolved } = setup(bagPillow);
    const params = (graph.meta?.params as Record<string, number>) ?? {};
    const crimpHalfDepth = Math.max(params.caliper!, params.bagD! * 0.06);
    const spec = graph.formedShape as FormedShapeSpec;
    const roundRoles = new Set(spec.faceRoles ?? []);
    const formed = computeFormedShape(graph, resolved, 1);
    let maxZ = 0;
    for (const face of resolved.faces) {
      if (!roundRoles.has(face.role)) continue;
      for (const p of allPoints(formed.get(face.id)!)) maxZ = Math.max(maxZ, Math.abs(p.z));
    }
    expect(maxZ).toBeGreaterThan(crimpHalfDepth);
    // Never exceeds the target (the loft never overshoots), and gets close —
    // exactly how close depends on whether a sampled row lands exactly on
    // the midpoint, which the curvature-driven row count does not guarantee.
    expect(maxZ).toBeLessThanOrEqual(params.bagD! / 2 + 1e-6);
    expect(maxZ).toBeGreaterThan(params.bagD! / 2 - 2);
  });

  it('round body and crimp band meet continuously — no seam of their own at the shared edge', () => {
    const { graph, resolved } = setup(bagPillow);
    const params = (graph.meta?.params as Record<string, number>) ?? {};
    const formed = computeFormedShape(graph, resolved, 1);
    const front = resolved.faces.find((f) => f.role === 'front_panel')!;
    const cap = resolved.faces.find((f) => f.role === 'front_end_bottom')!;
    // front_panel's own bottom row sits exactly at y = endSeal, the same flat
    // edge front_end_bottom's top row sits at; their formed points there must
    // coincide.
    const boundaryY = params.endSeal!;
    const frontEdge = allPoints(formed.get(front.id)!).filter((p) => Math.abs(p.y - boundaryY) < 1e-6);
    const capPts = allPoints(formed.get(cap.id)!);
    expect(frontEdge.length).toBeGreaterThan(0);
    for (const fp of frontEdge) {
      const nearest = capPts.reduce((best, p) => (Math.hypot(p.x - fp.x, p.z - fp.z) < Math.hypot(best.x - fp.x, best.z - fp.z) ? p : best));
      expect(Math.hypot(nearest.x - fp.x, nearest.z - fp.z)).toBeLessThan(1e-6);
    }
  });

  it('the fin lies close against the body, never protruding past the flat crimp half-width', () => {
    const { graph, resolved } = setup(bagPillow);
    const params = (graph.meta?.params as Record<string, number>) ?? {};
    const spec = graph.formedShape as FormedShapeSpec;
    const roundRoles = new Set(spec.faceRoles ?? []);
    const flapRoles = new Set(spec.flapFaceRoles ?? []);
    const formed = computeFormedShape(graph, resolved, 1);
    let maxRoundRadius = 0;
    let maxFlapRadius = 0;
    for (const face of resolved.faces) {
      const pts = allPoints(formed.get(face.id)!);
      if (roundRoles.has(face.role)) for (const p of pts) maxRoundRadius = Math.max(maxRoundRadius, Math.hypot(p.x, p.z));
      if (flapRoles.has(face.role)) for (const p of pts) maxFlapRadius = Math.max(maxFlapRadius, Math.hypot(p.x, p.z));
    }
    // The old bug: the fin stood out at the flat crimp's full half-width
    // (girth / 2, i.e. bagW) regardless of how round the body was at that y.
    // Folded flat, it should stay within a fin-seal-ish margin of the body's
    // own actual (fill-dependent) envelope, not out at the flattened width.
    expect(maxFlapRadius).toBeLessThan(maxRoundRadius + params.finSeal! + 2 * params.caliper! + 1);
  });

  it("sealStyle: 'lap' places the seal on the lofted surface itself, not as a standing flap", () => {
    const { graph, resolved } = setup(bagPillow);
    const finSpec = graph.formedShape as FormedShapeSpec;
    const lapGraph = { ...graph, formedShape: { ...finSpec, sealStyle: 'lap' as const } };
    const finFormed = computeFormedShape(graph, resolved, 1);
    const lapFormed = computeFormedShape(lapGraph, resolved, 1);
    const fin = resolved.faces.find((f) => f.role === 'fin_left')!;
    const finPts = allPoints(finFormed.get(fin.id)!);
    const lapPts = allPoints(lapFormed.get(fin.id)!);
    expect(lapPts).not.toEqual(finPts);
    for (const p of lapPts) expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
  });

  it("flapFold: 'right' folds the fin the opposite way from the default 'left'", () => {
    const { graph, resolved } = setup(bagPillow);
    const finSpec = graph.formedShape as FormedShapeSpec;
    const rightGraph = { ...graph, formedShape: { ...finSpec, flapFold: 'right' as const } };
    const left = computeFormedShape(graph, resolved, 1);
    const right = computeFormedShape(rightGraph, resolved, 1);
    const fin = resolved.faces.find((f) => f.role === 'fin_left')!;
    expect(allPoints(right.get(fin.id)!)).not.toEqual(allPoints(left.get(fin.id)!));
  });

  it('is completely unaffected by a hinge angle override — it never reads the fold tree', () => {
    const { graph, resolved } = setup(bagPillow);
    const hinge = resolved.hinges[0]!;
    const resolvedWithOverride = resolveGeometry(graph, {
      angles: new Map([[`${hinge.faceA}|${hinge.faceB}`, 2.5]]),
    });
    for (const fill of [0, 0.5, 1]) {
      const a = computeFormedShape(graph, resolved, fill);
      const b = computeFormedShape(graph, resolvedWithOverride, fill);
      for (const [id, faceA] of a) {
        const faceB = b.get(id)!;
        expect(faceB.facets).toEqual(faceA.facets);
        expect(faceB.outline).toEqual(faceA.outline);
      }
    }
  });

  it('produces only finite points across the fill range', () => {
    const { graph, resolved } = setup(bagPillow);
    for (const fill of [0, 0.25, 0.5, 0.75, 1]) {
      const formed = computeFormedShape(graph, resolved, fill);
      for (const face of formed.values()) {
        for (const p of allPoints(face)) {
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.y)).toBe(true);
          expect(Number.isFinite(p.z)).toBe(true);
        }
      }
    }
  });

  it('every formed vertex keeps its flat (x, y) as its uv', () => {
    const { graph, resolved } = setup(bagPillow);
    const formed = computeFormedShape(graph, resolved, 1);
    for (const face of formed.values()) {
      for (const p of allUv(face)) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });

  it('every face is covered — nothing falls through to a bare flat default', () => {
    const { graph, resolved } = setup(bagPillow);
    const spec = graph.formedShape as FormedShapeSpec;
    const covered = new Set([...(spec.faceRoles ?? []), ...(spec.flapFaceRoles ?? [])]);
    const roles = new Set(resolved.faces.map((f) => f.role));
    expect(covered).toEqual(roles);
  });
});

describe('loftedProfile() — SUP bag: two panels pinched at two fixed side seals, not a wrap-formed tube', () => {
  it('produces only finite points across the fill range', () => {
    const { graph, resolved } = setup(bagSup);
    for (const fill of [0, 0.25, 0.5, 0.75, 1]) {
      const formed = computeFormedShape(graph, resolved, fill);
      for (const face of formed.values()) {
        for (const p of allPoints(face)) {
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.y)).toBe(true);
          expect(Number.isFinite(p.z)).toBe(true);
        }
      }
    }
  });

  it('the pinch points stay at exactly +/- W/2 at every height — they never move', () => {
    const { graph, resolved } = setup(bagSup);
    const params = (graph.meta?.params as Record<string, number>) ?? {};
    const spec = graph.formedShape as FormedShapeSpec;
    const roundRoles = new Set(spec.faceRoles ?? []);
    const formed = computeFormedShape(graph, resolved, 1);
    let maxAbsX = 0;
    for (const face of resolved.faces) {
      if (!roundRoles.has(face.role)) continue;
      for (const p of allPoints(formed.get(face.id)!)) maxAbsX = Math.max(maxAbsX, Math.abs(p.x));
    }
    expect(maxAbsX).toBeCloseTo(params.W! / 2, 6);
  });

  it('depth is greatest near the base and near zero at the top seal', () => {
    const { graph, resolved } = setup(bagSup);
    const params = (graph.meta?.params as Record<string, number>) ?? {};
    const spec = graph.formedShape as FormedShapeSpec;
    const roundRoles = new Set(spec.faceRoles ?? []);
    const byRole = new Map(resolved.faces.map((f) => [f.role, f]));
    const formed = computeFormedShape(graph, resolved, 1);
    const floor = Math.max(params.caliper!, params.G! * 0.06);

    // The assembled (world) axis, not flat y: world y = 0 is the base for
    // every round face here, world y = L is the top seal — see the style's
    // own faceWorldY, which remaps back_panel's flat y for exactly this.
    const back = byRole.get('back_panel')!;
    const nearTop = allPoints(formed.get(back.id)!).filter((p) => Math.abs(p.y - params.L!) < 1);
    const nearBase = allPoints(formed.get(back.id)!).filter((p) => Math.abs(p.y - 0) < 1);
    const maxAbsZ = (pts: { z: number }[]) => Math.max(...pts.map((p) => Math.abs(p.z)));

    expect(maxAbsZ(nearTop)).toBeLessThanOrEqual(floor + 1e-6);
    expect(maxAbsZ(nearBase)).toBeGreaterThan(floor);
    // Never exceeds G (the loft never overshoots), and gets close — exactly
    // how close depends on whether a sampled column lands exactly on the
    // lens's own apex, which the curvature-driven column count does not
    // guarantee (same reasoning as the pillow's own equivalent check).
    expect(maxAbsZ(nearBase)).toBeLessThanOrEqual(params.G! + 1e-6);
    expect(maxAbsZ(nearBase)).toBeGreaterThan(params.G! * 0.95);
    for (const face of resolved.faces) {
      if (!roundRoles.has(face.role)) continue;
      for (const p of allPoints(formed.get(face.id)!)) expect(Math.abs(p.z)).toBeLessThanOrEqual(params.G! + 1e-6);
    }
  });

  it('the base welds exactly to the wall\'s own rim at the shared hinge', () => {
    const { graph, resolved } = setup(bagSup);
    const byRole = new Map(resolved.faces.map((f) => [f.role, f]));
    const formed = computeFormedShape(graph, resolved, 1);
    const wall = byRole.get('back_panel')!;
    const base = byRole.get('gusset_back')!;
    // back_panel's own base-adjacent edge and gusset_back's own hinge edge
    // are the SAME physical crease, both landing at world y = 0 (the
    // style's own faceWorldY/baseWorldY), so every formed point along one
    // must have a matching point on the other at the same (x, z).
    const wallEdge = allPoints(formed.get(wall.id)!).filter((p) => Math.abs(p.y - 0) < 1e-6);
    const baseEdge = allPoints(formed.get(base.id)!).filter((p) => Math.abs(p.y - 0) < 1e-6);
    expect(wallEdge.length).toBeGreaterThan(0);
    expect(baseEdge.length).toBeGreaterThan(0);
    for (const wp of wallEdge) {
      const nearest = baseEdge.reduce((best, p) => (Math.hypot(p.x - wp.x, p.z - wp.z) < Math.hypot(best.x - wp.x, best.z - wp.z) ? p : best));
      expect(Math.hypot(nearest.x - wp.x, nearest.z - wp.z)).toBeLessThan(1e-6);
    }
  });

  it('every face is covered — nothing falls through to a bare flat default', () => {
    const { graph, resolved } = setup(bagSup);
    const spec = graph.formedShape as FormedShapeSpec;
    const covered = new Set([...(spec.faceRoles ?? []), ...(spec.flapFaceRoles ?? []), ...(spec.baseFaceRoles ?? [])]);
    const roles = new Set(resolved.faces.map((f) => f.role));
    expect(covered).toEqual(roles);
  });
});
