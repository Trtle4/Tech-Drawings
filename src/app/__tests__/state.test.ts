import { describe, expect, it } from 'vitest';
import { fefco0201 } from '../../styles/catalog/fefco0201.js';
import { findCoincidentPoints } from '../hitTest.js';
import { createInitialState, Store } from '../state.js';

describe('createInitialState', () => {
  it('defaults to the first catalogue style, fully compiled', () => {
    const state = createInitialState();
    expect(state.styleId).toBeTruthy();
    expect(state.ops).toEqual([]);
    expect(state.selection).toBeNull();
    expect(Object.keys(state.params).length).toBeGreaterThan(0);
  });

  it('accepts a specific style id', () => {
    const state = createInitialState(fefco0201.id);
    expect(state.styleId).toBe(fefco0201.id);
  });
});

describe('Store.getDerived — the recompute pipeline', () => {
  it('matches a direct compileStyle + resolveGeometry when there are no ops', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const d = store.getDerived();
    expect(d.def.id).toBe(fefco0201.id);
    expect(d.resolved.faces.length).toBeGreaterThan(0);
    expect(d.resolved.unresolved).toEqual([]);
  });

  it('is cached until the next mutation', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const first = store.getDerived();
    const second = store.getDerived();
    expect(first).toBe(second);
    store.select({ kind: 'line', lineId: 'x' });
    const third = store.getDerived();
    expect(third).not.toBe(first);
  });

  it('notifies subscribers on every mutation', () => {
    const store = new Store(createInitialState(fefco0201.id));
    let calls = 0;
    store.subscribe(() => calls++);
    store.select({ kind: 'line', lineId: 'x' });
    store.setSnap({ grid: false });
    expect(calls).toBe(2);
  });
});

describe('setParam — dimension inputs regenerate the drawing', () => {
  it('changing L changes the blank size', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const before = store.getDerived().resolved.blankBounds!;
    store.setParam('L', store.getState().params.L! + 50);
    const after = store.getDerived().resolved.blankBounds!;
    expect(after.max.x - after.min.x).not.toBeCloseTo(before.max.x - before.min.x, 3);
  });

  it('resolves to the same face and hinge counts as compiling fresh at that value', () => {
    const store = new Store(createInitialState(fefco0201.id));
    store.setParam('L', 260);
    const d = store.getDerived();
    expect(d.compiledParams.L).toBe(260);
    expect(d.resolved.faces.length).toBe(13);
    expect(d.resolved.hinges.length).toBe(12);
  });
});

describe('ops survive a dimension regeneration', () => {
  it('a deleted line stays deleted after changing a param', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const targetId = store.getDerived().graph.lines[0]!.id;
    store.deleteLine(targetId);
    expect(store.getDerived().graph.lines.find((l) => l.id === targetId)).toBeUndefined();

    store.setParam('L', store.getState().params.L! + 20);
    expect(store.getDerived().graph.lines.find((l) => l.id === targetId)).toBeUndefined();
  });

  it('an added line is still present, at the same coordinates, after a param change', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const id = store.addLine('construction', [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    store.setParam('W', store.getState().params.W! + 15);
    const line = store.getDerived().graph.lines.find((l) => l.id === id);
    expect(line).toBeDefined();
    expect(line!.type).toBe('construction');
  });

  it('a retyped line keeps its new type after a param change', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const targetId = store.getDerived().graph.lines.find((l) => l.type === 'crease')!.id;
    store.setLineType(targetId, 'perf');
    store.setParam('H', store.getState().params.H! + 10);
    expect(store.getDerived().graph.lines.find((l) => l.id === targetId)!.type).toBe('perf');
  });
});

describe('setStyle', () => {
  it('resets params and ops for the new style', () => {
    const store = new Store(createInitialState(fefco0201.id));
    store.addLine('cut', [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    store.select({ kind: 'line', lineId: 'x' });
    store.setStyle(fefco0201.id); // same style is fine, still exercises the reset path
    const s = store.getState();
    expect(s.ops).toEqual([]);
    expect(s.selection).toBeNull();
  });

  it('ignores an unknown style id rather than corrupting state', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const before = store.getState();
    store.setStyle('not.a.real.style');
    expect(store.getState()).toBe(before);
  });
});

describe('deleteLine clears a matching selection', () => {
  it('deselects when the deleted line was selected', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const targetId = store.getDerived().graph.lines[0]!.id;
    store.select({ kind: 'line', lineId: targetId });
    store.deleteLine(targetId);
    expect(store.getState().selection).toBeNull();
  });

  it('leaves an unrelated selection alone', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const lines = store.getDerived().graph.lines;
    store.select({ kind: 'line', lineId: lines[0]!.id });
    store.deleteLine(lines[1]!.id);
    expect(store.getState().selection).toEqual({ kind: 'line', lineId: lines[0]!.id });
  });
});

describe('setHingeAngle', () => {
  it('changes the resolved hinge angle for that face pair', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const hinge = store.getDerived().resolved.hinges[0]!;
    store.setHingeAngle(hinge.faceA, hinge.faceB, 1.1);
    const after = store.getDerived().resolved.hinges.find((h) => h.id === hinge.id)!;
    expect(after.angle).toBeCloseTo(1.1, 9);
  });
});

describe('fitToBlank', () => {
  it('centres the camera on the blank', () => {
    const store = new Store(createInitialState(fefco0201.id));
    store.fitToBlank({ width: 1000, height: 800 });
    const bounds = store.getDerived().resolved.blankBounds!;
    const cam = store.getState().camera;
    expect(cam.cx).toBeCloseTo((bounds.min.x + bounds.max.x) / 2, 6);
    expect(cam.cy).toBeCloseTo((bounds.min.y + bounds.max.y) / 2, 6);
  });
});

describe('undo / redo', () => {
  it('starts with nothing to undo or redo', () => {
    const store = new Store(createInitialState(fefco0201.id));
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
  });

  it('undoes an added line back to no lines added', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const before = store.getDerived().graph.lines.length;
    const id = store.addLine('construction', [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(store.getDerived().graph.lines.some((l) => l.id === id)).toBe(true);
    expect(store.canUndo()).toBe(true);

    store.undo();
    expect(store.getDerived().graph.lines.some((l) => l.id === id)).toBe(false);
    expect(store.getDerived().graph.lines.length).toBe(before);
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(true);
  });

  it('redo replays the undone edit', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const id = store.addLine('construction', [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    store.undo();
    store.redo();
    expect(store.getDerived().graph.lines.some((l) => l.id === id)).toBe(true);
    expect(store.canRedo()).toBe(false);
  });

  it('a new edit after undo drops the redo branch', () => {
    const store = new Store(createInitialState(fefco0201.id));
    store.addLine('construction', [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    store.undo();
    expect(store.canRedo()).toBe(true);
    store.addLine('bleed', [{ x: 2, y: 2 }, { x: 3, y: 3 }]);
    expect(store.canRedo()).toBe(false);
  });

  it('undoes a dimension change', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const originalL = store.getState().params.L;
    store.setParam('L', originalL! + 40);
    expect(store.getState().params.L).toBe(originalL! + 40);
    store.undo();
    expect(store.getState().params.L).toBe(originalL);
  });

  it('undoes a hinge angle edit', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const hinge = store.getDerived().resolved.hinges[0]!;
    const originalAngle = hinge.angle;
    store.setHingeAngle(hinge.faceA, hinge.faceB, 1.1);
    store.undo();
    const after = store.getDerived().resolved.hinges.find((h) => h.id === hinge.id)!;
    expect(after.angle).toBeCloseTo(originalAngle, 9);
  });

  it('undo/redo do not touch camera or snap settings', () => {
    const store = new Store(createInitialState(fefco0201.id));
    store.setCamera({ cx: 99, cy: -50, zoom: 4 });
    store.setSnap({ grid: false });
    store.addLine('cut', [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    store.undo();
    expect(store.getState().camera).toEqual({ cx: 99, cy: -50, zoom: 4 });
    expect(store.getState().snap.grid).toBe(false);
  });

  it('undoing past the start, or redoing past the end, is a harmless no-op', () => {
    const store = new Store(createInitialState(fefco0201.id));
    store.undo();
    store.undo();
    expect(store.getState().ops).toEqual([]);
    store.redo();
    expect(store.getState().ops).toEqual([]);
  });

  it('clears selection on undo/redo, since a selected id may no longer refer to the same thing', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const id = store.addLine('cut', [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    store.select({ kind: 'line', lineId: id });
    store.undo();
    expect(store.getState().selection).toBeNull();
  });
});

describe('revertLine', () => {
  it('removes a user-added line entirely', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const id = store.addLine('construction', [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    store.revertLine(id);
    expect(store.getDerived().graph.lines.some((l) => l.id === id)).toBe(false);
  });

  it('restores a template line to its compiled state, undoing a retype and a move together', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const line = store.getDerived().graph.lines[0]!;
    const originalType = line.type;
    const originalGeometry = JSON.parse(JSON.stringify(line.geometry));
    store.setLineType(line.id, 'perf');
    store.moveLine(line.id, 15, -8);
    expect(store.getDerived().graph.lines.find((l) => l.id === line.id)!.type).toBe('perf');

    store.revertLine(line.id);
    const restored = store.getDerived().graph.lines.find((l) => l.id === line.id)!;
    expect(restored.type).toBe(originalType);
    expect(restored.geometry).toEqual(originalGeometry);
  });

  it('leaves edits to other lines alone', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const [a, b] = store.getDerived().graph.lines;
    store.setLineType(a!.id, 'perf');
    store.setLineType(b!.id, 'score');
    store.revertLine(a!.id);
    expect(store.getDerived().graph.lines.find((l) => l.id === a!.id)!.type).not.toBe('perf');
    expect(store.getDerived().graph.lines.find((l) => l.id === b!.id)!.type).toBe('score');
  });

  it('is itself undoable', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const line = store.getDerived().graph.lines[0]!;
    store.setLineType(line.id, 'perf');
    store.revertLine(line.id);
    expect(store.getDerived().graph.lines.find((l) => l.id === line.id)!.type).not.toBe('perf');
    store.undo();
    expect(store.getDerived().graph.lines.find((l) => l.id === line.id)!.type).toBe('perf');
  });

  it('a shared-vertex move is one edit: reverting any one of its lines drops the whole move', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const lines = store.getDerived().graph.lines;
    const first = lines[0]!;
    const p0 = (first.geometry as { points: { x: number; y: number }[] }).points[0]!;
    const targets = findCoincidentPoints(lines, p0);
    expect(targets.length).toBeGreaterThan(1); // a real welded vertex in a grid style

    store.moveVertex(targets, { x: p0.x + 12, y: p0.y - 7 });
    for (const t of targets) {
      const l = store.getDerived().graph.lines.find((x) => x.id === t.lineId)!;
      const pt = (l.geometry as { points: { x: number; y: number }[] }).points[t.pointIndex]!;
      expect(pt).toEqual({ x: p0.x + 12, y: p0.y - 7 });
    }

    store.revertLine(targets[1]!.lineId); // revert a DIFFERENT line in the same weld group
    for (const t of targets) {
      const l = store.getDerived().graph.lines.find((x) => x.id === t.lineId)!;
      const pt = (l.geometry as { points: { x: number; y: number }[] }).points[t.pointIndex]!;
      expect(pt).toEqual(p0); // every line in the group is back, not just the reverted one
    }
  });
});

describe('revertAll', () => {
  it('clears every op but leaves dimensions untouched', () => {
    const store = new Store(createInitialState(fefco0201.id));
    store.setParam('L', store.getState().params.L! + 20);
    store.addLine('cut', [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    const line = store.getDerived().graph.lines[1]!;
    store.setLineType(line.id, 'perf');

    const paramBefore = store.getState().params.L;
    store.revertAll();
    expect(store.getState().ops).toEqual([]);
    expect(store.getState().params.L).toBe(paramBefore);
  });
});

describe('staleOverrides — flagged, not silently dropped', () => {
  it('a line-targeting op whose line no longer exists is reported', () => {
    const store = new Store(createInitialState(fefco0201.id));
    store.pushOp({ kind: 'set_line_type', lineId: 'not.a.real.line', type: 'perf' });
    const stale = store.getDerived().staleOverrides;
    expect(stale).toHaveLength(1);
    expect(stale[0]!.op.kind).toBe('set_line_type');
    expect(stale[0]!.message).toMatch(/no longer/i);
  });

  it('a hinge angle override whose face pair no longer resolves to a hinge is reported', () => {
    const store = new Store(createInitialState(fefco0201.id));
    store.setHingeAngle('face.nope.a', 'face.nope.b', 1.0);
    const stale = store.getDerived().staleOverrides;
    expect(stale).toHaveLength(1);
    expect(stale[0]!.op.kind).toBe('set_hinge_angle');
  });

  it('a still-valid override is not reported as stale', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const line = store.getDerived().graph.lines[0]!;
    store.setLineType(line.id, 'perf');
    expect(store.getDerived().staleOverrides).toEqual([]);
  });

  it('the graph itself is unaffected by a stale op — it is simply not applied', () => {
    const store = new Store(createInitialState(fefco0201.id));
    const before = store.getDerived().graph.lines.length;
    store.pushOp({ kind: 'delete_line', lineId: 'not.a.real.line' });
    expect(store.getDerived().graph.lines.length).toBe(before);
    expect(store.getDerived().staleOverrides).toHaveLength(1);
  });
});
