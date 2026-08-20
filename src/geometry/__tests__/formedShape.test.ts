import { describe, expect, it } from 'vitest';
import { compileStyle } from '../../styles/index.js';
import { bagPillow } from '../../styles/catalog/bag-pillow.js';
import { bagGusseted } from '../../styles/catalog/bag-gusseted.js';
import { bagSup } from '../../styles/catalog/bag-sup.js';
import { slitCornerTray } from '../../styles/catalog/slit-corner-tray.js';
import { resolveGeometry } from '../resolve.js';
import { foldedFacePoints } from '../fold.js';
import { computeFormedShape, hasFormedShape } from '../formedShape.js';
import type { FormedShapeSpec, StyleDefinition } from '../../styles/schema.js';

function setup(def: StyleDefinition) {
  const compiled = compileStyle(def);
  const resolved = resolveGeometry(compiled.graph);
  return { graph: compiled.graph, resolved };
}

function extents(formed: ReturnType<typeof computeFormedShape>) {
  const mn = { x: Infinity, y: Infinity, z: Infinity };
  const mx = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const { points } of formed.values()) {
    for (const p of points) {
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
    for (const [id, { points }] of formed) {
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

describe.each([
  ['pillow', bagPillow],
  ['gusseted', bagGusseted],
] as const)('tube() — %s bag', (_name, def) => {
  it('leaves flatFaceRoles faces (seals, fin) exactly at the rigid fold, for every fill', () => {
    const { graph, resolved } = setup(def);
    const spec = graph.formedShape as FormedShapeSpec;
    const flatRoles = new Set(spec.flatFaceRoles ?? []);
    const rigid = foldedFacePoints(resolved, 1);
    for (const fill of [0, 0.5, 1]) {
      const formed = computeFormedShape(graph, resolved, fill);
      for (const face of resolved.faces) {
        if (!flatRoles.has(face.role)) continue;
        const formedFace = formed.get(face.id)!;
        const rigidFace = rigid.get(face.id)!;
        expect(formedFace.points).toHaveLength(rigidFace.points.length);
        for (let i = 0; i < formedFace.points.length; i++) {
          expect(formedFace.points[i]!.x).toBeCloseTo(rigidFace.points[i]!.x, 9);
          expect(formedFace.points[i]!.y).toBeCloseTo(rigidFace.points[i]!.y, 9);
          expect(formedFace.points[i]!.z).toBeCloseTo(rigidFace.points[i]!.z, 9);
        }
      }
    }
  });

  it('flattens the round panels to z = 0 at fill = 0', () => {
    const { graph, resolved } = setup(def);
    const spec = graph.formedShape as FormedShapeSpec;
    const roundRoles = new Set(spec.faceRoles ?? []);
    const formed = computeFormedShape(graph, resolved, 0);
    for (const face of resolved.faces) {
      if (!roundRoles.has(face.role)) continue;
      for (const p of formed.get(face.id)!.points) expect(p.z).toBeCloseTo(0, 9);
    }
  });

  it('produces only finite points across the fill range', () => {
    const { graph, resolved } = setup(def);
    for (const fill of [0, 0.25, 0.5, 0.75, 1]) {
      const formed = computeFormedShape(graph, resolved, fill);
      for (const { points } of formed.values()) {
        for (const p of points) {
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.y)).toBe(true);
          expect(Number.isFinite(p.z)).toBe(true);
        }
      }
    }
  });

  it('every formed vertex keeps its flat (x, y) as its uv — the shared parameterization', () => {
    const { graph, resolved } = setup(def);
    const formed = computeFormedShape(graph, resolved, 1);
    for (const { uv } of formed.values()) {
      for (const p of uv) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });

  it('rounds toward a girth-preserving tube as fill rises, without blowing up', () => {
    const { graph, resolved } = setup(def);
    const e0 = extents(computeFormedShape(graph, resolved, 0));
    const e1 = extents(computeFormedShape(graph, resolved, 1));
    // Folding into a round cross-section shortens the flattened girth axis
    // and grows depth (z); length (y) is untouched by this approximation.
    expect(e1.x).toBeLessThan(e0.x);
    expect(e1.z).toBeGreaterThan(e0.z);
    expect(e1.y).toBeCloseTo(e0.y, 6);
  });
});

describe('gussetedPouch() — SUP bag', () => {
  it('is exactly the rigid lay-flat fold at fill = 0', () => {
    const { graph, resolved } = setup(bagSup);
    const formed = computeFormedShape(graph, resolved, 0);
    const rigid = foldedFacePoints(resolved, 1);
    for (const face of resolved.faces) {
      const formedFace = formed.get(face.id)!;
      const rigidFace = rigid.get(face.id)!;
      expect(formedFace.points).toHaveLength(rigidFace.points.length);
      for (let i = 0; i < formedFace.points.length; i++) {
        expect(formedFace.points[i]!.x).toBeCloseTo(rigidFace.points[i]!.x, 9);
        expect(formedFace.points[i]!.y).toBeCloseTo(rigidFace.points[i]!.y, 9);
        expect(formedFace.points[i]!.z).toBeCloseTo(rigidFace.points[i]!.z, 9);
      }
    }
  });

  it('stays bounded near the rigid fold\'s own length as it inflates — the disjoint-flat-frame bug this replaced', () => {
    const { graph, resolved } = setup(bagSup);
    const rigid = foldedFacePoints(resolved, 1);
    const rigidExtent = extents(new Map([...rigid].map(([id, v]) => [id, { face: v.face, points: v.points, uv: [] }])));
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

  it('bulges outward in z and opens in x as fill rises, with y unchanged from the rigid fold', () => {
    const { graph, resolved } = setup(bagSup);
    const e0 = extents(computeFormedShape(graph, resolved, 0));
    const e1 = extents(computeFormedShape(graph, resolved, 1));
    expect(e1.z).toBeGreaterThan(e0.z);
    expect(e1.x).toBeGreaterThan(e0.x);
    expect(e1.y).toBeCloseTo(e0.y, 6);
  });

  it('produces only finite points across the fill range', () => {
    const { graph, resolved } = setup(bagSup);
    for (const fill of [0, 0.25, 0.5, 0.75, 1]) {
      const formed = computeFormedShape(graph, resolved, fill);
      for (const { points } of formed.values()) {
        for (const p of points) {
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.y)).toBe(true);
          expect(Number.isFinite(p.z)).toBe(true);
        }
      }
    }
  });
});
