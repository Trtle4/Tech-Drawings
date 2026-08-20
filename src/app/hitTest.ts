/**
 * Pure hit-testing in model space (mm). No DOM — the canvas module converts a
 * pointer event to a model-space point first, then calls in here. Kept
 * separate so it can be unit-tested without a browser.
 */
import type { DrawingLine, Face, Vec2 } from '../geometry/types.js';
import { flattenPath } from '../geometry/arrangement.js';

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Nearest distance from a point to a line's own path (arcs flattened first). */
export function distanceToLine(p: Vec2, line: DrawingLine): number {
  const pts = flattenPath(line.geometry);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, distToSegment(p, pts[i]!, pts[i + 1]!));
  return best;
}

/** Nearest line within `tol` model units, or null. */
export function hitTestLine(p: Vec2, lines: readonly DrawingLine[], tol: number): DrawingLine | null {
  let best: DrawingLine | null = null;
  let bestDist = tol;
  for (const l of lines) {
    const d = distanceToLine(p, l);
    if (d <= bestDist) {
      bestDist = d;
      best = l;
    }
  }
  return best;
}

export interface EndpointHit {
  lineId: string;
  pointIndex: number;
  point: Vec2;
}

/**
 * Nearest editable vertex within `tol`. Only polylines have vertices to grab
 * — arcs are not endpoint-draggable in v1, so they never win this hit test.
 */
export function hitTestEndpoint(p: Vec2, lines: readonly DrawingLine[], tol: number): EndpointHit | null {
  let best: EndpointHit | null = null;
  let bestDist = tol;
  for (const l of lines) {
    if (l.geometry.kind !== 'polyline') continue;
    const points = l.geometry.points;
    for (let i = 0; i < points.length; i++) {
      const pt = points[i]!;
      const d = Math.hypot(pt.x - p.x, pt.y - p.y);
      if (d <= bestDist) {
        bestDist = d;
        best = { lineId: l.id, pointIndex: i, point: pt };
      }
    }
  }
  return best;
}

/** Even-odd ray cast. `ring` need not be closed explicitly (wraps last -> first). */
function pointInRing(p: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const crosses = a.y > p.y !== b.y > p.y;
    if (crosses && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The face whose outer ring contains the point and whose holes do not. */
export function hitTestFace(p: Vec2, faces: readonly Face[]): Face | null {
  for (const f of faces) {
    if (!pointInRing(p, f.outer.points)) continue;
    if (f.holes.some((h) => pointInRing(p, h.points))) continue;
    return f;
  }
  return null;
}
