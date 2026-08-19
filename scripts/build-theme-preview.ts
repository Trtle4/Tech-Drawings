/**
 * Builds a self-contained preview of the app chrome on the shared design
 * system, using real compiled geometry rather than mock content.
 *
 *   npm run demo:theme   ->   out/theme-preview.html
 *
 * This is the step-3 layout skeleton: header, control column, split viewport
 * with the 2D drawing and a folded 3D preview, floating toolbar, title block.
 * The 3D pane is a plain isometric projection of the fold transforms — enough
 * to prove the layout and the palette before three.js arrives in step 4.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileStyle, fefco0201 } from '../src/styles/index.js';
import { blankSize, materialArea, resolveGeometry } from '../src/geometry/resolve.js';
import { foldedFacePoints } from '../src/geometry/fold.js';
import { flattenPath } from '../src/geometry/arrangement.js';
import type { ResolvedGeometry, Vec2, Vec3 } from '../src/geometry/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolvePath(HERE, '../out');
const THEME = readFileSync(resolvePath(HERE, '../src/ui/theme.css'), 'utf8');

// Fully folded. Part-folded reads as a tangle on an RSC, because all eight
// flaps swing through each other on the way in.
const FOLD_RATIO = 1;
const compiled = compileStyle(fefco0201);
const resolved = resolveGeometry(compiled.graph);
const P = compiled.params;
const size = blankSize(resolved)!;

const n1 = (v: number) => (Math.round(v * 10) / 10).toString();

// ---------------------------------------------------------------------------
// 2D drawing pane
// ---------------------------------------------------------------------------

const LINE_STYLE: Record<string, string> = {
  cut: 'stroke="var(--l-cut)" stroke-width="1.4"',
  crease: 'stroke="var(--l-crease)" stroke-width="1" stroke-dasharray="7 4"',
  perf: 'stroke="var(--l-perf)" stroke-width="1" stroke-dasharray="9 3 1.5 3"',
  score: 'stroke="var(--l-score)" stroke-width="0.8" stroke-dasharray="4 3"',
  bleed: 'stroke="var(--l-bleed)" stroke-width="0.7" stroke-dasharray="3 3"',
};

const d = (pts: Vec2[]) => `M ${pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')}`;

function drawing2d(): string {
  const b = resolved.blankBounds!;
  const pad = 56;
  // Extra room bottom-right so the floating title block and the scale chip sit
  // over empty paper rather than over the blank.
  const padBottom = size.height * 0.55;
  const padRight = size.width * 0.06;
  const w = size.width + pad * 2 + padRight;
  const h = size.height + pad * 2 + padBottom;
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

  // Panel labels, drawn upright in a y-down group. A label wider than its own
  // panel turns to run up the panel instead; if it does not fit either way the
  // panel goes unlabelled rather than spilling over its neighbours.
  const labels = resolved.faces
    .map((f) => {
      const text = f.role.replace(/_/g, ' ').toUpperCase();
      const xs = f.outer.points.map((q) => q.x);
      const ys = f.outer.points.map((q) => q.y);
      const fw = Math.max(...xs) - Math.min(...xs);
      const fh = Math.max(...ys) - Math.min(...ys);
      const est = text.length * 6.6; // ~11px mono at 0.6 em advance
      const cx = f.centroid.x.toFixed(1);
      const cy = (-f.centroid.y).toFixed(1);
      if (est <= fw * 0.88) return `<text class="lbl" x="${cx}" y="${cy}">${text}</text>`;
      if (est <= fh * 0.88) {
        return `<text class="lbl" x="${cx}" y="${cy}" transform="rotate(-90 ${cx} ${cy})">${text}</text>`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');

  // Overall blank dimensions, with witness lines and arrowheads.
  const dimY = b.min.y - 26;
  const dimX = b.max.x + 26;
  const dims = `
    <g class="dimgroup">
      <line class="dim-ext" x1="${b.min.x}" y1="${b.min.y - 4}" x2="${b.min.x}" y2="${dimY - 6}"/>
      <line class="dim-ext" x1="${b.max.x}" y1="${b.min.y - 4}" x2="${b.max.x}" y2="${dimY - 6}"/>
      <line class="dimline" x1="${b.min.x}" y1="${dimY}" x2="${b.max.x}" y2="${dimY}" marker-start="url(#a)" marker-end="url(#a)"/>
      <line class="dim-ext" x1="${b.max.x + 4}" y1="${b.min.y}" x2="${dimX + 6}" y2="${b.min.y}"/>
      <line class="dim-ext" x1="${b.max.x + 4}" y1="${b.max.y}" x2="${dimX + 6}" y2="${b.max.y}"/>
      <line class="dimline" x1="${dimX}" y1="${b.min.y}" x2="${dimX}" y2="${b.max.y}" marker-start="url(#a)" marker-end="url(#a)"/>
    </g>`;

  return `<svg class="pane-canvas" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMin meet">
  <defs>
    <marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="var(--l-dimension)" stroke-width="1.6"/>
    </marker>
  </defs>
  <g transform="translate(${pad - b.min.x} ${h - pad + b.min.y})">
    <g transform="scale(1 -1)">${parts.join('\n')}${dims}</g>
    ${labels}
    <text class="dimtext" x="${((b.min.x + b.max.x) / 2).toFixed(1)}" y="${(-dimY + 14).toFixed(1)}">${n1(size.width)}</text>
    <text class="dimtext" x="${(dimX + 14).toFixed(1)}" y="${(-(b.min.y + b.max.y) / 2).toFixed(1)}" transform="rotate(-90 ${(dimX + 14).toFixed(1)} ${(-(b.min.y + b.max.y) / 2).toFixed(1)})">${n1(size.height)}</text>
  </g>
</svg>`;
}

// ---------------------------------------------------------------------------
// 3D pane — isometric projection of the fold transforms, painter's algorithm
// ---------------------------------------------------------------------------

function preview3d(ratio: number): string {
  const AZ = (48 * Math.PI) / 180;
  const EL = (26 * Math.PI) / 180;
  const right = { x: -Math.sin(AZ), y: Math.cos(AZ), z: 0 };
  const up = { x: -Math.cos(AZ) * Math.sin(EL), y: -Math.sin(AZ) * Math.sin(EL), z: Math.cos(EL) };
  const fwd = { x: Math.cos(AZ) * Math.cos(EL), y: Math.sin(AZ) * Math.cos(EL), z: Math.sin(EL) };
  const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
  const project = (p: Vec3) => ({ x: dot(p, right), y: -dot(p, up), depth: dot(p, fwd) });

  const folded = foldedFacePoints(resolved, ratio);
  const faces: { pts: { x: number; y: number }[]; depth: number; shade: number }[] = [];

  for (const { points } of folded.values()) {
    if (points.length < 3) continue;
    const proj = points.map(project);
    const depth = proj.reduce((s, q) => s + q.depth, 0) / proj.length;

    // Newell normal, for a flat diffuse shade.
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
    const shade = Math.abs(dot({ x: nx / len, y: ny / len, z: nz / len }, fwd));
    faces.push({ pts: proj.map((q) => ({ x: q.x, y: q.y })), depth, shade });
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
  const pad = 40;
  const body = faces
    .map((f) => {
      // 0.55 .. 1.0 of the board tone, so folds read without becoming a rainbow.
      const light = 0.55 + 0.45 * f.shade;
      return (
        `<path d="${d(f.pts)} Z" fill="var(--board)" fill-opacity="${light.toFixed(3)}" ` +
        `stroke="var(--board-edge)" stroke-width="0.9" stroke-linejoin="round"/>`
      );
    })
    .join('\n');

  return `<svg class="pane-canvas" viewBox="${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}" preserveAspectRatio="xMidYMid meet">
${body}
</svg>`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const field = (label: string, value: string, unit: string, hint?: string) => `
  <div class="field">
    <span class="label">${label}</span>
    <div class="in"><input value="${value}" readonly><span class="unit">${unit}</span></div>
    ${hint ? `<div class="hint">${hint}</div>` : ''}
  </div>`;

const tbrow = (k: string, v: string) => `<div class="tbrow"><div class="k">${k}</div><div class="v">${v}</div></div>`;

const unfolded = (r: ResolvedGeometry) =>
  r.unresolved.length === 0
    ? `<div class="hint">Nothing — every line resolved into the fold graph.</div>`
    : `<ul class="unfolded-list">${r.unresolved
        .map((u) => `<li><span class="reason">${u.reason.replace(/_/g, ' ')}</span><span>${u.message}</span></li>`)
        .join('')}</ul>`;

const page = `<title>Dieline Studio</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${THEME}
/* preview-only: SVG text classes the real canvas will own */
.lbl { font-family: var(--mono); font-size: 11px; fill: var(--ink-3); text-anchor: middle; dominant-baseline: middle; letter-spacing: .04em; }
.dimtext { font-family: var(--mono); font-size: 13px; font-weight: 500; fill: var(--ink-2); text-anchor: middle; }
.preview-note { padding: 10px 20px 0; font-family: var(--mono); font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); }
</style>

<div id="app">
  <header id="topbar">
    <div class="brand">
      <h1>Dieline Studio</h1>
      <span class="part">FEFCO 0201 · REV A</span>
    </div>
    <div class="spacer"></div>
    <div id="build-status"><span class="dot"></span>Resolved · 13 faces · 12 hinges</div>
    <div id="export-control">
      <div class="seg">
        <button class="seg-btn on">DXF</button>
        <button class="seg-btn">SVG</button>
        <button class="seg-btn">PDF</button>
      </div>
      <button class="btn primary"><span class="ic">↧</span>Export</button>
    </div>
  </header>

  <main>
    <aside id="panel">
      <div class="preview-note">Design system preview · real compiled geometry</div>

      <div class="group">
        <div class="eyebrow"><span class="n">01</span> Style</div>
        <div class="field">
          <span class="label">Structure</span>
          <select><option>FEFCO 0201 — Regular Slotted Case</option></select>
          <div class="hint">${fefco0201.description}</div>
        </div>
      </div>

      <div class="group">
        <div class="eyebrow"><span class="n">02</span> Internal dimensions</div>
        <div class="row2">
          ${field('Length', n1(P.L!), 'mm')}
          ${field('Width', n1(P.W!), 'mm')}
        </div>
        ${field('Height', n1(P.H!), 'mm')}
      </div>

      <div class="group">
        <div class="eyebrow"><span class="n">03</span> Material</div>
        ${field('Board caliper', n1(P.caliper!), 'mm', 'Also the slot width.')}
      </div>

      <div class="group">
        <div class="eyebrow"><span class="n">04</span> Allowances</div>
        ${field('Glue flap', n1(P.glueFlap!), 'mm', 'Manufacturer’s joint.')}
        <div class="row2">
          ${field('Flap depth', n1(P.flap!), 'mm')}
          ${field('Slot width', n1(P.slot!), 'mm')}
        </div>
      </div>

      <div class="group">
        <div class="eyebrow"><span class="n">05</span> Unfolded geometry</div>
        ${unfolded(resolved)}
      </div>

      <div id="messages">
        <div class="msg warning">Flap depth is W/2, so outer flaps meet exactly. Any wider and they overlap.</div>
      </div>
    </aside>

    <section id="viewport">
      <div id="pane-2d">
        <div class="pane-grid"></div>
        <span class="pane-label">Flat blank · 1:1 · mm</span>
        ${drawing2d()}
        <div class="viewport-toolbar">
          <div class="toolbar-group">
            <button class="tbtn on">Cut</button>
            <button class="tbtn on">Crease</button>
            <button class="tbtn">Bleed</button>
          </div>
          <div class="toolbar-group">
            <button class="tbtn on">Dims</button>
            <button class="tbtn on">Labels</button>
          </div>
          <div class="toolbar-group">
            <button class="tbtn icon">⊞</button>
            <button class="tbtn icon">⤢</button>
          </div>
        </div>
        <span class="scalechip">Blank ${n1(size.width)} × ${n1(size.height)} mm</span>
        <div class="titleblock">
          <div class="tbhead"><span>Dieline Studio</span><span>FEFCO 0201</span></div>
          ${tbrow('Style', 'Regular Slotted Case')}
          ${tbrow('Internal', `<b>${n1(P.L!)} × ${n1(P.W!)} × ${n1(P.H!)}</b>`)}
          ${tbrow('Caliper', `${n1(P.caliper!)} mm`)}
          ${tbrow('Blank', `${n1(size.width)} × ${n1(size.height)}`)}
          ${tbrow('Board', `${Math.round(materialArea(resolved)).toLocaleString('en-GB')} mm²`)}
          ${tbrow('Scale', '1:1')}
          ${tbrow('Date', new Date().toISOString().slice(0, 10))}
          ${tbrow('Note', '<input value="Sample — not for production" readonly>')}
        </div>
      </div>

      <div id="pane-3d">
        <div class="pane-grid"></div>
        <span class="pane-label">Folded · ${Math.round(FOLD_RATIO * 100)}% · iso</span>
        ${preview3d(FOLD_RATIO)}
        <div class="viewport-toolbar">
          <div class="toolbar-group">
            <button class="tbtn on">Board</button>
            <button class="tbtn">Artwork</button>
          </div>
          <div class="toolbar-group">
            <input class="fold-slider" type="range" min="0" max="100" value="${Math.round(FOLD_RATIO * 100)}" readonly>
          </div>
        </div>
      </div>
    </section>
  </main>
</div>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolvePath(OUT_DIR, 'theme-preview.html'), page, 'utf8');
console.log(`theme preview -> ${resolvePath(OUT_DIR, 'theme-preview.html')}`);
console.log(`  ${resolved.faces.length} faces, ${resolved.hinges.length} hinges, fold ${FOLD_RATIO}`);
