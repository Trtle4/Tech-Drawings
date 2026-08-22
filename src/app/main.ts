/**
 * Step 3: the real 2D canvas. Entry point — mounts the editor shell and
 * wires the panel, inspector, 2D canvas and companion 3D pane to one store.
 */
import { createInitialState, Store } from './state.js';
import { mountPanel } from './panel.js';
import { mountInspector } from './inspector.js';
import { mountFlapPanel } from './flapPanel.js';
import { mountArtworkPanel } from './artworkPanel.js';
import { mountExportPanel } from './exportPanel.js';
import { mountCanvas } from './canvas.js';
import { mountPane3D } from './pane3d.js';

function boot(): void {
  const root = document.getElementById('app');
  if (!root) return;

  root.innerHTML = `
    <header id="topbar">
      <div class="brand"><h1>Dieline Studio</h1><span class="part">EDITOR</span></div>
      <div class="toolbar-group" id="history-controls">
        <button class="tbtn icon" id="btn-undo" title="Undo (Ctrl+Z)">↶</button>
        <button class="tbtn icon" id="btn-redo" title="Redo (Ctrl+Shift+Z)">↷</button>
      </div>
      <div class="spacer"></div>
      <button class="btn" id="btn-revert-all" title="Undo every edit in the drawing; dimensions are left alone">Revert all</button>
    </header>
    <main>
      <aside id="panel">
        <div id="panel-body"></div>
        <div id="inspector-body"></div>
        <div id="flap-body"></div>
        <div id="artwork-body"></div>
        <div id="export-body"></div>
      </aside>
      <div id="viewport" class="viewport-2d-primary">
        <div id="pane-2d" data-primary="2d"></div>
        <div id="pane-3d" data-primary="3d"></div>
      </div>
    </main>`;

  const store = new Store(createInitialState());

  mountPanel(root.querySelector<HTMLElement>('#panel-body')!, store);
  mountInspector(root.querySelector<HTMLElement>('#inspector-body')!, store);
  mountFlapPanel(root.querySelector<HTMLElement>('#flap-body')!, store);
  mountArtworkPanel(root.querySelector<HTMLElement>('#artwork-body')!, store);
  mountExportPanel(root.querySelector<HTMLElement>('#export-body')!, store);
  mountCanvas(root.querySelector<HTMLElement>('#pane-2d')!, store);
  mountPane3D(root.querySelector<HTMLElement>('#pane-3d')!, store);
  mountHistoryControls(root, store);
}

/**
 * Undo/redo and revert-all live in the header, not tucked into a panel —
 * without them an edit is a one-way door, which defeats the point of an
 * editor you're supposed to explore freely in.
 */
function mountHistoryControls(root: HTMLElement, store: Store): void {
  const undoBtn = root.querySelector<HTMLButtonElement>('#btn-undo')!;
  const redoBtn = root.querySelector<HTMLButtonElement>('#btn-redo')!;
  const revertAllBtn = root.querySelector<HTMLButtonElement>('#btn-revert-all')!;

  function render(): void {
    undoBtn.disabled = !store.canUndo();
    redoBtn.disabled = !store.canRedo();
    revertAllBtn.disabled = store.getState().ops.length === 0;
  }

  undoBtn.addEventListener('click', () => store.undo());
  redoBtn.addEventListener('click', () => store.redo());
  revertAllBtn.addEventListener('click', () => store.revertAll());

  window.addEventListener('keydown', (ev) => {
    const active = document.activeElement;
    const typing = active instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName);
    if (typing) return;
    const mod = ev.metaKey || ev.ctrlKey;
    if (!mod) return;
    const key = ev.key.toLowerCase();
    if (key === 'z' && !ev.shiftKey) {
      ev.preventDefault();
      store.undo();
    } else if ((key === 'z' && ev.shiftKey) || key === 'y') {
      ev.preventDefault();
      store.redo();
    }
  });

  store.subscribe(render);
  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
