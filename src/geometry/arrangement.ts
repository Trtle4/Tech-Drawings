import type { DrawingLine, LineType, Path, Vec2 } from './types.js';
import { isStructural } from './types.js';
import { WELD_TOL, dist, splitParams } from './math.js';

/** A straight piece of some DrawingLine, before intersection splitting. */
export interface RawSegment {
  a: Vec2;
  b: Vec2;
  lineId: string;
  type: LineType;
}

export interface ArrVertex {
  id: number;
  p: Vec2;
  /** Outgoing half-edge ids, sorted counter-clockwise by direction. */
  outgoing: number[];
}

export interface ArrEdge {
  id: number;
  a: number;
  b: number;
  /** The dominant line type on this edge. */
  type: LineType;
  /** Every DrawingLine that contributed to this edge. */
  lineIds: string[];
  /** Both types present, when lines of different types overlap exactly. */
  types: LineType[];
}

export interface ArrHalfEdge {
  id: number;
  edge: number;
  origin: number;
  /** Vertex at the head of this half-edge. */
  head: number;
  twin: number;
  /** Next half-edge along the same face cycle. Filled in by `linkCycles`. */
  next: number;
  /** Cycle index assigned by `traceCycles`. */
  cycle: number;
  /** Direction angle from origin, radians in (-π, π]. */
  angle: number;
}

export interface Arrangement {
  vertices: ArrVertex[];
  edges: ArrEdge[];
  halfEdges: ArrHalfEdge[];
  /** Cycles as ordered half-edge id lists. */
  cycles: number[][];
  /** Structural lines that vanished during arrangement, with a reason. */
  dropped: { lineId: string; reason: 'zero_length' }[];
}

/**
 * Chord tolerance for flattening arcs, in mm. Fine enough that a 3 mm peg hole
 * still reads as round in the drawing and coarse enough to keep the
 * arrangement small.
 */
export const ARC_CHORD_TOL = 0.05;

/** When one edge carries several line types, the strongest wins. */
const TYPE_RANK: Record<LineType, number> = {
  cut: 6,
  crease: 5,
  score: 4,
  perf: 3,
  bleed: 2,
  dimension: 1,
  construction: 0,
};

function rank(t: LineType): number {
  return TYPE_RANK[t] ?? 0;
}

/** Flatten a path into straight segments, splitting arcs under the chord tolerance. */
export function flattenPath(path: Path, chordTol = ARC_CHORD_TOL): Vec2[] {
  if (path.kind === 'polyline') {
    const pts = path.points.slice();
    if (path.closed && pts.length > 2) {
      const first = pts[0]!;
      const last = pts[pts.length - 1]!;
      if (dist(first, last) > WELD_TOL) pts.push({ ...first });
    }
    return pts;
  }
  const { center, radius, startAngle, endAngle } = path;
  const sweep = endAngle - startAngle;
  // Segments needed so the sagitta stays under the chord tolerance.
  const maxStep =
    radius > chordTol ? 2 * Math.acos(Math.max(-1, 1 - chordTol / radius)) : Math.PI / 2;
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / Math.max(maxStep, 1e-6)));
  const pts: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = startAngle + (sweep * i) / steps;
    pts.push({ x: center.x + radius * Math.cos(t), y: center.y + radius * Math.sin(t) });
  }
  return pts;
}

/** Structural lines, flattened to straight segments tagged with provenance. */
export function toRawSegments(lines: readonly DrawingLine[], chordTol = ARC_CHORD_TOL): RawSegment[] {
  const out: RawSegment[] = [];
  for (const line of lines) {
    if (!isStructural(line.type)) continue;
    const pts = flattenPath(line.geometry, chordTol);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      if (dist(a, b) <= WELD_TOL) continue;
      out.push({ a, b, lineId: line.id, type: line.type });
    }
  }
  return out;
}

/** Snap-to-grid spatial hash so coincident endpoints weld into one vertex. */
class VertexIndex {
  private buckets = new Map<string, number[]>();
  readonly vertices: ArrVertex[] = [];

  constructor(private tol = WELD_TOL) {}

  private key(x: number, y: number): string {
    return `${Math.round(x / this.tol)}:${Math.round(y / this.tol)}`;
  }

  add(p: Vec2): number {
    const gx = Math.round(p.x / this.tol);
    const gy = Math.round(p.y / this.tol);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.buckets.get(`${gx + dx}:${gy + dy}`);
        if (!bucket) continue;
        for (const id of bucket) {
          if (dist(this.vertices[id]!.p, p) <= this.tol) return id;
        }
      }
    }
    const id = this.vertices.length;
    this.vertices.push({ id, p: { x: p.x, y: p.y }, outgoing: [] });
    const k = this.key(p.x, p.y);
    const bucket = this.buckets.get(k);
    if (bucket) bucket.push(id);
    else this.buckets.set(k, [id]);
    return id;
  }
}

/**
 * Build the planar arrangement: split every structural segment at every
 * crossing and T-junction, weld coincident endpoints, merge duplicate edges,
 * and link half-edges into face cycles.
 *
 * Deliberately O(n²) in segment count. A blank is tens to low hundreds of
 * segments; a sweep line here would be complexity with no payoff yet.
 */
export function buildArrangement(
  lines: readonly DrawingLine[],
  opts: { chordTol?: number; weldTol?: number } = {},
): Arrangement {
  const weldTol = opts.weldTol ?? WELD_TOL;
  const raw = toRawSegments(lines, opts.chordTol ?? ARC_CHORD_TOL);
  const dropped: Arrangement['dropped'] = [];

  const structuralIds = new Set(lines.filter((l) => isStructural(l.type)).map((l) => l.id));
  const survivors = new Set<string>();

  // 1. Split each segment at every intersection with every other segment.
  const pieces: RawSegment[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i]!;
    const ts = new Set<number>([0, 1]);
    for (let j = 0; j < raw.length; j++) {
      if (i === j) continue;
      const o = raw[j]!;
      for (const t of splitParams(s.a, s.b, o.a, o.b)) ts.add(t);
    }
    const sorted = [...ts].sort((x, y) => x - y);
    for (let k = 0; k + 1 < sorted.length; k++) {
      const t0 = sorted[k]!;
      const t1 = sorted[k + 1]!;
      const p0 = { x: s.a.x + (s.b.x - s.a.x) * t0, y: s.a.y + (s.b.y - s.a.y) * t0 };
      const p1 = { x: s.a.x + (s.b.x - s.a.x) * t1, y: s.a.y + (s.b.y - s.a.y) * t1 };
      if (dist(p0, p1) <= weldTol) continue;
      pieces.push({ a: p0, b: p1, lineId: s.lineId, type: s.type });
    }
  }

  // 2. Weld endpoints into shared vertices.
  const index = new VertexIndex(weldTol);
  const edgeKey = new Map<string, number>();
  const edges: ArrEdge[] = [];
  for (const piece of pieces) {
    const a = index.add(piece.a);
    const b = index.add(piece.b);
    if (a === b) continue;
    survivors.add(piece.lineId);
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const existing = edgeKey.get(key);
    if (existing !== undefined) {
      // 3. Duplicate/overlapping edge — merge provenance, keep strongest type.
      const e = edges[existing]!;
      if (!e.lineIds.includes(piece.lineId)) e.lineIds.push(piece.lineId);
      if (!e.types.includes(piece.type)) e.types.push(piece.type);
      if (rank(piece.type) > rank(e.type)) e.type = piece.type;
      continue;
    }
    const id = edges.length;
    edgeKey.set(key, id);
    edges.push({ id, a, b, type: piece.type, lineIds: [piece.lineId], types: [piece.type] });
  }

  for (const id of structuralIds) {
    if (!survivors.has(id)) dropped.push({ lineId: id, reason: 'zero_length' });
  }

  const vertices = index.vertices;

  // 4. Half-edges, two per edge.
  const halfEdges: ArrHalfEdge[] = [];
  for (const e of edges) {
    const h0 = halfEdges.length;
    const h1 = h0 + 1;
    const pa = vertices[e.a]!.p;
    const pb = vertices[e.b]!.p;
    halfEdges.push({
      id: h0,
      edge: e.id,
      origin: e.a,
      head: e.b,
      twin: h1,
      next: -1,
      cycle: -1,
      angle: Math.atan2(pb.y - pa.y, pb.x - pa.x),
    });
    halfEdges.push({
      id: h1,
      edge: e.id,
      origin: e.b,
      head: e.a,
      twin: h0,
      next: -1,
      cycle: -1,
      angle: Math.atan2(pa.y - pb.y, pa.x - pb.x),
    });
    vertices[e.a]!.outgoing.push(h0);
    vertices[e.b]!.outgoing.push(h1);
  }

  // 5. Sort outgoing half-edges CCW at each vertex.
  for (const vert of vertices) {
    vert.outgoing.sort((x, y) => halfEdges[x]!.angle - halfEdges[y]!.angle);
  }

  // 6. Link cycles.
  //
  // next(e) is the half-edge outgoing from head(e) that immediately precedes
  // twin(e) in counter-clockwise order — i.e. take the sharpest right turn.
  // With this rule, bounded faces trace counter-clockwise (positive signed
  // area) and the outer boundary of each component traces clockwise.
  for (const he of halfEdges) {
    const atHead = vertices[he.head]!.outgoing;
    const i = atHead.indexOf(he.twin);
    he.next = atHead[(i - 1 + atHead.length) % atHead.length]!;
  }

  const cycles = traceCycles(halfEdges);

  return { vertices, edges, halfEdges, cycles, dropped };
}

function traceCycles(halfEdges: ArrHalfEdge[]): number[][] {
  const cycles: number[][] = [];
  for (const start of halfEdges) {
    if (start.cycle !== -1) continue;
    const idx = cycles.length;
    const walk: number[] = [];
    let cur = start;
    // Guard against a malformed link table rather than spinning forever.
    for (let guard = 0; guard <= halfEdges.length + 1; guard++) {
      if (cur.cycle !== -1) break;
      cur.cycle = idx;
      walk.push(cur.id);
      cur = halfEdges[cur.next]!;
      if (cur.id === start.id) break;
    }
    cycles.push(walk);
  }
  return cycles;
}
