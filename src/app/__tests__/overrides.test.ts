import { describe, expect, it } from 'vitest';
import { graph, rect, seg } from '../../geometry/build.js';
import { resolveGeometry } from '../../geometry/resolve.js';
import type { OverrideOp } from '../overrides.js';
import { applyOverrides, describeStaleOp, isLineOverridden } from '../overrides.js';

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

describe('staleOps — a line-targeting op whose target is gone is reported, not swallowed', () => {
  it('delete_line of a missing id is stale', () => {
    const b = base();
    const { staleOps } = applyOverrides(b, [{ kind: 'delete_line', lineId: 'ghost' }]);
    expect(staleOps).toEqual([{ kind: 'delete_line', lineId: 'ghost' }]);
  });

  it('set_line_type of a missing id is stale', () => {
    const b = base();
    const { staleOps } = applyOverrides(b, [{ kind: 'set_line_type', lineId: 'ghost', type: 'perf' }]);
    expect(staleOps).toHaveLength(1);
  });

  it('move_point of a missing id, or an out-of-range index, is stale', () => {
    const b = base();
    const real = b.lines[0]!.id;
    const { staleOps: s1 } = applyOverrides(b, [{ kind: 'move_point', lineId: 'ghost', pointIndex: 0, to: { x: 0, y: 0 } }]);
    expect(s1).toHaveLength(1);
    const { staleOps: s2 } = applyOverrides(b, [{ kind: 'move_point', lineId: real, pointIndex: 99, to: { x: 0, y: 0 } }]);
    expect(s2).toHaveLength(1);
  });

  it('move_line of a missing id is stale', () => {
    const b = base();
    const { staleOps } = applyOverrides(b, [{ kind: 'move_line', lineId: 'ghost', dx: 1, dy: 1 }]);
    expect(staleOps).toHaveLength(1);
  });

  it('add_line and set_hinge_angle are never reported stale by applyOverrides itself', () => {
    const b = base();
    const { staleOps } = applyOverrides(b, [
      { kind: 'add_line', id: 'new.1', type: 'cut', role: 'user.1', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { kind: 'set_hinge_angle', faceA: 'x', faceB: 'y', angleRad: 1 },
    ]);
    expect(staleOps).toEqual([]);
  });

  it('a valid op targeting a real line is never reported stale', () => {
    const b = base();
    const real = b.lines[0]!.id;
    const { staleOps } = applyOverrides(b, [{ kind: 'set_line_type', lineId: real, type: 'perf' }]);
    expect(staleOps).toEqual([]);
  });
});

describe('isLineOverridden', () => {
  it('is true for a user-sourced line regardless of ops', () => {
    const line = seg('cut', 'a', { x: 0, y: 0 }, { x: 1, y: 1 }, 'user');
    expect(isLineOverridden(line, [])).toBe(true);
  });

  it('is true for a template line an op targets by id', () => {
    const line = seg('cut', 'a', { x: 0, y: 0 }, { x: 1, y: 1 }, 'style.test');
    expect(isLineOverridden(line, [{ kind: 'set_line_type', lineId: line.id, type: 'perf' }])).toBe(true);
  });

  it('is false for a template line no op mentions', () => {
    const line = seg('cut', 'a', { x: 0, y: 0 }, { x: 1, y: 1 }, 'style.test');
    expect(isLineOverridden(line, [{ kind: 'set_line_type', lineId: 'someone.else', type: 'perf' }])).toBe(false);
  });

  it('add_line and set_hinge_angle ops never mark an unrelated template line as overridden', () => {
    const line = seg('cut', 'a', { x: 0, y: 0 }, { x: 1, y: 1 }, 'style.test');
    const ops: OverrideOp[] = [
      { kind: 'add_line', id: line.id, type: 'cut', role: 'x', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { kind: 'set_hinge_angle', faceA: 'x', faceB: 'y', angleRad: 1 },
    ];
    expect(isLineOverridden(line, ops)).toBe(false);
  });
});

describe('describeStaleOp', () => {
  it('produces a distinct, non-empty message for every op kind', () => {
    const ops: OverrideOp[] = [
      { kind: 'delete_line', lineId: 'x' },
      { kind: 'set_line_type', lineId: 'x', type: 'perf' },
      { kind: 'move_point', lineId: 'x', pointIndex: 0, to: { x: 0, y: 0 } },
      { kind: 'move_vertex', targets: [{ lineId: 'x', pointIndex: 0 }], to: { x: 0, y: 0 } },
      { kind: 'move_line', lineId: 'x', dx: 1, dy: 1 },
      { kind: 'add_line', id: 'x', type: 'cut', role: 'x', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { kind: 'set_hinge_angle', faceA: 'a', faceB: 'b', angleRad: 1 },
    ];
    const messages = ops.map(describeStaleOp);
    for (const m of messages) expect(m.length).toBeGreaterThan(0);
    expect(new Set(messages).size).toBe(messages.length);
  });
});

describe('move_vertex — topological welding, no semantic propagation', () => {
  // Three lines sharing a vertex at the origin, plus one that does not.
  function weldedFixture() {
    return graph([
      seg('cut', 'a', { x: 0, y: 0 }, { x: 100, y: 0 }, 'style.test'),
      seg('crease', 'b', { x: 0, y: 0 }, { x: 0, y: 100 }, 'style.test'),
      seg('crease', 'c', { x: 0, y: 0 }, { x: -80, y: -80 }, 'style.test'),
      seg('cut', 'lonely', { x: 500, y: 500 }, { x: 600, y: 600 }, 'style.test'),
    ]);
  }

  it('moves every named target to the same new point, and only those targets', () => {
    const b = weldedFixture();
    const [a, cr, c, lonely] = b.lines;
    const targets = [
      { lineId: a!.id, pointIndex: 0 },
      { lineId: cr!.id, pointIndex: 0 },
      { lineId: c!.id, pointIndex: 0 },
    ];
    const { graph: g } = applyOverrides(b, [{ kind: 'move_vertex', targets, to: { x: 40, y: 40 } }]);

    for (const id of [a!.id, cr!.id, c!.id]) {
      const pts = (g.lines.find((l) => l.id === id)!.geometry as { points: { x: number; y: number }[] }).points;
      expect(pts[0]).toEqual({ x: 40, y: 40 });
    }
    // The line that did not share the vertex is untouched.
    const lonelyPts = (g.lines.find((l) => l.id === lonely!.id)!.geometry as { points: { x: number; y: number }[] }).points;
    expect(lonelyPts).toEqual([{ x: 500, y: 500 }, { x: 600, y: 600 }]);
    // Each line's OTHER endpoint is untouched too — this reshapes, it does not translate.
    const aPts = (g.lines.find((l) => l.id === a!.id)!.geometry as { points: { x: number; y: number }[] }).points;
    expect(aPts[1]).toEqual({ x: 100, y: 0 });
  });

  it('applies to whichever targets still exist and flags the op stale if any are missing', () => {
    const b = weldedFixture();
    const [a, cr] = b.lines;
    const targets = [
      { lineId: a!.id, pointIndex: 0 },
      { lineId: cr!.id, pointIndex: 0 },
      { lineId: 'ghost', pointIndex: 0 },
    ];
    const { graph: g, staleOps } = applyOverrides(b, [{ kind: 'move_vertex', targets, to: { x: 9, y: 9 } }]);
    const aPts = (g.lines.find((l) => l.id === a!.id)!.geometry as { points: { x: number; y: number }[] }).points;
    expect(aPts[0]).toEqual({ x: 9, y: 9 }); // the surviving targets still moved
    expect(staleOps).toHaveLength(1);
  });

  it('is fully stale, and applies nothing, when every target is missing', () => {
    const b = weldedFixture();
    const targets = [
      { lineId: 'ghost1', pointIndex: 0 },
      { lineId: 'ghost2', pointIndex: 0 },
    ];
    const { graph: g, staleOps } = applyOverrides(b, [{ kind: 'move_vertex', targets, to: { x: 9, y: 9 } }]);
    for (let i = 0; i < b.lines.length; i++) {
      expect((g.lines[i]!.geometry as { points: { x: number; y: number }[] }).points).toEqual(
        (b.lines[i]!.geometry as { points: { x: number; y: number }[] }).points,
      );
    }
    expect(staleOps).toHaveLength(1);
  });

  it('marks every targeted line as overridden', () => {
    const b = weldedFixture();
    const [a, cr] = b.lines;
    const op: OverrideOp = { kind: 'move_vertex', targets: [{ lineId: a!.id, pointIndex: 0 }, { lineId: cr!.id, pointIndex: 0 }], to: { x: 1, y: 1 } };
    expect(isLineOverridden(a!, [op])).toBe(true);
    expect(isLineOverridden(cr!, [op])).toBe(true);
    const lonely = b.lines.find((l) => l.role === 'lonely')!;
    expect(isLineOverridden(lonely, [op])).toBe(false);
  });
});
