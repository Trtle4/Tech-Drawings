import type { Face, ResolvedGeometry, Vec2, Vec3 } from './types.js';
import { orientedAxis } from './hinges.js';

/**
 * Fold transforms. Pure maths, no renderer — the 3D viewer will apply these to
 * meshes built from the same faces the 2D canvas draws.
 *
 * Each face inherits its parent's transform and adds a rotation about its own
 * hinge axis, expressed in flat coordinates. Composing in flat space works
 * because the subtree below a hinge is still flat at the moment that hinge's
 * rotation is applied.
 */

/** Column-major 4x4, matching the convention three.js expects. */
export type Mat4 = Float64Array;

export function identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export function applyPoint(m: Mat4, p: Vec3): Vec3 {
  return {
    x: m[0]! * p.x + m[4]! * p.y + m[8]! * p.z + m[12]!,
    y: m[1]! * p.x + m[5]! * p.y + m[9]! * p.z + m[13]!,
    z: m[2]! * p.x + m[6]! * p.y + m[10]! * p.z + m[14]!,
  };
}

/** Rotation of `angle` radians about the line through `a` and `b` in the z=0 plane. */
export function rotationAboutAxis2D(a: Vec2, b: Vec2, angle: number): Mat4 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  if (l < 1e-12) return identity();
  const ux = dx / l;
  const uy = dy / l;
  const uz = 0;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;

  // Rodrigues' rotation, then conjugated by the translation to the axis point.
  const r = [
    t * ux * ux + c,
    t * ux * uy + s * uz,
    t * ux * uz - s * uy,
    t * ux * uy - s * uz,
    t * uy * uy + c,
    t * uy * uz + s * ux,
    t * ux * uz + s * uy,
    t * uy * uz - s * ux,
    t * uz * uz + c,
  ];

  const m = new Float64Array(16);
  m[0] = r[0]!;
  m[1] = r[1]!;
  m[2] = r[2]!;
  m[4] = r[3]!;
  m[5] = r[4]!;
  m[6] = r[5]!;
  m[8] = r[6]!;
  m[9] = r[7]!;
  m[10] = r[8]!;
  m[15] = 1;
  // Translate so the axis point stays put.
  m[12] = a.x - (r[0]! * a.x + r[3]! * a.y);
  m[13] = a.y - (r[1]! * a.x + r[4]! * a.y);
  m[14] = -(r[2]! * a.x + r[5]! * a.y);
  return m;
}

/**
 * Transform per face at a given fold ratio.
 *
 * `ratio` runs 0 (flat) to 1 (each hinge at its own target angle), which is
 * exactly what the fold slider drives. Faces with no path to the base face get
 * the identity so they stay visible lying flat instead of disappearing.
 */
export function foldTransforms(resolved: ResolvedGeometry, ratio = 1): Map<string, Mat4> {
  const out = new Map<string, Mat4>();
  const tree = resolved.foldTree;
  for (const f of resolved.faces) out.set(f.id, identity());
  if (!tree) return out;

  const hingeById = new Map(resolved.hinges.map((h) => [h.id, h]));
  const faceById = new Map(resolved.faces.map((f) => [f.id, f]));

  for (const faceId of tree.order) {
    const parentId = tree.parent.get(faceId);
    if (parentId === undefined) continue;
    const hinge = hingeById.get(tree.parentHinge.get(faceId)!);
    const face = faceById.get(faceId);
    if (!hinge || !face) continue;
    const axis = orientedAxis(hinge, face.centroid);
    const rot = rotationAboutAxis2D(axis.a, axis.b, hinge.angle * ratio);
    out.set(faceId, multiply(out.get(parentId)!, rot));
  }
  return out;
}

/**
 * Folded 3D position of every outer-ring vertex, ready to feed a mesh
 * builder — plus every hole ring's vertices, folded through the exact same
 * per-face rigid transform, so a peg hole or tear notch (see
 * geometry/features.ts) ends up in the right place on the formed pack
 * without this function's callers needing to know holes exist at all.
 */
export function foldedFacePoints(
  resolved: ResolvedGeometry,
  ratio = 1,
): Map<string, { face: Face; points: Vec3[]; holes: Vec3[][] }> {
  const transforms = foldTransforms(resolved, ratio);
  const out = new Map<string, { face: Face; points: Vec3[]; holes: Vec3[][] }>();
  for (const face of resolved.faces) {
    const m = transforms.get(face.id) ?? identity();
    out.set(face.id, {
      face,
      points: face.outer.points.map((p) => applyPoint(m, { x: p.x, y: p.y, z: 0 })),
      holes: face.holes.map((hole) => hole.points.map((p) => applyPoint(m, { x: p.x, y: p.y, z: 0 }))),
    });
  }
  return out;
}
