/**
 * The feature library UI: place a peg hole or tear notch from a list,
 * anchored to a face and offset from a reference edge, then edit it in
 * place afterward — the list itself IS the "select a feature" UI, there is
 * no separate click-to-select on the drawing for v1. Every add/edit/delete
 * is a `Store` override op (`add_feature`/`set_feature`/`delete_feature`),
 * so it is exactly as undoable and exactly as much a template-diverging
 * change as any hand-drawn line.
 *
 * Hidden entirely when the current style has no faces to anchor to (should
 * not happen once a style is loaded, but matches the same defensive style
 * flapPanel.ts uses).
 */
import { FEATURE_KINDS, FEATURE_LABEL, isPegHoleKind, isTopEndSealRole, type FeatureKind } from '../geometry/features.js';
import type { Store } from './state.js';

const rad2deg = (r: number) => (r * 180) / Math.PI;
const deg2rad = (d: number) => (d * Math.PI) / 180;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const DEFAULT_SIZE: Record<FeatureKind, { x: number; y: number }> = {
  'peg_hole.round': { x: 8, y: 8 },
  'peg_hole.sombrero': { x: 8, y: 4 },
  'peg_hole.delta': { x: 10, y: 8 },
  'tear_notch.v': { x: 12, y: 8 },
  'tear_notch.u': { x: 12, y: 6 },
  'tear_notch.laser_score': { x: 20, y: 0 },
};

export interface FeaturePanelController {
  destroy(): void;
}

export function mountFeaturePanel(container: HTMLElement, store: Store): FeaturePanelController {
  // Transient add-feature draft — not app content, reset each time it's placed.
  let draftKind: FeatureKind = 'peg_hole.round';
  let draftAnchor = '';
  let draftEdge = '';
  let draftOffsetX = 0;
  let draftOffsetY = 0;
  let draftRotationDeg = 0;
  let draftSizeX = DEFAULT_SIZE[draftKind].x;
  let draftSizeY = DEFAULT_SIZE[draftKind].y;
  let error: string | null = null;

  function render(): void {
    const derived = store.getDerived();
    const faces = derived.resolved.faces;
    if (faces.length === 0) {
      container.innerHTML = '';
      return;
    }
    // Peg holes are a retail hang-hole: only meaningful on a bag, and only on
    // the flat top end seal band it hangs from — see isTopEndSealRole. A
    // style with no such band (every case/carton/tray, plus the stand-up
    // pouch, which has no modeled top seal) simply never offers peg holes.
    const topEndSealFaces = faces.filter((f) => isTopEndSealRole(f.role));
    const availableKinds = FEATURE_KINDS.filter((k) => !isPegHoleKind(k) || topEndSealFaces.length > 0);
    if (!availableKinds.includes(draftKind)) {
      draftKind = availableKinds[0]!;
      draftSizeX = DEFAULT_SIZE[draftKind].x;
      draftSizeY = DEFAULT_SIZE[draftKind].y;
    }
    const anchorCandidates = isPegHoleKind(draftKind) ? topEndSealFaces : faces;
    if (!anchorCandidates.some((f) => f.role === draftAnchor)) draftAnchor = anchorCandidates[0]!.role;
    const lines = derived.graph.lines.filter((l) => l.type === 'cut' || l.type === 'crease' || l.type === 'perf' || l.type === 'score');
    if (!lines.some((l) => l.role === draftEdge)) draftEdge = lines[0]?.role ?? '';

    const features = derived.graph.features;
    const staleFeatures = derived.staleFeatures;
    const edgeLocked = draftKind === 'tear_notch.v' || draftKind === 'tear_notch.u';

    const faceOptions = anchorCandidates.map((f) => `<option value="${esc(f.role)}"${f.role === draftAnchor ? ' selected' : ''}>${esc(f.role)}</option>`).join('');
    const edgeOptions = lines.map((l) => `<option value="${esc(l.role)}"${l.role === draftEdge ? ' selected' : ''}>${esc(l.role)}</option>`).join('');
    const kindOptions = availableKinds.map((k) => `<option value="${k}"${k === draftKind ? ' selected' : ''}>${esc(FEATURE_LABEL[k])}</option>`).join('');

    const listRows = features
      .map((f) => {
        const stale = staleFeatures.find((s) => s.feature.id === f.id);
        return `
        <div class="field" data-feature-row="${esc(f.id)}" style="border:1px solid var(--line-2);border-radius:var(--r-sm);padding:8px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span class="label" style="margin:0">${esc(FEATURE_LABEL[f.kind as FeatureKind] ?? f.kind)}</span>
            <button class="tbtn icon" data-delete-feature="${esc(f.id)}" title="Delete this feature">✕</button>
          </div>
          <div class="hint" style="margin-bottom:6px">on ${esc(f.anchorFaceRole)}, from ${esc(f.referenceEdgeRole)}${stale ? ` — <span style="color:var(--warn)">${esc(stale.message)}</span>` : ''}</div>
          <div class="row2">
            <div class="in"><input type="number" step="0.5" value="${f.offset.x}" data-feature-field="${esc(f.id)}:offset.x"><span class="unit">mm along</span></div>
            <div class="in"><input type="number" step="0.5" value="${f.offset.y}" data-feature-field="${esc(f.id)}:offset.y"><span class="unit">mm in</span></div>
          </div>
          <div class="row2" style="margin-top:6px">
            <div class="in"><input type="number" step="0.5" value="${f.size.x}" data-feature-field="${esc(f.id)}:size.x"><span class="unit">size x</span></div>
            <div class="in"><input type="number" step="0.5" value="${f.size.y}" data-feature-field="${esc(f.id)}:size.y"><span class="unit">size y</span></div>
          </div>
          <div class="field" style="margin-top:6px;margin-bottom:0">
            <div class="in"><input type="number" step="1" value="${rad2deg(f.rotation).toFixed(1)}" data-feature-field="${esc(f.id)}:rotation"><span class="unit">deg</span></div>
          </div>
        </div>`;
      })
      .join('');

    container.innerHTML = `
      <div class="group">
        <div class="eyebrow"><span class="n">08</span> Features</div>
        <div class="hint">Peg holes and tear notches, anchored to a face and offset from a reference edge — resize the pack and they stay put relative to that edge.</div>
        ${listRows || '<div class="hint">None placed yet.</div>'}
        <div class="field" style="margin-top:10px">
          <span class="label">Kind</span>
          <select id="feature-kind">${kindOptions}</select>
          ${topEndSealFaces.length === 0 ? '<div class="hint">Peg holes are only available on a bag\'s top end seal — this style has none.</div>' : ''}
        </div>
        <div class="field">
          <span class="label">Anchor face</span>
          <select id="feature-anchor">${faceOptions}</select>
          ${isPegHoleKind(draftKind) ? '<div class="hint">Peg holes only anchor to the top end seal.</div>' : ''}
        </div>
        <div class="field">
          <span class="label">Reference edge</span>
          <select id="feature-edge">${edgeOptions}</select>
        </div>
        <div class="row2">
          <div class="field">
            <span class="label">Offset along edge</span>
            <div class="in"><input type="number" step="0.5" id="feature-offset-x" value="${draftOffsetX}"><span class="unit">mm</span></div>
          </div>
          <div class="field">
            <span class="label">Offset inward</span>
            <div class="in"><input type="number" step="0.5" id="feature-offset-y" value="${draftOffsetY}" ${edgeLocked ? 'disabled' : ''}><span class="unit">mm</span></div>
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <span class="label">Size</span>
            <div class="in"><input type="number" step="0.5" id="feature-size-x" value="${draftSizeX}"><span class="unit">x mm</span></div>
          </div>
          <div class="field">
            <span class="label">&nbsp;</span>
            <div class="in"><input type="number" step="0.5" id="feature-size-y" value="${draftSizeY}"><span class="unit">y mm</span></div>
          </div>
        </div>
        <div class="field">
          <span class="label">Rotation</span>
          <div class="in"><input type="number" step="1" id="feature-rotation" value="${draftRotationDeg}" ${edgeLocked ? 'disabled' : ''}><span class="unit">deg</span></div>
          ${edgeLocked ? '<div class="hint">V/U notches sit flush on the reference edge — offset-in and rotation are locked so the cut always lands exactly on the boundary.</div>' : ''}
        </div>
        <button class="btn" id="feature-add">Add feature</button>
        ${error ? `<div class="msg warning">${esc(error)}</div>` : ''}
      </div>`;
  }

  container.addEventListener('change', (ev) => {
    const target = ev.target as HTMLInputElement | HTMLSelectElement;

    if (target.id === 'feature-kind') {
      draftKind = target.value as FeatureKind;
      draftSizeX = DEFAULT_SIZE[draftKind].x;
      draftSizeY = DEFAULT_SIZE[draftKind].y;
      render();
      return;
    }
    if (target.id === 'feature-anchor') { draftAnchor = target.value; return; }
    if (target.id === 'feature-edge') { draftEdge = target.value; return; }
    if (target.id === 'feature-offset-x') { draftOffsetX = Number.parseFloat(target.value) || 0; return; }
    if (target.id === 'feature-offset-y') { draftOffsetY = Number.parseFloat(target.value) || 0; return; }
    if (target.id === 'feature-size-x') { draftSizeX = Number.parseFloat(target.value) || 0; return; }
    if (target.id === 'feature-size-y') { draftSizeY = Number.parseFloat(target.value) || 0; return; }
    if (target.id === 'feature-rotation') { draftRotationDeg = Number.parseFloat(target.value) || 0; return; }

    const fieldAttr = target.getAttribute('data-feature-field');
    if (fieldAttr) {
      const [featureId, path] = fieldAttr.split(':') as [string, string];
      const value = Number.parseFloat(target.value);
      if (!Number.isFinite(value)) return;
      const derived = store.getDerived();
      const feature = derived.graph.features.find((f) => f.id === featureId);
      if (!feature) return;
      if (path === 'offset.x') store.setFeature(featureId, { offset: { x: value, y: feature.offset.y } });
      else if (path === 'offset.y') store.setFeature(featureId, { offset: { x: feature.offset.x, y: value } });
      else if (path === 'size.x') store.setFeature(featureId, { size: { x: value, y: feature.size.y } });
      else if (path === 'size.y') store.setFeature(featureId, { size: { x: feature.size.x, y: value } });
      else if (path === 'rotation') store.setFeature(featureId, { rotation: deg2rad(value) });
    }
  });

  container.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;

    const deleteId = target.getAttribute('data-delete-feature');
    if (deleteId) {
      store.deleteFeature(deleteId);
      return;
    }

    if (target.id === 'feature-add') {
      error = null;
      const derived = store.getDerived();
      if (!derived.resolved.faces.some((f) => f.role === draftAnchor)) {
        error = 'Pick an anchor face.';
        render();
        return;
      }
      const kindLocked = draftKind === 'tear_notch.v' || draftKind === 'tear_notch.u';
      store.addFeature(
        draftKind,
        draftAnchor,
        draftEdge,
        { x: draftOffsetX, y: kindLocked ? 0 : draftOffsetY },
        kindLocked ? 0 : deg2rad(draftRotationDeg),
        { x: draftSizeX, y: draftSizeY },
      );
    }
  });

  const unsubscribe = store.subscribe(render);
  render();

  return {
    destroy() {
      unsubscribe();
    },
  };
}
