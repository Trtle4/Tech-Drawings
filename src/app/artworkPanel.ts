/**
 * Artwork round trip: export the registration-matched template, upload
 * finished art back, or drop in the one-click orientation test artwork.
 * Separate from `panel.ts` (which rebuilds its whole subtree on every store
 * change) so the DPI selector's own chosen value survives a re-render
 * caused by, say, a dimension edit elsewhere in the app.
 */
import { renderArtworkTemplate, canvasToPngBlob, downloadBlob } from '../render/artworkTemplate.js';
import { renderTestArtwork, TEST_ARTWORK_DPI } from '../render/testArtwork.js';
import type { ArtworkState, Store } from './state.js';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const DPI_OPTIONS = [150, 300, 600];

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image.'));
    img.src = dataUrl;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

function kindOfFile(file: File): 'png' | 'jpg' | 'svg' | null {
  const type = file.type;
  const name = file.name.toLowerCase();
  if (type === 'image/svg+xml' || name.endsWith('.svg')) return 'svg';
  if (type === 'image/png' || name.endsWith('.png')) return 'png';
  if (type === 'image/jpeg' || name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'jpg';
  return null;
}

export interface ArtworkPanelController {
  destroy(): void;
}

export function mountArtworkPanel(container: HTMLElement, store: Store): ArtworkPanelController {
  let dpi = 300;
  let busy = false;
  let error: string | null = null;

  function render(): void {
    const state = store.getState();
    const artwork = state.artwork;
    const bounds = store.getDerived().resolved.blankBounds;
    const pxAt = (d: number) =>
      bounds
        ? `${Math.round(((bounds.max.x - bounds.min.x) * d) / 25.4)} × ${Math.round(((bounds.max.y - bounds.min.y) * d) / 25.4)} px`
        : '—';

    container.innerHTML = `
      <div class="group">
        <div class="eyebrow"><span class="n">04</span> Artwork template</div>
        <div class="field">
          <span class="label">Export DPI</span>
          <div class="in">
            <select id="art-dpi">${DPI_OPTIONS.map((d) => `<option value="${d}"${d === dpi ? ' selected' : ''}>${d}</option>`).join('')}</select>
          </div>
          <div class="hint">${pxAt(dpi)} at ${dpi} DPI — exactly the flat blank's own bounds, no margin.</div>
        </div>
        <div class="field">
          <button class="btn" id="art-export-guided" ${bounds ? '' : 'disabled'}>Export guided (dieline) PNG</button>
        </div>
        <div class="field">
          <button class="btn" id="art-export-blank" ${bounds ? '' : 'disabled'}>Export blank (transparent) PNG</button>
          <div class="hint">Design on the guided file as reference; build the actual artwork on the blank one, so the guides never end up in it.</div>
        </div>
      </div>
      <div class="group">
        <div class="eyebrow"><span class="n">05</span> Apply artwork</div>
        <div class="field">
          <span class="label">Upload (PNG, JPG or SVG)</span>
          <input type="file" id="art-upload" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml" ${bounds ? '' : 'disabled'}>
        </div>
        <div class="field">
          <button class="btn" id="art-test" ${bounds ? '' : 'disabled'}>Apply test artwork (orientation check)</button>
          <div class="hint">Fills every panel with a big "F" and its own role name — every panel should read forward and upright on the formed pack.</div>
        </div>
        ${
          artwork
            ? `<div class="field">
                <span class="label">Current</span>
                <div class="hint">${esc(artwork.name)}</div>
                <button class="btn" id="art-remove" style="margin-top:6px">Remove artwork</button>
              </div>`
            : ''
        }
        ${error ? `<div class="msg warning">${esc(error)}</div>` : ''}
        ${busy ? `<div class="hint">Working…</div>` : ''}
      </div>`;
  }

  async function applyArtwork(kind: ArtworkState['kind'], name: string, dataUrl: string): Promise<void> {
    busy = true;
    error = null;
    render();
    try {
      const image = await loadImage(dataUrl);
      store.setArtwork({ kind, name, dataUrl, image });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      render();
    }
  }

  container.addEventListener('change', (ev) => {
    const target = ev.target as HTMLElement;
    if (target.id === 'art-dpi') {
      dpi = Number.parseInt((target as HTMLSelectElement).value, 10) || dpi;
      render();
      return;
    }
    if (target.id === 'art-upload') {
      const input = target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      const kind = kindOfFile(file);
      if (!kind) {
        error = `"${file.name}" is not a PNG, JPG or SVG.`;
        render();
        return;
      }
      readFileAsDataUrl(file)
        .then((dataUrl) => applyArtwork(kind, file.name, dataUrl))
        .catch((e) => {
          error = e instanceof Error ? e.message : String(e);
          render();
        });
    }
  });

  container.addEventListener('click', (ev) => {
    const id = (ev.target as HTMLElement).id;
    const { graph, resolved } = store.getDerived();

    if (id === 'art-export-guided' || id === 'art-export-blank') {
      const guided = id === 'art-export-guided';
      const { canvas } = renderArtworkTemplate(graph, resolved, dpi, guided);
      const styleId = store.getState().styleId;
      canvasToPngBlob(canvas)
        .then((blob) => downloadBlob(blob, `${styleId}-artwork-${guided ? 'guided' : 'blank'}-${dpi}dpi.png`))
        .catch((e) => {
          error = e instanceof Error ? e.message : String(e);
          render();
        });
      return;
    }

    if (id === 'art-test') {
      const { canvas } = renderTestArtwork(resolved, TEST_ARTWORK_DPI);
      // A data URL, not a blob: URL — this canvas is small (test-artwork
      // DPI, not an export DPI), and a plain string needs no revocation.
      applyArtwork('test', 'Test artwork (F + panel roles)', canvas.toDataURL('image/png'));
      return;
    }

    if (id === 'art-remove') {
      store.clearArtwork();
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
