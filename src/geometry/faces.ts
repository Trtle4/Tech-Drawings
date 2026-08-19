import type { DrawingLine, Face, FaceSeed, Ring, UnresolvedItem, Vec2 } from './types.js';
import { BOUNDING_TYPES } from './types.js';
import type { Arrangement } from './arrangement.js';
import {
  EPS,
  WELD_TOL,
  add,
  centroidOf,
  interiorPoint,
  normalize,
  normalLeft,
  pointInRing,
  pointInSegmentSoup,
  scale,
  signedArea,
  sub,
} from './math.js';

export interface DetectedFaces {
  faces: Face[];
  unresolved: UnresolvedItem[];
  /** Arrangement edge id -> ids of the material faces it borders. */
  edgeFaces: Map<number, string[]>;
}

interface CycleInfo {
  index: number;
  halfEdges: number[];
  ring: Ring;
  area: number;
}

/**
 * Resolve faces by planar subdivision.
 *
 * Cut lines and the outline bound the blank; creases, perfs and scores
 * subdivide the bounded region. Nothing here consults the style library — a
 * hand-drawn rectangle with two creases resolves into three faces the same way
 * a generated RSC does.
 */
export function detectFaces(
  arr: Arrangement,
  lines: readonly DrawingLine[],
  opts: { facePrefix?: string; seeds?: readonly FaceSeed[] } = {},
): DetectedFaces {
  const prefix = opts.facePrefix ?? 'face';
  const seeds = opts.seeds ?? [];
  const unresolved: UnresolvedItem[] = [];
  const lineById = new Map(lines.map((l) => [l.id, l]));

  // Material boundary as a raw segment soup — the only thing that decides
  // whether a detected region is board or air.
  const cutSegs: [Vec2, Vec2][] = [];
  for (const e of arr.edges) {
    if (!e.types.some((t) => BOUNDING_TYPES.includes(t))) continue;
    cutSegs.push([arr.vertices[e.a]!.p, arr.vertices[e.b]!.p]);
  }

  // 1. Turn each half-edge cycle into a ring with a signed area.
  const infos: CycleInfo[] = arr.cycles.map((halfEdges, index) => {
    const points: Vec2[] = [];
    const edgeIds: number[] = [];
    for (const hid of halfEdges) {
      const he = arr.halfEdges[hid]!;
      points.push(arr.vertices[he.origin]!.p);
      edgeIds.push(he.edge);
    }
    const area = signedArea(points);
    return { index, halfEdges, ring: { points, signedArea: area, edgeIds }, area };
  });

  // 2. Positive cycles bound regions. Keep the ones made of material.
  const outerCandidates = infos.filter((c) => c.area > EPS && c.ring.points.length >= 3);
  const materialCycles: CycleInfo[] = [];
  for (const c of outerCandidates) {
    const p = interiorPoint(c.ring.points);
    if (!p) {
      unresolved.push({
        reason: 'degenerate_face',
        lineIds: linesForEdges(arr, c.ring.edgeIds, lineById),
        message: `Region of ${c.area.toFixed(2)} mm² has no usable interior point and was skipped.`,
      });
      continue;
    }
    if (pointInSegmentSoup(p, cutSegs)) materialCycles.push(c);
    // Even crossing count means air: outside the blank, or inside a cut hole.
    // Either way it is not a face, and no warning is warranted.
  }

  // 3. Build faces, smallest first so hole assignment picks the tightest owner.
  materialCycles.sort((a, b) => a.area - b.area);
  const faces: Face[] = materialCycles.map((c, i) => ({
    id: `${prefix}.${i + 1}`,
    role: `${prefix}.${i + 1}`,
    kind: 'unknown' as const,
    outer: c.ring,
    holes: [],
    area: c.area,
    centroid: centroidOf(c.ring.points),
  }));

  const cycleToFace = new Map<number, string>();
  materialCycles.forEach((c, i) => cycleToFace.set(c.index, faces[i]!.id));

  // 4. Negative cycles are either a component's outer boundary or a hole ring.
  //    A hole ring has material on its outside, so probe just beyond an edge.
  for (const c of infos) {
    if (c.area >= -EPS || c.ring.points.length < 3) continue;
    const probe = outwardProbe(c.ring.points);
    if (!probe) continue;
    let owner: Face | null = null;
    for (const f of faces) {
      if (pointInRing(probe, f.outer.points)) {
        if (!owner || f.area < owner.area) owner = f;
      }
    }
    if (!owner) continue;
    owner.holes.push(c.ring);
    owner.area += c.area; // c.area is negative, so this subtracts the hole.
    // The hole ring is part of the owner's boundary, so its edges belong to the
    // owner too. Without this, a crease loop or a die-cut window would look
    // like it borders only one face and could never become a hinge.
    cycleToFace.set(c.index, owner.id);
  }

  // 5. Map each arrangement edge to the material faces on either side.
  const edgeFaces = new Map<number, string[]>();
  for (const he of arr.halfEdges) {
    const faceId = cycleToFace.get(he.cycle);
    if (!faceId) continue;
    const list = edgeFaces.get(he.edge);
    if (list) {
      if (!list.includes(faceId)) list.push(faceId);
    } else {
      edgeFaces.set(he.edge, [faceId]);
    }
  }

  // 6. Report structural lines that never made it onto a face boundary. These
  //    still draw in 2D; they just cannot participate in folding.
  const placed = new Set<string>();
  for (const [edgeId, ids] of edgeFaces) {
    if (ids.length === 0) continue;
    for (const lid of arr.edges[edgeId]!.lineIds) placed.add(lid);
  }
  for (const line of lines) {
    if (!lineById.has(line.id)) continue;
    const usesEdge = arr.edges.some((e) => e.lineIds.includes(line.id));
    if (!usesEdge) continue;
    if (placed.has(line.id)) continue;
    unresolved.push({
      reason: 'outside_blank',
      lineIds: [line.id],
      message: `${line.type} line "${line.role}" lies outside the blank and borders no face.`,
    });
  }

  // A subdividing edge that does not separate two faces cannot become a hinge.
  // Both half-edges landing in the same cycle means the crease dangles inside a
  // panel; otherwise it sits on the blank boundary with air on one side.
  for (const e of arr.edges) {
    if (BOUNDING_TYPES.includes(e.type)) continue;
    const ids = edgeFaces.get(e.id);
    if (!ids || ids.length !== 1) continue;
    const roles = [...new Set(e.lineIds.map((id) => lineById.get(id)?.role ?? id))].join(', ');
    const h0 = arr.halfEdges.find((h) => h.edge === e.id)!;
    const sameCycle = arr.halfEdges[h0.twin]!.cycle === h0.cycle;
    unresolved.push(
      sameCycle
        ? {
            reason: 'dangling',
            lineIds: [...e.lineIds],
            faceIds: [...ids],
            message: `${e.type} line "${roles}" dangles inside ${ids[0]} without dividing it.`,
          }
        : {
            reason: 'not_a_hinge',
            lineIds: [...e.lineIds],
            faceIds: [...ids],
            message: `${e.type} line "${roles}" runs along the edge of ${ids[0]} with no face on the other side.`,
          },
    );
  }

  // 7. Name the faces. Roles come from seed points a style emits, never from
  //    guessing at the bounding line names: a fold line names two faces at
  //    once, so bounding roles cannot identify a face reliably. A seed sits
  //    inside its panel and keeps naming it after the panel is resized or the
  //    user drags an edge.
  for (const seed of seeds) {
    const hit = faces.find(
      (f) => pointInRing(seed.point, f.outer.points) && !f.holes.some((h) => pointInRing(seed.point, h.points)),
    );
    if (!hit) {
      unresolved.push({
        reason: 'degenerate_face',
        lineIds: [],
        message: `No face was found at the seed point for "${seed.role}". The panel it names no longer exists.`,
      });
      continue;
    }
    hit.role = seed.role;
    if (seed.kind) hit.kind = seed.kind;
  }

  return { faces, unresolved: dedupe(unresolved), edgeFaces };
}

/**
 * A point just outside a clockwise ring, used to find which face owns it.
 * Walks the ring's edges so a thin or concave hole still gets a valid probe.
 */
function outwardProbe(ring: readonly Vec2[]): Vec2 | null {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const d = sub(b, a);
    const l = Math.hypot(d.x, d.y);
    if (l < WELD_TOL) continue;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // The ring is clockwise, so its left normal points away from the enclosed
    // hole and into the surrounding material.
    const nrm = normalLeft(normalize(d));
    for (const step of [l * 1e-3, l * 1e-2, l * 0.1]) {
      const cand = add(mid, scale(nrm, step));
      if (!pointInRing(cand, ring)) return cand;
    }
  }
  return null;
}

function linesForEdges(
  arr: Arrangement,
  edgeIds: readonly number[],
  lineById: Map<string, DrawingLine>,
): string[] {
  const out = new Set<string>();
  for (const id of edgeIds) {
    for (const lid of arr.edges[id]!.lineIds) if (lineById.has(lid)) out.add(lid);
  }
  return [...out];
}

function dedupe(items: UnresolvedItem[]): UnresolvedItem[] {
  const seen = new Set<string>();
  const out: UnresolvedItem[] = [];
  for (const item of items) {
    const key = `${item.reason}|${item.lineIds.join(',')}|${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
