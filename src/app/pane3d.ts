/**
 * The 3D pane: orbit, pan, zoom, reset to iso. One instance, shared by the
 * primary view and the companion inset — which one it is only changes its
 * CSS size, not which DOM/JS it is, so interaction here applies to both for
 * free.
 *
 * Re-renders on every store change, so a dragged line, a retyped crease, a
 * dimension edit or a hinge-angle edit from the inspector all show up here
 * without any extra wiring at the call site.
 */
import type { Vec2, Vec3 } from '../geometry/types.js';
import { foldedFacePoints } from '../geometry/fold.js';
import { computeFormedShape, hasFormedShape } from '../geometry/formedShape.js';
import { cameraBasis, paintOrder, project } from '../render/iso.js';
import { fitToBounds, modelToScreen, pan as panView, zoomAt, type Viewport } from './camera2d.js';
import { DEFAULT_ORBIT, type Store } from './state.js';

const d = (pts: Vec2[]) => `M ${pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')}`;
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

const ELEVATION_LIMIT = (89 * Math.PI) / 180;
const ORBIT_SENSITIVITY = Math.PI / 300; // radians per screen px
const clampElevation = (e: number) => Math.max(-ELEVATION_LIMIT, Math.min(ELEVATION_LIMIT, e));

interface ProjectedFace {
  pts: Vec2[];
  depth: number;
  shade: number;
  ply: number;
}

export interface Pane3DController {
  destroy(): void;
}

export function mountPane3D(container: HTMLElement, store: Store): Pane3DController {
  container.innerHTML = `
    <div class="pane-grid"></div>
    <span class="pane-label" id="pane3d-label">Folded · iso</span>
    <svg class="pane-canvas" id="pane3d-svg"></svg>
    <div class="viewport-toolbar">
      <button class="tbtn icon" id="pane3d-reset" title="Reset to iso view">⤢</button>
    </div>`;
  const svg = container.querySelector<SVGSVGElement>('#pane3d-svg')!;
  const label = container.querySelector<HTMLSpanElement>('#pane3d-label')!;
  const resetBtn = container.querySelector<HTMLButtonElement>('#pane3d-reset')!;

  function viewport(): Viewport {
    const r = svg.getBoundingClientRect();
    return { width: r.width || 1, height: r.height || 1 };
  }

  /** Project the current derived geometry at a given orbit orientation — pure, no DOM writes. */
  function projectFaces(azimuth: number, elevation: number): { faces: ProjectedFace[]; upAxis: 'x' | 'y' | 'z' | undefined; formed: boolean } {
    const derived = store.getDerived();
    const graph = derived.graph;
    const resolved = derived.resolved;
    const formed = hasFormedShape(graph);
    const cam = cameraBasis(graph.upAxis, azimuth, elevation);
    const folded = formed ? computeFormedShape(graph, resolved) : foldedFacePoints(resolved, 1);

    const faces: ProjectedFace[] = [];
    for (const { face, points } of folded.values()) {
      if (points.length < 3) continue;
      const proj = points.map((p) => project(p, cam));
      const depth = proj.reduce((s, q) => s + q.depth, 0) / proj.length;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        nx += (a.y - b.y) * (a.z + b.z);
        ny += (a.z - b.z) * (a.x + b.x);
        nz += (a.x - b.x) * (a.y + b.y);
      }
      const len = Math.hypot(nx, ny, nz) || 1;
      faces.push({
        pts: proj.map((q) => ({ x: q.x, y: q.y })),
        depth,
        ply: face.ply,
        shade: Math.abs(dot({ x: nx / len, y: ny / len, z: nz / len }, cam.forward)),
      });
    }
    return { faces: paintOrder(faces), upAxis: graph.upAxis, formed };
  }

  function projectedBounds(faces: ProjectedFace[]): { min: Vec2; max: Vec2 } | null {
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

  /** Reset orbit to the default iso angle and frame the model at that angle. */
  function resetToIso(): void {
    const { azimuth, elevation } = DEFAULT_ORBIT;
    const { faces } = projectFaces(azimuth, elevation);
    const bounds = projectedBounds(faces);
    const view = bounds ? fitToBounds(bounds, viewport()) : { cx: 0, cy: 0, zoom: 1 };
    store.setCamera3D({ azimuth, elevation, view });
  }

  function render(): void {
    const { azimuth, elevation, view } = store.getState().camera3d;
    const { faces: ordered, formed } = projectFaces(azimuth, elevation);
    label.textContent = `${formed ? 'Formed pack' : 'Folded'} · orbit`;

    const vp = viewport();
    if (ordered.length === 0) {
      svg.innerHTML = '';
      return;
    }
    const sw = 0.6 / view.zoom;
    svg.setAttribute('viewBox', `0 0 ${vp.width} ${vp.height}`);
    svg.innerHTML = ordered
      .map((f) => {
        const screenPts = f.pts.map((p) => modelToScreen(p, view, vp));
        return (
          `<path d="${d(screenPts)} Z" fill="var(--board)" fill-opacity="${(0.55 + 0.45 * f.shade).toFixed(3)}" ` +
          `stroke="var(--board-edge)" stroke-width="${sw.toFixed(3)}" stroke-linejoin="round"/>`
        );
      })
      .join('');
  }

  // -- interaction: left-drag orbits, shift+left-drag or middle-drag pans, wheel zooms --

  type Drag = { kind: 'orbit'; last: Vec2 } | { kind: 'pan'; last: Vec2 };
  let drag: Drag | null = null;

  svg.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 && ev.button !== 1) return;
    const r = svg.getBoundingClientRect();
    const last = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    drag = ev.button === 1 || ev.shiftKey ? { kind: 'pan', last } : { kind: 'orbit', last };
    svg.setPointerCapture(ev.pointerId);
    svg.classList.add(drag.kind === 'pan' ? 'panning' : 'orbiting');
  });

  svg.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const r = svg.getBoundingClientRect();
    const now = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    const dx = now.x - drag.last.x;
    const dy = now.y - drag.last.y;
    drag.last = now;
    const cam3 = store.getState().camera3d;

    if (drag.kind === 'pan') {
      store.setCamera3D({ ...cam3, view: panView(cam3.view, dx, dy) });
    } else {
      store.setCamera3D({
        ...cam3,
        azimuth: cam3.azimuth + dx * ORBIT_SENSITIVITY,
        elevation: clampElevation(cam3.elevation - dy * ORBIT_SENSITIVITY),
      });
    }
  });

  function endDrag(ev: PointerEvent): void {
    if (!drag) return;
    svg.releasePointerCapture(ev.pointerId);
    svg.classList.remove('panning', 'orbiting');
    drag = null;
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointerleave', endDrag);

  svg.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      const r = svg.getBoundingClientRect();
      const screenPoint = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      const factor = Math.exp(-ev.deltaY * 0.0015);
      const cam3 = store.getState().camera3d;
      store.setCamera3D({ ...cam3, view: zoomAt(cam3.view, viewport(), screenPoint, factor) });
    },
    { passive: false },
  );

  svg.addEventListener('contextmenu', (ev) => ev.preventDefault());
  resetBtn.addEventListener('click', () => resetToIso());

  // A style switch (or the very first mount) can put the content anywhere in
  // projected space — the pan/zoom from whatever was framed before has no
  // reason to still contain it. Re-fit on those, plain re-render otherwise,
  // so an in-progress orbit/pan/zoom on the SAME style survives every store
  // update instead of snapping back on every hinge-angle or dimension edit.
  let lastStyleId: string | null = null;
  function renderOrRefit(): void {
    const styleId = store.getState().styleId;
    if (styleId !== lastStyleId) {
      lastStyleId = styleId;
      resetToIso();
    } else {
      render();
    }
  }

  const unsubscribe = store.subscribe(renderOrRefit);
  renderOrRefit(); // first mount: always a "style change" from null, so this fits

  return {
    destroy() {
      unsubscribe();
    },
  };
}
