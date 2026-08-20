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

import type { Vec3 } from '../geometry/types.js';

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
  azimuth = (48 * Math.PI) / 180,
  elevation = (26 * Math.PI) / 180,
): CameraBasis {
  const U = AXIS[upAxis];
  // A reference vector not parallel to U, to seed the horizontal plane basis.
  // (0,0,1) works unless U itself is Z, in which case fall back to (1,0,0).
  const ref: Vec3 = Math.abs(dot(U, AXIS.z)) > 0.9 ? AXIS.x : AXIS.z;
  const h1 = norm(sub(ref, scale(U, dot(ref, U))));
  const h2 = cross(U, h1);

  const horiz = add(scale(h1, Math.cos(azimuth)), scale(h2, Math.sin(azimuth)));
  const forward = add(scale(horiz, Math.cos(elevation)), scale(U, Math.sin(elevation)));
  const right = add(scale(h1, -Math.sin(azimuth)), scale(h2, Math.cos(azimuth)));
  const up = add(scale(horiz, -Math.sin(elevation)), scale(U, Math.cos(elevation)));

  return { right: norm(right), up: norm(up), forward: norm(forward) };
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
 * Paint order for a set of faces: ply first, camera depth as the tie-break.
 *
 * Two faces at the same ply are ordered by real depth, which is correct for
 * faces that do not overlap on screen (the common case) and reasonable for
 * ones that do. Two faces at different ply are ordered by ply regardless of
 * depth — this is deliberate. A minor flap and a major flap folded to the same
 * position are geometrically coplanar, so their CENTROID-averaged camera depth
 * is close to a coin flip between shapes of different size and footprint; ply
 * is the style's explicit statement of which one actually sits on top, and
 * must win over that noise.
 */
export function paintOrder<T extends { ply: number; depth: number }>(faces: T[]): T[] {
  return [...faces].sort((a, b) => a.ply - b.ply || a.depth - b.depth);
}
