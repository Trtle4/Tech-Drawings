/**
 * The non-destructive edit layer the geometry core was built for but never
 * implemented (see `docs/geometry-core.md`, "The override layer is designed
 * for but not built"). Editing never mutates a compiled style's own lines —
 * every edit is an operation, appended to an ordered list, replayed on top of
 * a freshly compiled base graph. Changing a dimension in the left panel
 * recompiles the base and replays the same ops; nothing about an edit is lost
 * by moving a slider.
 *
 * No constraint propagation: `move_point` and `move_line` touch exactly the
 * one line they name. A crease that used to share an endpoint with the line
 * being dragged does not move with it — the drawing is allowed to show a gap.
 * That is deliberate, not a bug to fix later.
 */
import type { DrawingLine, GeometryGraph, LineType, Path, Vec2 } from '../geometry/types.js';
import { USER_SOURCE } from '../geometry/types.js';

export type OverrideOp =
  /** A brand-new line. Type is part of the op — there is no untyped geometry. */
  | { kind: 'add_line'; id: string; type: LineType; role: string; points: [Vec2, Vec2] }
  | { kind: 'delete_line'; lineId: string }
  | { kind: 'set_line_type'; lineId: string; type: LineType }
  /** Reshape: move one endpoint (or interior vertex) of one line. */
  | { kind: 'move_point'; lineId: string; pointIndex: number; to: Vec2 }
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

      case 'delete_line':
        lines = lines.filter((l) => l.id !== op.lineId);
        break;

      case 'set_line_type': {
        const line = lines.find((l) => l.id === op.lineId);
        if (line) line.type = op.type;
        break;
      }

      case 'move_point': {
        const line = lines.find((l) => l.id === op.lineId);
        if (line && line.geometry.kind === 'polyline' && op.pointIndex >= 0 && op.pointIndex < line.geometry.points.length) {
          line.geometry.points[op.pointIndex] = { x: op.to.x, y: op.to.y };
        }
        break;
      }

      case 'move_line': {
        const idx = lines.findIndex((l) => l.id === op.lineId);
        if (idx >= 0) lines[idx] = { ...lines[idx]!, geometry: translatePath(lines[idx]!.geometry, op.dx, op.dy) };
        break;
      }

      case 'set_hinge_angle':
        hingeAngleOverrides.set(`${op.faceA}|${op.faceB}`, op.angleRad);
        hingeAngleOverrides.set(`${op.faceB}|${op.faceA}`, op.angleRad);
        break;
    }
  }

  return { graph: { ...base, lines }, hingeAngleOverrides };
}
