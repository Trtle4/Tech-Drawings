/**
 * Parametric approximation of a filled bag's shape, for the 3D view.
 *
 * NOT simulation. The fold traversal (`fold.ts`) produces the RIGID folded
 * state, which is correct for board and wrong for film: a pillow bag has no
 * rigid folded form, it billows into a tube; a stand-up pouch's base opens
 * into an oval and its walls bow out. Both approximations here are closed-form
 * functions of the flat pattern, chosen to be exact at `fill = 0` (matching
 * the rigid lay-flat fold, already tested) and to open smoothly as `fill`
 * rises toward 1.
 *
 * THE RULE THAT MATTERS: every point this module produces is a deformation of
 * the flat blank's OWN surface. A face's outer ring is read from the resolved
 * geometry — the same rings the DXF and the flat drawing use — and every
 * vertex keeps its flat (x, y) as its intrinsic surface parameter; only its
 * position in 3D space changes. There is no separate mesh with its own UV
 * unwrap. That is what lets artwork, once it exists, land in the same place
 * on the flat drawing, the lay-flat fold and the formed pack.
 */

import type { Face, GeometryGraph, ResolvedGeometry, Vec2, Vec3 } from './types.js';
import type { FormedShapeSpec } from '../styles/schema.js';
import { evalExpr } from '../styles/expr.js';
import { foldedFacePoints } from './fold.js';
import { boundsOf } from './math.js';

/** A face's formed geometry: world points, each still tagged with its flat (x, y). */
export interface FormedFace {
  face: Face;
  /** World-space points, in the same order as `face.outer.points` extended by subdivision. */
  points: Vec3[];
  /** Flat (x, y) for each point in `points` — the UV, unchanged by forming. */
  uv: Vec2[];
}

/**
 * Resolve `formedShape.params` (and `fill`, if not overridden) against the
 * style's own resolved parameters, so param values like `bagD` or `G` are
 * available inside the formed-shape expressions.
 */
function resolveParams(
  spec: FormedShapeSpec,
  graph: GeometryGraph,
  fillOverride?: number,
): { fill: number; params: Record<string, number> } {
  const scope = (graph.meta?.params as Record<string, number> | undefined) ?? {};
  const fill =
    fillOverride ?? (spec.fill !== undefined ? evalExpr(spec.fill, scope) : 0.8);
  const params: Record<string, number> = {};
  for (const [k, expr] of Object.entries(spec.params ?? {})) params[k] = evalExpr(expr, scope);
  return { fill: Math.max(0, Math.min(1, fill)), params };
}

/**
 * If `formedShape` is absent, or its kind is 'none', or the graph has no
 * resolved faces to work with, there is no formed state distinct from the
 * rigid fold — the caller should just use `foldedFacePoints` directly.
 */
export function hasFormedShape(graph: GeometryGraph): graph is GeometryGraph & {
  formedShape: FormedShapeSpec;
} {
  const spec = graph.formedShape as FormedShapeSpec | undefined;
  return !!spec && spec.kind !== 'none';
}

export function computeFormedShape(
  graph: GeometryGraph,
  resolved: ResolvedGeometry,
  fillOverride?: number,
): Map<string, FormedFace> {
  const spec = graph.formedShape as FormedShapeSpec | undefined;
  if (!spec || spec.kind === 'none') {
    return rigidFallback(resolved);
  }
  const { fill, params } = resolveParams(spec, graph, fillOverride);
  if (spec.kind === 'tube') return tube(resolved, spec, fill);
  if (spec.kind === 'crimped_tube') return crimpedTube(resolved, spec, fill);
  if (spec.kind === 'gusseted_pouch') return gussetedPouch(resolved, spec, fill, params);
  return rigidFallback(resolved);
}

function rigidFallback(resolved: ResolvedGeometry): Map<string, FormedFace> {
  const out = new Map<string, FormedFace>();
  for (const [id, { face, points }] of foldedFacePoints(resolved, 1)) {
    out.set(id, { face, points, uv: face.outer.points });
  }
  return out;
}

// ---------------------------------------------------------------------------
// tube — pillow and gusseted bags
// ---------------------------------------------------------------------------

/**
 * A tube of the flat pattern's own girth, round at `fill = 1` and a flat
 * folded strip at `fill = 0`.
 *
 * The `faceRoles` panels are ordered around the girth by their flat x-centroid
 * — valid because a style built on the grid lays its wrap columns out left to
 * right in physical order. Each panel's x-extent becomes an arc-length span on
 * the cross-section; y is untouched and becomes the tube's length axis, matching
 * what the rigid fold already does for a wrap-style hinge chain. `flatFaceRoles`
 * (end seals, the fin) keep their rigid, fully-folded position — real seals do
 * not billow.
 */
function tube(
  resolved: ResolvedGeometry,
  spec: FormedShapeSpec,
  fill: number,
): Map<string, FormedFace> {
  const out = rigidFallback(resolved);
  const byRole = new Map(resolved.faces.map((f) => [f.role, f]));
  const roundFaces = (spec.faceRoles ?? [])
    .map((r) => byRole.get(r))
    .filter((f): f is Face => !!f)
    .sort((a, b) => a.centroid.x - b.centroid.x);
  if (roundFaces.length === 0) return out;

  const spans = roundFaces.map((f) => {
    const b = boundsOf(f.outer.points)!;
    return { face: f, x0: b.min.x, x1: b.max.x, y0: b.min.y, y1: b.max.y };
  });
  const girth = spans.reduce((s, sp) => s + (sp.x1 - sp.x0), 0);
  if (girth <= 0) return out;
  let cursor = 0;
  const offsetOf = new Map<string, number>();
  for (const sp of spans) {
    offsetOf.set(sp.face.id, cursor);
    cursor += sp.x1 - sp.x0;
  }

  const R = girth / (2 * Math.PI);
  const a = lerp(girth / 2, R, fill);
  const b = lerp(0, R, fill);

  // Subdivide across the girth so the cross-section reads as round, not
  // faceted at just the panel corners.
  const SEGMENTS_PER_FACE = 10;

  for (const sp of spans) {
    const face = sp.face;
    const off = offsetOf.get(face.id)!;
    const width = sp.x1 - sp.x0;
    const points: Vec3[] = [];
    const uv: Vec2[] = [];
    for (const y of [sp.y0, sp.y1]) {
      const row: Vec3[] = [];
      const rowUv: Vec2[] = [];
      for (let i = 0; i <= SEGMENTS_PER_FACE; i++) {
        const x = sp.x0 + (width * i) / SEGMENTS_PER_FACE;
        const t = (off + (x - sp.x0)) / girth;
        const angle = t * 2 * Math.PI;
        row.push({ x: a * Math.cos(angle), y, z: b * Math.sin(angle) });
        rowUv.push({ x, y });
      }
      // Trace bottom row left-to-right, top row right-to-left, so the strip
      // is one closed, non-self-intersecting outline.
      if (y === sp.y0) {
        points.push(...row);
        uv.push(...rowUv);
      } else {
        points.push(...row.reverse());
        uv.push(...rowUv.reverse());
      }
    }
    out.set(face.id, { face, points, uv });
  }

  return out;
}

// ---------------------------------------------------------------------------
// crimped_tube — pillow bag, no fold-tree dependency at all
// ---------------------------------------------------------------------------

/**
 * A round tube down the body, tapering to a flat crimped line at the true
 * ends. Every face — round or capped — is placed by the same closed-form
 * function of its own flat (x, y) and the style's params; nothing here reads
 * `foldedFacePoints` or any other fold-tree output, for any face, at any
 * fill. A carton's 3D is a fold traversal because rigid facets hinge on
 * creases; a bag is a film tube whose shape comes from its seals and how
 * full it is, so this does not derive from folding and does not patch a
 * folded result afterward — it is its own model, seeded only by dimensions.
 *
 * `faceRoles` are the panels that actually round out — front and back, whose
 * combined flat x-extent is the girth and whose combined flat y-extent is
 * the body. `flatFaceRoles` is everything that stays the fully flattened
 * section (a = girth / 2, b = 0) at every fill, over its own full extent —
 * both the true crimp bands beyond the body's y-extent, AND any fin, for its
 * whole length, not just its ends. A fin seal is two plies pressed flat and
 * sealed; it does not round out just because it is narrow. (An earlier
 * version folded the fin into the round faces on the theory that it "sits at
 * the seam angle anyway" — over a fin's narrow angular slice, the same
 * taper that reads as a gentle rounding on a wide panel instead flares from
 * a near-point at the body's midpoint out to the full flat width at its
 * edges, a visible spike. Keeping it flat throughout was simpler and is what
 * a fin actually does.) The round section itself tapers from full radius at
 * the body's midpoint to that same flattened line at the body's own edges,
 * so body and crimp band meet without a seam of their own.
 */
function crimpedTube(resolved: ResolvedGeometry, spec: FormedShapeSpec, fill: number): Map<string, FormedFace> {
  const byRole = new Map(resolved.faces.map((f) => [f.role, f]));
  const roundFaces = (spec.faceRoles ?? []).map((r) => byRole.get(r)).filter((f): f is Face => !!f);
  const capFaces = (spec.flatFaceRoles ?? []).map((r) => byRole.get(r)).filter((f): f is Face => !!f);

  const out = new Map<string, FormedFace>();
  // Anything the spec does not mention is drawn flat at its own position —
  // never the rigid fold, even as a fallback.
  for (const face of resolved.faces) {
    out.set(face.id, { face, points: face.outer.points.map((p) => ({ x: p.x, y: p.y, z: 0 })), uv: face.outer.points });
  }
  if (roundFaces.length === 0) return out;

  const roundBounds = roundFaces.map((f) => boundsOf(f.outer.points)!);
  const girthX0 = Math.min(...roundBounds.map((b) => b.min.x));
  const girthX1 = Math.max(...roundBounds.map((b) => b.max.x));
  const girth = girthX1 - girthX0;
  if (girth <= 0) return out;

  const bodyY0 = Math.min(...roundBounds.map((b) => b.min.y));
  const bodyY1 = Math.max(...roundBounds.map((b) => b.max.y));
  const bodySpan = bodyY1 - bodyY0 || 1;
  const R = girth / (2 * Math.PI);

  // 1 at the body's midpoint, 0 at its own top/bottom edge — the round
  // section's own taper toward the crimp, independent of fill. At taper = 0
  // the target radius below becomes (girth/2, 0): the same flattened line
  // the crimp band sits at, which is the continuity this is for — not a
  // point, a line the width of the flattened tube.
  const taper = (y: number) => Math.sin(Math.PI * Math.max(0, Math.min(1, (y - bodyY0) / bodySpan)));
  const angleOf = (x: number) => ((x - girthX0) / girth) * 2 * Math.PI;

  const SEGMENTS_PER_FACE = 10;
  // A taper only shows up if more than the two end rows are ever sampled —
  // with just top and bottom, both rows sit exactly at the zero-taper edge
  // and the whole face would render flat regardless of fill.
  const ROWS_PER_FACE = 8;

  const place = (face: Face, radiusAt: (y: number) => { a: number; r: number }) => {
    const bnd = boundsOf(face.outer.points)!;
    const w = bnd.max.x - bnd.min.x;
    const h = bnd.max.y - bnd.min.y;
    const grid: { p: Vec3; uv: Vec2 }[][] = [];
    for (let j = 0; j <= ROWS_PER_FACE; j++) {
      const y = bnd.min.y + (h * j) / ROWS_PER_FACE;
      const { a, r } = radiusAt(y);
      const row: { p: Vec3; uv: Vec2 }[] = [];
      for (let i = 0; i <= SEGMENTS_PER_FACE; i++) {
        const x = bnd.min.x + (w * i) / SEGMENTS_PER_FACE;
        const angle = angleOf(x);
        row.push({ p: { x: a * Math.cos(angle), y, z: r * Math.sin(angle) }, uv: { x, y } });
      }
      grid.push(row);
    }

    // Trace just the perimeter of the row x column grid — bottom row left to
    // right, up the right edge, top row right to left, down the left edge —
    // one closed, non-self-intersecting outline that still reflects the
    // interior taper along the way, without needing a separate sub-face per
    // grid cell.
    const points: Vec3[] = [];
    const uv: Vec2[] = [];
    const push = (cell: { p: Vec3; uv: Vec2 }) => {
      points.push(cell.p);
      uv.push(cell.uv);
    };
    for (const cell of grid[0]!) push(cell);
    for (let j = 1; j < grid.length; j++) push(grid[j]![grid[j]!.length - 1]!);
    for (let i = grid[grid.length - 1]!.length - 2; i >= 0; i--) push(grid[grid.length - 1]![i]!);
    for (let j = grid.length - 2; j >= 1; j--) push(grid[j]![0]!);

    out.set(face.id, { face, points, uv });
  };

  for (const face of roundFaces) {
    place(face, (y) => {
      const roundedness = fill * taper(y);
      return { a: lerp(girth / 2, R, roundedness), r: lerp(0, R, roundedness) };
    });
  }
  for (const face of capFaces) {
    place(face, () => ({ a: girth / 2, r: 0 }));
  }

  return out;
}

// ---------------------------------------------------------------------------
// gusseted_pouch — stand-up pouch
// ---------------------------------------------------------------------------

/**
 * Walls bow out from flat, base opens into a lens at the gusset end.
 *
 * Both approximations are a LERP from the rigid lay-flat position (fill = 0,
 * exactly the tested fold) toward an opened target position (fill = 1), so
 * the shape starts from a known-correct state and moves smoothly away from
 * it rather than being defined independently and hoping the two agree at the
 * seam.
 *
 * `faceRoles` is assumed to hold two wall faces (front, back — the larger two
 * by area) and two base/gusset faces (the smaller two). Which wall is "front"
 * (bows toward +local-depth) versus "back" (−) is taken from their order in
 * `faceRoles`, since role names are the style's own vocabulary and not
 * something this generic function should parse.
 */
function gussetedPouch(
  resolved: ResolvedGeometry,
  spec: FormedShapeSpec,
  fill: number,
  params: Record<string, number>,
): Map<string, FormedFace> {
  const out = rigidFallback(resolved);
  const byRole = new Map(resolved.faces.map((f) => [f.role, f]));
  const roles = spec.faceRoles ?? [];
  const faces = roles.map((r) => byRole.get(r)).filter((f): f is Face => !!f);
  if (faces.length < 4) return out;

  const byArea = [...faces].sort((x, y) => y.area - x.area);
  const walls = byArea.slice(0, 2);
  const bases = byArea.slice(2, 4);
  // Preserve the style's own declared order for sidedness, not the area sort.
  const wallSign = new Map(walls.map((f) => [f.id, roles.indexOf(f.role) === roles.indexOf(walls[0]!.role) ? 1 : -1]));
  const baseSign = new Map(bases.map((f) => [f.id, roles.indexOf(f.role) === roles.indexOf(bases[0]!.role) ? 1 : -1]));

  // Everything below works in the RIGID FOLD's frame (ratio = 1), not the flat
  // pattern's own coordinates. That frame is where front and back already
  // overlap correctly — the whole point of "folds to lay-flat" — so inflating
  // is just displacing away from it, never re-deriving a shared baseline from
  // scratch. Using the flat frame instead was the bug this replaced: front and
  // back occupy DISJOINT flat-y ranges (drawn end to end in the pattern), so
  // an inflated target built from flat y pulled them apart instead of
  // puffing them out from the same standing position.
  const rigid = foldedFacePoints(resolved, 1);
  const rigidBounds = (face: Face) => boundsOf(rigid.get(face.id)!.points.map((p) => ({ x: p.x, y: p.y })))!;

  const baseCenterY =
    bases.reduce((s, f) => s + rigidBounds(f).min.y + rigidBounds(f).max.y, 0) / (2 * bases.length);

  const depth = params.baseDepth ?? 0;

  const wallWidth = Math.max(...walls.map((f) => rigidBounds(f).max.x - rigidBounds(f).min.x));
  const ovalRadiusX = wallWidth / 2;

  for (const face of walls) {
    const rigidPts = rigid.get(face.id)!.points;
    const rb = rigidBounds(face);
    const sign = wallSign.get(face.id) ?? 1;
    // Which edge is nearer the gusset decides which end gets v = 0.
    const gussetAtLowY = Math.abs(rb.min.y - baseCenterY) < Math.abs(rb.max.y - baseCenterY);
    const span = rb.max.y - rb.min.y || 1;
    const points = face.outer.points.map((_p, i) => {
      const rp = rigidPts[i]!;
      const v = gussetAtLowY ? (rp.y - rb.min.y) / span : (rb.max.y - rp.y) / span;
      const bulge = fill * depth * Math.sin(Math.PI * Math.max(0, Math.min(1, v)));
      // Displace from the rigid position; x and y stay exactly where the
      // tested fold already put them, only z (the bulge) moves.
      const inflated: Vec3 = { x: rp.x, y: rp.y, z: sign * bulge };
      return lerp3(rp, inflated, fill);
    });
    out.set(face.id, { face, points, uv: face.outer.points });
  }

  for (const face of bases) {
    const rigidPts = rigid.get(face.id)!.points;
    const rb = rigidBounds(face);
    const sign = baseSign.get(face.id) ?? 1;
    const cx = (rb.min.x + rb.max.x) / 2;
    const cy = (rb.min.y + rb.max.y) / 2;
    const halfW = (rb.max.x - rb.min.x) / 2 || 1;
    const halfH = (rb.max.y - rb.min.y) / 2 || 1;
    const points = face.outer.points.map((_p, i) => {
      const rp = rigidPts[i]!;
      const nx = (rp.x - cx) / halfW; // -1..1 across the panel width
      const nz = (rp.y - cy) / halfH; // -1..1 from the gusset centre outward
      // y stays at the rigid position — only x (spreads to the oval width)
      // and z (bulges outward past the centre line) move.
      const opened: Vec3 = { x: nx * ovalRadiusX, y: rp.y, z: sign * Math.max(0, nz) * depth };
      return lerp3(rp, opened, fill);
    });
    out.set(face.id, { face, points, uv: face.outer.points });
  }

  return out;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t),
});
