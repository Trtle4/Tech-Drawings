/**
 * Prints the face detection result for each test blank, and drops an SVG of
 * each one next to it so the topology can be eyeballed rather than trusted.
 *
 *   npm run demo:faces
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIXTURES } from '../src/geometry/fixtures.js';
import { blankSize, materialArea, resolveGeometry } from '../src/geometry/resolve.js';
import { foldedFacePoints } from '../src/geometry/fold.js';
import type { GeometryGraph, ResolvedGeometry } from '../src/geometry/types.js';
import { flattenPath } from '../src/geometry/arrangement.js';

const OUT_DIR = resolvePath(dirname(fileURLToPath(import.meta.url)), '../out');

const deg = (r: number) => `${((r * 180) / Math.PI).toFixed(0)}°`;
const mm2 = (a: number) => `${a.toFixed(1)} mm²`;

function report(name: string, graph: GeometryGraph, resolved: ResolvedGeometry): void {
  const size = blankSize(resolved);
  console.log(`\n${'━'.repeat(72)}`);
  console.log(`  ${name}`);
  console.log('━'.repeat(72));
  console.log(
    `  lines ${graph.lines.length}   faces ${resolved.faces.length}   hinges ${resolved.hinges.length}` +
      `   caliper ${graph.caliper} mm`,
  );
  if (size) {
    console.log(
      `  blank ${size.width.toFixed(1)} × ${size.height.toFixed(1)} mm   board ${mm2(materialArea(resolved))}`,
    );
  }

  console.log('\n  FACES');
  for (const f of resolved.faces) {
    const holes = f.holes.length ? `  ${f.holes.length} hole(s)` : '';
    console.log(
      `    ${f.id.padEnd(10)} ${f.role.padEnd(22)} ${mm2(f.area).padStart(12)}` +
        `  ${f.outer.points.length} verts${holes}`,
    );
  }

  console.log('\n  HINGES');
  if (resolved.hinges.length === 0) console.log('    (none)');
  for (const h of resolved.hinges) {
    const flag = h.collinear ? '' : '   ⚠ not straight';
    console.log(
      `    ${h.id.padEnd(9)} ${h.faceA} ↔ ${h.faceB}`.padEnd(40) +
        ` ${h.lineType.padEnd(7)} ${deg(h.angle).padStart(5)}${flag}`,
    );
  }

  const tree = resolved.foldTree;
  console.log('\n  FOLD TREE');
  if (!tree) {
    console.log('    (no faces to fold)');
  } else {
    console.log(`    base ${tree.rootFaceId}`);
    for (const id of tree.order) {
      const depth = depthOf(tree.parent, id);
      const via = tree.parentHinge.get(id);
      console.log(`    ${'  '.repeat(depth + 1)}${id}${via ? `  via ${via}` : '  (base)'}`);
    }
    if (tree.closingHinges.length) {
      console.log(`    closing hinges (loops, not folded): ${tree.closingHinges.join(', ')}`);
    }
  }

  console.log('\n  UNFOLDED GEOMETRY');
  if (resolved.unresolved.length === 0) {
    console.log('    (nothing — everything resolved)');
  }
  for (const u of resolved.unresolved) {
    console.log(`    [${u.reason}] ${u.message}`);
  }
}

function depthOf(parent: Map<string, string>, id: string): number {
  let d = 0;
  let cur = id;
  while (parent.has(cur)) {
    cur = parent.get(cur)!;
    d++;
  }
  return d;
}

const FACE_FILL = [
  '#c9d6e3',
  '#d8ccbc',
  '#c4d3c8',
  '#ddccd6',
  '#cdd0dd',
  '#dcd6c1',
  '#c6d8d8',
  '#d6c8c8',
];

/** Flat drawing with each detected face tinted, so subdivision is visible. */
function toSvg(graph: GeometryGraph, resolved: ResolvedGeometry): string {
  const b = resolved.blankBounds ?? { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } };
  const pad = 20;
  const w = b.max.x - b.min.x + pad * 2;
  const h = b.max.y - b.min.y + pad * 2;
  const parts: string[] = [];

  resolved.faces.forEach((f, i) => {
    const ring = (pts: { x: number; y: number }[]) =>
      pts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');
    const holes = f.holes
      .map((hole) => `M ${hole.points.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`)
      .join(' ');
    const outer = `M ${f.outer.points.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`;
    parts.push(
      `<path d="${outer} ${holes}" fill-rule="evenodd" fill="${FACE_FILL[i % FACE_FILL.length]}" ` +
        `fill-opacity="0.85" stroke="none"/>`,
    );
    void ring;
    parts.push(
      `<text x="${f.centroid.x}" y="${f.centroid.y}" font-family="monospace" font-size="9" ` +
        `text-anchor="middle" fill="#33404d">${f.id}</text>`,
    );
  });

  const stroke: Record<string, string> = {
    cut: 'stroke="#1d2733" stroke-width="1.1"',
    crease: 'stroke="#b4593c" stroke-width="0.8" stroke-dasharray="6 3"',
    perf: 'stroke="#b4593c" stroke-width="0.8" stroke-dasharray="8 2 1 2"',
    score: 'stroke="#b4593c" stroke-width="0.6" stroke-dasharray="4 3"',
    bleed: 'stroke="#a8b2bd" stroke-width="0.5" stroke-dasharray="2 3"',
    dimension: 'stroke="#7d8896" stroke-width="0.4"',
    construction: 'stroke="#c3cad2" stroke-width="0.4" stroke-dasharray="1 3"',
  };
  for (const line of graph.lines) {
    const pts = flattenPath(line.geometry);
    if (pts.length < 2) continue;
    const d = `M ${pts.map((p) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' L ')}`;
    parts.push(`<path d="${d}" fill="none" ${stroke[line.type] ?? stroke.cut}/>`);
  }

  for (const hinge of resolved.hinges) {
    const mid = { x: (hinge.a.x + hinge.b.x) / 2, y: (hinge.a.y + hinge.b.y) / 2 };
    parts.push(
      `<circle cx="${mid.x}" cy="${mid.y}" r="2.2" fill="${hinge.collinear ? '#b4593c' : '#c0392b'}"/>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<rect width="100%" height="100%" fill="#f4f1ea"/>
<g transform="translate(${pad - b.min.x} ${h - pad + b.min.y}) scale(1 -1)">
${parts.join('\n')}
</g>
</svg>`;
}

mkdirSync(OUT_DIR, { recursive: true });

for (const [name, make] of Object.entries(FIXTURES)) {
  const g = make();
  const resolved = resolveGeometry(g);
  report(name, g, resolved);
  writeFileSync(resolvePath(OUT_DIR, `${name}.svg`), toSvg(g, resolved), 'utf8');

  // Sanity check that the fold traversal produces finite geometry.
  const folded = foldedFacePoints(resolved, 1);
  let maxZ = 0;
  for (const { points } of folded.values()) for (const p of points) maxZ = Math.max(maxZ, p.z);
  console.log(`\n  folded height at ratio 1: ${maxZ.toFixed(1)} mm`);
}

console.log(`\nSVGs written to ${OUT_DIR}\n`);
