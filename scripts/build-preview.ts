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
import type { CompiledStyle } from '../src/styles/schema.js';
import { blankSize, materialArea, resolveGeometry } from '../src/geometry/resolve.js';
import { foldedFacePoints } from '../src/geometry/fold.js';
import { flattenPath } from '../src/geometry/arrangement.js';
import type { ResolvedGeometry, Vec2, Vec3 } from '../src/geometry/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, '..');
const THEME = readFileSync(resolvePath(ROOT, 'src/ui/theme.css'), 'utf8');

const n1 = (v: number) => (Math.round(v * 10) / 10).toString();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

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

function preview3d(resolved: ResolvedGeometry, ratio: number): string {
  const AZ = (48 * Math.PI) / 180;
  const EL = (26 * Math.PI) / 180;
  const right = { x: -Math.sin(AZ), y: Math.cos(AZ), z: 0 };
  const up = { x: -Math.cos(AZ) * Math.sin(EL), y: -Math.sin(AZ) * Math.sin(EL), z: Math.cos(EL) };
  const fwd = { x: Math.cos(AZ) * Math.cos(EL), y: Math.sin(AZ) * Math.cos(EL), z: Math.sin(EL) };
  const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
  const project = (p: Vec3) => ({ x: dot(p, right), y: -dot(p, up), depth: dot(p, fwd) });

  const folded = foldedFacePoints(resolved, ratio);
  const faces: { pts: Vec2[]; depth: number; shade: number }[] = [];

  for (const { points } of folded.values()) {
    if (points.length < 3) continue;
    const proj = points.map(project);
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
      shade: Math.abs(dot({ x: nx / len, y: ny / len, z: nz / len }, fwd)),
    });
  }
  faces.sort((a, b) => a.depth - b.depth);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of faces) {
    for (const q of f.pts) {
      minX = Math.min(minX, q.x);
      minY = Math.min(minY, q.y);
      maxX = Math.max(maxX, q.x);
      maxY = Math.max(maxY, q.y);
    }
  }
  const pad = Math.max(maxX - minX, maxY - minY) * 0.12;
  const sw = Math.max(maxX - minX, maxY - minY) * 0.004;
  const body = faces
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

function section(compiled: CompiledStyle, id: string, active: boolean): string {
  const resolved = resolveGeometry(compiled.graph);
  const size = blankSize(resolved)!;
  const def = compiled.definition;
  const ratio = def.family === 'tray' ? 1 : 1;

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
      <div class="eyebrow"><span class="n">01</span> Style</div>
      <div class="field"><span class="label">Structure</span>
        <select><option>${esc(def.name)}${def.code ? ` — ${def.standard} ${def.code}` : ''}</option></select>
        <div class="hint">${esc(def.description ?? '')}</div>
      </div>
    </div>
    ${panelFor(compiled)}
    <div class="group">
      <div class="eyebrow"><span class="n">99</span> Unfolded geometry</div>
      ${unfolded}
    </div>
    <div id="messages">${warn}</div>
  </aside>

  <div id="viewport">
    <div id="pane-2d">
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
    <div id="pane-3d">
      <div class="pane-grid"></div>
      <span class="pane-label">Folded · ${Math.round(ratio * 100)}% · iso</span>
      ${preview3d(resolved, ratio)}
    </div>
  </div>
</section>`;
}

const entries = [...STYLES, proofTaperedTray].map((def) => {
  const compiled = compileStyle(def);
  return { def, compiled, id: def.id.replace(/[^a-z0-9]/gi, '_') };
});

const tabs = entries
  .map(
    (e, i) =>
      `<button class="tbtn${i === 0 ? ' on' : ''}" data-view="view-${e.id}">${esc(e.def.name)}</button>`,
  )
  .join('');

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
#style-tabs { display: flex; flex-wrap: wrap; gap: 2px; }
.banner { padding: 8px 20px; background: var(--warn-soft); border-bottom: 1px solid var(--warn-border);
  font-family: var(--mono); font-size: 11px; color: #7a5209; letter-spacing: .02em; }
@media (max-width: 820px) { .view.on { display: block; } }
</style>
</head>
<body>
<div id="app">
  <header id="topbar">
    <div class="brand"><h1>Dieline Studio</h1><span class="part">GEOMETRY PREVIEW</span></div>
    <div class="spacer"></div>
    <div id="style-tabs">${tabs}</div>
  </header>
  <div class="banner">! Static preview — pre-rendered from the style catalogue at default parameters. The editor, live 3D and exports are not built yet.</div>
  <main>
${entries.map((e, i) => section(e.compiled, e.id, i === 0)).join('\n')}
  </main>
</div>
<script>
document.getElementById('style-tabs').addEventListener('click', function (ev) {
  var btn = ev.target.closest('[data-view]');
  if (!btn) return;
  for (var b of this.querySelectorAll('[data-view]')) b.classList.toggle('on', b === btn);
  for (var v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === btn.dataset.view);
});
</script>
</body>
</html>
`;

mkdirSync(ROOT, { recursive: true });
writeFileSync(resolvePath(ROOT, 'index.html'), page, 'utf8');
console.log(`index.html -> ${resolvePath(ROOT, 'index.html')}  (${(page.length / 1024).toFixed(0)} KB)`);
for (const e of entries) {
  const r = resolveGeometry(e.compiled.graph);
  console.log(`  ${e.def.id.padEnd(22)} ${r.faces.length} faces, ${r.hinges.length} hinges, ${r.unresolved.length} unresolved`);
}
