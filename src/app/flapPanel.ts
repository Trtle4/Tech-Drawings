/**
 * Group-select flap faces and set their hinge angle together — stand every
 * top flap up to 90°, fold them past it toward closed, or anywhere back
 * down to flat. Reuses the same `set_hinge_angle` override the inspector's
 * single-hinge angle field already writes (`Store.setHingeAnglesForFaces`
 * just applies it to every selected face's hinge in one history step), so
 * a group edit is just as revertible and just as much a template-diverging
 * override as a one-off hand edit.
 *
 * Hidden entirely for styles with no `kind: 'flap'` faces (bags, pouches) —
 * there is nothing here to select.
 */
import type { Store } from './state.js';

const rad2deg = (r: number) => (r * 180) / Math.PI;
const deg2rad = (d: number) => (d * Math.PI) / 180;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface FlapPanelController {
  destroy(): void;
}

export function mountFlapPanel(container: HTMLElement, store: Store): FlapPanelController {
  function render(): void {
    const derived = store.getDerived();
    const flaps = derived.resolved.faces.filter((f) => f.kind === 'flap');
    if (flaps.length === 0) {
      container.innerHTML = '';
      return;
    }

    const state = store.getState();
    const validIds = new Set(flaps.map((f) => f.id));
    const selected = state.flapSelection.filter((id) => validIds.has(id));

    const angles: number[] = [];
    for (const id of selected) {
      const hinge = derived.resolved.hinges.find((h) => h.faceA === id || h.faceB === id);
      if (hinge) angles.push(rad2deg(hinge.angle));
    }
    const uniform = angles.length > 0 && angles.every((a) => Math.abs(a - angles[0]!) < 0.01);

    const rows = flaps
      .map(
        (f) =>
          `<label class="tbtn"><input type="checkbox" data-face="${f.id}"${selected.includes(f.id) ? ' checked' : ''}>${esc(f.role.replace(/_/g, ' '))}</label>`,
      )
      .join('');

    container.innerHTML = `
      <div class="group">
        <div class="eyebrow"><span class="n">07</span> Flap angles</div>
        <div class="hint">Select flaps, then set their hinge angle as a group. 0&deg; flat, 90&deg; standing up, 180&deg; folded flat closed.</div>
        <div class="field"><div class="toolbar-group">${rows}</div></div>
        <div class="field">
          <div class="toolbar-group">
            <button class="tbtn" id="flap-sel-all">All</button>
            <button class="tbtn" id="flap-sel-top">Top</button>
            <button class="tbtn" id="flap-sel-bottom">Bottom</button>
            <button class="tbtn" id="flap-sel-none">None</button>
          </div>
        </div>
        <div class="field">
          <span class="label">Angle</span>
          <div class="in">
            <input type="number" id="flap-angle" min="0" max="180" step="1" value="${uniform ? angles[0]!.toFixed(1) : ''}" placeholder="${selected.length > 0 && !uniform ? 'mixed' : '90'}" ${selected.length === 0 ? 'disabled' : ''}>
            <span class="unit">deg</span>
          </div>
          <div class="hint">${selected.length === 0 ? 'Select at least one flap above.' : `Applies to ${selected.length} selected flap${selected.length === 1 ? '' : 's'}. Updates the 3D pane live.`}</div>
        </div>
      </div>`;
  }

  container.addEventListener('change', (ev) => {
    const target = ev.target as HTMLInputElement;

    if (target.matches('input[type="checkbox"][data-face]')) {
      const faceId = target.dataset.face!;
      const current = store.getState().flapSelection;
      const next = target.checked ? [...current, faceId] : current.filter((id) => id !== faceId);
      store.setFlapSelection(next);
      return;
    }

    if (target.id === 'flap-angle') {
      const deg = Number.parseFloat(target.value);
      if (!Number.isFinite(deg)) return;
      const selected = store.getState().flapSelection;
      if (selected.length === 0) return;
      store.setHingeAnglesForFaces(selected, deg2rad(deg));
    }
  });

  container.addEventListener('click', (ev) => {
    const id = (ev.target as HTMLElement).id;
    const flaps = store.getDerived().resolved.faces.filter((f) => f.kind === 'flap');
    if (id === 'flap-sel-all') store.setFlapSelection(flaps.map((f) => f.id));
    else if (id === 'flap-sel-none') store.setFlapSelection([]);
    else if (id === 'flap-sel-top') store.setFlapSelection(flaps.filter((f) => f.role.includes('top')).map((f) => f.id));
    else if (id === 'flap-sel-bottom') store.setFlapSelection(flaps.filter((f) => f.role.includes('bottom')).map((f) => f.id));
  });

  const unsubscribe = store.subscribe(render);
  render();

  return {
    destroy() {
      unsubscribe();
    },
  };
}
