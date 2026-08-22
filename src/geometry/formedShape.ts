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
import type { FormedShapeSpec, LoftStationSpec, ProfileSpec } from '../styles/schema.js';
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
   * The face's own outer boundary (or boundaries), world points, each a
   * closed loop drawn as a stroke-only line separate from the (possibly
   * many) shaded facets. Facets themselves are seamed in their own fill
   * colour so tessellation never shows as a visible mesh; this is what
   * actually marks where one face ends and its neighbour — a different
   * panel, a folded-on fin, a dog-ear crease — begins. Usually one loop;
   * more than one when a face carries its own separately-folded features
   * (a dog-ear tucked onto a panel has its own boundary, distinct from the
   * panel's main envelope).
   */
  outline: Vec3[][];
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
    out.set(id, { face, facets: [{ points, uv: face.outer.points }], outline: [points] });
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
    out.set(face.id, { face, facets: [{ points, uv }], outline: [points] });
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
  /** Meaning depends on the shared `family` (see `ProfileFamily`): sharpness
   * for `superellipse`, corner radius for `rounded_rect`, unused otherwise.
   * Interpolated between stations the same way as halfWidth/halfDepth. */
  shapeParam: number;
}

const normalize2 = (x: number, z: number): { x: number; z: number } => {
  const l = Math.hypot(x, z);
  return l < 1e-9 ? { x: 1, z: 0 } : { x: x / l, z: z / l };
};

// ---------------------------------------------------------------------------
// Cross-section profile families for the lofted engine. Every one of these
// is a pure function of (halfWidth, halfDepth, angle[, shapeParam]) -> (x,
// z) — nothing here reads a station, a face, or the flat pattern. See
// `ProfileSpec` in schema.ts for what distinguishes each family physically.
// ---------------------------------------------------------------------------

function shapeEllipse(halfWidth: number, halfDepth: number, angle: number): { x: number; z: number } {
  return { x: halfWidth * Math.cos(angle), z: halfDepth * Math.sin(angle) };
}

function shapeSuperellipse(halfWidth: number, halfDepth: number, angle: number, sharpness: number): { x: number; z: number } {
  const p = 2 / (2 + sharpness);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: halfWidth * Math.sign(c) * Math.abs(c) ** p,
    z: halfDepth * Math.sign(s) * Math.abs(s) ** p,
  };
}

/**
 * Two circular arcs — front (z > 0) and back (z < 0) — each through the SAME
 * two fixed pinch points (+/-halfWidth, 0), bulging to (0, +/-halfDepth) at
 * its own apex, via the same chord-and-sagitta construction as `arcThrough`.
 * Unlike an ellipse's own extremum, the two arcs meet at the pinch with
 * DIFFERENT tangent directions — a genuine corner, not a roundover — which
 * is the whole reason this is a separate family: a lens/vesica shape's
 * pointed ends read as a real seal crease, an ellipse's read as a roundover.
 */
function shapeLens(halfWidth: number, halfDepth: number, angle: number): { x: number; z: number } {
  const hw = Math.max(1e-9, halfWidth);
  const hd = halfDepth;
  if (hd < 1e-6 * Math.max(1, hw)) {
    // The sagitta solve is numerically unstable as hd -> 0 (the arc's own
    // radius blows up); visually indistinguishable from a flat line at this
    // scale regardless of family, so just give the degenerate flat line.
    return { x: hw * Math.cos(angle), z: hd * Math.sin(angle) };
  }
  const zc = (hd * hd - hw * hw) / (2 * hd);
  const R = hd - zc;
  const cosBeta0 = Math.max(-1, Math.min(1, -zc / R));
  const beta0 = Math.acos(cosBeta0);
  let a = angle % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  const front = a <= Math.PI;
  const sign = front ? 1 : -1;
  const u = front ? a / Math.PI : (a - Math.PI) / Math.PI;
  const beta = sign * beta0 * (1 - 2 * u);
  return { x: R * Math.sin(beta), z: sign * (zc + R * Math.cos(beta)) };
}

/**
 * A true rounded rectangle: straight sides, a genuine constant-radius arc at
 * each corner — walked as arc length, CCW from (halfWidth, 0), so `angle`
 * (equivalently girth-fraction t) is an arc-length parametrization here
 * rather than a geometric angle. `cornerRadius` 0 degenerates to a sharp
 * rectangle, which is how a boxy body's own flat-bottomed station is
 * expressed: same family throughout, the corner radius alone shrinks away.
 */
function shapeRoundedRect(halfWidth: number, halfDepth: number, angle: number, cornerRadius: number): { x: number; z: number } {
  const hw = Math.max(1e-9, halfWidth);
  const hd = Math.max(1e-9, halfDepth);
  const r = Math.max(0, Math.min(cornerRadius, hw, hd));
  const straightX = hw - r;
  const straightZ = hd - r;
  const quarterLen = (Math.PI / 2) * r;
  const perimeter = 4 * straightX + 4 * straightZ + 4 * quarterLen;
  if (perimeter < 1e-9) return { x: 0, z: 0 };
  let a = angle % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  let s = (a / (2 * Math.PI)) * perimeter;

  if (s <= straightZ) return { x: hw, z: s }; // right edge, upper half
  s -= straightZ;
  if (s <= quarterLen) {
    const ang = (s / quarterLen) * (Math.PI / 2);
    return { x: straightX + r * Math.cos(ang), z: straightZ + r * Math.sin(ang) }; // top-right corner
  }
  s -= quarterLen;
  if (s <= 2 * straightX) return { x: straightX - s, z: hd }; // top edge
  s -= 2 * straightX;
  if (s <= quarterLen) {
    const ang = Math.PI / 2 + (s / quarterLen) * (Math.PI / 2);
    return { x: -straightX + r * Math.cos(ang), z: straightZ + r * Math.sin(ang) }; // top-left corner
  }
  s -= quarterLen;
  if (s <= 2 * straightZ) return { x: -hw, z: straightZ - s }; // left edge
  s -= 2 * straightZ;
  if (s <= quarterLen) {
    const ang = Math.PI + (s / quarterLen) * (Math.PI / 2);
    return { x: -straightX + r * Math.cos(ang), z: -straightZ + r * Math.sin(ang) }; // bottom-left corner
  }
  s -= quarterLen;
  if (s <= 2 * straightX) return { x: -straightX + s, z: -hd }; // bottom edge
  s -= 2 * straightX;
  if (s <= quarterLen) {
    const ang = (3 * Math.PI) / 2 + (s / quarterLen) * (Math.PI / 2);
    return { x: straightX + r * Math.cos(ang), z: -straightZ + r * Math.sin(ang) }; // bottom-right corner
  }
  s -= quarterLen;
  return { x: hw, z: -straightZ + s }; // right edge, lower half — closes the loop
}

/** Ramanujan's second approximation — accurate to a fraction of a percent for any aspect ratio. */
function ellipsePerimeter(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 4 * Math.max(a, b);
  const h = ((a - b) / (a + b)) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/**
 * The semi-axis `a` such that an ellipse of semi-axes (a, halfDepth) has
 * perimeter `targetPerimeter` — i.e. the width a girth-constrained
 * cross-section spreads to at a given depth. Perimeter grows monotonically
 * with `a` for fixed `halfDepth`, so bisection is exact enough in a handful
 * of iterations; at halfDepth = 0 the ellipse is a degenerate line
 * traversed twice, solved exactly (a = targetPerimeter / 4) rather than by
 * search.
 */
function solveHalfWidthForPerimeter(targetPerimeter: number, halfDepth: number): number {
  if (halfDepth <= 1e-9) return targetPerimeter / 4;
  let lo = 1e-9;
  let hi = targetPerimeter;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ellipsePerimeter(mid, halfDepth) < targetPerimeter) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * PCHIP tangents (Fritsch-Carlson): C1 continuous, and shape-preserving —
 * the tangent at a station is exactly zero wherever the data has a local
 * extremum OR either neighbouring run is flat (an adjacent secant of zero),
 * which is what keeps a genuinely flat run (two consecutive equal-valued
 * stations, e.g. a crimp band) flat rather than letting a plain spline bow
 * it to satisfy curvature elsewhere. Endpoints use the one-sided secant to
 * their only neighbour, which for THIS engine's stations is typically zero
 * too (the outermost station usually repeats its neighbour's value).
 */
function pchipTangents(ys: number[], vs: number[]): number[] {
  const n = ys.length;
  const secant = (i: number): number => {
    const dy = ys[i + 1]! - ys[i]!;
    return dy === 0 ? 0 : (vs[i + 1]! - vs[i]!) / dy;
  };
  if (n < 2) return ys.map(() => 0);
  if (n === 2) {
    const s = secant(0);
    return [s, s];
  }
  const m: number[] = new Array(n);
  m[0] = secant(0);
  m[n - 1] = secant(n - 2);
  for (let i = 1; i < n - 1; i++) {
    const sPrev = secant(i - 1);
    const sNext = secant(i);
    if (sPrev === 0 || sNext === 0 || (sPrev > 0) !== (sNext > 0)) {
      m[i] = 0;
    } else {
      const hPrev = ys[i]! - ys[i - 1]!;
      const hNext = ys[i + 1]! - ys[i]!;
      const w1 = 2 * hNext + hPrev;
      const w2 = hNext + 2 * hPrev;
      m[i] = (w1 + w2) / (w1 / sPrev + w2 / sNext);
    }
  }
  return m;
}

/** Cubic Hermite on t in [0, 1], with tangents already scaled to the segment's own span. */
function hermite(v0: number, v1: number, m0: number, m1: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * v0 + h10 * m0 + h01 * v1 + h11 * m1;
}

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
    out.set(face.id, { face, facets: [{ points: flatPoints, uv: face.outer.points }], outline: [flatPoints] });
  }
  if (roundFaces.length === 0 || (spec.stations ?? []).length < 2) return out;

  const roundBounds = roundFaces.map((f) => boundsOf(f.outer.points)!);
  const girthX0 = Math.min(...roundBounds.map((b) => b.min.x));
  const girthX1 = Math.max(...roundBounds.map((b) => b.max.x));
  const girth = girthX1 - girthX0;
  if (girth <= 0) return out;

  const paramScope = (graph.meta?.params as Record<string, number> | undefined) ?? {};
  const scope: Scope = { ...paramScope, girth };
  // A station's own shapeParam is the family-specific extra number
  // (superellipse's sharpness, rounded_rect's cornerRadius) — 0 for ellipse
  // and lens, which need none. The family itself is shared across every
  // station in this spec (interpolating BETWEEN two different families is
  // not defined), read once from the first station.
  const shapeParamOf = (p: ProfileSpec | undefined): number => {
    if (!p) return 0;
    if (p.family === 'superellipse') return evalExpr(p.sharpness, scope);
    if (p.family === 'rounded_rect') return evalExpr(p.cornerRadius, scope);
    return 0;
  };
  const family = spec.stations![0]!.profile?.family ?? 'ellipse';
  const stations: ResolvedStation[] = spec
    .stations!.map((s: LoftStationSpec) => {
      const halfDepth = evalExpr(s.halfDepth, scope);
      // Omitted halfWidth is DERIVED so the section's own perimeter matches
      // girth — the material the flat pattern actually provides at every
      // station, not just an assumed constant. This is what makes a flat
      // crimp read wider than the round midpoint: the same girth wrapped
      // around less depth has to spread out further to use it all.
      const halfWidth = s.halfWidth !== undefined ? evalExpr(s.halfWidth, scope) : solveHalfWidthForPerimeter(girth, halfDepth);
      return { y: evalExpr(s.y, scope), halfWidth, halfDepth, shapeParam: shapeParamOf(s.profile) };
    })
    .sort((a, b) => a.y - b.y);
  const flatRef = stations[0]!;

  // t = 0 sits at girthX0 by construction — the flat pattern's own left
  // edge, i.e. the seam on a wrap-formed tube (the two web edges meet
  // there). Sampled with NO phase shift, the seam lands at the ellipse's
  // own widest point (its "3 o'clock"), which is the tube's SIDE, not its
  // back — wrong for a fin-seal bag, where the seam sits diametrically
  // opposite the panel that never touches it, i.e. mid-back. girthPhaseDeg
  // rotates the whole cross-section so t = 0 lands wherever the style says
  // the seam physically is.
  const phase = ((spec.girthPhaseDeg ?? 0) * Math.PI) / 180;
  const angleOf = (x: number) => (x - girthX0) / girth; // t, unclamped — can run past [0, 1]

  // C1 (PCHIP) interpolation, not linear: a filled bag's depth profile is a
  // smooth curve, and linear segments between stations put a visible kink at
  // every one — most obviously at the midpoint, the single most visible
  // point on the profile. PCHIP also keeps a genuinely flat run flat (its
  // tangent is exactly zero wherever the data doesn't call for a slope,
  // which is exactly the crimp bands, since consecutive equal-valued
  // stations have a zero secant either side) rather than bowing it, which a
  // naive Catmull-Rom-style spline would do.
  const ys = stations.map((s) => s.y);
  const widthTangents = pchipTangents(ys, stations.map((s) => s.halfWidth));
  const depthTangents = pchipTangents(ys, stations.map((s) => s.halfDepth));
  const shapeParamTangents = pchipTangents(ys, stations.map((s) => s.shapeParam));

  const stationAt = (y: number): { halfWidth: number; halfDepth: number; shapeParam: number } => {
    let i = 0;
    while (i < stations.length - 2 && y > stations[i + 1]!.y) i++;
    const s0 = stations[i]!;
    const s1 = stations[i + 1]!;
    const span = s1.y - s0.y || 1;
    const t = Math.max(0, Math.min(1, (y - s0.y) / span));
    return {
      halfWidth: hermite(s0.halfWidth, s1.halfWidth, widthTangents[i]! * span, widthTangents[i + 1]! * span, t),
      halfDepth: hermite(s0.halfDepth, s1.halfDepth, depthTangents[i]! * span, depthTangents[i + 1]! * span, t),
      shapeParam: hermite(s0.shapeParam, s1.shapeParam, shapeParamTangents[i]! * span, shapeParamTangents[i + 1]! * span, t),
    };
  };

  // The envelope's WIDTH does not vary with y at all, even though the
  // isoperimetric width solved per station does. A filled tube does not
  // hold the girth's full isoperimetric width everywhere — it can only do
  // that at the roundest (deepest) station, where the cross-section is
  // closest to circular and needs its whole perimeter just to enclose that
  // depth. Everywhere shallower (toward a crimp), the same girth would
  // isoperimetrically need MORE width than the body actually has, and that
  // excess does not billow outward as a smooth taper — real film has
  // nowhere to put it but a fold. So the envelope's own half-width is
  // pinned to the deepest station's, a constant, and the difference between
  // that and each station's true isoperimetric half-width becomes the
  // dog-ear excess folded onto a panel below, not a wasp-waist bulge here.
  const bodyStation = stations.reduce((best, s) => (s.halfDepth > best.halfDepth ? s : best));
  const bodyHalfWidth = bodyStation.halfWidth;

  /** Per-side excess half-width at y: how much wider the girth-constrained
   * isoperimetric section would need to be than the constant body envelope,
   * i.e. exactly what a dog-ear at this y must fold away. Zero at (and near)
   * the body station, growing toward a crimp. */
  const excessHalfWidthAt = (y: number): number => Math.max(0, stationAt(y).halfWidth - bodyHalfWidth) * fill;

  // Dispatches to whichever profile family this spec's stations share (see
  // the shape* functions above and ProfileSpec in schema.ts). shapeParam is
  // the family-specific extra number, already PCHIP-interpolated the same
  // way as halfWidth/halfDepth by the caller.
  const shapeXZ = (halfWidth: number, halfDepth: number, angle: number, shapeParam: number): { x: number; z: number } => {
    switch (family) {
      case 'superellipse':
        return shapeSuperellipse(halfWidth, halfDepth, angle, shapeParam);
      case 'lens':
        return shapeLens(halfWidth, halfDepth, angle);
      case 'rounded_rect':
        return shapeRoundedRect(halfWidth, halfDepth, angle, shapeParam);
      default:
        return shapeEllipse(halfWidth, halfDepth, angle);
    }
  };

  /** The lofted surface point at girth-fraction t and length y, blended by fill. */
  const surfaceAt = (y: number, t: number): { x: number; z: number } => {
    const st = stationAt(y);
    const halfWidth = lerp(flatRef.halfWidth, bodyHalfWidth, fill);
    const halfDepth = lerp(flatRef.halfDepth, st.halfDepth, fill);
    const shapeParam = lerp(flatRef.shapeParam, st.shapeParam, fill);
    return shapeXZ(halfWidth, halfDepth, t * 2 * Math.PI + phase, shapeParam);
  };

  /** The FLAT reference cross-section alone, at girth-fraction t — fixed, no y or fill. */
  const flatAt = (t: number): { x: number; z: number } =>
    shapeXZ(flatRef.halfWidth, flatRef.halfDepth, t * 2 * Math.PI + phase, flatRef.shapeParam);

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
    tSpanOverride?: number,
    worldYOf?: (flatY: number) => number,
  ): { p: Vec3; uv: Vec2 }[][] => {
    const w = bnd.max.x - bnd.min.x;
    const h = bnd.max.y - bnd.min.y;
    const cols = segmentsForSpan(tSpanOverride ?? w / girth);
    const rows = rowsForHeight(h);
    const grid: { p: Vec3; uv: Vec2 }[][] = [];
    for (let j = 0; j <= rows; j++) {
      const y = bnd.min.y + (h * j) / rows;
      const worldY = worldYOf ? worldYOf(y) : y;
      const row: { p: Vec3; uv: Vec2 }[] = [];
      for (let i = 0; i <= cols; i++) {
        const x = bnd.min.x + (w * i) / cols;
        const { x: px, z } = pointAt(x, y);
        row.push({ p: { x: px, y: worldY, z }, uv: { x, y } });
      }
      grid.push(row);
    }
    return grid;
  };

  // A round face's own x maps to girth-fraction t by default via the
  // SHARED (x - girthX0) / girth — right for a wrap-formed tube, where
  // every round face occupies a distinct slice of ONE continuously wrapped
  // web. `faceAngularSpan` overrides that per role for a style where it
  // isn't true (see FormedShapeSpec).
  const angleOfFace = (role: string, bnd: { min: Vec2; max: Vec2 }, x: number): number => {
    const span = spec.faceAngularSpan?.[role];
    if (!span) return angleOf(x);
    const [t0, t1] = span;
    const w = bnd.max.x - bnd.min.x || 1;
    return t0 + ((x - bnd.min.x) / w) * (t1 - t0);
  };

  // A round face's own OUTPUT y is its flat y by default — right for a
  // wrap-formed tube, where every round face shares one continuous length
  // axis. `faceWorldY` overrides that per role for a style where a face's
  // flat y and its ASSEMBLED position are not the same axis (see
  // FormedShapeSpec) — the station lookup itself always stays keyed on
  // flat y, only the point's final position moves.
  const worldYOfFace = (role: string, bnd: { min: Vec2; max: Vec2 }, flatY: number): number => {
    const span = spec.faceWorldY?.[role];
    if (!span) return flatY;
    const [y0, y1] = span.map((e) => evalExpr(e, scope)) as [number, number];
    const h = bnd.max.y - bnd.min.y || 1;
    return y0 + ((flatY - bnd.min.y) / h) * (y1 - y0);
  };

  const thickness = 2 * graph.caliper;

  // A round face's own edge at girth-fraction t = 0 (mod 1) is the seam —
  // the flat pattern's two web edges meeting, where a flapFaceRole (the fin)
  // already attaches — never a dog-ear. Every OTHER round-to-round boundary
  // sits at a WIDTH EXTREME of the (now constant-width) envelope: x = ±
  // bodyHalfWidth, z = 0, for every y, by construction — the cross-section's
  // own cos(angle) term is stationary there regardless of halfDepth. That
  // boundary is a candidate for a dog-ear wherever excessHalfWidthAt is
  // nonzero along it.
  const SEAM_T_EPS = 1e-6;
  const isSeamT = (t: number) => Math.abs(t - Math.round(t)) < SEAM_T_EPS;
  const DOGEAR_EPS_MM = 0.05;

  /**
   * A triangular dog-ear folded against the face it's attached to, from its
   * edge at girth-fraction `edgeT`. That edge is a width-extreme line
   * (constant x = ±bodyHalfWidth, z = 0) running the face's full height, so
   * "folding the excess back" is not a tangent-plane offset the way the fin
   * is (the fin attaches at a DEPTH extreme, where the flat tangent runs
   * cleanly along x) — here the local tangent is degenerate (it runs in z,
   * the wrong axis to fold along). Instead this displaces straight inward
   * along x, by `excessHalfWidthAt(y)` itself, which is exactly the distance
   * between the constant envelope and the wider isoperimetric section that
   * boundary would otherwise have needed — a real crease running the fold's
   * own length, tapering to zero at the body station and widest at a crimp.
   * `zSign` offsets the folded ply a hair off the exact z = 0 seam line, on
   * the same side (+z front-ish, −z back-ish) as the face it folds onto, so
   * the two dog-ears meeting at one physical corner don't coincide. Returns
   * null when there is no excess anywhere along this edge.
   */
  const dogEarFlap = (
    bnd: { min: Vec2; max: Vec2 },
    edgeT: number,
    zSign: number,
    worldYOf: (flatY: number) => number,
  ): { facets: FormedFacet[]; outline: Vec3[] } | null => {
    const rows = rowsForHeight(bnd.max.y - bnd.min.y);
    const grid: { p: Vec3; uv: Vec2 }[][] = [];
    let maxExcess = 0;
    for (let j = 0; j <= rows; j++) {
      const y = bnd.min.y + ((bnd.max.y - bnd.min.y) * j) / rows;
      const worldY = worldYOf(y);
      const excess = excessHalfWidthAt(y);
      maxExcess = Math.max(maxExcess, excess);
      const base = surfaceAt(y, edgeT);
      const foldDir = base.x >= 0 ? -1 : 1; // toward x = 0, the panel's own centre
      const outer: Vec3 = { x: base.x, y: worldY, z: base.z + zSign * thickness };
      const inner: Vec3 = { x: base.x + foldDir * excess, y: worldY, z: outer.z };
      grid.push([
        { p: outer, uv: { x: bnd.min.x, y } },
        { p: inner, uv: { x: bnd.min.x, y } },
      ]);
    }
    if (maxExcess < DOGEAR_EPS_MM) return null;
    return { facets: gridToQuads(grid), outline: gridPerimeter(grid) };
  };

  for (const face of roundFaces) {
    const bnd = boundsOf(face.outer.points)!;
    const span = spec.faceAngularSpan?.[face.role];
    const worldYOf = (flatY: number) => worldYOfFace(face.role, bnd, flatY);
    const grid = sampleGrid(
      bnd,
      (x, y) => surfaceAt(y, angleOfFace(face.role, bnd, x)),
      span ? Math.abs(span[1] - span[0]) : undefined,
      worldYOf,
    );
    const facets = gridToQuads(grid);
    const outline: Vec3[][] = [gridPerimeter(grid)];

    const t0 = angleOfFace(face.role, bnd, bnd.min.x);
    const t1 = angleOfFace(face.role, bnd, bnd.max.x);
    const midY = (bnd.min.y + bnd.max.y) / 2;
    const faceZ = surfaceAt(midY, (t0 + t1) / 2).z;
    const zSign = faceZ === 0 ? 1 : Math.sign(faceZ);
    if (!isSeamT(t0)) {
      const flap = dogEarFlap(bnd, t0, zSign, worldYOf);
      if (flap) {
        facets.push(...flap.facets);
        outline.push(flap.outline);
      }
    }
    if (!isSeamT(t1)) {
      const flap = dogEarFlap(bnd, t1, zSign, worldYOf);
      if (flap) {
        facets.push(...flap.facets);
        outline.push(flap.outline);
      }
    }

    out.set(face.id, { face, facets, outline });
  }

  // Faces that do not lie on the lofted surface at all, but open into a
  // flat oval welded to it — a stand-up pouch's base. Each needs its own
  // `faceAngularSpan` entry: its own flat x maps to the girth-fraction t
  // range of the RIM it welds to, so the opened edge is read directly off
  // the wall's own surfaceAt formula (guaranteed to match, being literally
  // the same function) rather than re-derived independently — the bug an
  // earlier, bespoke version of this (`gussetedPouch`) had to fix twice.
  for (const role of spec.baseFaceRoles ?? []) {
    const face = byRole.get(role);
    const span = spec.faceAngularSpan?.[role];
    const weldYExpr = spec.baseWeldY?.[role];
    if (!face || !span || weldYExpr === undefined) continue;
    const weldY = evalExpr(weldYExpr, scope); // flat-y domain: which station's rim
    const worldWeldY = evalExpr(spec.baseWorldY?.[role] ?? weldYExpr, scope); // where it ends up
    const [t0, t1] = span;
    const bnd = boundsOf(face.outer.points)!;
    const cx = (bnd.min.x + bnd.max.x) / 2;
    const halfW = (bnd.max.x - bnd.min.x) / 2 || 1;
    // Which of the face's own y edges is the hinge (shared with the wall,
    // stays put) vs. the gusset's own centre fold (swings fully out) —
    // whichever is nearer the weld line.
    const hingeIsMin = Math.abs(bnd.min.y - weldY) <= Math.abs(bnd.max.y - weldY);
    const hingeY = hingeIsMin ? bnd.min.y : bnd.max.y;
    const armLength = bnd.max.y - bnd.min.y || 1;
    const rows = rowsForHeight(bnd.max.y - bnd.min.y);
    const cols = segmentsForSpan(Math.abs(t1 - t0));
    const grid: { p: Vec3; uv: Vec2 }[][] = [];
    for (let j = 0; j <= rows; j++) {
      const flatY = bnd.min.y + ((bnd.max.y - bnd.min.y) * j) / rows;
      // 0 at the hinge (matches the wall's own rim exactly), 1 at the
      // gusset's own centre fold (the floor's own centreline, z = 0).
      const s = Math.abs(flatY - hingeY) / armLength;
      const row: { p: Vec3; uv: Vec2 }[] = [];
      for (let i = 0; i <= cols; i++) {
        const flatX = bnd.min.x + ((bnd.max.x - bnd.min.x) * i) / cols;
        const nx = (flatX - cx) / halfW;
        const t = t0 + ((nx + 1) / 2) * (t1 - t0);
        const rim = surfaceAt(weldY, t);
        const x = lerp(flatX, rim.x, fill);
        const y = lerp(flatY, worldWeldY, fill);
        const z = lerp(0, rim.z * (1 - s), fill);
        row.push({ p: { x, y, z }, uv: { x: flatX, y: flatY } });
      }
      grid.push(row);
    }
    out.set(face.id, { face, facets: gridToQuads(grid), outline: [gridPerimeter(grid)] });
  }

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
    // Auto-detect (periodic: 0 or 1, the same physical seam point) assumes
    // one continuously wrapped web with a single seam — wrong for a style
    // with more than one physical seam position (e.g. two independent side
    // seals), which gives its own attach point per role instead.
    const seamT = spec.flapAttachT?.[face.role] ?? Math.round(angleOf(attachX));
    const worldYOf = (flatY: number) => worldYOfFace(face.role, bnd, flatY);

    let grid: { p: Vec3; uv: Vec2 }[][];
    if (sealStyle === 'lap') {
      // Not a separate flap — the same lofted surface, sampled past the
      // seam, offset out by the extra ply's thickness along the local
      // radial direction.
      grid = sampleGrid(
        bnd,
        (x, y) => {
          const p = surfaceAt(y, angleOf(x));
          const n = normalize2(p.x, p.z);
          return { x: p.x + n.x * thickness, z: p.z + n.z * thickness };
        },
        undefined,
        worldYOf,
      );
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
      grid = sampleGrid(
        bnd,
        (x, y) => {
          const base = surfaceAt(y, seamT);
          const flatBase = flatAt(seamT);
          const flatStep = flatAt(seamT + foldSign * TANGENT_STEP);
          const tangent = normalize2(flatStep.x - flatBase.x, flatStep.z - flatBase.z);
          const normal = normalize2(base.x, base.z);
          const along = Math.abs(x - attachX);
          return { x: base.x + normal.x * thickness + tangent.x * along, z: base.z + normal.z * thickness + tangent.z * along };
        },
        undefined,
        worldYOf,
      );
    }
    out.set(face.id, { face, facets: gridToQuads(grid), outline: [gridPerimeter(grid)] });
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

  // Curvature-driven sampling, same reasoning as the lofted tube: both
  // transforms below are smooth functions of RIGID (x, y) position — the
  // wall's sin() bulge peaks at v = 0.5, its own MID-height, not at either
  // edge — so evaluating them only at each face's own 4 (or 6, through the
  // gusset's pinch chamfer) flat corners samples the wall's bulge at
  // exactly the two points (v = 0, v = 1) where it is guaranteed to be
  // zero. The whole wall bulge was invisible for exactly that reason; a
  // sampled interior grid is what actually shows it.
  const ROW_SPACING_MM = 3;
  const COL_SPACING_MM = 3;
  const rowsFor = (h: number) => Math.max(4, Math.min(120, Math.round(h / ROW_SPACING_MM)));
  const colsFor = (w: number) => Math.max(2, Math.min(120, Math.round(w / COL_SPACING_MM)));

  /** A polygon's own x-range at a given y, via scanline edge crossings — so
   * a chamfered (pinched) hexagon tapers correctly instead of being sampled
   * as its bounding rectangle. */
  const xRangeAtY = (pts: { x: number; y: number }[], y: number): { x0: number; x1: number } | null => {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    return xs.length < 2 ? null : { x0: Math.min(...xs), x1: Math.max(...xs) };
  };

  /** This face's rigid-y -> flat-y mapping, from two of its own vertices —
   * a pure shift or a reflection for every face here, since every hinge in
   * this style is a horizontal crease (x never changes, flat to rigid). */
  const flatYOf = (face: Face, rigidPts: Vec3[]): ((ry: number) => number) => {
    const pts = face.outer.points;
    const y0f = pts[0]!.y;
    const y0r = rigidPts[0]!.y;
    const idx1 = pts.findIndex((p, i) => i > 0 && p.y !== y0f);
    const y1f = pts[idx1]!.y;
    const y1r = rigidPts[idx1]!.y;
    const a = (y1r - y0r) / (y1f - y0f);
    const b = y0r - a * y0f;
    return (ry: number) => (ry - b) / a;
  };

  const sampleFace = (
    face: Face,
    rigidPts: Vec3[],
    pointAt: (rx: number, ry: number) => { x: number; y: number; z: number },
  ): { facets: FormedFacet[]; outline: Vec3[] } => {
    const rb = boundsOf(rigidPts.map((p) => ({ x: p.x, y: p.y })))!;
    const toFlatY = flatYOf(face, rigidPts);
    const rows = rowsFor(rb.max.y - rb.min.y);
    // A constant column count for every row, from the face's OWN overall
    // width — gridToQuads pairs row[i] with next[i], so every row must have
    // the same point count. A chamfered row still tapers correctly: its own
    // (possibly narrower) x-range is just spread across that same count.
    const cols = colsFor(rb.max.x - rb.min.x);
    const grid: { p: Vec3; uv: Vec2 }[][] = [];
    for (let j = 0; j <= rows; j++) {
      const ry = rb.min.y + ((rb.max.y - rb.min.y) * j) / rows;
      const range = xRangeAtY(rigidPts, ry) ?? { x0: rb.min.x, x1: rb.max.x };
      const row: { p: Vec3; uv: Vec2 }[] = [];
      for (let i = 0; i <= cols; i++) {
        const rx = range.x0 + ((range.x1 - range.x0) * i) / cols;
        row.push({ p: pointAt(rx, ry), uv: { x: rx, y: toFlatY(ry) } });
      }
      grid.push(row);
    }
    return { facets: gridToQuads(grid), outline: gridPerimeter(grid) };
  };

  // How far a corner rounds off, in mm — one gusset-depth's worth of
  // material on either side of the wall/base hinge, which is the natural
  // scale here: it is exactly the base's own arm length, so applying the
  // SAME mm distance to the wall keeps the two tapers meeting at the same
  // absolute distance from their shared edge, not just the same fraction of
  // two very differently sized spans.
  const cornerRoundMM = Math.max(1e-6, depth);
  // 0 at the hinge, 1 a full cornerRoundMM away, eased along a quarter
  // circle — a steep initial pinch that flattens smoothly into full width,
  // not a linear taper (a real rounded corner is an arc, not a wedge).
  const cornerShrink = (distFromHinge: number): number => {
    const cr = Math.min(1, Math.max(0, distFromHinge) / cornerRoundMM);
    return Math.sqrt(Math.max(0, 1 - (1 - cr) ** 2));
  };

  for (const face of walls) {
    const rigidPts = rigid.get(face.id)!.points;
    const rb = rigidBounds(face);
    const sign = wallSign.get(face.id) ?? 1;
    // Which edge is nearer the gusset decides which end gets v = 0.
    const gussetAtLowY = Math.abs(rb.min.y - baseCenterY) < Math.abs(rb.max.y - baseCenterY);
    const span = rb.max.y - rb.min.y || 1;
    const cxRow = (rb.min.x + rb.max.x) / 2;
    // Displaced from the rigid position; only z (the bulge) and, near the
    // gusset-adjacent edge, x (rounding the corner in toward centre) move —
    // the flat pattern's own rectangle is otherwise untouched. A stand-up
    // pouch's own "fill area" is not the panel's full flat rectangle: the
    // corners nearest the base are consumed into the gusset seal, which
    // reads as the panel's own bottom corners rounding off rather than
    // staying square. It is formed-only, like the bulge itself — the flat
    // dieline's outer cut is still the plain rectangle it always was.
    const { facets, outline } = sampleFace(face, rigidPts, (rx, ry) => {
      const v = gussetAtLowY ? (ry - rb.min.y) / span : (rb.max.y - ry) / span;
      const bulge = fill * depth * Math.sin(Math.PI * Math.max(0, Math.min(1, v)));
      const shrink = cornerShrink(v * span);
      const roundedX = cxRow + (rx - cxRow) * shrink;
      return { x: lerp(rx, roundedX, fill), y: ry, z: lerp(0, sign * bulge, fill) };
    });
    out.set(face.id, { face, facets, outline: [outline] });
  }

  // Each base half hinges to a wall along the edge it shares with that
  // wall's own gusset-adjacent edge — the SAME edge `gussetAtLowY` finds
  // per wall above. In lay-flat, both halves' hinge edges land together at
  // that shared y (the W-fold collapses onto itself), which is why a base's
  // own rigidBounds has one edge sitting exactly on a wall edge and the
  // other at the gusset's own centre fold.
  const wallBnd = walls.length ? rigidBounds(walls[0]!) : null;
  const wallHingeY = wallBnd ? (Math.abs(wallBnd.min.y - baseCenterY) < Math.abs(wallBnd.max.y - baseCenterY) ? wallBnd.min.y : wallBnd.max.y) : baseCenterY;
  // The wall's own centre in x, not the world origin — nx*ovalRadiusX alone
  // (the pre-existing formula) always centres the opened oval at x = 0
  // regardless of where the wall it has to meet actually sits, which is
  // fine only when a style's own wall happens to be centred there. Adding
  // it back is what welds the base's opened edge to the wall's actual edge
  // instead of leaving the base floating off to whichever side x = 0 is.
  const wallCenterX = wallBnd ? (wallBnd.min.x + wallBnd.max.x) / 2 : 0;

  for (const face of bases) {
    const rigidPts = rigid.get(face.id)!.points;
    const rb = rigidBounds(face);
    const sign = baseSign.get(face.id) ?? 1;
    const cx = (rb.min.x + rb.max.x) / 2;
    const halfW = (rb.max.x - rb.min.x) / 2 || 1;
    const armLength = rb.max.y - rb.min.y || 1;
    const hingeY = Math.abs(rb.min.y - wallHingeY) < Math.abs(rb.max.y - wallHingeY) ? rb.min.y : rb.max.y;
    // A real base is not the wall's own vertical plane spread sideways — it
    // is the gusset ROTATED flat, out of that plane, into a horizontal oval
    // at the walls' own shared bottom edge. `s` is how far along the
    // gusset's arm a point sits, from 0 at the wall hinge (stays put) to 1
    // at the gusset's own centre fold (swings out to full depth); x spreads
    // to the oval width the same way at every s, and y collapses onto the
    // hinge line itself rather than staying spread across the arm's own
    // rigid length — the arm's LENGTH becomes depth in z, not height in y.
    const { facets, outline } = sampleFace(face, rigidPts, (rx, ry) => {
      const s = Math.abs(ry - hingeY) / armLength; // 0 at the wall hinge, 1 at the fold centre
      // The SAME corner shrink as the wall, in the same absolute mm from the
      // shared hinge line, so the base's own opened rim meets the wall's
      // now-rounded corner at matching width instead of snapping back out
      // to the base's own full oval width right at the seam.
      const shrink = cornerShrink(s * armLength);
      const nx = ((rx - cx) / halfW) * shrink; // -1..1 across the panel width
      return {
        x: lerp(rx, wallCenterX + nx * ovalRadiusX, fill),
        y: lerp(ry, hingeY, fill),
        z: lerp(0, sign * s * depth, fill),
      };
    });
    out.set(face.id, { face, facets, outline: [outline] });
  }

  return out;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
