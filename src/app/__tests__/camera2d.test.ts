import { describe, expect, it } from 'vitest';
import { seg } from '../../geometry/build.js';
import {
  collectSnapCandidates,
  DEFAULT_SNAP,
  fitToBounds,
  modelToScreen,
  pan,
  screenToModel,
  snapPoint,
  zoomAt,
  type Camera2D,
  type Viewport,
} from '../camera2d.js';

const VP: Viewport = { width: 800, height: 600 };
const CAM: Camera2D = { cx: 0, cy: 0, zoom: 2 };

describe('modelToScreen / screenToModel', () => {
  it('are inverses', () => {
    const model = { x: 37.5, y: -12.25 };
    const screen = modelToScreen(model, CAM, VP);
    const back = screenToModel(screen, CAM, VP);
    expect(back.x).toBeCloseTo(model.x, 9);
    expect(back.y).toBeCloseTo(model.y, 9);
  });

  it('the camera centre maps to the viewport centre', () => {
    const cam: Camera2D = { cx: 50, cy: -30, zoom: 3 };
    const s = modelToScreen({ x: 50, y: -30 }, cam, VP);
    expect(s.x).toBeCloseTo(VP.width / 2, 9);
    expect(s.y).toBeCloseTo(VP.height / 2, 9);
  });

  it('model y-up becomes screen y-down', () => {
    const above = modelToScreen({ x: 0, y: 10 }, CAM, VP);
    const below = modelToScreen({ x: 0, y: -10 }, CAM, VP);
    expect(above.y).toBeLessThan(below.y);
  });
});

describe('zoomAt', () => {
  it('keeps the screen point under the cursor fixed', () => {
    const cursor = { x: 200, y: 150 };
    const before = screenToModel(cursor, CAM, VP);
    const zoomed = zoomAt(CAM, VP, cursor, 2.5);
    const after = screenToModel(cursor, zoomed, VP);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(zoomed.zoom).toBeCloseTo(CAM.zoom * 2.5, 9);
  });

  it('clamps to a sane zoom range instead of blowing up or vanishing', () => {
    const huge = zoomAt(CAM, VP, { x: 0, y: 0 }, 1e12);
    const tiny = zoomAt(CAM, VP, { x: 0, y: 0 }, 1e-12);
    expect(Number.isFinite(huge.zoom)).toBe(true);
    expect(huge.zoom).toBeLessThan(1e6);
    expect(tiny.zoom).toBeGreaterThan(0);
  });
});

describe('pan', () => {
  it('dragging the view right moves the model-space centre left, scaled by zoom', () => {
    const panned = pan(CAM, 100, 0);
    expect(panned.cx).toBeCloseTo(CAM.cx - 100 / CAM.zoom, 9);
    expect(panned.cy).toBe(CAM.cy);
  });
});

describe('fitToBounds', () => {
  it('centres the camera on the bounds and fills the viewport within the margin', () => {
    const bounds = { min: { x: 0, y: 0 }, max: { x: 400, y: 200 } };
    const cam = fitToBounds(bounds, VP, 0.1);
    expect(cam.cx).toBeCloseTo(200, 9);
    expect(cam.cy).toBeCloseTo(100, 9);
    // The wider axis (400mm vs 800px*0.8=640px) sets the zoom, not the taller one.
    const expectedZoom = (VP.width * 0.8) / 400;
    expect(cam.zoom).toBeCloseTo(expectedZoom, 6);
    // With that zoom, the bounds' corners land inside the viewport.
    const corner = modelToScreen(bounds.max, cam, VP);
    expect(corner.x).toBeLessThanOrEqual(VP.width);
    expect(corner.x).toBeGreaterThanOrEqual(0);
  });

  it('never divides by zero on a degenerate (zero-size) box', () => {
    const cam = fitToBounds({ min: { x: 5, y: 5 }, max: { x: 5, y: 5 } }, VP);
    expect(Number.isFinite(cam.zoom)).toBe(true);
    expect(cam.zoom).toBeGreaterThan(0);
  });
});

describe('collectSnapCandidates', () => {
  it('collects each line\'s two endpoints and one midpoint', () => {
    const lines = [seg('cut', 'a', { x: 0, y: 0 }, { x: 10, y: 0 }), seg('cut', 'b', { x: 0, y: 10 }, { x: 10, y: 10 })];
    const c = collectSnapCandidates(lines);
    expect(c.endpoints).toHaveLength(4);
    expect(c.midpoints).toHaveLength(2);
  });

  it('excludes the named line — a line being dragged should not snap to itself', () => {
    const lines = [seg('cut', 'a', { x: 0, y: 0 }, { x: 10, y: 0 }), seg('cut', 'b', { x: 0, y: 10 }, { x: 10, y: 10 })];
    const c = collectSnapCandidates(lines, lines[0]!.id);
    expect(c.endpoints).toHaveLength(2);
  });

  it('excludes a whole array of lines — a welded vertex drag should not snap to its own group', () => {
    const lines = [
      seg('cut', 'a', { x: 0, y: 0 }, { x: 10, y: 0 }),
      seg('cut', 'b', { x: 0, y: 10 }, { x: 10, y: 10 }),
      seg('cut', 'c', { x: 0, y: 20 }, { x: 10, y: 20 }),
    ];
    const c = collectSnapCandidates(lines, [lines[0]!.id, lines[1]!.id]);
    expect(c.endpoints).toHaveLength(2); // only line c's
  });
});

describe('snapPoint', () => {
  const candidates = { endpoints: [{ x: 10, y: 10 }], midpoints: [{ x: 5, y: 5 }] };

  it('snaps to a nearby endpoint within tolerance', () => {
    const p = snapPoint({ x: 10.4, y: 10.4 }, CAM, candidates, DEFAULT_SNAP);
    expect(p).toEqual({ x: 10, y: 10 });
  });

  it('leaves the point alone when nothing is within tolerance', () => {
    const p = snapPoint({ x: 500, y: 500 }, CAM, candidates, { ...DEFAULT_SNAP, grid: false });
    expect(p).toEqual({ x: 500, y: 500 });
  });

  it('falls back to the grid when endpoint/midpoint snap are both off', () => {
    const settings = { ...DEFAULT_SNAP, endpoints: false, midpoints: false, gridSize: 5 };
    const p = snapPoint({ x: 12.6, y: 1.1 }, CAM, candidates, settings);
    expect(p).toEqual({ x: 15, y: 0 });
  });

  it('a toggled-off snap type is never used even if it would have been closer', () => {
    const settings = { ...DEFAULT_SNAP, endpoints: false, grid: false };
    const p = snapPoint({ x: 10.1, y: 10.1 }, CAM, candidates, settings); // near the endpoint, but it's off
    expect(p).not.toEqual({ x: 10, y: 10 });
  });
});
