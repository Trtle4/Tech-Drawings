/**
 * The interactive 2D canvas: pan, zoom, fit, snap, select, drag, add, delete,
 * retype. DOM-facing — the pure math it calls into lives in `camera2d.ts` and
 * `hitTest.ts` so it stays testable without a browser.
 *
 * Rendering is a full rebuild of the SVG content on every store change or
 * drag frame — string templates, the same approach the rest of this app uses
 * (`scripts/build-preview.ts`). The drawings here are dozens of lines, not
 * thousands, so there is no diffing to earn its keep.
 *
 * A drag never touches the store until it ends. While a line is being
 * dragged, only its own rendered path is swapped for a live preview; every
 * other line, every face and every dimension stays exactly as it was until
 * pointerup commits one op and the store recomputes — "drag a line: only
 * that line moves, dimensions recalculate afterward," literally.
 */
import type { DrawingLine, LineType, Path, Vec2 } from '../geometry/types.js';
import { flattenPath } from '../geometry/arrangement.js';
import { translatePath } from './overrides.js';
import { hitTestEndpoint, hitTestFace, hitTestLine } from './hitTest.js';
import {
  collectSnapCandidates,
  modelToScreen,
  pan as panCamera,
  screenToModel,
  snapPoint,
  zoomAt,
  type Camera2D,
  type Viewport,
} from './camera2d.js';
import type { Store } from './state.js';

const LINE_STYLE: Record<string, string> = {
  cut: 'stroke="var(--l-cut)" stroke-width="1.6"',
  crease: 'stroke="var(--l-crease)" stroke-width="1.1" stroke-dasharray="7 4"',
  perf: 'stroke="var(--l-perf)" stroke-width="1.1" stroke-dasharray="9 3 1.5 3"',
  score: 'stroke="var(--l-score)" stroke-width="0.9" stroke-dasharray="4 3"',
  bleed: 'stroke="var(--l-bleed)" stroke-width="0.8" stroke-dasharray="3 3"',
  dimension: 'stroke="var(--l-dimension)" stroke-width="0.8" stroke-dasharray="2 2"',
  construction: 'stroke="var(--ink-3)" stroke-width="0.8" stroke-dasharray="1 3"',
};

const LINE_TYPES: LineType[] = ['cut', 'crease', 'perf', 'score', 'bleed', 'dimension', 'construction'];

const ENDPOINT_TOL_PX = 9;
const LINE_TOL_PX = 7;
const CLICK_SLOP_PX = 3;

type Tool = { kind: 'select' } | { kind: 'draw'; lineType: LineType };

type LiveDrag =
  | { kind: 'pan'; startScreen: Vec2; startCamera: Camera2D }
  | { kind: 'move_point'; lineId: string; pointIndex: number; startModel: Vec2; to: Vec2 }
  | { kind: 'move_line'; lineId: string; startModel: Vec2; dx: number; dy: number }
  | { kind: 'draw_place'; start: Vec2 };

const d = (pts: Vec2[]) => `M ${pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')}`;

function effectivePath(line: DrawingLine, drag: LiveDrag | null): Path {
  if (!drag) return line.geometry;
  if (drag.kind === 'move_point' && drag.lineId === line.id && line.geometry.kind === 'polyline') {
    return {
      kind: 'polyline',
      points: line.geometry.points.map((p, i) => (i === drag.pointIndex ? drag.to : p)),
      ...(line.geometry.closed ? { closed: true } : {}),
    };
  }
  if (drag.kind === 'move_line' && drag.lineId === line.id) {
    return translatePath(line.geometry, drag.dx, drag.dy);
  }
  return line.geometry;
}

export interface CanvasController {
  fit(): void;
  destroy(): void;
}

export function mountCanvas(container: HTMLElement, store: Store): CanvasController {
  container.innerHTML = `
    <div class="pane-grid"></div>
    <span class="pane-label">Flat blank · mm</span>
    <svg class="pane-canvas tool-select" id="canvas-svg"></svg>
    <div class="viewport-toolbar">
      <div class="toolbar-group">
        <button class="tbtn on" data-tool="select">Select</button>
        <select id="draw-type" title="Type for the next line">
          ${LINE_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}
        </select>
        <button class="tbtn" data-tool="draw">Add line</button>
      </div>
      <div class="toolbar-group">
        <button class="tbtn${store.getState().snap.grid ? ' on' : ''}" data-snap="grid">Grid</button>
        <button class="tbtn${store.getState().snap.endpoints ? ' on' : ''}" data-snap="endpoints">Endpoints</button>
        <button class="tbtn${store.getState().snap.midpoints ? ' on' : ''}" data-snap="midpoints">Midpoints</button>
      </div>
      <div class="toolbar-group">
        <button class="tbtn icon" id="canvas-fit" title="Fit to blank">⤢</button>
      </div>
    </div>`;

  const svg = container.querySelector<SVGSVGElement>('#canvas-svg')!;
  const drawTypeSelect = container.querySelector<HTMLSelectElement>('#draw-type')!;
  const toolButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-tool]'));
  const snapButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-snap]'));
  const fitButton = container.querySelector<HTMLButtonElement>('#canvas-fit')!;

  let tool: Tool = { kind: 'select' };
  let drag: LiveDrag | null = null;
  let hoverModel: Vec2 | null = null;
  let placeCursor: Vec2 | null = null;
  let raf = 0;

  function viewport(): Viewport {
    const r = svg.getBoundingClientRect();
    return { width: r.width || 1, height: r.height || 1 };
  }

  function toModel(ev: PointerEvent): Vec2 {
    const r = svg.getBoundingClientRect();
    return screenToModel({ x: ev.clientX - r.left, y: ev.clientY - r.top }, store.getState().camera, viewport());
  }

  function snapped(model: Vec2, excludeLineId?: string): Vec2 {
    const derived = store.getDerived();
    const candidates = collectSnapCandidates(derived.graph.lines, excludeLineId);
    return snapPoint(model, store.getState().camera, candidates, store.getState().snap);
  }

  function scheduleRender(): void {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      render();
    });
  }

  function setTool(next: Tool): void {
    tool = next;
    drag = null;
    placeCursor = null;
    for (const b of toolButtons) b.classList.toggle('on', b.dataset.tool === next.kind);
    svg.classList.toggle('tool-draw', next.kind === 'draw');
    svg.classList.toggle('tool-select', next.kind === 'select');
    scheduleRender();
  }

  // -- pointer interaction ---------------------------------------------------

  svg.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 && ev.button !== 1) return;
    const cam = store.getState().camera;
    const screenStart = { x: ev.clientX - svg.getBoundingClientRect().left, y: ev.clientY - svg.getBoundingClientRect().top };
    const model = toModel(ev);
    const tolEndpoint = ENDPOINT_TOL_PX / cam.zoom;
    const tolLine = LINE_TOL_PX / cam.zoom;
    const derived = store.getDerived();

    if (ev.button === 1) {
      drag = { kind: 'pan', startScreen: screenStart, startCamera: cam };
      svg.classList.add('panning');
      svg.setPointerCapture(ev.pointerId);
      return;
    }

    if (tool.kind === 'draw') {
      const p = snapped(model);
      if (drag && drag.kind === 'draw_place') {
        store.addLine(tool.lineType, [drag.start, p]);
        drag = null;
        placeCursor = null;
        scheduleRender();
      } else {
        drag = { kind: 'draw_place', start: p };
      }
      return;
    }

    // Select mode: endpoint first (finest target), then a line body, then a face, then background pan.
    const endpointHit = hitTestEndpoint(model, derived.graph.lines, tolEndpoint);
    if (endpointHit) {
      store.select({ kind: 'line', lineId: endpointHit.lineId });
      drag = { kind: 'move_point', lineId: endpointHit.lineId, pointIndex: endpointHit.pointIndex, startModel: model, to: endpointHit.point };
      svg.setPointerCapture(ev.pointerId);
      scheduleRender();
      return;
    }

    const lineHit = hitTestLine(model, derived.graph.lines, tolLine);
    if (lineHit) {
      store.select({ kind: 'line', lineId: lineHit.id });
      drag = { kind: 'move_line', lineId: lineHit.id, startModel: model, dx: 0, dy: 0 };
      svg.setPointerCapture(ev.pointerId);
      scheduleRender();
      return;
    }

    const faceHit = hitTestFace(model, derived.resolved.faces);
    if (faceHit) {
      store.select({ kind: 'face', faceId: faceHit.id });
      return;
    }

    drag = { kind: 'pan', startScreen: screenStart, startCamera: cam };
    svg.classList.add('panning');
    svg.setPointerCapture(ev.pointerId);
  });

  svg.addEventListener('pointermove', (ev) => {
    const model = toModel(ev);
    hoverModel = model;

    if (!drag) {
      scheduleRender();
      return;
    }

    if (drag.kind === 'pan') {
      const r = svg.getBoundingClientRect();
      const screenNow = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      store.setCamera(panCamera(drag.startCamera, screenNow.x - drag.startScreen.x, screenNow.y - drag.startScreen.y));
      return;
    }

    if (drag.kind === 'move_point') {
      drag = { ...drag, to: snapped(model, drag.lineId) };
      scheduleRender();
      return;
    }

    if (drag.kind === 'move_line') {
      drag = { ...drag, dx: model.x - drag.startModel.x, dy: model.y - drag.startModel.y };
      scheduleRender();
      return;
    }

    if (drag.kind === 'draw_place') {
      placeCursor = snapped(model);
      scheduleRender();
    }
  });

  function endDrag(ev: PointerEvent): void {
    if (!drag) return;
    if (drag.kind === 'pan') {
      const r = svg.getBoundingClientRect();
      const moved = Math.hypot(ev.clientX - r.left - drag.startScreen.x, ev.clientY - r.top - drag.startScreen.y);
      if (moved < CLICK_SLOP_PX) store.select(null); // a plain click on empty space deselects
      drag = null;
      svg.classList.remove('panning');
      scheduleRender();
      return;
    }
    if (drag.kind === 'move_point') {
      const { lineId, pointIndex, to, startModel } = drag;
      const moved = Math.hypot(to.x - startModel.x, to.y - startModel.y);
      const original = store.getDerived().graph.lines.find((l) => l.id === lineId);
      const originalPoint = original && original.geometry.kind === 'polyline' ? original.geometry.points[pointIndex] : undefined;
      const settled = originalPoint ? Math.hypot(to.x - originalPoint.x, to.y - originalPoint.y) > 1e-9 : moved > 1e-9;
      if (settled) store.moveLinePoint(lineId, pointIndex, to);
      drag = null;
      scheduleRender();
      return;
    }
    if (drag.kind === 'move_line') {
      if (Math.hypot(drag.dx, drag.dy) > 1e-9) store.moveLine(drag.lineId, drag.dx, drag.dy);
      drag = null;
      scheduleRender();
      return;
    }
    // draw_place ends only on the second click (handled in pointerdown), not on pointerup.
  }

  svg.addEventListener('pointerup', (ev) => {
    if (drag?.kind === 'pan' || drag?.kind === 'move_point' || drag?.kind === 'move_line') {
      svg.releasePointerCapture(ev.pointerId);
    }
    endDrag(ev);
  });

  svg.addEventListener('pointerleave', () => {
    hoverModel = null;
    scheduleRender();
  });

  svg.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      const r = svg.getBoundingClientRect();
      const screenPoint = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      const factor = Math.exp(-ev.deltaY * 0.0015);
      store.setCamera(zoomAt(store.getState().camera, viewport(), screenPoint, factor));
    },
    { passive: false },
  );

  svg.addEventListener('contextmenu', (ev) => ev.preventDefault());

  window.addEventListener('keydown', (ev) => {
    const active = document.activeElement;
    const typing = active instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName);
    if (typing) return;

    if (ev.key === 'Escape') {
      if (drag?.kind === 'draw_place') {
        drag = null;
        placeCursor = null;
        scheduleRender();
      } else {
        setTool({ kind: 'select' });
      }
      return;
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      const sel = store.getState().selection;
      if (sel?.kind === 'line') {
        ev.preventDefault();
        store.deleteLine(sel.lineId);
      }
    }
  });

  for (const btn of toolButtons) {
    btn.addEventListener('click', () => {
      if (btn.dataset.tool === 'draw') setTool({ kind: 'draw', lineType: drawTypeSelect.value as LineType });
      else setTool({ kind: 'select' });
    });
  }
  drawTypeSelect.addEventListener('change', () => {
    if (tool.kind === 'draw') tool = { kind: 'draw', lineType: drawTypeSelect.value as LineType };
  });

  for (const btn of snapButtons) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.snap as 'grid' | 'endpoints' | 'midpoints';
      const next = !store.getState().snap[key];
      store.setSnap({ [key]: next });
      btn.classList.toggle('on', next);
    });
  }

  fitButton.addEventListener('click', () => fit());

  function fit(): void {
    store.fitToBlank(viewport());
  }

  // -- rendering --------------------------------------------------------------

  function render(): void {
    const derived = store.getDerived();
    const cam = store.getState().camera;
    const vp = viewport();
    const selection = store.getState().selection;

    const toScreen = (p: Vec2) => modelToScreen(p, cam, vp);

    const gridLayer = renderGrid(cam, vp);

    const faceLayer = derived.resolved.faces
      .map((f) => {
        const isSel = selection?.kind === 'face' && selection.faceId === f.id;
        const outer = d(f.outer.points.map(toScreen));
        const holes = f.holes.map((h) => `${d(h.points.map(toScreen))} Z`).join(' ');
        return `<path d="${outer} Z ${holes}" fill-rule="evenodd" fill="${isSel ? 'var(--accent-soft)' : 'var(--board-white)'}" opacity="${isSel ? '0.9' : '0.75'}" data-face-id="${f.id}"/>`;
      })
      .join('');

    const lineLayer = derived.graph.lines
      .map((l) => {
        const path = effectivePath(l, drag);
        const pts = flattenPath(path).map(toScreen);
        if (pts.length < 2) return '';
        const isSel = selection?.kind === 'line' && selection.lineId === l.id;
        const style = LINE_STYLE[l.type] ?? LINE_STYLE.cut;
        // A wider accent halo drawn underneath, not a filter on the line itself
        // — the dash pattern and colour a crease/perf/etc. is drawn in still
        // read clearly on top of it.
        const halo = isSel ? `<path d="${d(pts)}" fill="none" stroke="var(--accent)" stroke-width="5" stroke-linecap="round" opacity="0.35"/>` : '';
        return `${halo}<path d="${d(pts)}" fill="none" ${style} data-line-id="${l.id}"/>`;
      })
      .join('');

    const handleLayer = derived.graph.lines
      .flatMap((l) => {
        if (l.geometry.kind !== 'polyline') return [];
        const isDragTarget = drag?.kind === 'move_point' && drag.lineId === l.id;
        return l.geometry.points.map((p, i) => {
          const shown = isDragTarget && drag && drag.kind === 'move_point' && drag.pointIndex === i ? drag.to : p;
          const s = toScreen(shown);
          const isSel = selection?.kind === 'line' && selection.lineId === l.id;
          const r = isSel ? 4.5 : 2.6;
          return `<circle cx="${s.x.toFixed(2)}" cy="${s.y.toFixed(2)}" r="${r}" class="handle-pt" fill="${isSel ? 'var(--accent)' : 'var(--ink-3)'}" data-line-id="${l.id}" data-point-index="${i}"/>`;
        });
      })
      .join('');

    let overlay = '';
    if (drag?.kind === 'draw_place' && placeCursor) {
      const a = toScreen(drag.start);
      const b = toScreen(placeCursor);
      overlay += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="var(--accent)" stroke-width="1.4" stroke-dasharray="5 4"/>`;
      overlay += `<circle cx="${b.x}" cy="${b.y}" r="4" fill="none" stroke="var(--accent)" stroke-width="1.4"/>`;
    } else if (hoverModel && !drag) {
      const excl = selection?.kind === 'line' ? selection.lineId : undefined;
      const snap = snapped(hoverModel, excl);
      if (Math.hypot(snap.x - hoverModel.x, snap.y - hoverModel.y) > 1e-9) {
        const s = toScreen(snap);
        overlay += `<circle cx="${s.x.toFixed(2)}" cy="${s.y.toFixed(2)}" r="5" fill="none" stroke="var(--accent)" stroke-width="1.4"/>`;
      }
    }

    svg.innerHTML = `${gridLayer}<g>${faceLayer}</g><g>${lineLayer}</g><g>${handleLayer}</g><g>${overlay}</g>`;
  }

  function renderGrid(cam: Camera2D, vp: Viewport): string {
    const snap = store.getState().snap;
    if (!snap.grid || snap.gridSize <= 0) return '';
    const step = snap.gridSize * cam.zoom;
    if (step < 6) return ''; // too dense to be useful, skip rather than paint mud
    const topLeft = screenToModel({ x: 0, y: 0 }, cam, vp);
    const bottomRight = screenToModel({ x: vp.width, y: vp.height }, cam, vp);
    const x0 = Math.floor(Math.min(topLeft.x, bottomRight.x) / snap.gridSize) * snap.gridSize;
    const x1 = Math.max(topLeft.x, bottomRight.x);
    const y0 = Math.floor(Math.min(topLeft.y, bottomRight.y) / snap.gridSize) * snap.gridSize;
    const y1 = Math.max(topLeft.y, bottomRight.y);
    const lines: string[] = [];
    for (let x = x0; x <= x1; x += snap.gridSize) {
      const a = modelToScreen({ x, y: y0 }, cam, vp);
      const b = modelToScreen({ x, y: y1 }, cam, vp);
      lines.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`);
    }
    for (let y = y0; y <= y1; y += snap.gridSize) {
      const a = modelToScreen({ x: x0, y }, cam, vp);
      const b = modelToScreen({ x: x1, y }, cam, vp);
      lines.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`);
    }
    return `<g stroke="var(--grid)" stroke-width="1">${lines.join('')}</g>`;
  }

  const unsubscribe = store.subscribe(() => {
    // A style/dimension change may resize the blank; keep the drag's line
    // targeted by id, but a stale in-flight drag from before a param change
    // is rare enough (would require editing two things in one pointer-down
    // window) not to special-case.
    scheduleRender();
  });

  const resizeObserver = new ResizeObserver(() => scheduleRender());
  resizeObserver.observe(svg);

  fit();
  render();

  return {
    fit,
    destroy() {
      unsubscribe();
      resizeObserver.disconnect();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
