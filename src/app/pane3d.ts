/**
 * The companion 3D pane. Read-only — no interaction of its own — but it
 * re-renders on every store change, so a dragged line, a retyped crease, a
 * dimension edit or a hinge-angle edit from the inspector all show up here
 * without any extra wiring at the call site.
 *
 * Same isometric projection and paint order as the gallery's 3D preview
 * (`src/render/iso.ts`, `scripts/build-preview.ts`) — one camera, driven by
 * the style's declared up axis, reused rather than re-derived.
 */
import type { Vec2, Vec3 } from '../geometry/types.js';
import { foldedFacePoints } from '../geometry/fold.js';
import { computeFormedShape, hasFormedShape } from '../geometry/formedShape.js';
import { cameraBasis, paintOrder, project } from '../render/iso.js';
import type { Store } from './state.js';

const d = (pts: Vec2[]) => `M ${pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')}`;
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

export interface Pane3DController {
  destroy(): void;
}

export function mountPane3D(container: HTMLElement, store: Store): Pane3DController {
  container.innerHTML = `
    <div class="pane-grid"></div>
    <span class="pane-label" id="pane3d-label">Folded · iso</span>
    <svg class="pane-canvas" id="pane3d-svg"></svg>`;
  const svg = container.querySelector<SVGSVGElement>('#pane3d-svg')!;
  const label = container.querySelector<HTMLSpanElement>('#pane3d-label')!;

  function render(): void {
    const derived = store.getDerived();
    const graph = derived.graph;
    const resolved = derived.resolved;
    const formed = hasFormedShape(graph);
    label.textContent = `${formed ? 'Formed pack' : 'Folded'} · iso`;

    const cam = cameraBasis(graph.upAxis);
    const folded = formed ? computeFormedShape(graph, resolved) : foldedFacePoints(resolved, 1);

    const faces: { pts: Vec2[]; depth: number; shade: number; ply: number }[] = [];
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
    const ordered = paintOrder(faces);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const f of ordered) {
      for (const q of f.pts) {
        minX = Math.min(minX, q.x);
        minY = Math.min(minY, q.y);
        maxX = Math.max(maxX, q.x);
        maxY = Math.max(maxY, q.y);
      }
    }
    if (!Number.isFinite(minX)) {
      svg.removeAttribute('viewBox');
      svg.innerHTML = '';
      return;
    }
    const pad = Math.max(maxX - minX, maxY - minY) * 0.12;
    const sw = Math.max(maxX - minX, maxY - minY) * 0.004;
    svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`);
    svg.innerHTML = ordered
      .map(
        (f) =>
          `<path d="${d(f.pts)} Z" fill="var(--board)" fill-opacity="${(0.55 + 0.45 * f.shade).toFixed(3)}" ` +
          `stroke="var(--board-edge)" stroke-width="${sw.toFixed(3)}" stroke-linejoin="round"/>`,
      )
      .join('');
  }

  const unsubscribe = store.subscribe(render);
  render();

  return {
    destroy() {
      unsubscribe();
    },
  };
}
