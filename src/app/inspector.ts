/**
 * Selection inspector. Always shows the same four rows — type, role, ply
 * index, hinge angle — so the panel never rearranges itself; a row that does
 * not apply to the current selection shows a dash instead of disappearing.
 *
 * Only two fields are ever editable: a line's type, and a crease's hinge
 * angle. Ply is the style's own statement of stacking order, not something
 * v1 lets a user free-edit; role is a name, not a value.
 */
import type { LineType } from '../geometry/types.js';
import { isLineOverridden } from './overrides.js';
import type { Store } from './state.js';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const LINE_TYPES: LineType[] = ['cut', 'crease', 'perf', 'score', 'bleed', 'dimension', 'construction'];
const rad2deg = (r: number) => (r * 180) / Math.PI;
const deg2rad = (d: number) => (d * Math.PI) / 180;

export interface InspectorController {
  destroy(): void;
}

export function mountInspector(container: HTMLElement, store: Store): InspectorController {
  function row(label: string, value: string): string {
    return `<div class="field"><span class="label">${label}</span><div class="hint" style="margin-top:2px">${value}</div></div>`;
  }

  function render(): void {
    const state = store.getState();
    const sel = state.selection;

    if (!sel) {
      container.innerHTML = `
        <div class="group">
          <div class="eyebrow"><span class="n">03</span> Inspector</div>
          <div class="hint">Click a line or a face to inspect it.</div>
        </div>`;
      return;
    }

    const derived = store.getDerived();

    if (sel.kind === 'line') {
      const line = derived.graph.lines.find((l) => l.id === sel.lineId);
      if (!line) {
        container.innerHTML = `<div class="group"><div class="eyebrow"><span class="n">03</span> Inspector</div><div class="hint">That line no longer exists.</div></div>`;
        return;
      }
      const hinge = derived.resolved.hinges.find((h) => h.lineIds.includes(line.id));
      const hingeRow = hinge
        ? `<div class="field">
            <span class="label">Hinge angle</span>
            <div class="in"><input type="number" id="insp-angle" value="${rad2deg(hinge.angle).toFixed(2)}" step="1" min="0" max="360"><span class="unit">deg</span></div>
            <div class="hint">Between "${esc(hinge.faceA)}" and "${esc(hinge.faceB)}". Updates the 3D pane live.</div>
          </div>`
        : row('Hinge angle', '—');

      const overridden = isLineOverridden(line, state.ops);
      const overrideRow = overridden
        ? `<div class="field">
            <span class="label" style="color:var(--warn)">● Overridden</span>
            <div class="hint">${line.sourceStyle === 'user' ? 'Added by hand — not part of the template.' : 'Edited by hand — differs from what the template generates at these dimensions.'}</div>
          </div>`
        : '';

      container.innerHTML = `
        <div class="group">
          <div class="eyebrow"><span class="n">03</span> Inspector · line</div>
          <div class="field">
            <span class="label">Type</span>
            <select id="insp-type">${LINE_TYPES.map((t) => `<option value="${t}"${t === line.type ? ' selected' : ''}>${t}</option>`).join('')}</select>
          </div>
          ${row('Role', esc(line.role))}
          ${row('Ply', '—')}
          ${hingeRow}
          ${overrideRow}
          <button class="btn" id="insp-delete" style="margin-top:6px">Delete line</button>
          ${overridden ? `<button class="btn" id="insp-revert" style="margin-top:6px; margin-left:6px">Revert to template</button>` : ''}
        </div>`;
      return;
    }

    // Face selection.
    const face = derived.resolved.faces.find((f) => f.id === sel.faceId);
    if (!face) {
      container.innerHTML = `<div class="group"><div class="eyebrow"><span class="n">03</span> Inspector</div><div class="hint">That face no longer exists.</div></div>`;
      return;
    }
    container.innerHTML = `
      <div class="group">
        <div class="eyebrow"><span class="n">03</span> Inspector · face</div>
        ${row('Type', esc(face.kind))}
        ${row('Role', esc(face.role))}
        ${row('Ply', String(face.ply))}
        ${row('Hinge angle', '—')}
      </div>`;
  }

  container.addEventListener('change', (ev) => {
    const target = ev.target as HTMLElement;
    const sel = store.getState().selection;
    if (!sel || sel.kind !== 'line') return;

    if (target.id === 'insp-type') {
      const type = (target as HTMLSelectElement).value as LineType;
      store.setLineType(sel.lineId, type);
    }

    if (target.id === 'insp-angle') {
      const deg = Number.parseFloat((target as HTMLInputElement).value);
      if (!Number.isFinite(deg)) return;
      const derived = store.getDerived();
      const line = derived.graph.lines.find((l) => l.id === sel.lineId);
      const hinge = line ? derived.resolved.hinges.find((h) => h.lineIds.includes(line.id)) : undefined;
      if (hinge) store.setHingeAngle(hinge.faceA, hinge.faceB, deg2rad(deg));
    }
  });

  container.addEventListener('click', (ev) => {
    const id = (ev.target as HTMLElement).id;
    const sel = store.getState().selection;
    if (sel?.kind !== 'line') return;
    if (id === 'insp-delete') store.deleteLine(sel.lineId);
    if (id === 'insp-revert') store.revertLine(sel.lineId);
  });

  const unsubscribe = store.subscribe(render);
  render();

  return {
    destroy() {
      unsubscribe();
    },
  };
}
