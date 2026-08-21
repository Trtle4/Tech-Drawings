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
import type { FormedShapeSpec, LoftStationSpec } from '../styles/schema.js';
import { evalExpr, type Scope } from '../styles/expr.js';
import { foldedFacePoints } from './fold.js';
import { boundsOf } from './math.js';

/** One small, roughly-planar patch of a formed face — a quad, or a whole flat face. */
export interface FormedFacet {
  /** World-space points. */
  points: Vec3[];
  /** Flat (x, y) for each point in `points` — the UV, unchanged by forming. */
  uv: Vec2[];
}

/**
 * A face's formed geometry, as one or more facets. A rigid/flat face (a
 * carton panel, a bag's flat crimp cap) is exactly one facet — its own outer
 * ring. A face on a LOFTED, curved surface is subdivided into many small
 * quads, because a curved cross-section drawn as a single flat-shaded
 * polygon per original face reads as faceted (a hexagon standing in for an
 * ellipse) regardless of how finely that one polygon's own boundary is
 * sampled — only the OUTER edge gets subdivided that way, never the
 * interior. Consumers render every facet as its own small flat-shaded patch.
 */
export interface FormedFace {
  face: Face;
  facets: FormedFacet[];
  /**
   * The face's own outer boundary, world points, drawn as a stroke-only line
   * separate from the (possibly many) shaded facets. Facets themselves are
   * seamed in their own fill colour so tessellation never shows as a visible
   * mesh; this is what actually marks where one face ends and its neighbour
   * — a different panel, a folded-on fin — begins.
   */
  outline: Vec3[];
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
  if (spec.kind === 'gusseted_pouch') return gussetedPouch(resolved, spec, fill, params);
  if (spec.kind === 'lofted_profile') return loftedProfile(resolved, graph, spec, fill);
  return rigidFallback(resolved);
}

function rigidFallback(resolved: ResolvedGeometry): Map<string, FormedFace> {
  const out = new Map<string, FormedFace>();
  for (const [id, { face, points }] of foldedFacePoints(resolved, 1)) {
    out.set(id, { face, facets: [{ points, uv: face.outer.points }], outline: points });
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
    out.set(face.id, { face, facets: [{ points, uv }], outline: points });
  }

  return out;
}

// ---------------------------------------------------------------------------
// lofted_profile — the general engine: stations along the up-axis, each with
// its own cross-section, interpolated between. No fold-tree dependency at
// all. Every bag becomes a station list against this one engine, not a
// bespoke shape function per bag.
// ---------------------------------------------------------------------------

interface ResolvedStation {
  y: number;
  halfWidth: number;
  halfDepth: number;
}

const normalize2 = (x: number, z: number): { x: number; z: number } => {
  const l = Math.hypot(x, z);
  return l < 1e-9 ? { x: 1, z: 0 } : { x: x / l, z: z / l };
};

/**
 * A lofted cross-section, swept along the up-axis. Every face — round or
 * flap — is placed by a closed-form function of its own flat (x, y) and the
 * resolved stations; nothing here reads `foldedFacePoints` or any other
 * fold-tree output, for any face, at any fill. A carton's 3D is a fold
 * traversal because rigid facets hinge on creases; a bag is a film tube
 * whose shape comes from its own seals and how full it is, so this does not
 * derive from folding and does not patch a folded result afterward.
 *
 * `faceRoles` are the panels that lie on the lofted surface — their combined
 * flat x-extent is the girth, and each panel's own x-position becomes an
 * angular position around the section. `stations` are resolved against the
 * style's own params PLUS `girth`, so a flat crimp is written as
 * `{ halfWidth: 'girth/2', halfDepth: 'caliper' }` — the same ellipse
 * formula as the round midpoint, just with different numbers, which is what
 * lets the two loft into each other with no special-cased "flat" path.
 *
 * `fill` blends the whole tube, at every y, between the first station's
 * cross-section (a uniformly flat/closed bag, used at fill = 0) and the
 * authored per-y loft (fill = 1) — a fully deflated bag has no bulge
 * anywhere along its length, not just at the ends the stations name.
 *
 * `flapFaceRoles` (a fin, a side seal) are not on the lofted surface at all.
 * `sealStyle: 'fin'` (the default) folds each flap flat against the surface
 * at its own seam: a straight tangent flap, offset outward by 2x caliper,
 * running its own true width toward `flapFold`. `sealStyle: 'lap'` instead
 * treats the flap as a continuation of the SAME lofted surface — its flat x
 * sits just outside the round span, and `angleOf` is unclamped, so it
 * samples the loft smoothly past the seam rather than switching formula —
 * offset out by 2x caliper for the extra ply, never standing proud of the
 * body the way a straight flap does. That difference is exactly "no
 * protruding fin": an overlap seal is physically part of the same wrapped
 * film, not a separate flap sealed on afterward.
 */
function loftedProfile(
  resolved: ResolvedGeometry,
  graph: GeometryGraph,
  spec: FormedShapeSpec,
  fill: number,
): Map<string, FormedFace> {
  const byRole = new Map(resolved.faces.map((f) => [f.role, f]));
  const roundFaces = (spec.faceRoles ?? []).map((r) => byRole.get(r)).filter((f): f is Face => !!f);
  const flapFaces = (spec.flapFaceRoles ?? []).map((r) => byRole.get(r)).filter((f): f is Face => !!f);

  const out = new Map<string, FormedFace>();
  // Anything the spec does not mention is drawn flat at its own position —
  // never the rigid fold, even as a fallback.
  for (const face of resolved.faces) {
    const flatPoints = face.outer.points.map((p) => ({ x: p.x, y: p.y, z: 0 }));
    out.set(face.id, { face, facets: [{ points: flatPoints, uv: face.outer.points }], outline: flatPoints });
  }
  if (roundFaces.length === 0 || (spec.stations ?? []).length < 2) return out;

  const roundBounds = roundFaces.map((f) => boundsOf(f.outer.points)!);
  const girthX0 = Math.min(...roundBounds.map((b) => b.min.x));
  const girthX1 = Math.max(...roundBounds.map((b) => b.max.x));
  const girth = girthX1 - girthX0;
  if (girth <= 0) return out;

  const paramScope = (graph.meta?.params as Record<string, number> | undefined) ?? {};
  const scope: Scope = { ...paramScope, girth };
  const stations: ResolvedStation[] = spec
    .stations!.map((s: LoftStationSpec) => ({
      y: evalExpr(s.y, scope),
      halfWidth: evalExpr(s.halfWidth, scope),
      halfDepth: evalExpr(s.halfDepth, scope),
    }))
    .sort((a, b) => a.y - b.y);
  const flatRef = stations[0]!;

  const angleOf = (x: number) => (x - girthX0) / girth; // t, unclamped — can run past [0, 1]

  const stationAt = (y: number): { halfWidth: number; halfDepth: number } => {
    let i = 0;
    while (i < stations.length - 2 && y > stations[i + 1]!.y) i++;
    const s0 = stations[i]!;
    const s1 = stations[i + 1]!;
    const span = s1.y - s0.y || 1;
    const frac = Math.max(0, Math.min(1, (y - s0.y) / span));
    return { halfWidth: lerp(s0.halfWidth, s1.halfWidth, frac), halfDepth: lerp(s0.halfDepth, s1.halfDepth, frac) };
  };

  /** The lofted surface point at girth-fraction t and length y, blended by fill. */
  const surfaceAt = (y: number, t: number): { x: number; z: number } => {
    const st = stationAt(y);
    const halfWidth = lerp(flatRef.halfWidth, st.halfWidth, fill);
    const halfDepth = lerp(flatRef.halfDepth, st.halfDepth, fill);
    const angle = t * 2 * Math.PI;
    return { x: halfWidth * Math.cos(angle), z: halfDepth * Math.sin(angle) };
  };

  /** The FLAT reference cross-section alone, at girth-fraction t — fixed, no y or fill. */
  const flatAt = (t: number): { x: number; z: number } => {
    const angle = t * 2 * Math.PI;
    return { x: flatRef.halfWidth * Math.cos(angle), z: flatRef.halfDepth * Math.sin(angle) };
  };

  // Tessellation is driven by curvature, not by how many panels divide the
  // girth. A pillow bag has three round panels; a gusseted bag might have
  // seven. Sampling a fixed count PER FACE makes the cross-section a hexagon
  // for the first and a smoother polygon for the second, for reasons that
  // have nothing to do with either bag's actual roundness — the earlier bug.
  // Instead: pick a total segment count around the FULL girth from a target
  // chord error against the largest radius any station actually reaches,
  // then give each face a share of that total proportional to its own
  // angular span. A wide panel gets many segments, a narrow one gets few,
  // but the ellipse they jointly trace is equally smooth regardless of the
  // panel count in between.
  const maxRadius = Math.max(
    1e-6,
    ...stations.flatMap((s) => [Math.abs(s.halfWidth), Math.abs(s.halfDepth)]),
  );
  const CHORD_TOLERANCE_MM = 0.4;
  const angleStep = 2 * Math.acos(Math.max(-1, 1 - CHORD_TOLERANCE_MM / maxRadius));
  const totalGirthSegments = Math.max(24, Math.min(240, Math.ceil((2 * Math.PI) / angleStep)));
  const segmentsForSpan = (tSpan: number) => Math.max(2, Math.round(totalGirthSegments * Math.abs(tSpan)));

  // Rows scale with each face's own physical height, not with topology
  // either — a short crimp cap and a tall body panel each get a sane row
  // count for their own size, independent of anything else in the mesh.
  const ROW_SPACING_MM = 3;
  const rowsForHeight = (h: number) => Math.max(6, Math.min(120, Math.round(h / ROW_SPACING_MM)));

  const sampleGrid = (
    bnd: { min: Vec2; max: Vec2 },
    pointAt: (x: number, y: number) => { x: number; z: number },
  ): { p: Vec3; uv: Vec2 }[][] => {
    const w = bnd.max.x - bnd.min.x;
    const h = bnd.max.y - bnd.min.y;
    const cols = segmentsForSpan(w / girth);
    const rows = rowsForHeight(h);
    const grid: { p: Vec3; uv: Vec2 }[][] = [];
    for (let j = 0; j <= rows; j++) {
      const y = bnd.min.y + (h * j) / rows;
      const row: { p: Vec3; uv: Vec2 }[] = [];
      for (let i = 0; i <= cols; i++) {
        const x = bnd.min.x + (w * i) / cols;
        const { x: px, z } = pointAt(x, y);
        row.push({ p: { x: px, y, z }, uv: { x, y } });
      }
      grid.push(row);
    }
    return grid;
  };

  for (const face of roundFaces) {
    const bnd = boundsOf(face.outer.points)!;
    const grid = sampleGrid(bnd, (x, y) => surfaceAt(y, angleOf(x)));
    out.set(face.id, { face, facets: gridToQuads(grid), outline: gridPerimeter(grid) });
  }

  const thickness = 2 * graph.caliper;
  const sealStyle = spec.sealStyle ?? 'fin';
  // girthX0 (t = 0) sits at the seam, and +t runs forward through the
  // round faceRoles in their flat left-to-right order — for the pillow that
  // is back_panel_left first, so 'left' (the default) is +t and 'right' is
  // -t, matching those role names.
  const foldSign = spec.flapFold === 'right' ? -1 : 1;
  const TANGENT_STEP = 0.01; // in girth-fraction t

  for (const face of flapFaces) {
    const bnd = boundsOf(face.outer.points)!;
    const distMin = Math.min(Math.abs(bnd.min.x - girthX0), Math.abs(bnd.min.x - girthX1));
    const distMax = Math.min(Math.abs(bnd.max.x - girthX0), Math.abs(bnd.max.x - girthX1));
    const attachX = distMin <= distMax ? bnd.min.x : bnd.max.x;
    const seamT = Math.round(angleOf(attachX)); // periodic: 0 or 1, the same physical seam point

    let grid: { p: Vec3; uv: Vec2 }[][];
    if (sealStyle === 'lap') {
      // Not a separate flap — the same lofted surface, sampled past the
      // seam, offset out by the extra ply's thickness along the local
      // radial direction.
      grid = sampleGrid(bnd, (x, y) => {
        const p = surfaceAt(y, angleOf(x));
        const n = normalize2(p.x, p.z);
        return { x: p.x + n.x * thickness, z: p.z + n.z * thickness };
      });
    } else {
      // A straight flap, folded flat against the surface at the seam: a
      // fixed offset out from the seam point, running its own true width
      // along a fixed tangent toward flapFold. The tangent MUST come from
      // the flat reference cross-section, not the current (possibly
      // rounded) surfaceAt — at the seam, which sits at the ellipse's own
      // widest point, the round surface's tangent runs almost entirely in
      // z (that IS the tube's curvature there), so building the flap from
      // it swings the flap out to the side by as much as the section's own
      // depth, the exact "sticking out like a flag" bug this replaces. A
      // flap that is actually folded flat stays flat regardless of how
      // round the body is elsewhere: it runs along the flat width
      // direction, which is what the degenerate flat ellipse gives.
      grid = sampleGrid(bnd, (x, y) => {
        const base = surfaceAt(y, seamT);
        const flatBase = flatAt(seamT);
        const flatStep = flatAt(seamT + foldSign * TANGENT_STEP);
        const tangent = normalize2(flatStep.x - flatBase.x, flatStep.z - flatBase.z);
        const normal = normalize2(base.x, base.z);
        const along = Math.abs(x - attachX);
        return { x: base.x + normal.x * thickness + tangent.x * along, z: base.z + normal.z * thickness + tangent.z * along };
      });
    }
    out.set(face.id, { face, facets: gridToQuads(grid), outline: gridPerimeter(grid) });
  }

  return out;
}

/**
 * The outer perimeter of a sampled row x column grid — bottom row left to
 * right, up the right edge, top row right to left, down the left edge — one
 * closed loop for a stroke-only boundary line, separate from the filled
 * quad facets.
 */
function gridPerimeter(grid: { p: Vec3; uv: Vec2 }[][]): Vec3[] {
  const points: Vec3[] = [];
  const push = (cell: { p: Vec3 }) => points.push(cell.p);
  for (const cell of grid[0]!) push(cell);
  for (let j = 1; j < grid.length; j++) push(grid[j]![grid[j]!.length - 1]!);
  for (let i = grid[grid.length - 1]!.length - 2; i >= 0; i--) push(grid[grid.length - 1]![i]!);
  for (let j = grid.length - 2; j >= 1; j--) push(grid[j]![0]!);
  return points;
}

/** Every interior cell of a sampled row x column grid, as its own quad facet. */
function gridToQuads(grid: { p: Vec3; uv: Vec2 }[][]): FormedFacet[] {
  const facets: FormedFacet[] = [];
  for (let j = 0; j < grid.length - 1; j++) {
    const row = grid[j]!;
    const next = grid[j + 1]!;
    for (let i = 0; i < row.length - 1; i++) {
      const a = row[i]!;
      const b = row[i + 1]!;
      const c = next[i + 1]!;
      const d = next[i]!;
      facets.push({ points: [a.p, b.p, c.p, d.p], uv: [a.uv, b.uv, c.uv, d.uv] });
    }
  }
  return facets;
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
    out.set(face.id, { face, facets: [{ points, uv: face.outer.points }], outline: points });
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
    out.set(face.id, { face, facets: [{ points, uv: face.outer.points }], outline: points });
  }

  return out;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t),
});
