import { describe, expect, it } from 'vitest';
import { seg } from '../../geometry/build.js';
import { fefco0201 } from '../../styles/catalog/fefco0201.js';
import { compileStyle } from '../../styles/compile.js';
import { resolveGeometry } from '../../geometry/resolve.js';
import { distanceToLine, findCoincidentPoints, hitTestEndpoint, hitTestFace, hitTestLine } from '../hitTest.js';

const horiz = seg('cut', 'a', { x: 0, y: 0 }, { x: 100, y: 0 });
const vert = seg('crease', 'b', { x: 0, y: 0 }, { x: 0, y: 100 });

describe('distanceToLine', () => {
  it('is zero on the line', () => {
    expect(distanceToLine({ x: 50, y: 0 }, horiz)).toBeCloseTo(0, 9);
  });
  it('is the perpendicular distance off the line', () => {
    expect(distanceToLine({ x: 50, y: 7 }, horiz)).toBeCloseTo(7, 9);
  });
  it('is the distance to the nearest endpoint past the line\'s extent', () => {
    expect(distanceToLine({ x: 110, y: 0 }, horiz)).toBeCloseTo(10, 9);
  });
});

describe('hitTestLine', () => {
  const lines = [horiz, vert];
  it('picks the nearer of two lines within tolerance', () => {
    const hit = hitTestLine({ x: 1, y: 1 }, lines, 5);
    expect(hit).not.toBeNull();
  });
  it('returns null when nothing is within tolerance', () => {
    expect(hitTestLine({ x: 500, y: 500 }, lines, 5)).toBeNull();
  });
  it('distinguishes the two lines by proximity', () => {
    expect(hitTestLine({ x: 50, y: 0.5 }, lines, 2)!.id).toBe(horiz.id);
    expect(hitTestLine({ x: 0.5, y: 50 }, lines, 2)!.id).toBe(vert.id);
  });
});

describe('hitTestEndpoint', () => {
  const lines = [horiz, vert];
  it('finds the nearest vertex within tolerance, and which line/index it belongs to', () => {
    const hit = hitTestEndpoint({ x: 0.3, y: 0.2 }, lines, 2);
    expect(hit).not.toBeNull();
    expect(hit!.point).toEqual({ x: 0, y: 0 });
    // Both lines share an endpoint at the origin; either owner is a valid answer.
    expect([horiz.id, vert.id]).toContain(hit!.lineId);
  });
  it('returns null past tolerance', () => {
    expect(hitTestEndpoint({ x: 5, y: 5 }, lines, 1)).toBeNull();
  });
  it('never matches an arc (no draggable endpoints in v1)', () => {
    const arcLine = { ...horiz, geometry: { kind: 'arc' as const, center: { x: 0, y: 0 }, radius: 10, startAngle: 0, endAngle: Math.PI } };
    expect(hitTestEndpoint({ x: 10, y: 0 }, [arcLine], 5)).toBeNull();
  });
});

describe('findCoincidentPoints — the weld-tolerance group a shared-vertex drag moves', () => {
  it('finds every line with a point at the same location, including the query line', () => {
    const third = seg('cut', 'c', { x: 0, y: 0 }, { x: -50, y: -50 });
    const hits = findCoincidentPoints([horiz, vert, third], { x: 0, y: 0 });
    expect(hits).toHaveLength(3);
    const ids = hits.map((h) => h.lineId).sort();
    expect(ids).toEqual([horiz.id, third.id, vert.id].sort());
  });

  it('uses the geometry core\'s own weld tolerance by default — a near miss does not weld', () => {
    const nearMiss = seg('cut', 'near', { x: 0.01, y: 0.01 }, { x: 10, y: 10 }); // well outside WELD_TOL (1e-4mm)
    const hits = findCoincidentPoints([horiz, vert, nearMiss], { x: 0, y: 0 });
    expect(hits.map((h) => h.lineId)).not.toContain(nearMiss.id);
  });

  it('an exact-weld-tolerance coincidence still counts', () => {
    const exact = seg('cut', 'exact', { x: 0.00005, y: 0 }, { x: 5, y: 5 }); // within 1e-4mm
    const hits = findCoincidentPoints([horiz, exact], { x: 0, y: 0 });
    expect(hits.map((h) => h.lineId)).toContain(exact.id);
  });

  it('a custom tolerance is honoured', () => {
    const near = seg('cut', 'near', { x: 3, y: 0 }, { x: 3, y: 10 });
    expect(findCoincidentPoints([horiz, near], { x: 0, y: 0 }, 5).map((h) => h.lineId)).toContain(near.id);
    expect(findCoincidentPoints([horiz, near], { x: 0, y: 0 }, 1).map((h) => h.lineId)).not.toContain(near.id);
  });

  it('returns each matching point index, not just the line', () => {
    const closed = seg('cut', 'z', { x: 0, y: 0 }, { x: 0, y: 0 }); // degenerate on purpose, both ends at origin
    const hits = findCoincidentPoints([closed], { x: 0, y: 0 });
    expect(hits.map((h) => h.pointIndex).sort()).toEqual([0, 1]);
  });
});

describe('hitTestFace — real geometry, holes excluded', () => {
  const compiled = compileStyle(fefco0201);
  const resolved = resolveGeometry(compiled.graph);

  it('finds the face containing an interior point', () => {
    const face = resolved.faces.find((f) => f.role.includes('front') || f.role.includes('body')) ?? resolved.faces[0]!;
    const hit = hitTestFace(face.centroid, resolved.faces);
    expect(hit?.id).toBe(face.id);
  });

  it('returns null well outside the blank', () => {
    const bounds = resolved.blankBounds!;
    const hit = hitTestFace({ x: bounds.max.x + 1000, y: bounds.max.y + 1000 }, resolved.faces);
    expect(hit).toBeNull();
  });
});
