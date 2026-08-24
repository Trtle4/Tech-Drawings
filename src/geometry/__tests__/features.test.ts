import { describe, expect, it } from 'vitest';
import { emptyGraph, type DrawingLine, type FeatureInstance, type GeometryGraph } from '../types.js';
import { resolveGeometry } from '../resolve.js';
import { compileAllFeatureLines, compileFeatureLines, isKnownFeatureKind, isPegHoleKind, isTopEndSealRole } from '../features.js';

/** A 100x100 square, edges named n/e/s/w, plus one crease so it has a base face and resolves cleanly. */
function squareGraph(): GeometryGraph {
  const lines: DrawingLine[] = [
    { id: 's', type: 'cut', role: 'edge.s', sourceStyle: 'test', geometry: { kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] } },
    { id: 'e', type: 'cut', role: 'edge.e', sourceStyle: 'test', geometry: { kind: 'polyline', points: [{ x: 100, y: 0 }, { x: 100, y: 100 }] } },
    { id: 'n', type: 'cut', role: 'edge.n', sourceStyle: 'test', geometry: { kind: 'polyline', points: [{ x: 100, y: 100 }, { x: 0, y: 100 }] } },
    { id: 'w', type: 'cut', role: 'edge.w', sourceStyle: 'test', geometry: { kind: 'polyline', points: [{ x: 0, y: 100 }, { x: 0, y: 0 }] } },
  ];
  // Off-center, away from (50,50) — several tests below anchor a feature
  // exactly there, and a seed placed on top of it would land inside the
  // feature's own hole (a real, separately-covered case, not what these
  // tests are about).
  return { ...emptyGraph(), lines, faceSeeds: [{ role: 'panel', point: { x: 15, y: 15 } }] };
}

function baseFeature(kind: string, patch: Partial<FeatureInstance> = {}): FeatureInstance {
  return {
    id: 'f1',
    kind,
    anchorFaceRole: 'panel',
    referenceEdgeRole: 'edge.s',
    offset: { x: 50, y: 20 },
    rotation: 0,
    size: { x: 10, y: 10 },
    sourceStyle: 'user',
    ...patch,
  };
}

describe('isKnownFeatureKind', () => {
  it('accepts the v1 library kinds and rejects anything else', () => {
    expect(isKnownFeatureKind('peg_hole.round')).toBe(true);
    expect(isKnownFeatureKind('tear_notch.laser_score')).toBe(true);
    expect(isKnownFeatureKind('peg_hole.hexagon')).toBe(false);
  });
});

describe('isPegHoleKind', () => {
  it('is true only for the three peg hole silhouettes, not the notches', () => {
    expect(isPegHoleKind('peg_hole.round')).toBe(true);
    expect(isPegHoleKind('peg_hole.sombrero')).toBe(true);
    expect(isPegHoleKind('peg_hole.delta')).toBe(true);
    expect(isPegHoleKind('tear_notch.v')).toBe(false);
    expect(isPegHoleKind('tear_notch.u')).toBe(false);
    expect(isPegHoleKind('tear_notch.laser_score')).toBe(false);
  });
});

describe('isTopEndSealRole', () => {
  it('matches every current bag style\'s top-end-seal band naming and nothing else', () => {
    expect(isTopEndSealRole('front_end_top')).toBe(true);
    expect(isTopEndSealRole('back_left_end_top')).toBe(true);
    expect(isTopEndSealRole('gusset_left_back_end_top')).toBe(true);
    expect(isTopEndSealRole('front_end_bottom')).toBe(false);
    expect(isTopEndSealRole('front_panel')).toBe(false);
    expect(isTopEndSealRole('glue_flap')).toBe(false);
  });
});

describe('compileFeatureLines — anchoring', () => {
  it('returns null when the reference edge role does not exist', () => {
    const graph = squareGraph();
    const resolved = resolveGeometry(graph);
    const feature = baseFeature('peg_hole.round', { referenceEdgeRole: 'no.such.edge' });
    expect(compileFeatureLines(feature, graph, resolved)).toBeNull();
  });

  it('returns null when the anchor face role does not exist', () => {
    const graph = squareGraph();
    const resolved = resolveGeometry(graph);
    const feature = baseFeature('peg_hole.round', { anchorFaceRole: 'no.such.face' });
    expect(compileFeatureLines(feature, graph, resolved)).toBeNull();
  });

  it('places a round hole offset along the edge and inward, independent of which way the edge line was drawn', () => {
    const graph = squareGraph();
    const resolved = resolveGeometry(graph);
    // edge.s runs (0,0)->(100,0); offset.x=50 along it, offset.y=20 inward (+y, toward the face centroid at (50,50)).
    const feature = baseFeature('peg_hole.round', { offset: { x: 50, y: 20 }, size: { x: 10, y: 10 } });
    const lines = compileFeatureLines(feature, graph, resolved)!;
    expect(lines).toHaveLength(1);
    const pts = lines[0]!.geometry as { kind: 'polyline'; points: { x: number; y: number }[] };
    const cx = pts.points.reduce((s, p) => s + p.x, 0) / pts.points.length;
    const cy = pts.points.reduce((s, p) => s + p.y, 0) / pts.points.length;
    expect(cx).toBeCloseTo(50, 0);
    expect(cy).toBeCloseTo(20, 0);
  });
});

describe('compileFeatureLines — round peg hole resolves as a real hole', () => {
  it('subtracts the hole from the anchor face, fully inside it, no unresolved warnings', () => {
    const graph = squareGraph();
    const resolved1 = resolveGeometry(graph, { reanchorSeeds: false });
    const feature = baseFeature('peg_hole.round', { offset: { x: 50, y: 50 }, size: { x: 20, y: 20 } });
    const featureLines = compileAllFeatureLines({ ...graph, features: [feature] }, resolved1);
    const graph2 = { ...graph, lines: [...graph.lines, ...featureLines] };
    const resolved2 = resolveGeometry(graph2);

    expect(resolved2.faces).toHaveLength(1);
    const face = resolved2.faces[0]!;
    expect(face.holes).toHaveLength(1);
    // 100x100 minus a 20-diameter circle (radius 10, area ~314.16) — the
    // hole is a 48-gon, not a true circle, so its area is a hair under πr²
    // (the inscribed 48-gon's own area, 2*sin(π/48)*24*10² ≈ 313.26).
    expect(face.area).toBeGreaterThan(10000 - Math.PI * 100 - 5);
    expect(face.area).toBeLessThan(10000 - 300);
    expect(resolved2.unresolved).toHaveLength(0);
  });
});

describe('compileFeatureLines — V and U notches bite the boundary cleanly', () => {
  it.each(['tear_notch.v', 'tear_notch.u'])('%s: one face, reduced area, zero unresolved, apex/bulge lands inward', (kind) => {
    const graph = squareGraph();
    const resolved1 = resolveGeometry(graph, { reanchorSeeds: false });
    // Anchored to edge.s (the south edge, y=0), offset.y ignored for edge-locked kinds — base sits exactly on the edge.
    const feature = baseFeature(kind, { offset: { x: 50, y: 0 }, size: { x: 20, y: 15 } });
    const featureLines = compileAllFeatureLines({ ...graph, features: [feature] }, resolved1);
    const graph2 = { ...graph, lines: [...graph.lines, ...featureLines] };
    const resolved2 = resolveGeometry(graph2);

    expect(resolved2.faces).toHaveLength(1);
    expect(resolved2.unresolved).toHaveLength(0);
    expect(resolved2.faces[0]!.area).toBeLessThan(10000);
    // Every outer-ring point stays within the original square (the notch cuts IN, never adds material outside it).
    for (const p of resolved2.faces[0]!.outer.points) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x).toBeLessThanOrEqual(100 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y).toBeLessThanOrEqual(100 + 1e-6);
    }
  });

  it('ignores rotation for edge-locked notch kinds, keeping the endpoints exactly on the reference edge', () => {
    const graph = squareGraph();
    const resolved1 = resolveGeometry(graph, { reanchorSeeds: false });
    const feature = baseFeature('tear_notch.v', { offset: { x: 50, y: 0 }, rotation: 0.7, size: { x: 20, y: 15 } });
    const lines = compileFeatureLines(feature, graph, resolved1)!;
    const pts = (lines[0]!.geometry as { kind: 'polyline'; points: { x: number; y: number }[] }).points;
    expect(pts[0]!.y).toBeCloseTo(0, 6);
    expect(pts[pts.length - 1]!.y).toBeCloseTo(0, 6);
  });
});

describe('compileFeatureLines — laser score line', () => {
  it('emits a single open perf line, centered at the anchor point, respecting rotation', () => {
    const graph = squareGraph();
    const resolved = resolveGeometry(graph);
    const feature = baseFeature('tear_notch.laser_score', { offset: { x: 50, y: 50 }, size: { x: 30, y: 0 }, rotation: 0 });
    const lines = compileFeatureLines(feature, graph, resolved)!;
    expect(lines).toHaveLength(1);
    expect(lines[0]!.type).toBe('perf');
    const pts = (lines[0]!.geometry as { kind: 'polyline'; points: { x: number; y: number }[] }).points;
    expect(pts).toHaveLength(2);
    expect(Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y)).toBeCloseTo(30, 5);
  });
});

describe('sombrero and delta peg holes resolve as closed holes too', () => {
  it.each(['peg_hole.sombrero', 'peg_hole.delta'])('%s subtracts a hole from the anchor face', (kind) => {
    const graph = squareGraph();
    const resolved1 = resolveGeometry(graph, { reanchorSeeds: false });
    const feature = baseFeature(kind, { offset: { x: 50, y: 50 }, size: { x: 16, y: 8 } });
    const featureLines = compileAllFeatureLines({ ...graph, features: [feature] }, resolved1);
    const graph2 = { ...graph, lines: [...graph.lines, ...featureLines] };
    const resolved2 = resolveGeometry(graph2);
    expect(resolved2.faces).toHaveLength(1);
    expect(resolved2.faces[0]!.holes).toHaveLength(1);
    expect(resolved2.unresolved).toHaveLength(0);
  });
});
