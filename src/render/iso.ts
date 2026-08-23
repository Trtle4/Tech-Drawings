/**
 * Axis-agnostic isometric-style camera for previewing folded/formed geometry.
 *
 * The fold engine embeds a flat pattern into 3D by extruding out of whichever
 * axis a hinge's rotation moves points into — which world axis ends up
 * "vertical" for a given style depends on how that style's wrap folds are
 * built (see `GeometryGraph.upAxis`). A camera that always treats world Z as
 * up gets a wrap-style case sideways, because that case's height is preserved
 * along Y, not Z. This builds the camera basis FROM the declared up axis, so
 * the same projection code is correct for every style without special-casing
 * any of them.
 */

import type { Vec2, Vec3 } from '../geometry/types.js';
import type { FormedFace } from '../geometry/formedShape.js';

export type UpAxis = 'x' | 'y' | 'z';

export interface CameraBasis {
  /** Screen +x in world space. */
  right: Vec3;
  /** Screen +y (up on screen) in world space. */
  up: Vec3;
  /** Direction from the scene toward the camera. Higher dot = closer = drawn on top. */
  forward: Vec3;
}

const AXIS: Record<UpAxis, Vec3> = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
};

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return scale(a, 1 / l);
};

/** The horizontal-plane basis (h1, h2) perpendicular to a given up axis — shared by `cameraBasis` and `orbitTowards`, which is exactly `cameraBasis` run in reverse. */
function horizontalBasis(upAxis: UpAxis): { U: Vec3; h1: Vec3; h2: Vec3 } {
  const U = AXIS[upAxis];
  // A reference vector not parallel to U, to seed the horizontal plane basis.
  // (0,0,1) works unless U itself is Z, in which case fall back to (1,0,0).
  const ref: Vec3 = Math.abs(dot(U, AXIS.z)) > 0.9 ? AXIS.x : AXIS.z;
  const h1 = norm(sub(ref, scale(U, dot(ref, U))));
  const h2 = cross(U, h1);
  return { U, h1, h2 };
}

/**
 * Camera basis for a given up axis, azimuth and elevation.
 *
 * `azimuth`/`elevation` are in radians, matching the spherical-coordinate
 * convention a fixed isometric camera would use: azimuth spins the view
 * around the up axis, elevation tilts the camera up away from the horizontal
 * plane perpendicular to it. Defaults give the same oblique three-quarter view
 * regardless of which axis is up, so switching a style's up axis reorients the
 * model rather than changing the CAMERA ANGLE'S character.
 */
export function cameraBasis(
  upAxis: UpAxis = 'y',
  azimuth = (30 * Math.PI) / 180,
  elevation = (18 * Math.PI) / 180,
): CameraBasis {
  const { U, h1, h2 } = horizontalBasis(upAxis);

  const horiz = add(scale(h1, Math.cos(azimuth)), scale(h2, Math.sin(azimuth)));
  const forward = add(scale(horiz, Math.cos(elevation)), scale(U, Math.sin(elevation)));
  const right = add(scale(h1, -Math.sin(azimuth)), scale(h2, Math.cos(azimuth)));
  const up = add(scale(horiz, -Math.sin(elevation)), scale(U, Math.cos(elevation)));

  return { right: norm(right), up: norm(up), forward: norm(forward) };
}

/**
 * The azimuth/elevation that makes `cameraBasis(upAxis, azimuth, elevation)`'s
 * `forward` point toward `dir` — the exact inverse of `cameraBasis`, reusing
 * its same up-axis basis so the two stay consistent for every `upAxis`. This
 * is what turns a clicked view-cube face's outward normal into an orbit
 * target: RSC's `viewcube.js` solves the same inversion for its fixed Y-up
 * three.js camera (`rx = asin(dy/mag), ry = atan2(dx, dz)`); this version
 * generalizes that to an arbitrary up axis by projecting `dir` onto the same
 * `(U, h1, h2)` basis `cameraBasis` itself is built from.
 */
export function orbitTowards(dir: Vec3, upAxis: UpAxis = 'y'): { azimuth: number; elevation: number } {
  const { U, h1, h2 } = horizontalBasis(upAxis);
  const d = norm(dir);
  const elevation = Math.asin(Math.max(-1, Math.min(1, dot(d, U))));
  const azimuth = Math.atan2(dot(d, h2), dot(d, h1));
  return { azimuth, elevation };
}

export interface Projected2D {
  x: number;
  y: number;
  /** Camera-space depth: higher = nearer the camera. */
  depth: number;
}

export function project(p: Vec3, cam: CameraBasis): Projected2D {
  return { x: dot(p, cam.right), y: -dot(p, cam.up), depth: dot(p, cam.forward) };
}

/**
 * Paint order for a set of facets: real camera depth, with ply as a
 * tie-break for facets that are effectively coplanar.
 *
 * Ply exists for a genuinely ambiguous case: a minor flap and a major flap
 * folded to the same position are geometrically coplanar, so their
 * CENTROID-averaged camera depth is close to a coin flip between shapes of
 * different size and footprint — ply is the style's explicit statement of
 * which one actually sits on top there. But that reasoning only holds when
 * the depths really are close. A `lofted_profile` face (a stand-up pouch's
 * front and back panel, say) can carry a ply too, set for exactly that
 * flat-folded case — yet at any real fill it sweeps through a wide, genuinely
 * separated depth range along its own length, not a fixed offset from its
 * counterpart. Letting ply win there regardless of depth (as a strict
 * primary sort key would) pins one face permanently "on top" even from a
 * camera angle where the far side of it should visibly be occluded by
 * something nearer — a top or bottom view being exactly that angle for a
 * pouch's front/back split. So ply only overrides depth within a small
 * coplanarity tolerance, scaled to this call's own depth range; outside it,
 * real depth decides, the same as same-ply facets always have.
 */
export function paintOrder<T extends { ply: number; depth: number }>(faces: T[]): T[] {
  let minD = Infinity;
  let maxD = -Infinity;
  for (const f of faces) {
    if (f.depth < minD) minD = f.depth;
    if (f.depth > maxD) maxD = f.depth;
  }
  const coplanarEps = (maxD - minD) * 0.02;
  return [...faces].sort((a, b) => {
    const dd = a.depth - b.depth;
    if (Math.abs(dd) > coplanarEps) return dd;
    return a.ply - b.ply || dd;
  });
}

/** One projected, shaded, paintable patch — a facet of a `FormedFace`, ready to draw. */
export interface ProjectedFacet {
  pts: Vec2[];
  depth: number;
  shade: number;
  ply: number;
  /**
   * True for a face's own outer-boundary trace: stroke only, no fill. A
   * lofted face's interior facets are seamed invisibly (their own fill
   * colour), so this is what actually marks a real edge — a different
   * panel, a fin folded on — without the tessellation itself showing as a
   * mesh.
   */
  outline?: boolean;
  /**
   * Flat (x, y) per point in `pts`, carried through unchanged from
   * `FormedFacet.uv` — absent for outline segments, which are never
   * textured. This is what lets a consumer (the 3D pane, when artwork is
   * applied) sample the SAME template image this facet's own flat pattern
   * region would print from, via a per-triangle affine fit between `uv`
   * (source, in the template's mm/pixel space) and `pts` (destination, in
   * screen space).
   */
  uv?: Vec2[];
}

function projectRing(points: Vec3[], uv: Vec2[], cam: CameraBasis): { pts: Vec2[]; depth: number; shade: number; uv: Vec2[] } | null {
  if (points.length < 3) return null;
  const proj = points.map((p) => project(p, cam));
  const depth = proj.reduce((s, q) => s + q.depth, 0) / proj.length;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  const dot3 = (nx / len) * cam.forward.x + (ny / len) * cam.forward.y + (nz / len) * cam.forward.z;
  return { pts: proj.map((q) => ({ x: q.x, y: q.y })), depth, shade: Math.abs(dot3), uv };
}

/**
 * Project every facet of every formed face through a camera and return them
 * in paint order, ready to draw as one SVG path each.
 *
 * Operating per FACET rather than per face is what makes a lofted, curved
 * face render as a curve: each small quad gets its own normal, so a panel
 * that curves toward the camera on one edge and away on the other shades
 * (and self-occludes via paint order) the way a curved surface should,
 * instead of being one flat-shaded polygon standing in for the whole panel.
 * A rigid, flat face — still exactly one facet — renders identically to
 * before this existed.
 *
 * Each face's own `outline` is projected too, but as many short EDGE
 * segments rather than one path for the whole loop — a face's boundary can
 * sweep a wide depth range along its own length (the seam down a curved
 * bag's back runs from near the crimp to deep at the midpoint), and a
 * single average-depth sort key for the whole loop can lose locally even
 * where a segment should clearly win, painting real edges away in patches.
 * Per-segment depth keeps that sort as local as the fill facets already
 * get.
 */
export function projectFormedFaces(formed: Map<string, FormedFace>, cam: CameraBasis): ProjectedFacet[] {
  const out: ProjectedFacet[] = [];
  for (const { face, facets, outline } of formed.values()) {
    for (const { points, uv } of facets) {
      const r = projectRing(points, uv, cam);
      if (r) out.push({ ...r, ply: face.ply });
    }
    for (const loop of outline) {
      for (let i = 0; i < loop.length; i++) {
        const a = project(loop[i]!, cam);
        const b = project(loop[(i + 1) % loop.length]!, cam);
        out.push({
          pts: [
            { x: a.x, y: a.y },
            { x: b.x, y: b.y },
          ],
          depth: (a.depth + b.depth) / 2,
          shade: 0,
          ply: face.ply,
          outline: true,
        });
      }
    }
  }
  return paintOrder(out);
}
