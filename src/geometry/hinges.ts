import type { DrawingLine, Face, FoldTree, Hinge, UnresolvedItem, Vec2 } from './types.js';
import { HINGE_TYPES } from './types.js';
import type { Arrangement } from './arrangement.js';
import { EPS, WELD_TOL, cross, dist, normalize, sub } from './math.js';

export const DEFAULT_FOLD_ANGLE = Math.PI / 2;

export interface HingeResult {
  hinges: Hinge[];
  /** faceId -> hinge ids touching it. */
  adjacency: Map<string, string[]>;
  unresolved: UnresolvedItem[];
}

/**
 * Every crease shared by exactly two faces becomes a hinge.
 *
 * Arrangement edges are grouped by (face pair, originating line) so that a
 * crease chopped into pieces by other geometry crossing it still folds as one
 * hinge with one angle, rather than as several hinges that can drift apart.
 */
export function buildHinges(
  arr: Arrangement,
  faces: readonly Face[],
  lines: readonly DrawingLine[],
  edgeFaces: Map<number, string[]>,
  opts: { defaultAngle?: number } = {},
): HingeResult {
  const defaultAngle = opts.defaultAngle ?? DEFAULT_FOLD_ANGLE;
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const faceIds = new Set(faces.map((f) => f.id));
  const unresolved: UnresolvedItem[] = [];

  interface Group {
    faceA: string;
    faceB: string;
    lineIds: Set<string>;
    edgeIds: number[];
    type: DrawingLine['type'];
  }
  const groups = new Map<string, Group>();

  for (const e of arr.edges) {
    if (!e.types.some((t) => HINGE_TYPES.includes(t))) continue;
    const ids = edgeFaces.get(e.id);
    if (!ids || ids.length !== 2) continue;
    const [f0, f1] = ids as [string, string];
    if (!faceIds.has(f0) || !faceIds.has(f1)) continue;
    const [faceA, faceB] = f0 < f1 ? [f0, f1] : [f1, f0];
    // Provenance keeps two parallel creases between the same pair of faces
    // (a double-scored fold) as separate hinges.
    const owner =
      e.lineIds.find((id) => {
        const t = lineById.get(id)?.type;
        return t !== undefined && HINGE_TYPES.includes(t);
      }) ?? e.lineIds[0]!;
    const key = `${faceA}|${faceB}|${owner}`;
    const group = groups.get(key);
    if (group) {
      group.edgeIds.push(e.id);
      for (const lid of e.lineIds) group.lineIds.add(lid);
    } else {
      groups.set(key, {
        faceA,
        faceB,
        lineIds: new Set(e.lineIds),
        edgeIds: [e.id],
        type: lineById.get(owner)?.type ?? e.type,
      });
    }
  }

  const hinges: Hinge[] = [];
  let n = 0;
  for (const group of groups.values()) {
    const pts: Vec2[] = [];
    for (const id of group.edgeIds) {
      pts.push(arr.vertices[arr.edges[id]!.a]!.p, arr.vertices[arr.edges[id]!.b]!.p);
    }
    const axis = fitAxis(pts);
    if (!axis) continue;
    const hinge: Hinge = {
      id: `hinge.${++n}`,
      faceA: group.faceA,
      faceB: group.faceB,
      lineType: group.type,
      lineIds: [...group.lineIds],
      a: axis.a,
      b: axis.b,
      angle: defaultAngle,
      collinear: axis.collinear,
    };
    hinges.push(hinge);
    if (!axis.collinear) {
      unresolved.push({
        reason: 'non_collinear_hinge',
        lineIds: hinge.lineIds,
        faceIds: [hinge.faceA, hinge.faceB],
        message: `Crease between ${hinge.faceA} and ${hinge.faceB} is not straight, so it has no rigid fold axis. Drawn in 2D, approximated in 3D.`,
      });
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const f of faces) adjacency.set(f.id, []);
  for (const h of hinges) {
    adjacency.get(h.faceA)!.push(h.id);
    adjacency.get(h.faceB)!.push(h.id);
  }

  return { hinges, adjacency, unresolved };
}

/**
 * Longest straight axis through a group of hinge endpoints. Reports whether
 * every point actually lies on it — a bent crease still gets an axis so 3D can
 * show something, but it is flagged rather than trusted.
 */
function fitAxis(pts: readonly Vec2[]): { a: Vec2; b: Vec2; collinear: boolean } | null {
  if (pts.length < 2) return null;
  let a = pts[0]!;
  let b = pts[0]!;
  let best = -1;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = dist(pts[i]!, pts[j]!);
      if (d > best) {
        best = d;
        a = pts[i]!;
        b = pts[j]!;
      }
    }
  }
  if (best < WELD_TOL) return null;
  const dir = normalize(sub(b, a));
  const collinear = pts.every((p) => Math.abs(cross(dir, sub(p, a))) <= WELD_TOL * 10);
  return { a, b, collinear };
}

/**
 * Spanning tree over the face adjacency graph, rooted at the base face.
 *
 * Folding is a traversal of this tree: each face inherits its parent's
 * transform and adds a rotation about its own hinge's axis by that hinge's own
 * angle. Hinges outside the tree close a loop (a glue flap meeting the far
 * panel) and are recorded rather than folded.
 */
export function buildFoldTree(
  faces: readonly Face[],
  hinges: readonly Hinge[],
  baseFaceId?: string,
): { tree: FoldTree | null; unreachable: string[] } {
  if (faces.length === 0) return { tree: null, unreachable: [] };

  const byId = new Map(faces.map((f) => [f.id, f]));
  // Default base: the largest face. It is the panel a user thinks of as "the
  // one lying on the table", and it keeps the fold shallow.
  const root =
    baseFaceId && byId.has(baseFaceId)
      ? baseFaceId
      : [...faces].sort((a, b) => b.area - a.area)[0]!.id;

  const incident = new Map<string, Hinge[]>();
  for (const f of faces) incident.set(f.id, []);
  for (const h of hinges) {
    incident.get(h.faceA)?.push(h);
    incident.get(h.faceB)?.push(h);
  }

  const parent = new Map<string, string>();
  const parentHinge = new Map<string, string>();
  const children = new Map<string, string[]>();
  for (const f of faces) children.set(f.id, []);

  const visited = new Set<string>([root]);
  const order: string[] = [root];
  const usedHinges = new Set<string>();
  const queue = [root];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const h of incident.get(cur) ?? []) {
      const other = h.faceA === cur ? h.faceB : h.faceA;
      if (visited.has(other)) continue;
      visited.add(other);
      parent.set(other, cur);
      parentHinge.set(other, h.id);
      children.get(cur)!.push(other);
      usedHinges.add(h.id);
      order.push(other);
      queue.push(other);
    }
  }

  // A hinge is "closing" only if it joins two faces the tree already reached.
  // Hinges between two unreachable faces belong to a separate island, not to
  // this fold tree.
  const closingHinges = hinges
    .filter((h) => !usedHinges.has(h.id) && visited.has(h.faceA) && visited.has(h.faceB))
    .map((h) => h.id);
  const unreachable = faces.filter((f) => !visited.has(f.id)).map((f) => f.id);

  return {
    tree: { rootFaceId: root, parent, parentHinge, children, order, closingHinges },
    unreachable,
  };
}

/** Hinge axis oriented so that the child face lies to its left. */
export function orientedAxis(hinge: Hinge, childCentroid: Vec2): { a: Vec2; b: Vec2 } {
  const dir = sub(hinge.b, hinge.a);
  const side = cross(dir, sub(childCentroid, hinge.a));
  // Positive rotation about a left-handed axis would fold the child downward;
  // flipping the axis keeps every fold consistent.
  return side < -EPS ? { a: hinge.b, b: hinge.a } : { a: hinge.a, b: hinge.b };
}
