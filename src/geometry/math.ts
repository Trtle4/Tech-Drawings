import type { Vec2 } from './types.js';

/** Numeric slack for degenerate tests. */
export const EPS = 1e-9;
/** Distance under which two points are the same point, in mm. */
export const WELD_TOL = 1e-4;

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export function normalize(a: Vec2): Vec2 {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Left-hand normal: rotating `a` by +90°. */
export const normalLeft = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export function nearlyEqual(a: number, b: number, tol = WELD_TOL): boolean {
  return Math.abs(a - b) <= tol;
}

export function pointsEqual(a: Vec2, b: Vec2, tol = WELD_TOL): boolean {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
}

/** Signed area of a closed ring. Positive when wound counter-clockwise. */
export function signedArea(points: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % n]!;
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

export function centroidOf(points: readonly Vec2[]): Vec2 {
  const a = signedArea(points);
  if (Math.abs(a) < EPS) {
    // Degenerate ring — fall back to the average of the vertices.
    let sx = 0;
    let sy = 0;
    for (const p of points) {
      sx += p.x;
      sy += p.y;
    }
    const n = Math.max(points.length, 1);
    return { x: sx / n, y: sy / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % n]!;
    const w = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * w;
    cy += (p.y + q.y) * w;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/**
 * Even-odd point-in-polygon using a half-open crossing rule, so a ray passing
 * exactly through a vertex is still counted once.
 */
export function pointInRing(p: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

/**
 * Even-odd test against a soup of segments rather than an ordered ring. Used to
 * decide whether a detected face is material: a point is inside the blank iff a
 * ray from it crosses cut segments an odd number of times. This is why folding
 * never pattern-matches the style library — the cut lines alone define material.
 */
export function pointInSegmentSoup(p: Vec2, segs: readonly [Vec2, Vec2][]): boolean {
  let inside = false;
  for (const [a, b] of segs) {
    if (a.y > p.y !== b.y > p.y) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

/** Perpendicular distance from `p` to segment `a`–`b`. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, scale(ab, t)));
}

/**
 * A point strictly inside a simple ring.
 *
 * Tries the centroid first (correct for every convex face and most concave
 * ones), then falls back to nudging inward from the sharpest convex vertex
 * along its angle bisector. The fallback matters for L-shaped and notched
 * panels where the centroid can land outside the material.
 */
export function interiorPoint(ring: readonly Vec2[]): Vec2 | null {
  if (ring.length < 3) return null;
  const c = centroidOf(ring);
  if (pointInRing(c, ring)) return c;

  const area = signedArea(ring);
  const wind = area >= 0 ? 1 : -1;
  // Shortest edge sets the nudge scale so we stay inside thin features.
  let shortest = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const d = dist(ring[i]!, ring[(i + 1) % ring.length]!);
    if (d > WELD_TOL) shortest = Math.min(shortest, d);
  }
  const step = Math.min(shortest, Math.sqrt(Math.abs(area)) || shortest) * 1e-3;

  for (let i = 0; i < ring.length; i++) {
    const prev = ring[(i - 1 + ring.length) % ring.length]!;
    const cur = ring[i]!;
    const next = ring[(i + 1) % ring.length]!;
    const din = normalize(sub(cur, prev));
    const dout = normalize(sub(next, cur));
    if (len(din) < EPS || len(dout) < EPS) continue;
    // Convex corner for this winding: turn to the inside.
    if (cross(din, dout) * wind <= EPS) continue;
    let bis = normalize(sub(dout, din));
    if (len(bis) < EPS) bis = normalize(normalLeft(dout));
    if (cross(din, bis) * wind < 0) bis = scale(bis, -1);
    for (let k = 1; k <= 6; k++) {
      const cand = add(cur, scale(bis, step * k));
      if (pointInRing(cand, ring)) return cand;
    }
  }

  // Last resort: sample the bounding box.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  for (let i = 1; i < 16; i++) {
    for (let j = 1; j < 16; j++) {
      const cand = {
        x: minX + ((maxX - minX) * i) / 16,
        y: minY + ((maxY - minY) * j) / 16,
      };
      if (pointInRing(cand, ring)) return cand;
    }
  }
  return null;
}

/** Bounding box of a point cloud, or null when empty. */
export function boundsOf(points: readonly Vec2[]): { min: Vec2; max: Vec2 } | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

/**
 * Split parameters along segment A where segment B meets it, including
 * collinear overlap endpoints and T-junctions. Returns t values in (0, 1).
 */
export function splitParams(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): number[] {
  const d1 = sub(a2, a1);
  const d2 = sub(b2, b1);
  const l1 = len(d1);
  const l2 = len(d2);
  if (l1 < WELD_TOL || l2 < WELD_TOL) return [];

  const denom = cross(d1, d2);
  const tolA = WELD_TOL / l1;
  const tolB = WELD_TOL / l2;
  const out: number[] = [];

  if (Math.abs(denom) > EPS * l1 * l2) {
    const r = sub(b1, a1);
    const t = cross(r, d2) / denom;
    const u = cross(r, d1) / denom;
    if (t > -tolA && t < 1 + tolA && u > -tolB && u < 1 + tolB) {
      out.push(Math.min(1, Math.max(0, t)));
    }
    return out;
  }

  // Parallel. Only collinear overlap contributes split points.
  if (Math.abs(cross(sub(b1, a1), d1)) / l1 > WELD_TOL) return [];
  const inv = 1 / (l1 * l1);
  for (const p of [b1, b2]) {
    const t = dot(sub(p, a1), d1) * inv;
    if (t > tolA && t < 1 - tolA) out.push(t);
  }
  return out;
}
