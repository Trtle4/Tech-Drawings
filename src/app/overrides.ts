/**
 * The non-destructive edit layer the geometry core was built for but never
 * implemented (see `docs/geometry-core.md`, "The override layer is designed
 * for but not built"). Editing never mutates a compiled style's own lines —
 * every edit is an operation, appended to an ordered list, replayed on top of
 * a freshly compiled base graph. Changing a dimension in the left panel
 * recompiles the base and replays the same ops; nothing about an edit is lost
 * by moving a slider.
 *
 * No SEMANTIC propagation: nothing here knows what a panel or a flap is, and
 * never will. `move_vertex` is purely topological — it moves every line that
 * happens to share a coincident endpoint with the dragged one, using the
 * same weld tolerance the geometry core uses to decide two points are "the
 * same vertex" for face detection. That is a correctness fix (a torn vertex
 * leaves a gap the face detector then has to cope with), not a step toward
 * constraint solving. `move_point` still exists for the deliberate opposite:
 * detach one line's endpoint and leave every other line alone.
 */
import type { DrawingLine, GeometryGraph, LineType, Path, Vec2 } from '../geometry/types.js';
import { USER_SOURCE } from '../geometry/types.js';

export type OverrideOp =
  /** A brand-new line. Type is part of the op — there is no untyped geometry. */
  | { kind: 'add_line'; id: string; type: LineType; role: string; points: [Vec2, Vec2] }
  | { kind: 'delete_line'; lineId: string }
  | { kind: 'set_line_type'; lineId: string; type: LineType }
  /** Reshape one line only: move one endpoint (or interior vertex), detached from any line that used to share it. */
  | { kind: 'move_point'; lineId: string; pointIndex: number; to: Vec2 }
  /**
   * The default drag: move a shared vertex, and every line that has a point
   * coincident with it (within weld tolerance) follows. `targets` is the
   * group as found at drag time — topological, not "every line that was
   * ever near this point."
   */
  | { kind: 'move_vertex'; targets: { lineId: string; pointIndex: number }[]; to: Vec2 }
  /** Translate: shift every point of one line by the same delta. */
  | { kind: 'move_line'; lineId: string; dx: number; dy: number }
  /**
   * A hinge is identified by the pair of face ids it separates, not by role or
   * hinge id — the same key `resolveGeometry`'s `ResolveOptions.angles` already
   * accepts, so this reuses the override layer the geometry core designed
   * rather than inventing a second one. Face ids are positional and stable
   * across a recompile as long as the style's structure (not just its
   * dimensions) is unchanged.
   */
  | { kind: 'set_hinge_angle'; faceA: string; faceB: string; angleRad: number };

export interface AppliedOverrides {
  graph: GeometryGraph;
  /** Ready to hand straight to `resolveGeometry(graph, { angles })`. */
  hingeAngleOverrides: Map<string, number>;
  /**
   * Ops that named a line no longer present when they were replayed — a
   * dimension change dropped the cell that line belonged to. Not dropped
   * silently: the caller surfaces these in the unfolded-geometry panel so a
   * stale edit is visible rather than just quietly not applying.
   */
  staleOps: OverrideOp[];
}

/** Whether a line carries any edit at all — a hand-drawn addition, or a template line an op still targets. */
export function isLineOverridden(line: DrawingLine, ops: readonly OverrideOp[]): boolean {
  if (line.sourceStyle === USER_SOURCE) return true;
  return ops.some((op) => {
    if (op.kind === 'add_line' || op.kind === 'set_hinge_angle') return false;
    if (op.kind === 'move_vertex') return op.targets.some((t) => t.lineId === line.id);
    return op.lineId === line.id;
  });
}

/** Human-readable explanation for why a stale op no longer applies, for the unfolded-geometry panel. */
export function describeStaleOp(op: OverrideOp): string {
  switch (op.kind) {
    case 'delete_line':
      return 'A delete no longer applies — its line no longer exists at this dimension.';
    case 'set_line_type':
      return 'A type change no longer applies — its line no longer exists at this dimension.';
    case 'move_point':
      return 'An endpoint edit no longer applies — its line no longer exists at this dimension.';
    case 'move_vertex':
      return 'A shared-vertex move no longer fully applies — at least one of its lines no longer exists at this dimension.';
    case 'move_line':
      return 'A line move no longer applies — its line no longer exists at this dimension.';
    case 'add_line':
      return 'An added line no longer applies.';
    case 'set_hinge_angle':
      return `A hinge angle override no longer matches any hinge between "${op.faceA}" and "${op.faceB}".`;
  }
}

function clonePath(p: Path): Path {
  if (p.kind === 'polyline') {
    return {
      kind: 'polyline',
      points: p.points.map((q) => ({ x: q.x, y: q.y })),
      ...(p.closed ? { closed: true } : {}),
    };
  }
  return { kind: 'arc', center: { x: p.center.x, y: p.center.y }, radius: p.radius, startAngle: p.startAngle, endAngle: p.endAngle };
}

/** Shift every point of a path by the same delta. Exported for the canvas's live drag preview. */
export function translatePath(p: Path, dx: number, dy: number): Path {
  if (p.kind === 'polyline') {
    return {
      kind: 'polyline',
      points: p.points.map((q) => ({ x: q.x + dx, y: q.y + dy })),
      ...(p.closed ? { closed: true } : {}),
    };
  }
  return { ...p, center: { x: p.center.x + dx, y: p.center.y + dy } };
}

/**
 * Replay an ordered op list on top of a freshly compiled base graph.
 *
 * Every op that names a line it cannot find is silently skipped rather than
 * thrown — a dimension edit that drops a cell (and the line an old op
 * targeted with it) should not crash the editor, it should just mean that one
 * stale edit no longer applies.
 */
export function applyOverrides(base: GeometryGraph, ops: readonly OverrideOp[]): AppliedOverrides {
  let lines: DrawingLine[] = base.lines.map((l) => ({ ...l, geometry: clonePath(l.geometry) }));
  const hingeAngleOverrides = new Map<string, number>();
  const staleOps: OverrideOp[] = [];

  for (const op of ops) {
    switch (op.kind) {
      case 'add_line':
        lines.push({
          id: op.id,
          type: op.type,
          role: op.role,
          geometry: { kind: 'polyline', points: [{ ...op.points[0] }, { ...op.points[1] }] },
          sourceStyle: USER_SOURCE,
        });
        break;

      case 'delete_line': {
        const before = lines.length;
        lines = lines.filter((l) => l.id !== op.lineId);
        if (lines.length === before) staleOps.push(op);
        break;
      }

      case 'set_line_type': {
        const line = lines.find((l) => l.id === op.lineId);
        if (line) line.type = op.type;
        else staleOps.push(op);
        break;
      }

      case 'move_point': {
        const line = lines.find((l) => l.id === op.lineId);
        if (line && line.geometry.kind === 'polyline' && op.pointIndex >= 0 && op.pointIndex < line.geometry.points.length) {
          line.geometry.points[op.pointIndex] = { x: op.to.x, y: op.to.y };
        } else {
          staleOps.push(op);
        }
        break;
      }

      case 'move_vertex': {
        let anyApplied = false;
        let anyMissing = false;
        for (const t of op.targets) {
          const line = lines.find((l) => l.id === t.lineId);
          if (line && line.geometry.kind === 'polyline' && t.pointIndex >= 0 && t.pointIndex < line.geometry.points.length) {
            line.geometry.points[t.pointIndex] = { x: op.to.x, y: op.to.y };
            anyApplied = true;
          } else {
            anyMissing = true;
          }
        }
        if (anyMissing || !anyApplied) staleOps.push(op);
        break;
      }

      case 'move_line': {
        const idx = lines.findIndex((l) => l.id === op.lineId);
        if (idx >= 0) lines[idx] = { ...lines[idx]!, geometry: translatePath(lines[idx]!.geometry, op.dx, op.dy) };
        else staleOps.push(op);
        break;
      }

      case 'set_hinge_angle':
        hingeAngleOverrides.set(`${op.faceA}|${op.faceB}`, op.angleRad);
        hingeAngleOverrides.set(`${op.faceB}|${op.faceA}`, op.angleRad);
        break;
    }
  }

  return { graph: { ...base, lines }, hingeAngleOverrides, staleOps };
}
