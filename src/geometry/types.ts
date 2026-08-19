/**
 * The single geometry graph that the whole app derives from.
 *
 * There is no separate "2D model" and "3D model". The 2D canvas draws the lines
 * in this graph; the 3D viewer folds the faces resolved from this graph. Both
 * read the same object.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Semantics of a line, not just its appearance. Drives face detection,
 * hinge extraction, DXF layer assignment and 2D stroke style.
 *
 *  - cut          material boundary. Bounds the blank and cuts holes in it.
 *  - crease       fold line. Subdivides the blank into faces; becomes a hinge.
 *  - perf         perforation. Subdivides and hinges, but tears rather than folds.
 *  - score        half-cut fold assist. Behaves like a crease.
 *  - bleed        artwork bleed guide. Non-structural.
 *  - dimension    dimension/witness line. Non-structural, drawing furniture.
 *  - construction reference geometry. Non-structural.
 */
export type LineType =
  | 'cut'
  | 'crease'
  | 'perf'
  | 'score'
  | 'bleed'
  | 'dimension'
  | 'construction';

/** Types that bound material. A point is "inside the blank" iff cut lines say so. */
export const BOUNDING_TYPES: readonly LineType[] = ['cut'];

/** Types that subdivide the bounded region into faces. */
export const SUBDIVIDING_TYPES: readonly LineType[] = ['crease', 'perf', 'score'];

/** Types that participate in planar subdivision at all. */
export const STRUCTURAL_TYPES: readonly LineType[] = [...BOUNDING_TYPES, ...SUBDIVIDING_TYPES];

/** Types that produce a hinge when they separate two faces. */
export const HINGE_TYPES: readonly LineType[] = ['crease', 'perf', 'score'];

export function isStructural(t: LineType): boolean {
  return STRUCTURAL_TYPES.includes(t);
}

/**
 * Where a line came from. A style id (e.g. `fefco.201`) or `'user'` for
 * anything drawn or added by hand. Feeds the non-destructive override layer:
 * regeneration rebuilds `sourceStyle !== 'user'` lines from the template and
 * replays user operations on top.
 */
export type SourceStyle = string;
export const USER_SOURCE: SourceStyle = 'user';

/**
 * Path geometry. Arcs are kept as arcs so DXF export and dimensioning stay
 * exact; the topology pass flattens them to polylines under a chord tolerance.
 */
export type Path =
  | { kind: 'polyline'; points: Vec2[]; closed?: boolean }
  | {
      kind: 'arc';
      center: Vec2;
      radius: number;
      /** radians, CCW from +x */
      startAngle: number;
      endAngle: number;
    };

/**
 * A line in the drawing. Carries meaning, not just coordinates.
 *
 * `role` is barely used in v1 — a couple of panel labels and nothing else. It
 * is here because constraint-aware editing and linked-panel propagation are
 * addressed by role, and retrofitting it later would mean reworking every
 * style definition.
 */
export interface DrawingLine {
  id: string;
  type: LineType;
  /** Semantic name, e.g. `left_side_panel.outer_edge`, `glue_flap.fold`. */
  role: string;
  geometry: Path;
  sourceStyle: SourceStyle;
  /** Free-form per-style payload. Never read by the geometry core. */
  meta?: Record<string, unknown>;
}

/**
 * Zones that consume material: fin seals, lap seals, glue flaps. Real geometry
 * with real thickness, so they land in the blank dimensions and render as
 * actual solid in 3D rather than as a texture trick.
 */
export interface SealZone {
  id: string;
  kind: 'fin' | 'lap' | 'glue_flap';
  role: string;
  /** Roles of the faces this seal binds together. */
  boundFaceRoles: string[];
  /** Total material consumed across the seal, in mm. */
  width: number;
  /** Number of material plies in the seal. Drives rendered thickness. */
  plies: number;
  sourceStyle: SourceStyle;
}

/** Library shapes anchored to a face, applied as booleans against its outline. */
export interface FeatureInstance {
  id: string;
  /** `peg_hole.round`, `tear_notch.v`, ... */
  kind: string;
  /** Role of the face this feature is anchored to. */
  anchorFaceRole: string;
  /** Role of the edge offsets are measured from. */
  referenceEdgeRole: string;
  /** Offset from the reference edge, in mm. */
  offset: Vec2;
  /** Rotation about the anchor point, radians. */
  rotation: number;
  size: Vec2;
  sourceStyle: SourceStyle;
}

/**
 * Names a face by a point inside it.
 *
 * Face detection never guesses a panel's name from the lines around it — a fold
 * line borders two panels, so bounding roles cannot identify either one. A
 * style emits a seed point per panel instead; whichever detected face contains
 * the point takes the name. The seed keeps naming the right panel when
 * dimensions change or the user drags an edge, and a seed that lands on no face
 * is reported rather than silently lost.
 */
export interface FaceSeed {
  role: string;
  point: Vec2;
  kind?: FaceKind;
}

/**
 * The whole drawing. A style generator returns one of these; the editor mutates
 * one of these; the 2D canvas, the 3D viewer and every exporter read one.
 */
export interface GeometryGraph {
  /** Millimetres throughout. */
  units: 'mm';
  /** Material thickness. Drives 3D edge thickness and seal ply stacking. */
  caliper: number;
  lines: DrawingLine[];
  seals: SealZone[];
  features: FeatureInstance[];
  /** Panel names, as points inside the panels they name. */
  faceSeeds?: FaceSeed[];
  /**
   * Formed-shape approximation for the 3D view, copied from the style.
   * Declared and carried; nothing consumes it in v1. A formed mesh must reuse
   * this blank's UV parameterization so artwork lands identically flat, folded
   * or formed — see FormedShapeSpec.
   */
  formedShape?: unknown;
  /**
   * Default fold angles in radians, keyed by the role of the crease line. A
   * style states its angles here rather than on the hinge, because hinges are
   * discovered by face detection and do not exist yet when a style is
   * generated. User overrides are applied on top at resolve time.
   */
  hingeAngles?: Record<string, number>;
  /** Role of the face to keep fixed when folding. Defaults to the largest face. */
  baseFaceRole?: string;
  meta?: Record<string, unknown>;
}

export function emptyGraph(caliper = 0.5): GeometryGraph {
  return { units: 'mm', caliper, lines: [], seals: [], features: [] };
}

// ---------------------------------------------------------------------------
// Resolved topology — the output of the face detection pass.
// ---------------------------------------------------------------------------

/** A closed ring of the planar arrangement, in resolved (welded) coordinates. */
export interface Ring {
  points: Vec2[];
  /** CCW positive. Outer rings are positive, hole rings are negative. */
  signedArea: number;
  /** Arrangement edge ids walked by this ring, in order. */
  edgeIds: number[];
}

export type FaceKind = 'panel' | 'flap' | 'seal' | 'unknown';

export interface Face {
  id: string;
  /** Derived from the lines that bound it where possible; else `face.<n>`. */
  role: string;
  kind: FaceKind;
  outer: Ring;
  /** Holes cut into this face (peg holes, windows). */
  holes: Ring[];
  /** Outer area minus hole areas, mm². */
  area: number;
  centroid: Vec2;
}

/**
 * A crease shared by exactly two faces. Holds its own fold angle, so folding is
 * a tree traversal that reads a target angle per hinge rather than assuming 90.
 */
export interface Hinge {
  id: string;
  faceA: string;
  faceB: string;
  /** Line type that produced it. */
  lineType: LineType;
  /** Originating DrawingLine ids. */
  lineIds: string[];
  /** Fold axis endpoints in flat coordinates. */
  a: Vec2;
  b: Vec2;
  /** Target fold angle in radians. Defaults to 90°. */
  angle: number;
  /**
   * Merged collinear crease segments only. A crease that bends between the same
   * face pair cannot be a rigid hinge; it is reported instead of folded.
   */
  collinear: boolean;
}

/** Reason a piece of geometry could not be resolved into the face graph. */
export type UnresolvedReason =
  | 'dangling'
  | 'outside_blank'
  | 'zero_length'
  | 'not_a_hinge'
  | 'non_collinear_hinge'
  | 'unreachable_face'
  | 'degenerate_face';

export interface UnresolvedItem {
  reason: UnresolvedReason;
  /** DrawingLine ids involved, where known. */
  lineIds: string[];
  faceIds?: string[];
  message: string;
}

/** Spanning tree over the face adjacency graph, rooted at the base face. */
export interface FoldTree {
  rootFaceId: string;
  /** faceId -> hinge used to reach it from its parent. */
  parentHinge: Map<string, string>;
  /** faceId -> parent faceId. */
  parent: Map<string, string>;
  /** faceId -> child faceIds. */
  children: Map<string, string[]>;
  /** Faces in breadth-first order from the root. */
  order: string[];
  /**
   * Hinges not in the spanning tree — they close a loop (e.g. the glue flap
   * meeting the far panel of an RSC). Recorded so a closure check can use them
   * later; ignored by the fold transform.
   */
  closingHinges: string[];
}

export interface ResolvedGeometry {
  faces: Face[];
  hinges: Hinge[];
  /** faceId -> hinge ids touching it. */
  adjacency: Map<string, string[]>;
  foldTree: FoldTree | null;
  /** Faces not reachable from the base face — separate blanks, or islands. */
  unreachableFaceIds: string[];
  /** Everything the 2D canvas should still draw but 3D cannot fold. */
  unresolved: UnresolvedItem[];
  /**
   * Seeds re-anchored to the faces they matched, so they track panels across
   * edits. Seeds that matched nothing pass through unmoved and are reported.
   */
  faceSeeds: FaceSeed[];
  /** Overall flat extents of the material, for the blank size callout. */
  blankBounds: { min: Vec2; max: Vec2 } | null;
}
