/**
 * Left panel: pack type (category > style) and the live dimension inputs.
 *
 * Committing a value (Enter, tab away, or a spin-button click — the `change`
 * event, not every keystroke) pushes it through `store.setParam`, which
 * recompiles the base graph and replays every stored edit on top. Rendering
 * on `input` instead would rebuild this panel's own DOM mid-keystroke and
 * steal focus out from under the user, so this module deliberately waits for
 * `change`.
 */
import { evalExpr } from '../styles/expr.js';
import { STYLES } from '../styles/index.js';
import type { StyleDefinition } from '../styles/schema.js';
import type { Store } from './state.js';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

const CATEGORY_LABEL: Record<string, string> = {
  case: 'Cases · FEFCO 02xx',
  carton: 'Cartons',
  tray: 'Trays',
  bag: 'Bags',
};

const GROUP_LABEL: Record<string, string> = {
  internal: 'Internal dimensions',
  material: 'Material',
  allowance: 'Allowances',
  feature: 'Features',
};

function styleNavHtml(activeId: string): string {
  const byFamily = new Map<string, StyleDefinition[]>();
  for (const def of STYLES) {
    const list = byFamily.get(def.family);
    if (list) list.push(def);
    else byFamily.set(def.family, [def]);
  }
  return `<div class="nav-tree">${[...byFamily.entries()]
    .map(
      ([family, list]) => `<div class="nav-group">
        <div class="nav-group-label">${esc(CATEGORY_LABEL[family] ?? family)}</div>
        ${list
          .map((def) => `<button class="nav-btn${def.id === activeId ? ' on' : ''}" data-style="${def.id}">${esc(def.name)}</button>`)
          .join('')}
      </div>`,
    )
    .join('')}</div>`;
}

export interface PanelController {
  destroy(): void;
}

export function mountPanel(container: HTMLElement, store: Store): PanelController {
  function render(): void {
    const derived = store.getDerived();
    const state = store.getState();
    const def = derived.def;
    const scope = derived.compiledParams;

    const groups: Record<string, string[]> = {};
    for (const p of def.params) {
      const value = derived.compiledParams[p.id] ?? 0;
      const min = p.min !== undefined ? evalExpr(p.min, scope) : undefined;
      const max = p.max !== undefined ? evalExpr(p.max, scope) : undefined;
      const step = p.step ?? 0.1;
      (groups[p.group] ??= []).push(`
        <div class="field">
          <span class="label">${esc(p.label)}</span>
          <div class="in">
            <input type="number" data-param="${p.id}" value="${n2(value)}" step="${step}"
              ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''}>
            <span class="unit">${esc(p.unit ?? 'mm')}</span>
          </div>
          ${p.hint ? `<div class="hint">${esc(p.hint)}</div>` : ''}
        </div>`);
    }
    const paramGroupsHtml = Object.entries(groups)
      .map(([g, fields], i) => `<div class="group"><div class="eyebrow"><span class="n">0${i + 2}</span> ${GROUP_LABEL[g] ?? g}</div>${fields.join('')}</div>`)
      .join('');

    const unresolved = derived.resolved.unresolved;
    const unfoldedHtml =
      unresolved.length === 0
        ? `<div class="hint">Nothing — every line resolved into the fold graph.</div>`
        : `<ul class="unfolded-list">${unresolved.map((u) => `<li><span class="reason">${u.reason.replace(/_/g, ' ')}</span><span>${esc(u.message)}</span></li>`).join('')}</ul>`;

    const warningsHtml = derived.warnings.map((w) => `<div class="msg warning">${esc(w)}</div>`).join('');

    container.innerHTML = `
      <div class="group">
        <div class="eyebrow"><span class="n">01</span> Pack type</div>
        ${styleNavHtml(state.styleId)}
        <div class="hint">${esc(def.description ?? '')}</div>
      </div>
      ${paramGroupsHtml}
      <div class="group">
        <div class="eyebrow"><span class="n">99</span> Unfolded geometry</div>
        ${unfoldedHtml}
      </div>
      <div id="messages">${warningsHtml}</div>`;
  }

  container.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-style]');
    if (!btn) return;
    store.setStyle(btn.dataset.style!);
  });

  container.addEventListener('change', (ev) => {
    const input = ev.target as HTMLInputElement;
    if (input.tagName !== 'INPUT' || !input.dataset.param) return;
    const value = Number.parseFloat(input.value);
    if (Number.isFinite(value)) store.setParam(input.dataset.param, value);
  });

  const unsubscribe = store.subscribe(render);
  render();

  return {
    destroy() {
      unsubscribe();
    },
  };
}
