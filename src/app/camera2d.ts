/**
 * Pan, zoom and snap for the 2D canvas. Pure functions — the canvas module
 * owns the DOM events and calls into these; nothing here touches the DOM, so
 * the math is unit-testable without a browser.
 *
 * Model space is millimetres, y-up (the geometry core's convention, and
 * DXF's). Screen space is CSS pixels, y-down. The camera is the model-space
 * point sitting at the centre of the viewport, plus a zoom in screen px per
 * model mm.
 */
import type { DrawingLine, Vec2 } from '../geometry/types.js';
import { flattenPath } from '../geometry/arrangement.js';

export interface Camera2D {
  cx: number;
  cy: number;
  /** Screen pixels per model mm. */
  zoom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export function modelToScreen(p: Vec2, cam: Camera2D, vp: Viewport): Vec2 {
  return {
    x: vp.width / 2 + (p.x - cam.cx) * cam.zoom,
    y: vp.height / 2 - (p.y - cam.cy) * cam.zoom,
  };
}

export function screenToModel(p: Vec2, cam: Camera2D, vp: Viewport): Vec2 {
  return {
    x: cam.cx + (p.x - vp.width / 2) / cam.zoom,
    y: cam.cy - (p.y - vp.height / 2) / cam.zoom,
  };
}

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 200;

/** Zoom by `factor` (> 1 zooms in) about a fixed screen point — that point does not move on screen. */
export function zoomAt(cam: Camera2D, vp: Viewport, screenPoint: Vec2, factor: number): Camera2D {
  const before = screenToModel(screenPoint, cam, vp);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
  const scaled: Camera2D = { ...cam, zoom };
  const after = screenToModel(screenPoint, scaled, vp);
  return { ...scaled, cx: scaled.cx + (before.x - after.x), cy: scaled.cy + (before.y - after.y) };
}

/** Pan by a screen-space delta (e.g. from a pointermove while dragging the background). */
export function pan(cam: Camera2D, dxScreen: number, dyScreen: number): Camera2D {
  return { ...cam, cx: cam.cx - dxScreen / cam.zoom, cy: cam.cy + dyScreen / cam.zoom };
}

/** Frame a model-space bounding box in the viewport with a fractional margin on every side. */
export function fitToBounds(bounds: { min: Vec2; max: Vec2 }, vp: Viewport, marginFrac = 0.1): Camera2D {
  const w = Math.max(bounds.max.x - bounds.min.x, 1e-6);
  const h = Math.max(bounds.max.y - bounds.min.y, 1e-6);
  const zoomX = (vp.width * (1 - marginFrac * 2)) / w;
  const zoomY = (vp.height * (1 - marginFrac * 2)) / h;
  return {
    cx: (bounds.min.x + bounds.max.x) / 2,
    cy: (bounds.min.y + bounds.max.y) / 2,
    zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(zoomX, zoomY))),
  };
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

export interface SnapSettings {
  grid: boolean;
  gridSize: number;
  endpoints: boolean;
  midpoints: boolean;
  /** Screen-pixel radius within which a candidate wins. */
  toleranceScreenPx: number;
}

export const DEFAULT_SNAP: SnapSettings = {
  grid: true,
  gridSize: 5,
  endpoints: true,
  midpoints: true,
  toleranceScreenPx: 10,
};

export interface SnapCandidates {
  endpoints: Vec2[];
  midpoints: Vec2[];
}

/**
 * Endpoints and midpoints of every line, for the snap engine to test against.
 * Arcs are flattened first (same chord tolerance the geometry core uses), so
 * an arc's midpoint is the flattened point nearest its parameter mid-point —
 * an approximation, fine for a snap target.
 */
export function collectSnapCandidates(
  lines: readonly DrawingLine[],
  exclude?: string | readonly string[],
): SnapCandidates {
  const excluded = new Set(typeof exclude === 'string' ? [exclude] : (exclude ?? []));
  const endpoints: Vec2[] = [];
  const midpoints: Vec2[] = [];
  for (const l of lines) {
    if (excluded.has(l.id)) continue;
    const pts = flattenPath(l.geometry);
    if (pts.length === 0) continue;
    endpoints.push(pts[0]!, pts[pts.length - 1]!);
    if (pts.length >= 2) midpoints.push(pts[Math.floor((pts.length - 1) / 2)]!);
  }
  return { endpoints, midpoints };
}

/**
 * Snap a model-space point to the nearest enabled candidate within tolerance,
 * endpoints and midpoints first, grid as the fallback lattice. Returns the
 * input point unchanged if nothing is close enough or every snap type is off.
 */
export function snapPoint(model: Vec2, cam: Camera2D, candidates: SnapCandidates, settings: SnapSettings): Vec2 {
  const tol = settings.toleranceScreenPx / cam.zoom;
  let best: Vec2 | null = null;
  let bestDist = tol;

  const consider = (p: Vec2) => {
    const d = Math.hypot(p.x - model.x, p.y - model.y);
    if (d <= bestDist) {
      bestDist = d;
      best = p;
    }
  };

  if (settings.endpoints) for (const p of candidates.endpoints) consider(p);
  if (settings.midpoints) for (const p of candidates.midpoints) consider(p);
  if (settings.grid && settings.gridSize > 0) {
    consider({
      x: Math.round(model.x / settings.gridSize) * settings.gridSize,
      y: Math.round(model.y / settings.gridSize) * settings.gridSize,
    });
  }
  return best ?? model;
}
