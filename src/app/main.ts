/**
 * Step 3: the real 2D canvas. Entry point — mounts the editor shell and
 * wires the panel, inspector, 2D canvas and companion 3D pane to one store.
 */
import { createInitialState, Store } from './state.js';
import { mountPanel } from './panel.js';
import { mountInspector } from './inspector.js';
import { mountCanvas } from './canvas.js';
import { mountPane3D } from './pane3d.js';

function boot(): void {
  const root = document.getElementById('app');
  if (!root) return;

  root.innerHTML = `
    <header id="topbar">
      <div class="brand"><h1>Dieline Studio</h1><span class="part">EDITOR</span></div>
      <div class="spacer"></div>
    </header>
    <main>
      <aside id="panel">
        <div id="panel-body"></div>
        <div id="inspector-body"></div>
      </aside>
      <div id="viewport" class="viewport-2d-primary">
        <div id="pane-2d" data-primary="2d"></div>
        <div id="pane-3d" data-primary="3d"></div>
      </div>
    </main>`;

  const store = new Store(createInitialState());

  mountPanel(root.querySelector<HTMLElement>('#panel-body')!, store);
  mountInspector(root.querySelector<HTMLElement>('#inspector-body')!, store);
  mountCanvas(root.querySelector<HTMLElement>('#pane-2d')!, store);
  mountPane3D(root.querySelector<HTMLElement>('#pane-3d')!, store);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
