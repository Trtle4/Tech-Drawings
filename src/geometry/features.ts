/**
 * The feature library: peg holes and tear notches, placed as library shapes
 * anchored to a face rather than drawn as raw geometry. `FeatureInstance`
 * (types.ts) has carried this design since early in the project; this is
 * what actually consumes it.
 *
 * A feature never edits a face directly. It compiles to ordinary
 * `DrawingLine`s — the same kind a style's own compiler emits — positioned
 * from its anchor face and reference edge at CURRENT resolved coordinates,
 * then handed back to `resolveGeometry` for a second pass. That second pass
 * is the "boolean operation": the arrangement/face-detection pipeline
 * already subtracts any closed cut loop fully inside a face as a hole
 * (proven case, see faces.test.ts), and already re-splices an open cut
 * polyline whose two endpoints land exactly on an existing boundary line as
 * a bite out of that boundary (empirically confirmed against this exact
 * pipeline before writing this file — an open polyline landing exactly on
 * the edge produces one clean face with zero unresolved warnings; a closed
 * loop that overshoots past the edge leaves a small disconnected scrap
 * face). Nothing in this file touches face outlines, rings or holes
 * directly — it only ever emits lines.
 *
 * This is also what makes "survive a dimension change without moving
 * relative to their anchor edge" free: a feature is recompiled from its
 * anchor face's CURRENT geometry on every derive, the same as every other
 * generated line in the app. There is no absolute position stored anywhere.
 */
import type { DrawingLine, Face, FeatureInstance, GeometryGraph, ResolvedGeometry, Vec2 } from './types.js';
import { flattenPath } from './arrangement.js';

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
const len = (a: Vec2): number => Math.hypot(a.x, a.y);
const norm = (a: Vec2): Vec2 => scale(a, 1 / (len(a) || 1));
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** 90° CCW. */
const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
const rotate = (a: Vec2, radians: number): Vec2 => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};

/** The kinds this v1 library actually implements. `FeatureInstance.kind` is a plain string so a style or a future kind isn't blocked by this union, but only these compile to geometry. */
export const FEATURE_KINDS = [
  'peg_hole.round',
  'peg_hole.sombrero',
  'peg_hole.delta',
  'tear_notch.v',
  'tear_notch.u',
  'tear_notch.laser_score',
] as const;
export type FeatureKind = (typeof FEATURE_KINDS)[number];

export function isKnownFeatureKind(kind: string): kind is FeatureKind {
  return (FEATURE_KINDS as readonly string[]).includes(kind);
}

/** Human label for the "add feature" list. */
export const FEATURE_LABEL: Record<FeatureKind, string> = {
  'peg_hole.round': 'Peg hole — round',
  'peg_hole.sombrero': 'Peg hole — sombrero',
  'peg_hole.delta': 'Peg hole — delta',
  'tear_notch.v': 'Tear notch — V',
  'tear_notch.u': 'Tear notch — U',
  'tear_notch.laser_score': 'Laser score line',
};

/** peg_hole.* and tear_notch.laser_score sit wherever offset+rotation put them, unconstrained. tear_notch.v/.u are edge-locked (see `compileFeatureLines`'s doc comment) — their own rotation input is ignored, not applied. */
function isEdgeLocked(kind: FeatureKind): boolean {
  return kind === 'tear_notch.v' || kind === 'tear_notch.u';
}

/** `true` for the two shapes that cut a bite out of the boundary itself (open path, endpoints on the edge) as opposed to a hole fully inside the face (closed loop). Determines open vs. closed below, not the DXF layer — every kind here is line type 'cut' except the laser score line, which is 'perf'. */
function isEdgeNotch(kind: FeatureKind): boolean {
  return kind === 'tear_notch.v' || kind === 'tear_notch.u';
}

// ---------------------------------------------------------------------------
// Shape generators — local space, origin at the feature's own anchor point,
// +y is "up" for a hole (arbitrary, rotatable) or "inward from the edge" for
// a notch (by construction, see compileFeatureLines). Each returns the path
// points; whether the path is open or closed is decided by the caller from
// the feature kind, not encoded here.
// ---------------------------------------------------------------------------

/** size.x = diameter. Full circle, closed. */
function roundPegHolePoints(size: Vec2): Vec2[] {
  const r = size.x / 2;
  const segments = 48;
  const points: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    points.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return points;
}

/**
 * A circle (size.x diameter) with a triangular peak merged into its top —
 * the classic retail hang-hole silhouette. The peak REPLACES a slice of the
 * circle's own arc rather than sitting on top of it, so the result is one
 * simple closed outline, not two overlapping loops (which would cut a
 * second, unwanted boundary through the first). size.y is how far the peak
 * extends beyond the circle.
 */
function sombreroPegHolePoints(size: Vec2): Vec2[] {
  const r = size.x / 2;
  const apex: Vec2 = { x: 0, y: r + Math.max(0.1, size.y) };
  const gapHalfAngle = Math.PI / 6; // 30°, so the peak's own base is r apart from the apex's shoulders
  const topAngle = Math.PI / 2;
  const start = topAngle + gapHalfAngle;
  const sweep = 2 * Math.PI - 2 * gapHalfAngle;
  const segments = 40;
  const points: Vec2[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = start + (sweep * i) / segments;
    points.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  points.push(apex);
  return points;
}

/** A simple isoceles triangle, apex up. size = (width, height). */
function deltaPegHolePoints(size: Vec2): Vec2[] {
  const w = size.x;
  const h = size.y;
  return [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: 0, y: h / 2 },
  ];
}

/** Open path: base at y=0 (lands exactly on the reference edge), apex at y=size.y inward. size.x = opening width. */
function vNotchPoints(size: Vec2): Vec2[] {
  const w = size.x;
  const d = size.y;
  return [
    { x: -w / 2, y: 0 },
    { x: 0, y: d },
    { x: w / 2, y: 0 },
  ];
}

/** Open path: base at y=0, a half-ellipse bulging inward to y=size.y. size.x = opening width. */
function uNotchPoints(size: Vec2): Vec2[] {
  const w = size.x;
  const d = size.y;
  const segments = 16;
  const points: Vec2[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = Math.PI - (Math.PI * i) / segments; // π..0, over the top of the bulge
    points.push({ x: (w / 2) * Math.cos(angle), y: d * Math.sin(angle) });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Anchoring: find the reference edge and anchor face at CURRENT resolved
// coordinates, build a local frame, and place the shape.
// ---------------------------------------------------------------------------

interface LocalFrame {
  origin: Vec2;
  /** Local +x, world direction. */
  ex: Vec2;
  /** Local +y, world direction — inward from the reference edge for an edge-anchored frame. */
  ey: Vec2;
}

/** The reference edge's endpoints, in current flat coordinates — the FIRST line with this role, per the codebase-wide convention that a role names exactly one line (see features.ts's own module doc / the style catalogue). */
function referenceEdgeEndpoints(graph: GeometryGraph, referenceEdgeRole: string): [Vec2, Vec2] | null {
  const line = graph.lines.find((l) => l.role === referenceEdgeRole);
  if (!line) return null;
  const pts = flattenPath(line.geometry);
  if (pts.length < 2) return null;
  return [pts[0]!, pts[pts.length - 1]!];
}

function anchorFace(resolved: ResolvedGeometry, anchorFaceRole: string): Face | null {
  return resolved.faces.find((f) => f.role === anchorFaceRole) ?? null;
}

/**
 * Builds the placement frame for one feature. `offset.x` runs along the
 * reference edge from its own start point; `offset.y` runs perpendicular,
 * inward (toward the anchor face's centroid) for positive values. `rotation`
 * (radians, CCW) turns the shape's own local axes further — except for the
 * two edge-locked notch kinds, where it is ignored: rotating them would tip
 * their base off the reference edge, breaking the open-path/exact-endpoint
 * bite this whole module depends on (see the module doc comment).
 */
function buildFrame(feature: FeatureInstance, kind: FeatureKind, graph: GeometryGraph, resolved: ResolvedGeometry): LocalFrame | null {
  const edge = referenceEdgeEndpoints(graph, feature.referenceEdgeRole);
  const face = anchorFace(resolved, feature.anchorFaceRole);
  if (!edge || !face) return null;
  const [p0, p1] = edge;
  const dir = norm(sub(p1, p0));
  const rawNormal = perp(dir);
  const mid = scale(add(p0, p1), 0.5);
  const towardFace = norm(sub(face.centroid, mid));
  const inward = dot(rawNormal, towardFace) >= 0 ? rawNormal : scale(rawNormal, -1);

  const origin = add(add(p0, scale(dir, feature.offset.x)), scale(inward, feature.offset.y));
  const angle = isEdgeLocked(kind) ? 0 : feature.rotation;
  return { origin, ex: rotate(dir, angle), ey: rotate(inward, angle) };
}

function toWorld(local: Vec2, frame: LocalFrame): Vec2 {
  return add(frame.origin, add(scale(frame.ex, local.x), scale(frame.ey, local.y)));
}

/**
 * Compiles one feature into the `DrawingLine`(s) it becomes at the CURRENT
 * resolved geometry — `null` if its anchor face or reference edge doesn't
 * exist at this dimension (the same "silently doesn't apply, don't crash"
 * treatment `applyOverrides` gives a stale op; the caller surfaces this to
 * the user rather than this module deciding how).
 */
export function compileFeatureLines(feature: FeatureInstance, graph: GeometryGraph, resolved: ResolvedGeometry): DrawingLine[] | null {
  if (!isKnownFeatureKind(feature.kind)) return null;
  const kind = feature.kind;
  const frame = buildFrame(feature, kind, graph, resolved);
  if (!frame) return null;

  if (kind === 'tear_notch.laser_score') {
    const half = feature.size.x / 2;
    const p1 = toWorld({ x: -half, y: 0 }, frame);
    const p2 = toWorld({ x: half, y: 0 }, frame);
    return [
      {
        id: `${feature.id}`,
        type: 'perf',
        role: `feature.${feature.id}`,
        sourceStyle: feature.sourceStyle,
        geometry: { kind: 'polyline', points: [p1, p2] },
      },
    ];
  }

  const local =
    kind === 'peg_hole.round'
      ? roundPegHolePoints(feature.size)
      : kind === 'peg_hole.sombrero'
        ? sombreroPegHolePoints(feature.size)
        : kind === 'peg_hole.delta'
          ? deltaPegHolePoints(feature.size)
          : kind === 'tear_notch.v'
            ? vNotchPoints(feature.size)
            : uNotchPoints(feature.size);

  const points = local.map((p) => toWorld(p, frame));
  const closed = !isEdgeNotch(kind);
  return [
    {
      id: `${feature.id}`,
      type: 'cut',
      role: `feature.${feature.id}`,
      sourceStyle: feature.sourceStyle,
      geometry: closed ? { kind: 'polyline', points, closed: true } : { kind: 'polyline', points },
    },
  ];
}

/** Compiles every feature in `graph.features`, dropping (not throwing on) any whose anchor no longer resolves. */
export function compileAllFeatureLines(graph: GeometryGraph, resolved: ResolvedGeometry): DrawingLine[] {
  const out: DrawingLine[] = [];
  for (const feature of graph.features) {
    const lines = compileFeatureLines(feature, graph, resolved);
    if (lines) out.push(...lines);
  }
  return out;
}
