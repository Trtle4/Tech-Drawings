/**
 * Export the 2D drawing itself — a reviewable PNG (lines, face labels,
 * overall dimensions) or a cutting-table DXF (built once, already used by
 * the CLI export script and the static gallery; this just wires the same
 * `buildDxf` into the live app with a download button).
 */
import { buildDxf } from '../export/dxf.js';
import { canvasToPngBlob, downloadBlob } from '../render/artworkTemplate.js';
import { renderDrawing2D } from '../render/drawing2dExport.js';
import type { Store } from './state.js';

export interface ExportPanelController {
  destroy(): void;
}

export function mountExportPanel(container: HTMLElement, store: Store): ExportPanelController {
  let error: string | null = null;

  function render(): void {
    const bounds = store.getDerived().resolved.blankBounds;
    container.innerHTML = `
      <div class="group">
        <div class="eyebrow"><span class="n">06</span> Export drawing</div>
        <div class="field">
          <button class="btn" id="export-png" ${bounds ? '' : 'disabled'}>Export PNG (lines + dimensions)</button>
        </div>
        <div class="field">
          <button class="btn" id="export-dxf" ${bounds ? '' : 'disabled'}>Export DXF (cutting table)</button>
        </div>
        ${error ? `<div class="msg warning">${error.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)}</div>` : ''}
      </div>`;
  }

  container.addEventListener('click', (ev) => {
    const id = (ev.target as HTMLElement).id;
    if (id !== 'export-png' && id !== 'export-dxf') return;
    const { graph, resolved } = store.getDerived();
    const styleId = store.getState().styleId;
    error = null;

    try {
      if (id === 'export-png') {
        const { canvas } = renderDrawing2D(graph, resolved, store.getState().unit);
        canvasToPngBlob(canvas)
          .then((blob) => downloadBlob(blob, `${styleId}-drawing.png`))
          .catch((e) => {
            error = e instanceof Error ? e.message : String(e);
            render();
          });
      } else {
        const { dxf } = buildDxf(graph, resolved, { note: 'Dieline Studio export' });
        downloadBlob(new Blob([dxf], { type: 'application/dxf' }), `${styleId}.dxf`);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      render();
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
