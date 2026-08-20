/**
 * Builds the static preview site: `index.html` at the repo root, which is what
 * the Pages workflow serves.
 *
 *   npm run build:preview
 *
 * Every catalogue style is compiled, resolved and pre-rendered — the flat blank
 * with its dimensions and panel labels, and an isometric projection of the fold
 * transforms. Static: the tabs switch between pre-rendered styles, there is no
 * app behind it yet. It exists so the geometry and the design system can be
 * looked at before the real 2D canvas is built in step 3.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STYLES, compileStyle, proofTaperedTray } from '../src/styles/index.js';
import type { CompiledStyle, StyleDefinition } from '../src/styles/schema.js';
import { blankSize, materialArea, resolveGeometry } from '../src/geometry/resolve.js';
import { foldedFacePoints } from '../src/geometry/fold.js';
import { computeFormedShape, hasFormedShape } from '../src/geometry/formedShape.js';
import { flattenPath } from '../src/geometry/arrangement.js';
import type { GeometryGraph, ResolvedGeometry, Vec2, Vec3 } from '../src/geometry/types.js';
import { cameraBasis, paintOrder, project } from '../src/render/iso.js';
import { buildDxf } from '../src/export/dxf.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, '..');
const THEME = readFileSync(resolvePath(ROOT, 'src/ui/theme.css'), 'utf8');

const n1 = (v: number) => (Math.round(v * 10) / 10).toString();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const dataUri = (mime: string, text: string) => `data:${mime};base64,${Buffer.from(text, 'utf8').toString('base64')}`;

// The tokens the flat drawing's classes and inline styles reference via
// var(--x). A downloaded SVG is opened outside this page, with no access to
// theme.css, so its own colours travel with it rather than through a link.
const ROOT_VARS = THEME.match(/:root\s*\{[^}]*\}/)?.[0] ?? '';

/** Turn a `drawing2d()` fragment into a standalone file: real SVG namespace, own tokens. */
function standaloneSvg(svg: string): string {
  return svg
    .replace('<svg class="pane-canvas"', '<svg xmlns="http://www.w3.org/2000/svg" class="pane-canvas"')
    .replace(
      '<defs>',
      `<defs><style>${ROOT_VARS} .lbl{font-family:var(--mono),monospace;fill:var(--ink-3);text-anchor:middle;dominant-baseline:middle;letter-spacing:.04em;} .dimtext{font-family:var(--mono),monospace;font-weight:500;fill:var(--ink-2);text-anchor:middle;} .dim-ext{stroke:var(--ink-3);stroke-width:1;} .dimline{stroke:var(--l-dimension);stroke-width:1;}</style>`,
    );
}

const LINE_STYLE: Record<string, string> = {
  cut: 'stroke="var(--l-cut)" stroke-width="1.4"',
  crease: 'stroke="var(--l-crease)" stroke-width="1" stroke-dasharray="7 4"',
  perf: 'stroke="var(--l-perf)" stroke-width="1" stroke-dasharray="9 3 1.5 3"',
  score: 'stroke="var(--l-score)" stroke-width="0.8" stroke-dasharray="4 3"',
  bleed: 'stroke="var(--l-bleed)" stroke-width="0.7" stroke-dasharray="3 3"',
};

const d = (pts: { x: number; y: number }[]) =>
  `M ${pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')}`;

// ---------------------------------------------------------------------------
// 2D drawing
// ---------------------------------------------------------------------------

function drawing2d(compiled: CompiledStyle, resolved: ResolvedGeometry): string {
  const b = resolved.blankBounds!;
  const size = blankSize(resolved)!;
  // Uniform margin only — clearance for the title block is reserved in CSS,
  // where it can be a fixed pixel height rather than a guess in millimetres.
  const pad = Math.max(size.width, size.height) * 0.1;
  const w = size.width + pad * 2;
  const h = size.height + pad * 2;
  const parts: string[] = [];

  for (const f of resolved.faces) {
    const holes = f.holes.map((hole) => `${d(hole.points)} Z`).join(' ');
    parts.push(
      `<path d="${d(f.outer.points)} Z ${holes}" fill-rule="evenodd" fill="var(--board-white)" opacity="0.85"/>`,
    );
  }
  for (const line of compiled.graph.lines) {
    const pts = flattenPath(line.geometry);
    if (pts.length < 2) continue;
    parts.push(`<path d="${d(pts)}" fill="none" ${LINE_STYLE[line.type] ?? LINE_STYLE.cut}/>`);
  }

  // Labels turn to run up a narrow panel, or drop if they fit neither way.
  const fs = Math.max(size.width, size.height) * 0.016;
  const labels = resolved.faces
    .map((f) => {
      const text = f.role.replace(/_/g, ' ').toUpperCase();
      const xs = f.outer.points.map((q) => q.x);
      const ys = f.outer.points.map((q) => q.y);
      const fw = Math.max(...xs) - Math.min(...xs);
      const fh = Math.max(...ys) - Math.min(...ys);
      const est = text.length * fs * 0.62;
      const cx = f.centroid.x.toFixed(1);
      const cy = (-f.centroid.y).toFixed(1);
      const attrs = `class="lbl" style="font-size:${fs.toFixed(2)}px" x="${cx}" y="${cy}"`;
      if (est <= fw * 0.88) return `<text ${attrs}>${esc(text)}</text>`;
      if (est <= fh * 0.88) return `<text ${attrs} transform="rotate(-90 ${cx} ${cy})">${esc(text)}</text>`;
      return '';
    })
    .filter(Boolean)
    .join('\n');

  const off = Math.max(size.width, size.height) * 0.035;
  const dimY = b.min.y - off;
  const dimX = b.max.x + off;
  const dims = `
    <g>
      <line class="dim-ext" x1="${b.min.x}" y1="${b.min.y - off * 0.15}" x2="${b.min.x}" y2="${dimY - off * 0.25}"/>
      <line class="dim-ext" x1="${b.max.x}" y1="${b.min.y - off * 0.15}" x2="${b.max.x}" y2="${dimY - off * 0.25}"/>
      <line class="dimline" x1="${b.min.x}" y1="${dimY}" x2="${b.max.x}" y2="${dimY}" marker-start="url(#a)" marker-end="url(#a)"/>
      <line class="dim-ext" x1="${b.max.x + off * 0.15}" y1="${b.min.y}" x2="${dimX + off * 0.25}" y2="${b.min.y}"/>
      <line class="dim-ext" x1="${b.max.x + off * 0.15}" y1="${b.max.y}" x2="${dimX + off * 0.25}" y2="${b.max.y}"/>
      <line class="dimline" x1="${dimX}" y1="${b.min.y}" x2="${dimX}" y2="${b.max.y}" marker-start="url(#a)" marker-end="url(#a)"/>
    </g>`;

  const dfs = fs * 1.15;
  const midX = ((b.min.x + b.max.x) / 2).toFixed(1);
  const midY = (-(b.min.y + b.max.y) / 2).toFixed(1);
  return `<svg class="pane-canvas" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
  <defs>
    <marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="var(--l-dimension)" stroke-width="1.6"/>
    </marker>
  </defs>
  <g transform="translate(${pad - b.min.x} ${h - pad + b.min.y})">
    <g transform="scale(1 -1)">${parts.join('\n')}${dims}</g>
    ${labels}
    <text class="dimtext" style="font-size:${dfs.toFixed(2)}px" x="${midX}" y="${(-dimY + dfs * 1.2).toFixed(1)}">${n1(size.width)}</text>
    <text class="dimtext" style="font-size:${dfs.toFixed(2)}px" x="${(dimX + dfs * 1.2).toFixed(1)}" y="${midY}" transform="rotate(-90 ${(dimX + dfs * 1.2).toFixed(1)} ${midY})">${n1(size.height)}</text>
  </g>
</svg>`;
}

// ---------------------------------------------------------------------------
// 3D preview — isometric projection of the fold transforms
// ---------------------------------------------------------------------------

function preview3d(graph: GeometryGraph, resolved: ResolvedGeometry, ratio: number): string {
  const cam = cameraBasis(graph.upAxis);
  const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

  // A style with a declared formedShape (a bag) shows its approximated filled
  // pack, not the rigid board fold — that fold is real for a carton, but a
  // pillow bag has no rigid folded form to show.
  const folded = hasFormedShape(graph) ? computeFormedShape(graph, resolved) : foldedFacePoints(resolved, ratio);
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
  // Ply first: two faces folded to the same position are ordered by which one
  // the style declares sits on top, not by a centroid-depth coin flip between
  // coplanar shapes. Real depth only breaks ties within the same ply.
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
  const pad = Math.max(maxX - minX, maxY - minY) * 0.12;
  const sw = Math.max(maxX - minX, maxY - minY) * 0.004;
  const body = ordered
    .map(
      (f) =>
        `<path d="${d(f.pts)} Z" fill="var(--board)" fill-opacity="${(0.55 + 0.45 * f.shade).toFixed(3)}" ` +
        `stroke="var(--board-edge)" stroke-width="${sw.toFixed(3)}" stroke-linejoin="round"/>`,
    )
    .join('\n');

  return `<svg class="pane-canvas" viewBox="${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}" preserveAspectRatio="xMidYMid meet">
${body}
</svg>`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const tbrow = (k: string, v: string) => `<div class="tbrow"><div class="k">${k}</div><div class="v">${v}</div></div>`;

interface Entry {
  def: StyleDefinition;
  compiled: CompiledStyle;
  resolved: ResolvedGeometry;
  id: string;
}

// Category is a data grouping, not a hardcoded UI list — adding flow wrap or
// another FEFCO code means adding a catalogue entry with a `family`, nothing
// here.
const CATEGORY_LABEL: Record<string, string> = {
  case: 'Cases · FEFCO 02xx',
  carton: 'Cartons',
  tray: 'Trays',
  bag: 'Bags',
};

/** Pack type picker: category, then style within it. Lives in the left panel. */
function styleNav(entries: Entry[], activeId: string): string {
  const byFamily = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = byFamily.get(e.def.family);
    if (list) list.push(e);
    else byFamily.set(e.def.family, [e]);
  }
  const groups = [...byFamily.entries()]
    .map(
      ([family, list]) => `<div class="nav-group">
        <div class="nav-group-label">${esc(CATEGORY_LABEL[family] ?? family)}</div>
        ${list
          .map(
            (e) =>
              `<button class="nav-btn${e.id === activeId ? ' on' : ''}" data-view="view-${e.id}">${esc(e.def.name)}</button>`,
          )
          .join('')}
      </div>`,
    )
    .join('');
  return `<div class="nav-tree">${groups}</div>`;
}

function panelFor(compiled: CompiledStyle): string {
  const groups: Record<string, string[]> = {};
  for (const p of compiled.definition.params) {
    const v = compiled.params[p.id]!;
    (groups[p.group] ??= []).push(
      `<div class="field"><span class="label">${esc(p.label)}</span>` +
        `<div class="in"><input value="${n1(v)}" readonly><span class="unit">${p.unit ?? 'mm'}</span></div>` +
        (p.hint ? `<div class="hint">${esc(p.hint)}</div>` : '') +
        `</div>`,
    );
  }
  const titles: Record<string, string> = {
    internal: 'Internal dimensions',
    material: 'Material',
    allowance: 'Allowances',
    feature: 'Features',
  };
  return Object.entries(groups)
    .map(
      ([g, fields], i) =>
        `<div class="group"><div class="eyebrow"><span class="n">0${i + 2}</span> ${titles[g] ?? g}</div>${fields.join('')}</div>`,
    )
    .join('');
}

function section(entries: Entry[], entry: Entry, active: boolean): string {
  const { compiled, resolved, id } = entry;
  const size = blankSize(resolved)!;
  const def = compiled.definition;
  const ratio = 1;
  const formed = hasFormedShape(compiled.graph);

  const unfolded =
    resolved.unresolved.length === 0
      ? `<div class="hint">Nothing — every line resolved into the fold graph.</div>`
      : `<ul class="unfolded-list">${resolved.unresolved
          .map((u) => `<li><span class="reason">${u.reason.replace(/_/g, ' ')}</span><span>${esc(u.message)}</span></li>`)
          .join('')}</ul>`;

  const warn = compiled.warnings
    .map((w) => `<div class="msg warning">${esc(w)}</div>`)
    .join('');

  return `<section class="view${active ? ' on' : ''}" id="view-${id}">
  <aside id="panel">
    <div class="group">
      <div class="eyebrow"><span class="n">01</span> Pack type</div>
      ${styleNav(entries, id)}
      <div class="hint">${esc(def.description ?? '')}</div>
    </div>
    ${panelFor(compiled)}
    <div class="group">
      <div class="eyebrow"><span class="n">99</span> Unfolded geometry</div>
      ${unfolded}
    </div>
    <div id="messages">${warn}</div>
  </aside>

  <div id="viewport" class="viewport-2d-primary">
    <div id="pane-2d" data-primary="2d">
      <div class="pane-grid"></div>
      <span class="pane-label">Flat blank · mm</span>
      ${drawing2d(compiled, resolved)}
      <span class="scalechip">Blank ${n1(size.width)} × ${n1(size.height)} mm</span>
      <div class="titleblock">
        <div class="tbhead"><span>Dieline Studio</span><span>${esc(def.code ? `${def.standard} ${def.code}` : def.family.toUpperCase())}</span></div>
        ${tbrow('Style', esc(def.name))}
        ${tbrow('Faces', `<b>${resolved.faces.length}</b> · ${resolved.hinges.length} hinges`)}
        ${tbrow('Caliper', `${n1(compiled.graph.caliper)} mm`)}
        ${tbrow('Blank', `${n1(size.width)} × ${n1(size.height)}`)}
        ${tbrow('Board', `${Math.round(materialArea(resolved)).toLocaleString('en-GB')} mm²`)}
        ${tbrow('Seals', String(compiled.graph.seals.length))}
        ${tbrow('Scale', '1:1')}
      </div>
    </div>
    <div id="pane-3d" data-primary="3d">
      <div class="pane-grid"></div>
      <span class="pane-label">${formed ? 'Formed pack' : 'Folded'} · iso</span>
      ${preview3d(compiled.graph, resolved, ratio)}
    </div>
  </div>
</section>`;
}

const entries: Entry[] = [...STYLES, proofTaperedTray].map((def) => {
  const compiled = compileStyle(def);
  const resolved = resolveGeometry(compiled.graph);
  return { def, compiled, resolved, id: def.id.replace(/[^a-z0-9]/gi, '_') };
});

// Export formats live behind the header's Export button. DXF and SVG are
// real generators this repo already has, pre-rendered per style exactly like
// the drawings above — not a client-side re-derivation. PDF has no generator
// yet, so its menu entry stays honestly disabled rather than faked.
const EXPORTS: Record<string, { dxf: string; svg: string; filename: string }> = {};
for (const e of entries) {
  const { dxf } = buildDxf(e.compiled.graph, e.resolved, { note: `${e.def.name} — Dieline Studio preview` });
  const svg = standaloneSvg(drawing2d(e.compiled, e.resolved));
  EXPORTS[e.id] = {
    dxf: dataUri('application/dxf', dxf),
    svg: dataUri('image/svg+xml', svg),
    filename: e.id,
  };
}

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dieline Studio — geometry preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${THEME}
.lbl { font-family: var(--mono); fill: var(--ink-3); text-anchor: middle; dominant-baseline: middle; letter-spacing: .04em; }
.dimtext { font-family: var(--mono); font-weight: 500; fill: var(--ink-2); text-anchor: middle; }
.view { display: none; flex: 1; min-height: 0; }
.view.on { display: flex; }
#view-switch { display: flex; flex-wrap: wrap; gap: 2px; }
.banner { padding: 8px 20px; background: var(--warn-soft); border-bottom: 1px solid var(--warn-border);
  font-family: var(--mono); font-size: 11px; color: #7a5209; letter-spacing: .02em; }
@media (max-width: 820px) { .view.on { display: block; } }
</style>
</head>
<body>
<div id="app">
  <header id="topbar">
    <div class="brand"><h1>Dieline Studio</h1><span class="part">GEOMETRY PREVIEW</span></div>
    <div class="toolbar-group" id="view-switch">
      <button class="tbtn on" data-primary="2d">2D</button>
      <button class="tbtn" data-primary="3d">3D</button>
      <button class="tbtn" disabled title="Not built yet">Artwork</button>
      <button class="tbtn" disabled title="Not built yet">On shelf</button>
    </div>
    <div class="spacer"></div>
    <div id="export-control">
      <button class="btn" id="export-btn">Export ▾</button>
      <div class="export-menu" id="export-menu">
        <a class="export-item" id="export-dxf" download><span>DXF</span><span class="fmt">R12 · mm</span></a>
        <a class="export-item" id="export-svg" download><span>SVG</span><span class="fmt">flat blank</span></a>
        <span class="export-item disabled" title="Not built yet"><span>PDF</span><span class="fmt">soon</span></span>
      </div>
    </div>
  </header>
  <div class="banner">! Static preview — pre-rendered from the style catalogue at default parameters. The editor and live parametric re-solve are not built yet; DXF and SVG downloads below are real.</div>
  <main>
${entries.map((e, i) => section(entries, e, i === 0)).join('\n')}
  </main>
</div>
<script id="export-data" type="application/json">${JSON.stringify(EXPORTS)}</script>
<script>
(function () {
  var EXPORTS = JSON.parse(document.getElementById('export-data').textContent);
  var currentId = ${JSON.stringify(entries[0]!.id)};

  function updateExportLinks() {
    var data = EXPORTS[currentId];
    if (!data) return;
    var dxf = document.getElementById('export-dxf');
    var svg = document.getElementById('export-svg');
    dxf.href = data.dxf;
    dxf.download = data.filename + '.dxf';
    svg.href = data.svg;
    svg.download = data.filename + '.svg';
  }
  updateExportLinks();

  // Pack type: category > style, duplicated into every panel so whichever
  // style is showing can still reach every other one.
  document.body.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-view]');
    if (!btn) return;
    var viewId = btn.dataset.view;
    currentId = viewId.replace(/^view-/, '');
    for (var b of document.querySelectorAll('[data-view]')) b.classList.toggle('on', b.dataset.view === viewId);
    for (var v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === viewId);
    updateExportLinks();
  });

  // View type: header sets which pane is primary; the other stays on screen
  // as a small companion, not a mode you navigate away to.
  function setPrimary(mode) {
    for (var v of document.querySelectorAll('#viewport')) v.classList.toggle('viewport-3d-primary', mode === '3d');
    for (var b of document.querySelectorAll('#view-switch [data-primary]')) b.classList.toggle('on', b.dataset.primary === mode);
  }
  document.getElementById('view-switch').addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-primary]');
    if (!btn) return;
    setPrimary(btn.dataset.primary);
  });
  // Clicking the companion pane swaps it into primary.
  document.querySelector('main').addEventListener('click', function (ev) {
    var pane = ev.target.closest('[data-primary]');
    if (!pane) return;
    var viewport = pane.closest('#viewport');
    var isPrimary = viewport.classList.contains('viewport-3d-primary')
      ? pane.dataset.primary === '3d'
      : pane.dataset.primary === '2d';
    if (!isPrimary) setPrimary(pane.dataset.primary);
  });

  // Export dropdown.
  var exportBtn = document.getElementById('export-btn');
  var exportMenu = document.getElementById('export-menu');
  exportBtn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    exportMenu.classList.toggle('open');
  });
  document.addEventListener('click', function () {
    exportMenu.classList.remove('open');
  });
})();
</script>
</body>
</html>
`;

mkdirSync(ROOT, { recursive: true });
writeFileSync(resolvePath(ROOT, 'index.html'), page, 'utf8');
console.log(`index.html -> ${resolvePath(ROOT, 'index.html')}  (${(page.length / 1024).toFixed(0)} KB)`);
for (const e of entries) {
  const r = e.resolved;
  console.log(`  ${e.def.id.padEnd(22)} ${r.faces.length} faces, ${r.hinges.length} hinges, ${r.unresolved.length} unresolved`);
}
