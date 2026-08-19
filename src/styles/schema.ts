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

/** Geometry the grid cannot express. Coordinates are expressions. */
export interface ExtraLineSpec {
  type: LineType;
  role: string;
  points?: { x: Expr; y: Expr }[];
  closed?: boolean;
  arc?: { center: { x: Expr; y: Expr }; radius: Expr; startAngle: Expr; endAngle: Expr };
  angle?: Expr;
  presentIf?: Expr;
}

/** An extra face seed for a face `extraLines` created. */
export interface ExtraSeedSpec {
  role: string;
  point: { x: Expr; y: Expr };
  kind?: FaceKind;
  presentIf?: Expr;
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
  /** Falls back to the grid cell marked `base`, then to the largest face. */
  baseFaceRole?: string;
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
