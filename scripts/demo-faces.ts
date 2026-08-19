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
import { renderSvg } from './render-svg.js';

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


mkdirSync(OUT_DIR, { recursive: true });

for (const [name, make] of Object.entries(FIXTURES)) {
  const g = make();
  const resolved = resolveGeometry(g);
  report(name, g, resolved);
  writeFileSync(resolvePath(OUT_DIR, `${name}.svg`), renderSvg(g, resolved), 'utf8');

  // Sanity check that the fold traversal produces finite geometry.
  const folded = foldedFacePoints(resolved, 1);
  let maxZ = 0;
  for (const { points } of folded.values()) for (const p of points) maxZ = Math.max(maxZ, p.z);
  console.log(`\n  folded height at ratio 1: ${maxZ.toFixed(1)} mm`);
}

console.log(`\nSVGs written to ${OUT_DIR}\n`);
