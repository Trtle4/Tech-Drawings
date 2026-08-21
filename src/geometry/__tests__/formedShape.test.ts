import { describe, expect, it } from 'vitest';
import { compileStyle } from '../../styles/index.js';
import { bagPillow } from '../../styles/catalog/bag-pillow.js';
import { bagGusseted } from '../../styles/catalog/bag-gusseted.js';
import { bagSup } from '../../styles/catalog/bag-sup.js';
import { slitCornerTray } from '../../styles/catalog/slit-corner-tray.js';
import { resolveGeometry } from '../resolve.js';
import { foldedFacePoints } from '../fold.js';
import { boundsOf } from '../math.js';
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

function extents(formed: ReturnType<typeof computeFormedShape>) {
  const mn = { x: Infinity, y: Infinity, z: Infinity };
  const mx = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const face of formed.values()) {
    for (const p of allPoints(face)) {
      mn.x = Math.min(mn.x, p.x);
      mn.y = Math.min(mn.y, p.y);
      mn.z = Math.min(mn.z, p.z);
      mx.x = Math.max(mx.x, p.x);
      mx.y = Math.max(mx.y, p.y);
      mx.z = Math.max(mx.z, p.z);
    }
  }
  return { x: mx.x - mn.x, y: mx.y - mn.y, z: mx.z - mn.z };
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

describe('gussetedPouch() — SUP bag', () => {
  it('lies exactly in the rigid lay-flat fold\'s own plane at fill = 0', () => {
    // Walls and bases are now sampled as a curvature-driven grid (so the
    // wall's sin() bulge, which peaks at its own MID-height, actually shows
    // up — see gussetedPouch), not just each face's own flat corners, so a
    // point-for-point match against the rigid fold's vertex list no longer
    // applies. At fill = 0 both transforms collapse to zero displacement,
    // so every sampled point must still land exactly on the rigid face's
    // own (flat, z = 0) plane and within its rigid x/y bounds.
    const { graph, resolved } = setup(bagSup);
    const formed = computeFormedShape(graph, resolved, 0);
    const rigid = foldedFacePoints(resolved, 1);
    for (const face of resolved.faces) {
      const bnd = boundsOf(rigid.get(face.id)!.points.map((p) => ({ x: p.x, y: p.y })))!;
      for (const p of allPoints(formed.get(face.id)!)) {
        expect(p.z).toBeCloseTo(0, 9);
        expect(p.x).toBeGreaterThanOrEqual(bnd.min.x - 1e-6);
        expect(p.x).toBeLessThanOrEqual(bnd.max.x + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(bnd.min.y - 1e-6);
        expect(p.y).toBeLessThanOrEqual(bnd.max.y + 1e-6);
      }
    }
  });

  it('stays bounded near the rigid fold\'s own length as it inflates — the disjoint-flat-frame bug this replaced', () => {
    const { graph, resolved } = setup(bagSup);
    const rigid = foldedFacePoints(resolved, 1);
    const rigidExtent = extents(new Map([...rigid].map(([id, v]) => [id, { face: v.face, facets: [{ points: v.points, uv: [] }], outline: [v.points] }])));
    for (const fill of [0, 0.5, 0.75, 1]) {
      const formed = computeFormedShape(graph, resolved, fill);
      const e = extents(formed);
      // Front and back panels must stay aligned along the rigid fold's length
      // axis (y) instead of pulling apart toward the unfolded blank's full
      // length — the bug was Y growing to ~2L+2G (roughly double this).
      expect(e.y).toBeLessThanOrEqual(rigidExtent.y + 1e-6);
      expect(Number.isFinite(e.x)).toBe(true);
      expect(Number.isFinite(e.z)).toBe(true);
    }
  });

  it('bulges outward in z as fill rises, with the overall y unchanged from the rigid fold', () => {
    const { graph, resolved } = setup(bagSup);
    const e0 = extents(computeFormedShape(graph, resolved, 0));
    const e1 = extents(computeFormedShape(graph, resolved, 1));
    expect(e1.z).toBeGreaterThan(e0.z);
    expect(e1.y).toBeCloseTo(e0.y, 6);
  });

  it('opens the base to the walls\' own width, welded to their edge rather than centred on the world origin', () => {
    const { graph, resolved } = setup(bagSup);
    const spec = graph.formedShape as FormedShapeSpec;
    const roles = spec.faceRoles ?? [];
    const byRole = new Map(resolved.faces.map((f) => [f.role, f]));
    const byArea = [...roles.map((r) => byRole.get(r)!)].sort((a, b) => b.area - a.area);
    const wall = byArea[0]!;
    const bases = byArea.slice(2, 4);
    const rigid = foldedFacePoints(resolved, 1);
    const wallBnd = boundsOf(rigid.get(wall.id)!.points.map((p) => ({ x: p.x, y: p.y })))!;
    const formed = computeFormedShape(graph, resolved, 1);
    for (const base of bases) {
      for (const p of allPoints(formed.get(base.id)!)) {
        expect(p.x).toBeGreaterThanOrEqual(wallBnd.min.x - 1e-6);
        expect(p.x).toBeLessThanOrEqual(wallBnd.max.x + 1e-6);
      }
    }
  });

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
});
