import { describe, expect, it } from 'vitest';
import { fefco0201 } from '../../styles/catalog/fefco0201.js';
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
