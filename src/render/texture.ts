/**
 * Shared math for the artwork round trip: flat mm (model space, y-up) to
 * image pixel space (y-down, origin at the blank's own top-left), and the
 * per-triangle affine fit that lets a raster image texture a projected 3D
 * facet.
 *
 * ONE formula owns the mm-to-pixel conversion, used by the template
 * exporter, the test-artwork generator and the live 2D/3D panes alike —
 * registration is the whole point of the artwork round trip, and that only
 * holds if every consumer agrees on the same transform bit for bit.
 */
import type { Vec2 } from '../geometry/types.js';

export interface PixelFrame {
  /** Model-space bounds this frame covers — normally `resolved.blankBounds`. */
  bounds: { min: Vec2; max: Vec2 };
  /** Pixels per mm, x and y — usually equal, but a stretched upload (wrong aspect ratio) is still mapped onto the full blank rather than rejected. */
  pxPerMmX: number;
  pxPerMmY: number;
}

/** A pixel frame that maps `bounds` onto exactly `widthPx` x `heightPx`. */
export function pixelFrame(bounds: { min: Vec2; max: Vec2 }, widthPx: number, heightPx: number): PixelFrame {
  const w = Math.max(bounds.max.x - bounds.min.x, 1e-9);
  const h = Math.max(bounds.max.y - bounds.min.y, 1e-9);
  return { bounds, pxPerMmX: widthPx / w, pxPerMmY: heightPx / h };
}

/** A pixel frame sized by DPI (pixels per inch) rather than a target pixel size. */
export function pixelFrameAtDpi(bounds: { min: Vec2; max: Vec2 }, dpi: number): PixelFrame {
  const pxPerMm = dpi / 25.4;
  return { bounds, pxPerMmX: pxPerMm, pxPerMmY: pxPerMm };
}

export function templatePixelSize(bounds: { min: Vec2; max: Vec2 }, dpi: number): { width: number; height: number } {
  const pxPerMm = dpi / 25.4;
  return {
    width: Math.max(1, Math.round((bounds.max.x - bounds.min.x) * pxPerMm)),
    height: Math.max(1, Math.round((bounds.max.y - bounds.min.y) * pxPerMm)),
  };
}

/**
 * Model mm (y-up) to image pixel (y-down, origin at the frame's own
 * min-x/max-y corner — the top-left of the exported PNG). The y flip is the
 * one place this whole round trip can silently invert everything if it
 * disagrees with itself between the exporter and the texture sampler, so it
 * lives here once, not re-derived at each call site.
 */
export function mmToPx(p: Vec2, frame: PixelFrame): Vec2 {
  return {
    x: (p.x - frame.bounds.min.x) * frame.pxPerMmX,
    y: (frame.bounds.max.y - p.y) * frame.pxPerMmY,
  };
}

export interface Affine2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/**
 * The unique affine transform M with M*s_i = d_i for i = 0,1,2 — three point
 * correspondences exactly determine a 2D affine map (6 unknowns, 6
 * equations), which is what makes per-triangle texture mapping exact where
 * per-quad mapping is only an approximation: a quad has no affine map that
 * hits all 4 corners in general, but two triangles sharing a diagonal each
 * have one, and they agree exactly along that shared edge.
 *
 * Returns `null` for a degenerate (zero-area) source triangle — the caller's
 * signal to skip drawing that triangle rather than divide by zero.
 */
export function triangleAffine(s0: Vec2, s1: Vec2, s2: Vec2, d0: Vec2, d1: Vec2, d2: Vec2): Affine2D | null {
  const denom = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(denom) < 1e-9) return null;
  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denom;
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denom;
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denom;
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denom;
  const e = d0.x - a * s0.x - c * s0.y;
  const f = d0.y - b * s0.x - d * s0.y;
  return { a, b, c, d, e, f };
}
