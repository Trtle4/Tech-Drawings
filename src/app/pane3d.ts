/**
 * The 3D pane: orbit, pan, zoom, reset to iso. One instance, shared by the
 * primary view and the companion inset — which one it is only changes its
 * CSS size, not which DOM/JS it is, so interaction here applies to both for
 * free.
 *
 * Renders to a `<canvas>`, not SVG — the artwork round trip needs a true
 * per-triangle affine texture warp (`ctx.transform` + `drawImage`, clipped
 * per triangle), which Canvas2D does natively and cheaply; an SVG
 * equivalent would mean one `<image>` + one `<clipPath>` DOM node per
 * triangle, for a mesh that can run into the thousands once a curved bag is
 * tessellated. No interactive feature here ever depended on picking a
 * specific SVG element (orbit/pan/zoom all work from raw pointer
 * coordinates), so the switch costs nothing functionally.
 *
 * Re-renders on every store change, so a dragged line, a retyped crease, a
 * dimension edit, a hinge-angle edit or applied/removed artwork all show up
 * here without any extra wiring at the call site.
 */
import type { Vec2, Vec3 } from '../geometry/types.js';
import { computeFormedShape, hasFormedShape, type FormedFace } from '../geometry/formedShape.js';
import { cameraBasis, orbitTowards, project, projectFormedFaces, projectFormedHoles, type CameraBasis, type ProjectedFacet, type UpAxis } from '../render/iso.js';
import { mmToPx, pixelFrame, triangleAffine, type PixelFrame } from '../render/texture.js';
import { assembleDimension, drawDimensionCanvas, formatLength, type LengthUnit } from '../render/dimension.js';
import { tweenOrbit, type OrbitAngles } from '../../packages/orbit-controls/dist/orbitControls.js';
import { fitToBounds, modelToScreen, pan as panView, zoomAt, type Camera2D, type Viewport } from './camera2d.js';
import { pointInRing } from './hitTest.js';
import { DEFAULT_ORBIT, type ArtworkState, type Store } from './state.js';

const ELEVATION_LIMIT = (89 * Math.PI) / 180;
const ORBIT_SENSITIVITY = Math.PI / 300; // radians per screen px
const clampElevation = (e: number) => Math.max(-ELEVATION_LIMIT, Math.min(ELEVATION_LIMIT, e));

/**
 * The navigation cube's 6 faces, each a unit half-size quad in local cube
 * space with an outward normal — a deliberately smaller cut of RSC's own
 * 26-region (6 face + 12 edge + 8 corner) ViewCube, see `paintViewCube`.
 * Corner order matters (must trace the face's own boundary, not a
 * diagonal), winding does not (nothing here culls by winding — visibility
 * comes from `dot(normal, cam.forward)`, hit-testing from `pointInRing`,
 * neither of which cares which way a polygon winds).
 */
const CUBE_FACES: { normal: Vec3; corners: Vec3[] }[] = [
  { normal: { x: 1, y: 0, z: 0 }, corners: [{ x: 1, y: -1, z: -1 }, { x: 1, y: 1, z: -1 }, { x: 1, y: 1, z: 1 }, { x: 1, y: -1, z: 1 }] },
  { normal: { x: -1, y: 0, z: 0 }, corners: [{ x: -1, y: -1, z: 1 }, { x: -1, y: 1, z: 1 }, { x: -1, y: 1, z: -1 }, { x: -1, y: -1, z: -1 }] },
  { normal: { x: 0, y: 1, z: 0 }, corners: [{ x: -1, y: 1, z: -1 }, { x: -1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: -1 }] },
  { normal: { x: 0, y: -1, z: 0 }, corners: [{ x: -1, y: -1, z: 1 }, { x: -1, y: -1, z: -1 }, { x: 1, y: -1, z: -1 }, { x: 1, y: -1, z: 1 }] },
  { normal: { x: 0, y: 0, z: 1 }, corners: [{ x: -1, y: -1, z: 1 }, { x: 1, y: -1, z: 1 }, { x: 1, y: 1, z: 1 }, { x: -1, y: 1, z: 1 }] },
  { normal: { x: 0, y: 0, z: -1 }, corners: [{ x: 1, y: -1, z: -1 }, { x: -1, y: -1, z: -1 }, { x: -1, y: 1, z: -1 }, { x: 1, y: 1, z: -1 }] },
];
const CUBE_SCALE_PX = 20;
const CUBE_MARGIN_PX = 38;
const CUBE_MIN_VIEWPORT_PX = 90;
const CUBE_TWEEN_MS = 400;

/** "TOP"/"BOTTOM" for the style's own up axis, "X+"/"Y−"/etc for the other two — there's no "front" convention in this app's geometry model (only `upAxis`), so the other four faces get an honest signed-axis label instead of an invented one. */
function cubeFaceLabel(normal: Vec3, upAxis: UpAxis): string {
  const axis: 'x' | 'y' | 'z' = normal.x !== 0 ? 'x' : normal.y !== 0 ? 'y' : 'z';
  const positive = normal[axis] > 0;
  if (axis === upAxis) return positive ? 'TOP' : 'BOTTOM';
  return `${axis.toUpperCase()}${positive ? '+' : '−'}`;
}

export interface Pane3DController {
  destroy(): void;
}

export function mountPane3D(container: HTMLElement, store: Store): Pane3DController {
  container.innerHTML = `
    <div class="pane-grid"></div>
    <span class="pane-label" id="pane3d-label">Folded · iso</span>
    <canvas class="pane-canvas" id="pane3d-canvas"></canvas>
    <div class="viewport-toolbar">
      <button class="tbtn" id="pane3d-dims" title="Overall width/height/depth dimension lines">Dims</button>
      <button class="tbtn" id="pane3d-outside" title="Measure the outside of the assembled pack (adds the material's board caliper to each wall) instead of the raw modeled envelope">Outside</button>
      <button class="tbtn icon" id="pane3d-bg" title="Toggle white background">⬜</button>
      <button class="tbtn icon" id="pane3d-reset" title="Reset to iso view">⤢</button>
    </div>`;
  const canvas = container.querySelector<HTMLCanvasElement>('#pane3d-canvas')!;
  const ctx = canvas.getContext('2d')!;
  const label = container.querySelector<HTMLSpanElement>('#pane3d-label')!;
  const resetBtn = container.querySelector<HTMLButtonElement>('#pane3d-reset')!;
  const bgBtn = container.querySelector<HTMLButtonElement>('#pane3d-bg')!;
  const dimsBtn = container.querySelector<HTMLButtonElement>('#pane3d-dims')!;
  const outsideBtn = container.querySelector<HTMLButtonElement>('#pane3d-outside')!;

  function viewport(): Viewport {
    const r = canvas.getBoundingClientRect();
    return { width: r.width || 1, height: r.height || 1 };
  }

  // Recomputed by `paintViewCube` every render, read by the pointer handlers
  // below for hit-testing — a click's screen point only needs testing
  // against whichever faces were actually visible (and drawn) last frame.
  let cubeHitRegions: { label: string; dir: Vec3; poly: Vec2[] }[] = [];
  let hoveredCubeLabel: string | null = null;

  /**
   * A small always-visible navigation cube, fixed in the pane's top-right
   * corner independent of the model's own pan/zoom — click a face to snap
   * the orbit to look straight at it. Ported from RSC's `viewcube.js`
   * (there, a genuine three.js mini-scene with 26 raycast-hit regions —
   * 6 faces, 12 edges, 8 corners); this is a deliberately smaller cut: 6
   * face regions only, drawn with the exact same `project`/`modelToScreen`
   * pipeline already used for the main model (retargeted to a fixed
   * screen anchor via a synthetic zero-origin `Camera2D`/`Viewport`, so it
   * shares the proven sign convention instead of risking a fresh one) and
   * hit-tested with the same point-in-polygon test the 2D canvas already
   * uses for face selection (`pointInRing`).
   */
  function paintViewCube(cam: CameraBasis, vpNow: Viewport, upAxis: UpAxis): { label: string; dir: Vec3; poly: Vec2[] }[] {
    if (vpNow.width < CUBE_MIN_VIEWPORT_PX || vpNow.height < CUBE_MIN_VIEWPORT_PX) return [];
    const anchor = { x: vpNow.width - CUBE_MARGIN_PX, y: CUBE_MARGIN_PX };
    const toScreen = (p: Vec3): Vec2 =>
      modelToScreen(project(p, cam), { cx: 0, cy: 0, zoom: CUBE_SCALE_PX }, { width: anchor.x * 2, height: anchor.y * 2 });

    const dot3 = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
    const visible = CUBE_FACES.map((f) => ({ ...f, forwardDot: dot3(f.normal, cam.forward) }))
      .filter((f) => f.forwardDot > 0.001)
      .sort((a, b) => a.forwardDot - b.forwardDot); // most face-on drawn last, on top

    const faceColor = themeColor('--panel', '#eef1f4');
    const edgeColor = themeColor('--line-2', '#c7ccd3');
    const textColor = themeColor('--ink-2', '#5a6472');
    const hoverColor = themeColor('--accent-soft', '#d7ecee');

    const regions: { label: string; dir: Vec3; poly: Vec2[] }[] = [];
    for (const f of visible) {
      const poly = f.corners.map(toScreen);
      const faceLabel = cubeFaceLabel(f.normal, upAxis);
      regions.push({ label: faceLabel, dir: f.normal, poly });

      ctx.beginPath();
      ctx.moveTo(poly[0]!.x, poly[0]!.y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i]!.x, poly[i]!.y);
      ctx.closePath();
      ctx.fillStyle = faceLabel === hoveredCubeLabel ? hoverColor : faceColor;
      ctx.fill();
      ctx.strokeStyle = edgeColor;
      ctx.lineWidth = 1;
      ctx.stroke();

      const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
      const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
      ctx.fillStyle = textColor;
      ctx.font = '600 8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(faceLabel, cx, cy);
    }
    return regions;
  }

  function hitCubeFace(p: Vec2): { label: string; dir: Vec3; poly: Vec2[] } | null {
    for (const region of cubeHitRegions) {
      if (pointInRing(p, region.poly)) return region;
    }
    return null;
  }

  /**
   * The world-space (mm) axis-aligned bounding box of every point in the
   * formed/folded shape — the raw modeled envelope, at the panel geometry's
   * own mid-plane (nothing here models material thickness; see
   * `outsideBounds` for the true outside envelope the "Outside" toggle
   * shows instead).
   */
  function worldBoundsOf(formed: Map<string, FormedFace>): { min: Vec3; max: Vec3 } | null {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const { facets } of formed.values()) {
      for (const facet of facets) {
        for (const p of facet.points) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
          if (p.z < minZ) minZ = p.z;
          if (p.z > maxZ) maxZ = p.z;
        }
      }
    }
    return Number.isFinite(minX) ? { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } } : null;
  }

  const AXES: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];

  /**
   * How many distinct plies of board actually COVER a given axis extreme —
   * every formed face whose facet lies flush against that boundary plane,
   * counted by its DISTINCT `face.ply` values (not summed, not just "1").
   * A side wall of an RSC case is a single panel at one ply, so it counts
   * as 1. The top and bottom are a minor flap (ply 0) AND a major flap
   * (ply 1) both lying flush against that same boundary, so they count as
   * 2 — that second ply is exactly the case flagged: "internal plus two
   * caliper is wrong anywhere flaps overlap, which on an 0201 is most of
   * the top and bottom." Ply IS spatially meaningful for this purpose even
   * though it drives no point position anywhere else in this codebase
   * (see `iso.ts`'s `paintOrder`) — it is the style's own explicit
   * statement of physical stacking order, exactly what "how many layers of
   * board sit here" needs.
   *
   * Tests the facet's CENTROID against the boundary, not any single point.
   * A flap is exactly as wide as the wall it hinges from, so once folded
   * flat its far corner can land ON an adjacent boundary plane (the flap's
   * own edge reaching the box's other axis extreme) without the flap
   * actually covering that adjacent face at all — a corner brushing a
   * plane is not the same as lying flush against it. The centroid only
   * lands on a boundary when the facet's own BULK sits there, which is
   * what should count.
   */
  function plyCountAtBoundary(formed: Map<string, FormedFace>, axis: 'x' | 'y' | 'z', bound: number, tolerance: number): number {
    const plies = new Set<number>();
    for (const { face, facets } of formed.values()) {
      for (const facet of facets) {
        if (facet.points.length === 0) continue;
        let sum = 0;
        for (const p of facet.points) sum += p[axis];
        const centroid = sum / facet.points.length;
        if (Math.abs(centroid - bound) <= tolerance) {
          plies.add(face.ply);
          break;
        }
      }
    }
    return Math.max(1, plies.size);
  }

  /**
   * Pads the raw (mid-plane) bounding box out to the assembled pack's true
   * outside envelope, one `graph.caliper` per ply actually stacked at each
   * of the box's six faces — see `plyCountAtBoundary`. A uniform "+1 wall
   * thickness on every side" (what this used to do) is only correct where
   * every boundary happens to be a single panel; it undercounts anywhere
   * flaps overlap.
   */
  function outsideBounds(b: { min: Vec3; max: Vec3 }, formed: Map<string, FormedFace>, caliper: number): { min: Vec3; max: Vec3 } {
    const tolerance = Math.max(1e-6, caliper * 0.1);
    const min = { ...b.min };
    const max = { ...b.max };
    for (const axis of AXES) {
      min[axis] -= plyCountAtBoundary(formed, axis, b.min[axis], tolerance) * caliper;
      max[axis] += plyCountAtBoundary(formed, axis, b.max[axis], tolerance) * caliper;
    }
    return { min, max };
  }

  /** Project the current derived geometry at a given orbit orientation — pure, no DOM writes. */
  function projectFaces(
    azimuth: number,
    elevation: number,
  ): {
    faces: ProjectedFacet[];
    holes: Vec2[][];
    upAxis: 'x' | 'y' | 'z' | undefined;
    formed: boolean;
    cam: CameraBasis;
    worldBounds: { min: Vec3; max: Vec3 } | null;
    formedShape: Map<string, FormedFace>;
  } {
    const derived = store.getDerived();
    const graph = derived.graph;
    const resolved = derived.resolved;
    const formed = hasFormedShape(graph);
    const cam = cameraBasis(graph.upAxis, azimuth, elevation);
    // computeFormedShape falls back to the rigid fold itself when the style
    // has no formedShape, so this is the one path for both cases.
    const folded = computeFormedShape(graph, resolved);
    return {
      faces: projectFormedFaces(folded, cam),
      holes: projectFormedHoles(folded, cam),
      upAxis: graph.upAxis,
      formed,
      cam,
      worldBounds: worldBoundsOf(folded),
      formedShape: folded,
    };
  }

  function projectedBounds(faces: ProjectedFacet[]): { min: Vec2; max: Vec2 } | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const f of faces) {
      for (const q of f.pts) {
        minX = Math.min(minX, q.x);
        minY = Math.min(minY, q.y);
        maxX = Math.max(maxX, q.x);
        maxY = Math.max(maxY, q.y);
      }
    }
    return Number.isFinite(minX) ? { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } } : null;
  }

  /** Jump straight to the default iso angle and frame the model there — no animation. Used when a style switch makes the previous orbit/pan meaningless, where animating FROM a stale orientation would read as a glitch, not a transition. */
  function snapToIso(): void {
    const { azimuth, elevation } = DEFAULT_ORBIT;
    const { faces } = projectFaces(azimuth, elevation);
    const bounds = projectedBounds(faces);
    const view = bounds ? fitToBounds(bounds, viewport()) : { cx: 0, cy: 0, zoom: 1 };
    store.setCamera3D({ azimuth, elevation, view });
  }

  let cancelActiveTween: (() => void) | null = null;
  function cancelTween(): void {
    cancelActiveTween?.();
    cancelActiveTween = null;
  }

  /** Reset button: eases the rotation back to iso (RSC's Home-button behaviour, ported via `tweenOrbit`), then snaps pan/zoom to frame it once the rotation settles — refitting mid-rotation would mean the target bounds keep changing under the animation. */
  function resetToIso(): void {
    cancelTween();
    const from = store.getState().camera3d;
    cancelActiveTween = tweenOrbit(
      { azimuth: from.azimuth, elevation: from.elevation },
      DEFAULT_ORBIT,
      CUBE_TWEEN_MS,
      (a) => store.setCamera3D({ ...store.getState().camera3d, azimuth: a.azimuth, elevation: a.elevation }),
      () => {
        cancelActiveTween = null;
        snapToIso();
      },
    );
  }

  let cssVars: CSSStyleDeclaration | null = null;
  function themeColor(name: string, fallback: string): string {
    cssVars ??= getComputedStyle(container);
    const v = cssVars.getPropertyValue(name).trim();
    return v || fallback;
  }

  /** One facet's fill: the plain board colour, then the artwork texture (if any) blended over it at the same shade-derived strength. */
  function paintFacet(f: ProjectedFacet, screenPts: Vec2[], opacity: number, boardColor: string, artwork: ArtworkState | null, frame: PixelFrame | null): void {
    ctx.beginPath();
    ctx.moveTo(screenPts[0]!.x, screenPts[0]!.y);
    for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i]!.x, screenPts[i]!.y);
    ctx.closePath();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = boardColor;
    ctx.fill();
    ctx.globalAlpha = 1;

    if (artwork && frame && f.uv && f.uv.length === screenPts.length && screenPts.length >= 3) {
      paintTexture(screenPts, f.uv, frame, artwork.image, opacity);
    }
  }

  /**
   * Fan-triangulate the facet from its own first vertex and warp the
   * template image onto each triangle with an exact 3-point affine fit —
   * exact along the shared diagonal between adjacent triangles, which is
   * what keeps a curved surface's texture seamless across its tessellation
   * instead of tearing at each quad boundary. Almost every facet here is
   * already a small, convex, tessellated quad (two triangles, exact); the
   * one non-convex case in the catalogue would be a whole rigid panel with
   * a locking-tab notch cut into its own outline, where a vertex-0 fan can
   * slightly misplace a triangle — accepted for v1, checked visually
   * against the actual carton styles rather than solved generally here.
   */
  function paintTexture(screenPts: Vec2[], uvPts: Vec2[], frame: PixelFrame, image: CanvasImageSource, opacity: number): void {
    // `mmToPx`, then a point-reflection through the image's own centre.
    // Verified empirically against the test artwork (not re-derived from
    // first principles, on purpose — see below): with this reflection, the
    // base face's own big "F" and both its crimp-band labels land upright,
    // in the right place; without it, they land upside down. `iso.ts`'s
    // `project()` also went through a real fix (it used to negate the
    // camera-space y a second time, inverting every pack's own up/down
    // orientation — see its own history), and that fix does NOT change what
    // this function needs: this reflection is a property of the mapping
    // between flat-mm pixel space and screen pixel space, independent of
    // which way `project()` happens to route "up". Re-verify against the
    // test artwork (the "Apply test artwork" button in the artwork panel)
    // before ever touching this again — the two pipelines are easy to
    // reason about wrongly and hard to reason about right.
    const imgW = (image as HTMLImageElement).naturalWidth || 0;
    const imgH = (image as HTMLImageElement).naturalHeight || 0;
    const src = (p: Vec2): Vec2 => {
      const px = mmToPx(p, frame);
      return { x: imgW - px.x, y: imgH - px.y };
    };
    for (let i = 1; i < screenPts.length - 1; i++) {
      const s0 = src(uvPts[0]!);
      const s1 = src(uvPts[i]!);
      const s2 = src(uvPts[i + 1]!);
      const d0 = screenPts[0]!;
      const d1 = screenPts[i]!;
      const d2 = screenPts[i + 1]!;
      const m = triangleAffine(s0, s1, s2, d0, d1, d2);
      if (!m) continue;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(d0.x, d0.y);
      ctx.lineTo(d1.x, d1.y);
      ctx.lineTo(d2.x, d2.y);
      ctx.closePath();
      ctx.clip();
      ctx.globalAlpha = opacity;
      ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
      ctx.drawImage(image, 0, 0);
      ctx.restore();
    }
  }

  const DIM_MARGIN_FRACTION = 0.15;
  const DIM_ARROW_PX = 6;

  /**
   * Overall width/height/depth of the formed pack's own world-space
   * bounding box — not a per-panel breakdown, the same "outside dimensions"
   * scope as the 2D pane's blank-bounds callout. Each axis is offset out
   * along exactly one OTHER axis before projecting (X along -Y, Y along
   * -Z, Z along -X, all anchored at the box's own min corner), so all three
   * read as a single corner-anchored annotation rather than three
   * independent floating lines — the standard shape for an overall 3D
   * bounding-box dimension, even though no single fixed offset scheme
   * reads perfectly from every possible orbit angle (an inherent property
   * of dimensioning a rotatable 3D view, not something worth chasing here).
   */
  function paintDimensions3D(bounds: { min: Vec3; max: Vec3 }, cam: CameraBasis, view: Camera2D, vp: Viewport, color: string, unit: LengthUnit): void {
    const dx = bounds.max.x - bounds.min.x;
    const dy = bounds.max.y - bounds.min.y;
    const dz = bounds.max.z - bounds.min.z;
    const margin = Math.max(dx, dy, dz, 1e-6) * DIM_MARGIN_FRACTION;
    const toScreen = (p: Vec3): Vec2 => modelToScreen(project(p, cam), view, vp);

    const axis = (
      widthOf: number,
      p1: Vec3,
      p2: Vec3,
      offsetAxis: 'x' | 'y' | 'z',
    ): void => {
      const off = { x: 0, y: 0, z: 0 };
      off[offsetAxis] = -margin;
      const d1 = { x: p1.x + off.x, y: p1.y + off.y, z: p1.z + off.z };
      const d2 = { x: p2.x + off.x, y: p2.y + off.y, z: p2.z + off.z };
      const g = assembleDimension(toScreen(p1), toScreen(d1), toScreen(p2), toScreen(d2), DIM_ARROW_PX);
      drawDimensionCanvas(ctx, g, formatLength(widthOf, unit), color);
    };

    const min = bounds.min;
    const max = bounds.max;
    axis(dx, { x: min.x, y: min.y, z: min.z }, { x: max.x, y: min.y, z: min.z }, 'y');
    axis(dy, { x: min.x, y: min.y, z: min.z }, { x: min.x, y: max.y, z: min.z }, 'z');
    axis(dz, { x: min.x, y: min.y, z: min.z }, { x: min.x, y: min.y, z: max.z }, 'x');
  }

  function render(): void {
    cubeHitRegions = [];
    const state = store.getState();
    const { azimuth, elevation, view } = state.camera3d;
    const { faces: ordered, holes, formed, cam, worldBounds, upAxis, formedShape } = projectFaces(azimuth, elevation);
    label.textContent = `${formed ? 'Formed pack' : 'Folded'} · orbit`;
    bgBtn.classList.toggle('on', state.bg3d === 'white');
    dimsBtn.classList.toggle('on', state.dims3d);
    outsideBtn.classList.toggle('on', state.outsideDims3d);

    const vp = viewport();
    const dpr = window.devicePixelRatio || 1;
    const wantW = Math.max(1, Math.round(vp.width * dpr));
    const wantH = Math.max(1, Math.round(vp.height * dpr));
    if (canvas.width !== wantW) canvas.width = wantW;
    if (canvas.height !== wantH) canvas.height = wantH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vp.width, vp.height);

    if (state.bg3d === 'white') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, vp.width, vp.height);
    }

    if (ordered.length === 0) return;

    const boardColor = themeColor('--board', '#d8c9ae');
    const edgeColor = themeColor('--board-edge', '#b39b76');
    const seamWidth = Math.max(0.4, 0.4 / view.zoom);
    const outlineWidth = Math.max(0.5, 0.7 / view.zoom);

    const artwork = state.artwork;
    const bounds = store.getDerived().resolved.blankBounds;
    const frame = artwork && bounds ? pixelFrame(bounds, artwork.image.naturalWidth || 1, artwork.image.naturalHeight || 1) : null;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Interleaved paint order, same as the SVG version this replaced: a
    // boundary on the far side of the loft must be genuinely occludable by
    // a nearer facet's fill, which is only true if fills and outline
    // strokes are drawn in one pass through the SAME depth-sorted array
    // rather than all fills, then all outlines.
    for (const f of ordered) {
      const screenPts = f.pts.map((p) => modelToScreen(p, view, vp));
      if (f.outline) {
        ctx.strokeStyle = edgeColor;
        ctx.lineWidth = outlineWidth;
        ctx.beginPath();
        ctx.moveTo(screenPts[0]!.x, screenPts[0]!.y);
        ctx.lineTo(screenPts[1]!.x, screenPts[1]!.y);
        ctx.stroke();
        continue;
      }
      const opacity = 0.55 + 0.45 * f.shade;
      paintFacet(f, screenPts, opacity, boardColor, artwork, frame);
      // The same seam stroke the SVG version drew around each fill facet —
      // present only to close antialiasing gaps between adjacent
      // tessellated quads, in the facet's own colour, not a visible edge.
      ctx.beginPath();
      ctx.moveTo(screenPts[0]!.x, screenPts[0]!.y);
      for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i]!.x, screenPts[i]!.y);
      ctx.closePath();
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = boardColor;
      ctx.lineWidth = seamWidth;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Punch every feature hole (peg holes, U/V tear notches) out of whatever
    // got painted above, in one pass after all facets — see
    // `projectFormedHoles`'s own comment for why this doesn't try to respect
    // occlusion. `destination-out` erases to transparent, which reads as
    // "through the board" against this canvas's own background (white or
    // the app's transparent default), the same as the 2D dieline view.
    if (holes.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000000';
      for (const loop of holes) {
        const screenPts = loop.map((p) => modelToScreen(p, view, vp));
        ctx.beginPath();
        ctx.moveTo(screenPts[0]!.x, screenPts[0]!.y);
        for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i]!.x, screenPts[i]!.y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    if (state.dims3d && worldBounds) {
      const caliper = store.getDerived().graph.caliper;
      const dimsBounds = state.outsideDims3d ? outsideBounds(worldBounds, formedShape, caliper) : worldBounds;
      paintDimensions3D(dimsBounds, cam, view, vp, themeColor('--l-dimension', '#0f6e77'), state.unit);
    }

    cubeHitRegions = paintViewCube(cam, vp, upAxis ?? 'y');
  }

  // -- interaction: left-drag orbits, shift+left-drag or middle-drag pans,
  // wheel zooms, a view-cube click snaps to a face. One-finger touch orbits,
  // two-finger touch pans (by centroid) and pinch-zooms (by spread ratio) —
  // ported from RSC's `fold3d.js` pointer handling, which tracks every
  // active pointer in a `Map` rather than assuming a single mouse; mouse
  // interaction itself is unchanged from before.

  type Drag = { kind: 'orbit'; last: Vec2 } | { kind: 'pan'; last: Vec2 };
  let drag: Drag | null = null;

  // pointerId -> last screen position, touch pointers only.
  const touchPoints = new Map<number, Vec2>();
  let pinchDist = 0;
  let pinchCentroid: Vec2 | null = null;

  function applyOrbitDelta(dx: number, dy: number): void {
    const cam3 = store.getState().camera3d;
    store.setCamera3D({
      ...cam3,
      azimuth: cam3.azimuth + dx * ORBIT_SENSITIVITY,
      elevation: clampElevation(cam3.elevation - dy * ORBIT_SENSITIVITY),
    });
  }

  function applyPanDelta(dx: number, dy: number): void {
    const cam3 = store.getState().camera3d;
    store.setCamera3D({ ...cam3, view: panView(cam3.view, dx, dy) });
  }

  function touchCentroid(): Vec2 {
    let x = 0;
    let y = 0;
    for (const p of touchPoints.values()) {
      x += p.x;
      y += p.y;
    }
    const n = touchPoints.size || 1;
    return { x: x / n, y: y / n };
  }

  function touchSpread(): number {
    const pts = [...touchPoints.values()];
    return pts.length < 2 ? 0 : Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
  }

  canvas.addEventListener('pointerdown', (ev) => {
    const r = canvas.getBoundingClientRect();
    const now = { x: ev.clientX - r.left, y: ev.clientY - r.top };

    const hit = hitCubeFace(now);
    if (hit) {
      cancelTween();
      const cam3 = store.getState().camera3d;
      const upAxis = store.getDerived().graph.upAxis;
      const target = orbitTowards(hit.dir, upAxis);
      cancelActiveTween = tweenOrbit(
        { azimuth: cam3.azimuth, elevation: cam3.elevation },
        { azimuth: target.azimuth, elevation: clampElevation(target.elevation) },
        CUBE_TWEEN_MS,
        (a: OrbitAngles) => store.setCamera3D({ ...store.getState().camera3d, azimuth: a.azimuth, elevation: a.elevation }),
        () => {
          cancelActiveTween = null;
        },
      );
      return;
    }

    if (ev.pointerType === 'touch') {
      cancelTween();
      canvas.setPointerCapture(ev.pointerId);
      touchPoints.set(ev.pointerId, now);
      if (touchPoints.size >= 2) {
        pinchDist = touchSpread();
        pinchCentroid = touchCentroid();
      }
      return;
    }

    if (ev.button !== 0 && ev.button !== 1) return;
    cancelTween();
    drag = ev.button === 1 || ev.shiftKey ? { kind: 'pan', last: now } : { kind: 'orbit', last: now };
    canvas.setPointerCapture(ev.pointerId);
    canvas.classList.add(drag.kind === 'pan' ? 'panning' : 'orbiting');
  });

  canvas.addEventListener('pointermove', (ev) => {
    const r = canvas.getBoundingClientRect();
    const now = { x: ev.clientX - r.left, y: ev.clientY - r.top };

    if (ev.pointerType === 'touch' && touchPoints.has(ev.pointerId)) {
      const prev = touchPoints.get(ev.pointerId)!;
      touchPoints.set(ev.pointerId, now);
      if (touchPoints.size >= 2) {
        const centroid = touchCentroid();
        if (pinchCentroid) applyPanDelta(centroid.x - pinchCentroid.x, centroid.y - pinchCentroid.y);
        pinchCentroid = centroid;
        const spread = touchSpread();
        if (pinchDist > 0 && spread > 0) {
          const cam3 = store.getState().camera3d;
          store.setCamera3D({ ...cam3, view: zoomAt(cam3.view, viewport(), centroid, spread / pinchDist) });
        }
        pinchDist = spread;
      } else {
        applyOrbitDelta(now.x - prev.x, now.y - prev.y);
      }
      return;
    }

    if (drag) {
      const dx = now.x - drag.last.x;
      const dy = now.y - drag.last.y;
      drag.last = now;
      if (drag.kind === 'pan') applyPanDelta(dx, dy);
      else applyOrbitDelta(dx, dy);
      return;
    }

    // Idle: just track view-cube hover, for its highlight.
    const hovered = hitCubeFace(now)?.label ?? null;
    if (hovered !== hoveredCubeLabel) {
      hoveredCubeLabel = hovered;
      canvas.style.cursor = hovered ? 'pointer' : '';
      render();
    }
  });

  function endDrag(ev: PointerEvent): void {
    if (ev.pointerType === 'touch') {
      touchPoints.delete(ev.pointerId);
      canvas.releasePointerCapture(ev.pointerId);
      if (touchPoints.size < 2) {
        pinchDist = 0;
        pinchCentroid = null;
      }
      if (touchPoints.size === 0) canvas.classList.remove('panning', 'orbiting');
      return;
    }
    if (!drag) return;
    canvas.releasePointerCapture(ev.pointerId);
    canvas.classList.remove('panning', 'orbiting');
    drag = null;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointerleave', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      cancelTween();
      const r = canvas.getBoundingClientRect();
      const screenPoint = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      const factor = Math.exp(-ev.deltaY * 0.0015);
      const cam3 = store.getState().camera3d;
      store.setCamera3D({ ...cam3, view: zoomAt(cam3.view, viewport(), screenPoint, factor) });
    },
    { passive: false },
  );

  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  resetBtn.addEventListener('click', () => resetToIso());
  bgBtn.addEventListener('click', () => store.setBg3D(store.getState().bg3d === 'white' ? 'theme' : 'white'));
  dimsBtn.addEventListener('click', () => store.setDims3D(!store.getState().dims3d));
  outsideBtn.addEventListener('click', () => store.setOutsideDims3D(!store.getState().outsideDims3d));

  // A style switch (or the very first mount) can put the content anywhere in
  // projected space — the pan/zoom from whatever was framed before has no
  // reason to still contain it. Re-fit on those, plain re-render otherwise,
  // so an in-progress orbit/pan/zoom on the SAME style survives every store
  // update instead of snapping back on every hinge-angle or dimension edit.
  let lastStyleId: string | null = null;
  function renderOrRefit(): void {
    container.classList.toggle('bg-white', store.getState().bg3d === 'white');
    const styleId = store.getState().styleId;
    if (styleId !== lastStyleId) {
      lastStyleId = styleId;
      cancelTween();
      snapToIso();
    } else {
      render();
    }
  }

  const unsubscribe = store.subscribe(renderOrRefit);
  renderOrRefit(); // first mount: always a "style change" from null, so this fits

  const resizeObserver = new ResizeObserver(() => render());
  resizeObserver.observe(canvas);

  return {
    destroy() {
      unsubscribe();
      resizeObserver.disconnect();
    },
  };
}
