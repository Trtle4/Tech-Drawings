/**
 * The style definition schema.
 *
 * A style is DATA. Adding FEFCO 0203 or ECMA A20.20 should mean writing another
 * definition object, not another module of geometry code. Everything here is
 * JSON-serialisable: dimensions are expressions over the style's own declared
 * parameters, evaluated by `expr.ts`.
 *
 * The model is a parametric grid. A blank is a sequence of columns crossed with
 * a sequence of rows; each cell is either present (a panel, a flap, a seal
 * tab) or absent (air). The boundary between two cells is a crease by default,
 * and overrides turn specific boundaries into slots, cuts, perfs or nothing.
 *
 * That covers most of the FEFCO 02xx and 03xx families and a good part of the
 * ECMA folding-carton catalogue, because those blanks genuinely are grids. When
 * a style is not a grid — a curved bag profile, a hex tray — `extraLines`
 * carries arbitrary geometry alongside, and a style may use only that.
 */

import type { Expr } from './expr.js';
import type { FaceKind, FeatureInstance, LineType, SealZone, Vec2 } from '../geometry/types.js';

export type { Expr };

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

export type ParamGroup = 'internal' | 'material' | 'allowance' | 'feature';

/**
 * One dimension the user can set. `min`/`max` are advisory in v1 — the compiler
 * clamps and reports rather than refusing, so a half-typed value never blanks
 * the drawing.
 */
export interface ParamSpec {
  id: string;
  label: string;
  group: ParamGroup;
  /** Millimetres unless stated. */
  unit?: 'mm' | 'deg' | 'count';
  default: Expr;
  min?: Expr;
  max?: Expr;
  step?: number;
  /** Shown under the field in the control column. */
  hint?: string;
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

/** A column (width) or a row (height) of the blank grid. */
export interface AxisSpec {
  id: string;
  size: Expr;
  /** Omit the whole track when this evaluates to 0 or less. */
  presentIf?: Expr;
}

/**
 * A cell of the grid: one face of the finished blank.
 *
 * `role` is the semantic name that lands on the detected face via a face seed,
 * so it must be unique within the style.
 */
export interface CellSpec {
  row: string;
  col: string;
  role: string;
  kind: FaceKind;
  /** Omit the cell when this evaluates to 0 or less. Absent cells are air. */
  presentIf?: Expr;
  /** Marks the face the fold traversal holds fixed. Exactly one, or none. */
  base?: boolean;
  /**
   * Shrink the cell from the named sides of its track, in mm.
   *
   * Tracks are uniform, but real cartons are not: a seal end carton's minor
   * flaps are shorter than its major flaps even though both sit in the same
   * flap row. Inset from the side away from the fold, so the crease stays on
   * the track boundary where its neighbour expects it and only the free edge
   * moves in.
   */
  inset?: { top?: Expr; bottom?: Expr; left?: Expr; right?: Expr };
  /**
   * Closure order for rendering — which of two overlapping faces draws on top.
   * Higher wins. A minor flap that closes before a major flap is a lower ply
   * than the major; a glue tab laminated under its panel is lower still.
   * Defaults to 0. Never affects folding, only paint order.
   */
  ply?: number;
}

/**
 * What separates two adjacent cells.
 *
 *  - `crease` / `score` / `perf`  a fold line, and a hinge
 *  - `cut`                        a slit: board both sides, nothing removed
 *  - `slot`                       a real gap of `width`, punched out
 *  - `none`                       no line at all; the cells merge into one face
 */
export type BoundaryKind = 'crease' | 'score' | 'perf' | 'cut' | 'slot' | 'none';

/**
 * An override for boundaries the default (crease between present neighbours)
 * gets wrong. Unmatched boundaries keep the default, so a definition only
 * states its exceptions.
 */
export interface BoundarySpec {
  /** `v` between horizontally adjacent cells, `h` between vertically adjacent. */
  axis: 'v' | 'h';
  /**
   * Restrict to the boundary immediately after this column (for `v`) or row
   * (for `h`). Omit to match every boundary on that axis.
   */
  after?: string | string[];
  /**
   * Restrict to these rows (for `v`) or columns (for `h`). Omit for all.
   */
  within?: string | string[];
  kind: BoundaryKind;
  /** Gap width for `slot`. Ignored otherwise. */
  width?: Expr;
  /** Target fold angle in degrees. Defaults to 90. */
  angle?: Expr;
  /** Overrides the generated line role. */
  role?: string;
}

// ---------------------------------------------------------------------------
// Seals, features, extra geometry
// ---------------------------------------------------------------------------

/** A seal that consumes material. Carried from day one; nothing reads it yet. */
export interface SealSpec {
  id: string;
  kind: SealZone['kind'];
  role: string;
  /** Cell roles the seal binds together. */
  boundFaceRoles: string[];
  width: Expr;
  plies?: Expr;
}

/** A library shape anchored to a face. Carried from day one; unused in v1. */
export interface FeatureSpec {
  id: string;
  kind: string;
  anchorFaceRole: string;
  referenceEdgeRole: string;
  offset: { x: Expr; y: Expr };
  rotation?: Expr;
  size: { x: Expr; y: Expr };
  presentIf?: Expr;
}

/**
 * Geometry the grid cannot express. Coordinates are expressions.
 *
 * A style may use `extraLines` alone and skip the grid entirely — the grid is a
 * convenience for blanks that happen to be grids, not the canonical model.
 *
 * Three ways to give an arc:
 *  - `arc`         centre, radius and angles, when those are what you know
 *  - `arcThrough`  two endpoints and a bulge, which is how a curved edge is
 *                  actually dimensioned. The compiler solves the centre.
 *  - `points`      a polyline, for everything else
 */
export interface ExtraLineSpec {
  type: LineType;
  role: string;
  points?: { x: Expr; y: Expr }[];
  closed?: boolean;
  /** Angles in degrees, CCW from +x. */
  arc?: { center: { x: Expr; y: Expr }; radius: Expr; startAngle: Expr; endAngle: Expr };
  /**
   * An arc from `from` to `to`, bulging by `sagitta` at its midpoint. Positive
   * sagitta bulges to the left of the from -> to direction. Zero degrades to a
   * straight line rather than erroring.
   */
  arcThrough?: { from: { x: Expr; y: Expr }; to: { x: Expr; y: Expr }; sagitta: Expr };
  angle?: Expr;
  presentIf?: Expr;
}

/** An extra face seed for a face `extraLines` created. */
export interface ExtraSeedSpec {
  role: string;
  point: { x: Expr; y: Expr };
  kind?: FaceKind;
  /** See `CellSpec.ply`. */
  ply?: number;
  presentIf?: Expr;
}

/**
 * How a style's FORMED shape is approximated in 3D. Declared now, consumed by
 * nothing — the same footing SealZone and FeatureInstance were given.
 *
 * WHY IT EXISTS. The fold traversal produces a rigid folded state, which is
 * right for board and wrong for film. A pillow bag folds to lay-flat and a
 * stand-up pouch folds flat too, because neither has a rigid folded form; the
 * filled shape is a tube with crimped ends, or a pouch with an opened base and
 * billowed walls. Those are parametric approximations, NOT simulation: a tube
 * of known girth with sealed ends, a filled profile swept along the gusset.
 *
 * THE REQUIREMENT THAT MATTERS. A formed mesh must carry the SAME UV
 * parameterization as the flat blank. Artwork is placed once, on the flat, and
 * must land in the identical place whether the viewer is looking at the flat
 * drawing, the lay-flat fold, or the formed shape. So a formed shape is defined
 * as a DEFORMATION OF THE BLANK'S OWN SURFACE — every vertex keeps the (u, v)
 * it had in the flat, and only its position in space changes. It is never a
 * separately modelled mesh with its own unwrap, because two unwraps cannot be
 * kept in agreement.
 *
 * WHAT STAYS TRUE. The fold graph remains the single source of truth for the
 * dieline. A formed shape may only reinterpret faces the graph already
 * resolved; it cannot introduce panels, move creases, or change the blank. A
 * style with no `formedShape` has the folded state AS its formed state, which
 * is the right answer for every carton and case.
 */
/**
 * The shape family a station's cross-section is drawn from — everything
 * else about the lofted engine (girth conservation, PCHIP interpolation
 * between stations, `fill`, the UV parameterization) is unchanged by this;
 * only the (halfWidth, halfDepth, angle) -> (x, z) function at a station
 * changes.
 *
 *  - `ellipse`       x = halfWidth*cos, z = halfDepth*sin. The engine's
 *                     original, only behavior — a bag with no flat panel to
 *                     hold (front and back barely wider than the fin
 *                     between them), like the pillow. THE DEFAULT: a station
 *                     with no `profile` is exactly this, so an existing
 *                     ellipse-only style needs no changes at all.
 *  - `superellipse`   Bows the ellipse toward a rounded rectangle:
 *                     x = halfWidth*sign(cos)*|cos|^p, z analogous, with
 *                     p = 2/(2 + sharpness). sharpness 0 is the exact
 *                     ellipse; higher holds each axis near its own full
 *                     extent across most of the sweep and turns it over
 *                     sharply only near the pole — right for a bag with
 *                     wide flat panels and the folding concentrated at
 *                     narrow corners, like a side-gusseted bag.
 *  - `lens`           Two circular arcs (via the same chord+sagitta
 *                     construction as `arcThrough`), meeting at FIXED
 *                     pinch points (+/-halfWidth, 0) with a genuine corner
 *                     there — not the ellipse's own smooth (but still
 *                     rounded) extremum. Right for two panels pinched at
 *                     two side seals, like a stand-up pouch: the seal is a
 *                     real crease, not a roundover, so the footprint comes
 *                     to a point at each side.
 *  - `rounded_rect`   A true rounded rectangle: straight sides and a
 *                     genuine constant-radius arc at each corner (not a
 *                     superellipse's continuously-curving approximation).
 *                     `cornerRadius` 0 degenerates to a sharp rectangle —
 *                     which is how a "flat base" station is expressed: the
 *                     SAME family throughout a boxy body, just with
 *                     `cornerRadius` shrinking to 0 at the one station that
 *                     is the box's own flat floor.
 *
 * A single lofted surface must use ONE family throughout its stations —
 * interpolating between two different families is not defined. The
 * family-specific parameter (`sharpness`, `cornerRadius`) DOES interpolate
 * per-station via the same PCHIP machinery as halfWidth/halfDepth.
 */
export type ProfileSpec =
  | { family: 'ellipse' }
  | { family: 'superellipse'; sharpness: Expr }
  | { family: 'lens' }
  | { family: 'rounded_rect'; cornerRadius: Expr };

/**
 * One cross-section of a `lofted_profile` shape, at a given position along the
 * blank's up-axis. `halfWidth`/`halfDepth` are the section's own two radii,
 * sampled the same way at every station via its `profile` family, so two
 * adjacent stations can be interpolated point-for-point regardless of whether
 * either one is round, flat, or something between. A flat crimp is simply a
 * station whose `halfDepth` is small (the film's own half-thickness) rather
 * than a different code path — same shape function, different numbers.
 * `girth` (the round faces' combined flat-x extent) is available in these
 * expressions alongside the style's own params.
 *
 * `halfWidth` is optional. Omit it and the engine DERIVES it from `halfDepth`
 * so the cross-section's own perimeter matches `girth` — the material
 * actually available at that point, same as the flat pattern promises for
 * every station, not just the flat one (against the true ELLIPSE perimeter
 * regardless of `profile`, since a closed-form perimeter for the other
 * families does not exist; girth conservation is exact at the axis poles and
 * approximate between them for anything but a plain ellipse). This is what
 * makes the bag flare WIDER approaching a flat crimp than it is at a round
 * midpoint: a fixed girth wrapped around a shallow section only reaches its
 * full width by spreading out, the way real film does. Give an explicit
 * `halfWidth` only to override that derivation for a station that is not
 * girth-constrained — e.g. a pinch that stays at a fixed physical width
 * regardless of depth.
 *
 * `profile` defaults to `{ family: 'ellipse' }` when omitted.
 */
export interface LoftStationSpec {
  y: Expr;
  halfWidth?: Expr;
  halfDepth: Expr;
  profile?: ProfileSpec;
}

export interface FormedShapeSpec {
  /**
   * Which approximation to apply, and — this is the part that matters —
   * every one of these is a closed-form function of the flat pattern and the
   * style's own compiled params. None of them read the fold tree. A bag is
   * film, not board: its 3D shape comes from its own seals and how full it
   * is, not from a rigid hinge-chain traversal.
   *
   * `lofted_profile` is the general case: a list of `stations` along the
   * up-axis, each with its own cross-section, linearly interpolated between
   * neighbours — a flat end crimp lofting out to a round midpoint and back is
   * one station list; an oval base lofting up to a flat top is another. One
   * engine, no per-bag geometry code. `faceRoles` are the panels that lie on
   * that lofted surface; `flapFaceRoles` are seals (a fin, a side seal) that
   * do not lie on it — they are placed folded flat against the surface at
   * the seam, per `flapFold`/`sealStyle`.
   * `tube` and `gusseted_pouch` are the original, bespoke approximations;
   * every bag in the catalogue has since migrated to `lofted_profile`, and
   * they are kept only as a documented fallback for a future style whose
   * shape genuinely does not fit the lofted model.
   * `none` keeps the rigid fold — correct for every carton and case, wrong
   * for anything without a rigid folded state.
   */
  kind: 'none' | 'tube' | 'gusseted_pouch' | 'lofted_profile';
  /**
   * Roles of the faces the approximation deforms. Everything else keeps its
   * folded transform, so seals and flaps stay rigid while panels billow.
   */
  faceRoles?: string[];
  /**
   * Roles of the faces held flat — the crimped end seals on a pillow bag, the
   * side seals on a pouch. Used by `tube` and `gusseted_pouch` only.
   */
  flatFaceRoles?: string[];
  /**
   * `lofted_profile` only: cross-sections along the up-axis, in any order —
   * sorted by `y` before use. Needs at least two.
   */
  stations?: LoftStationSpec[];
  /**
   * `lofted_profile` only: seal faces (a fin, a side seal) that are not part
   * of the lofted surface. Each is placed at the seam nearest its own flat-x
   * span, folded flat against the surface for `sealStyle: 'fin'` (the
   * default — a separate flap, offset out from the surface by 2x caliper,
   * lying along the local tangent toward `flapFold`) or, for `sealStyle:
   * 'lap'`, treated as a continuation of the lofted surface itself (no
   * separate flap at all) — the physically correct picture for an overlap
   * seal, and why it does not protrude the way a mis-modelled fin does.
   */
  flapFaceRoles?: string[];
  /** `lofted_profile` only, `sealStyle: 'fin'`: which side the flap folds onto. Defaults to 'left'. */
  flapFold?: 'left' | 'right';
  /** `lofted_profile` only: how flap faces are placed. Defaults to 'fin'. */
  sealStyle?: 'fin' | 'lap';
  /**
   * `lofted_profile` only: rotates where girth-fraction t = 0 (the seam)
   * lands on the cross-section, in degrees. Defaults to 0 — the seam at the
   * ellipse's own widest point, i.e. the flat pattern's own left edge — which
   * is wrong for a wrap-formed tube: the seam is where the flat web's TWO
   * edges meet, diametrically opposite the panel that does not touch it. For
   * a fin-seal bag laid out fin | back-left | front | back-right | fin, that
   * places the seam at -90 (or 90, sign is a fold-direction choice) so it
   * lands mid-BACK rather than at the tube's side edge.
   */
  girthPhaseDeg?: number;
  /**
   * `lofted_profile` only: per-role override of how a round face's own flat
   * x maps to girth-fraction t, as [t at the face's own min-x, t at its own
   * max-x] (linear between). Every role WITHOUT an entry here uses the
   * default shared mapping — `(x - girthX0) / girth` — which assumes every
   * round face occupies a DISTINCT slice of x along one continuously
   * wrapped web, true for a wrap-formed tube (pillow, gusseted). It is NOT
   * true for two panels stacked in y at the SAME x range and joined only by
   * discrete side seals, like a stand-up pouch's front and back: both need
   * an explicit span (e.g. front: [0, 0.5], back: [1, 0.5], the reversed
   * order tracing the loop's other half) since there is no continuous x to
   * derive one from.
   */
  faceAngularSpan?: Record<string, [number, number]>;
  /**
   * `lofted_profile` only: per-role override of a round face's own OUTPUT y,
   * as [world y at the face's own min flat-y, world y at its own max flat-y]
   * (linear between). Every role WITHOUT an entry uses its flat y directly
   * (the default, exact for a wrap-formed tube, where every round face
   * shares one continuous length axis). It is NOT exact for panels that sit
   * in DIFFERENT rows of the flat pattern but must occupy the SAME assembled
   * length — a stand-up pouch's front and back, stacked head-to-tail in the
   * flat web, need to end up standing side by side: front's own flat y is
   * reflected (its near-base edge and its top-seal edge swap ends) so its
   * base lands at the SAME world y as back's. The STATION lookup
   * (`surfaceAt`) always uses flat y, never this — only the point's final
   * position moves.
   */
  faceWorldY?: Record<string, [Expr, Expr]>;
  /**
   * `lofted_profile` only: a constant mm offset added to a round face's own
   * z, keyed by role — a straight nudge along the loft's own depth axis, on
   * top of whatever `surfaceAt` already gives it. Together with
   * `faceWorldY`, this is what turns "swept back along y" into "actually
   * folded flat against a panel": a folded band that only moved in y would
   * sit almost exactly where the body panel it now overlaps already is
   * (both being thin near a crimp), reading as invisible rather than
   * folded. Nudging it toward whichever side it's meant to lie against
   * (negative toward the back pole, positive toward the front, in this
   * engine's own convention) separates the two surfaces enough to paint-sort
   * correctly — hidden behind the panel it's folded under when viewed from
   * the far side, visible in front of it from the near side — the way a
   * real folded, glued tab actually occludes.
   */
  faceDepthOffset?: Record<string, Expr>;
  /**
   * `lofted_profile` only: explicit girth-fraction t a flap face attaches
   * at, keyed by role. Overrides the default auto-detection (nearest of
   * girthX0/girthX1 to the flap's own flat-x span), which — like the
   * default `faceAngularSpan` mapping — assumes a single continuously
   * wrapped web and is wrong for a style with more than one physical seam
   * position (e.g. two independent side seals, each needing its own t).
   */
  flapAttachT?: Record<string, number>;
  /**
   * `lofted_profile` only: faces that are not swept along the loft at all —
   * a bottom gusset that opens into a flat oval and welds to the loft's own
   * lowest station, e.g. a stand-up pouch's base. Each role also needs a
   * `faceAngularSpan` entry: its own flat x maps to the girth-fraction t
   * range of the RIM it welds to, so the base's opened edge is read
   * directly off the wall's own station formula (guaranteed to match,
   * being the same function) rather than re-derived independently.
   */
  baseFaceRoles?: string[];
  /**
   * `lofted_profile`, with `baseFaceRoles` only: the loft-space (flat-y
   * domain) y each base role welds to, keyed by role — a station y
   * (typically the lowest), used to look up the rim's own cross-section via
   * `surfaceAt`. NOT necessarily the base face's own flat y, since a base
   * panel usually sits in an entirely different part of the flat pattern
   * (e.g. a fold or two away) than the wall whose rim it welds to. See
   * `baseWorldY` for where the welded result actually ends up.
   */
  baseWeldY?: Record<string, Expr>;
  /**
   * `lofted_profile`, with `baseFaceRoles` only: the single world y a base
   * role collapses onto once opened, keyed by role — the wall's own
   * OUTPUT y (after any `faceWorldY` remapping) at the weld line, not
   * `baseWeldY` itself. Defaults to `baseWeldY`'s own value, correct only
   * when the welded wall has no `faceWorldY` override at that point.
   */
  baseWorldY?: Record<string, Expr>;
  /**
   * How full the pack is, 0 to 1. Drives how far the section rounds out.
   * Presentation only; it never affects the dieline.
   */
  fill?: Expr;
  /** Free parameters for the chosen approximation, all expressions. */
  params?: Record<string, Expr>;
}

// ---------------------------------------------------------------------------
// The definition
// ---------------------------------------------------------------------------

export interface StyleDefinition {
  /** Stable id, also the `sourceStyle` stamped on every generated line. */
  id: string;
  name: string;
  family: 'case' | 'carton' | 'tray' | 'bag';
  /** `FEFCO`, `ECMA`, or omitted for house styles. */
  standard?: string;
  /** Catalogue code within the standard, e.g. `0201`. */
  code?: string;
  description?: string;
  params: ParamSpec[];
  grid?: {
    columns: AxisSpec[];
    rows: AxisSpec[];
    cells: CellSpec[];
    boundaries?: BoundarySpec[];
  };
  seals?: SealSpec[];
  features?: FeatureSpec[];
  extraLines?: ExtraLineSpec[];
  extraSeeds?: ExtraSeedSpec[];
  /**
   * Formed-shape approximation for the 3D view. Carried, never read in v1.
   * Absent means the rigid folded state is the formed state.
   */
  formedShape?: FormedShapeSpec;
  /** Falls back to the grid cell marked `base`, then to the largest face. */
  baseFaceRole?: string;
  /**
   * Which world axis is up when displaying the folded or formed result. See
   * `GeometryGraph.upAxis` for the full explanation. Defaults to 'y', which is
   * correct for every wrap-style case, carton and bag in the catalogue; a tray
   * or another base-and-walls style wants 'z'.
   */
  upAxis?: 'x' | 'y' | 'z';
}

// ---------------------------------------------------------------------------
// Compiler output
// ---------------------------------------------------------------------------

export interface CompiledStyle {
  definition: StyleDefinition;
  /** Every parameter after defaults, overrides and clamping. */
  params: Record<string, number>;
  graph: import('../geometry/types.js').GeometryGraph;
  /**
   * Flat blank size derived from the grid, independent of face detection.
   * Cross-checking this against `resolveGeometry`'s bounds catches a definition
   * whose geometry does not fill the grid it declared.
   */
  blank: { width: number; height: number };
  /** Clamped inputs and skipped specs. Non-blocking.  */
  warnings: string[];
}

/** Convenience: a resolved seal, before it becomes a `SealZone`. */
export type CompiledSeal = SealZone;
/** Convenience: a resolved feature, before it becomes a `FeatureInstance`. */
export type CompiledFeature = FeatureInstance;
/** Convenience alias for a compiled point. */
export type CompiledPoint = Vec2;
