import type { GeometryGraph, ResolvedGeometry, UnresolvedItem, Vec2 } from './types.js';
import { buildArrangement } from './arrangement.js';
import { detectFaces } from './faces.js';
import { buildFoldTree, buildHinges } from './hinges.js';
import { boundsOf } from './math.js';

export interface ResolveOptions {
  /** Chord tolerance for flattening arcs, mm. */
  chordTol?: number;
  /** Distance under which two points weld into one vertex, mm. */
  weldTol?: number;
  /** Fold angle assigned to new hinges, radians. Defaults to 90°. */
  defaultAngle?: number;
  /**
   * Fold angles to carry over, keyed by hinge id or by a stable key. Lets an
   * edit survive regeneration without the fold snapping back to 90°.
   */
  angles?: Map<string, number>;
  /**
   * Write the re-anchored seeds back into `graph.faceSeeds` (default true), so
   * seeds track panels across successive edits without the caller having to
   * remember to copy them. Set false to resolve without touching the input.
   */
  reanchorSeeds?: boolean;
}

/**
 * Resolve the geometry graph into faces, hinges and a fold tree.
 *
 * This is the single pass that both the 2D canvas and the 3D viewer consume.
 * Anything that cannot be resolved is reported in `unresolved` rather than
 * thrown, so the drawing always renders and the 3D view never dies on odd
 * input.
 */
export function resolveGeometry(graph: GeometryGraph, opts: ResolveOptions = {}): ResolvedGeometry {
  const arr = buildArrangement(graph.lines, {
    chordTol: opts.chordTol,
    weldTol: opts.weldTol,
  });

  const unresolved: UnresolvedItem[] = [];
  const lineById = new Map(graph.lines.map((l) => [l.id, l]));
  for (const d of arr.dropped) {
    unresolved.push({
      reason: 'zero_length',
      lineIds: [d.lineId],
      message: `Line "${lineById.get(d.lineId)?.role ?? d.lineId}" collapsed to zero length and was ignored.`,
    });
  }

  const detected = detectFaces(arr, graph.lines, { seeds: graph.faceSeeds ?? [] });
  unresolved.push(...detected.unresolved);

  const hingeResult = buildHinges(arr, detected.faces, graph.lines, detected.edgeFaces, {
    defaultAngle: opts.defaultAngle,
  });
  unresolved.push(...hingeResult.unresolved);

  // Reapply held fold angles. Keyed by hinge id first, then by face pair so an
  // angle survives ids being renumbered on regeneration.
  if (opts.angles) {
    for (const h of hingeResult.hinges) {
      const byId = opts.angles.get(h.id);
      const byPair = opts.angles.get(`${h.faceA}|${h.faceB}`);
      const held = byId ?? byPair;
      if (held !== undefined) h.angle = held;
    }
  }

  const baseFaceId = graph.baseFaceRole
    ? detected.faces.find((f) => f.role === graph.baseFaceRole)?.id
    : undefined;
  const { tree, unreachable } = buildFoldTree(detected.faces, hingeResult.hinges, baseFaceId);

  for (const id of unreachable) {
    const face = detected.faces.find((f) => f.id === id);
    unresolved.push({
      reason: 'unreachable_face',
      lineIds: [],
      faceIds: [id],
      message: `${face?.role ?? id} is not connected to the base face by any crease. It draws in 2D but does not fold.`,
    });
  }

  const allPoints: Vec2[] = [];
  for (const f of detected.faces) allPoints.push(...f.outer.points);

  // Seeds heal by default: each one moves to the interior point of the face it
  // matched, so it follows the panel through successive edits.
  if (opts.reanchorSeeds !== false && graph.faceSeeds) graph.faceSeeds = detected.seeds;

  return {
    faces: detected.faces,
    hinges: hingeResult.hinges,
    adjacency: hingeResult.adjacency,
    foldTree: tree,
    unreachableFaceIds: unreachable,
    unresolved,
    faceSeeds: detected.seeds,
    blankBounds: boundsOf(allPoints),
  };
}

/** Overall flat size of the blank, for the blank size callout. */
export function blankSize(resolved: ResolvedGeometry): { width: number; height: number } | null {
  if (!resolved.blankBounds) return null;
  const { min, max } = resolved.blankBounds;
  return { width: max.x - min.x, height: max.y - min.y };
}

/** Total board area, holes already subtracted. */
export function materialArea(resolved: ResolvedGeometry): number {
  return resolved.faces.reduce((sum, f) => sum + f.area, 0);
}
