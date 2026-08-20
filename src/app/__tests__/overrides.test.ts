import { describe, expect, it } from 'vitest';
import { graph, rect, seg } from '../../geometry/build.js';
import { resolveGeometry } from '../../geometry/resolve.js';
import type { OverrideOp } from '../overrides.js';
import { applyOverrides } from '../overrides.js';

function base() {
  return graph([
    rect('cut', 'blank.outline', 0, 0, 300, 100, 'style.test'),
    seg('crease', 'crease.a', { x: 100, y: 0 }, { x: 100, y: 100 }, 'style.test'),
    seg('crease', 'crease.b', { x: 200, y: 0 }, { x: 200, y: 100 }, 'style.test'),
  ]);
}

describe('applyOverrides — no ops', () => {
  it('is a pass-through: same lines, no hinge overrides', () => {
    const b = base();
    const { graph: g, hingeAngleOverrides } = applyOverrides(b, []);
    expect(g.lines).toHaveLength(3);
    expect(hingeAngleOverrides.size).toBe(0);
  });

  it('does not mutate the base graph — points are cloned, not shared', () => {
    const b = base();
    const { graph: g } = applyOverrides(b, [{ kind: 'move_line', lineId: b.lines[0]!.id, dx: 5, dy: 0 }]);
    const movedPt = (g.lines[0]!.geometry as { points: { x: number }[] }).points[0]!;
    const origPt = (b.lines[0]!.geometry as { points: { x: number }[] }).points[0]!;
    expect(movedPt.x).toBe(5);
    expect(origPt.x).toBe(0);
  });
});

describe('add_line — no untyped geometry', () => {
  it('appends a new user-sourced line with the type given at creation', () => {
    const b = base();
    const ops: OverrideOp[] = [
      { kind: 'add_line', id: 'new.1', type: 'construction', role: 'user.1', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
    ];
    const { graph: g } = applyOverrides(b, ops);
    expect(g.lines).toHaveLength(4);
    const added = g.lines.find((l) => l.id === 'new.1')!;
    expect(added.type).toBe('construction');
    expect(added.sourceStyle).toBe('user');
  });
});

describe('delete_line', () => {
  it('removes exactly the named line and nothing else', () => {
    const b = base();
    const targetId = b.lines[1]!.id;
    const { graph: g } = applyOverrides(b, [{ kind: 'delete_line', lineId: targetId }]);
    expect(g.lines).toHaveLength(2);
    expect(g.lines.find((l) => l.id === targetId)).toBeUndefined();
  });

  it('a delete of an id that no longer exists is a harmless no-op', () => {
    const b = base();
    const { graph: g } = applyOverrides(b, [{ kind: 'delete_line', lineId: 'does.not.exist' }]);
    expect(g.lines).toHaveLength(3);
  });
});

describe('set_line_type', () => {
  it('changes only the named line\'s type', () => {
    const b = base();
    const targetId = b.lines[1]!.id;
    const { graph: g } = applyOverrides(b, [{ kind: 'set_line_type', lineId: targetId, type: 'perf' }]);
    expect(g.lines.find((l) => l.id === targetId)!.type).toBe('perf');
    expect(g.lines.find((l) => l.id === b.lines[2]!.id)!.type).toBe('crease');
  });
});

describe('move_point and move_line — no constraint propagation', () => {
  it('move_point reshapes one endpoint of one line; the neighbouring line is untouched', () => {
    const b = base();
    const target = b.lines[1]!; // crease.a, shares x=100 with nothing structurally linked
    const other = b.lines[2]!; // crease.b
    const { graph: g } = applyOverrides(b, [
      { kind: 'move_point', lineId: target.id, pointIndex: 0, to: { x: 120, y: 0 } },
    ]);
    const movedGeom = g.lines.find((l) => l.id === target.id)!.geometry as { points: { x: number; y: number }[] };
    expect(movedGeom.points[0]).toEqual({ x: 120, y: 0 });
    expect(movedGeom.points[1]).toEqual({ x: 100, y: 100 }); // the untouched endpoint of the SAME line
    const untouched = g.lines.find((l) => l.id === other.id)!.geometry as { points: { x: number }[] };
    expect(untouched.points[0]!.x).toBe(200); // crease.b did not move
  });

  it('move_line translates every point of one line by the same delta, and only that line', () => {
    const b = base();
    const target = b.lines[1]!;
    const { graph: g } = applyOverrides(b, [{ kind: 'move_line', lineId: target.id, dx: 3, dy: -4 }]);
    const moved = g.lines.find((l) => l.id === target.id)!.geometry as { points: { x: number; y: number }[] };
    expect(moved.points[0]).toEqual({ x: 103, y: -4 });
    expect(moved.points[1]).toEqual({ x: 103, y: 96 });
    for (const l of g.lines) {
      if (l.id === target.id) continue;
      const orig = b.lines.find((o) => o.id === l.id)!.geometry as { points: { x: number; y: number }[] };
      const now = l.geometry as { points: { x: number; y: number }[] };
      expect(now.points).toEqual(orig.points);
    }
  });

  it('move_point on a missing pointIndex, or on a deleted line, is a harmless no-op', () => {
    const b = base();
    const target = b.lines[1]!;
    const { graph: g1 } = applyOverrides(b, [{ kind: 'move_point', lineId: target.id, pointIndex: 99, to: { x: 1, y: 1 } }]);
    expect((g1.lines.find((l) => l.id === target.id)!.geometry as { points: unknown[] }).points).toHaveLength(2);

    const { graph: g2 } = applyOverrides(b, [
      { kind: 'delete_line', lineId: target.id },
      { kind: 'move_point', lineId: target.id, pointIndex: 0, to: { x: 1, y: 1 } },
    ]);
    expect(g2.lines.find((l) => l.id === target.id)).toBeUndefined();
  });
});

describe('ops replay deterministically in order', () => {
  it('a later op on the same line wins', () => {
    const b = base();
    const target = b.lines[1]!;
    const ops: OverrideOp[] = [
      { kind: 'set_line_type', lineId: target.id, type: 'perf' },
      { kind: 'set_line_type', lineId: target.id, type: 'score' },
    ];
    const { graph: g } = applyOverrides(b, ops);
    expect(g.lines.find((l) => l.id === target.id)!.type).toBe('score');
  });

  it('add then delete the same new line leaves it gone', () => {
    const b = base();
    const ops: OverrideOp[] = [
      { kind: 'add_line', id: 'new.1', type: 'cut', role: 'user.1', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { kind: 'delete_line', lineId: 'new.1' },
    ];
    const { graph: g } = applyOverrides(b, ops);
    expect(g.lines.find((l) => l.id === 'new.1')).toBeUndefined();
  });
});

describe('set_hinge_angle feeds resolveGeometry\'s existing override layer', () => {
  it('overrides the resolved hinge angle for the named face pair, symmetric in either order', () => {
    const b = base();
    const resolved = resolveGeometry(b);
    expect(resolved.hinges.length).toBeGreaterThan(0);
    const hinge = resolved.hinges[0]!;
    expect(hinge.angle).toBeCloseTo(Math.PI / 2, 9); // untouched default

    const { hingeAngleOverrides } = applyOverrides(b, [
      { kind: 'set_hinge_angle', faceA: hinge.faceA, faceB: hinge.faceB, angleRad: 1.234 },
    ]);
    expect(hingeAngleOverrides.get(`${hinge.faceA}|${hinge.faceB}`)).toBeCloseTo(1.234, 9);
    expect(hingeAngleOverrides.get(`${hinge.faceB}|${hinge.faceA}`)).toBeCloseTo(1.234, 9);

    const reresolved = resolveGeometry(b, { angles: hingeAngleOverrides });
    const sameHinge = reresolved.hinges.find((h) => h.id === hinge.id)!;
    expect(sameHinge.angle).toBeCloseTo(1.234, 9);
  });

  it('does not touch graph.lines at all', () => {
    const b = base();
    const resolved = resolveGeometry(b);
    const hinge = resolved.hinges[0]!;
    const { graph: g } = applyOverrides(b, [
      { kind: 'set_hinge_angle', faceA: hinge.faceA, faceB: hinge.faceB, angleRad: 0.5 },
    ]);
    expect(g.lines).toHaveLength(b.lines.length);
  });
});
