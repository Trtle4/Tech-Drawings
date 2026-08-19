/**
 * Compiles each catalogue style at a few parameter sets, resolves it, and
 * reports. Writes an SVG per case to out/.
 *
 *   npm run demo:styles
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STYLES, compileStyle } from '../src/styles/index.js';
import { blankSize, materialArea, resolveGeometry } from '../src/geometry/resolve.js';
import { foldedFacePoints } from '../src/geometry/fold.js';
import { renderSvg } from './render-svg.js';

const OUT_DIR = resolvePath(dirname(fileURLToPath(import.meta.url)), '../out');
mkdirSync(OUT_DIR, { recursive: true });

const CASES: Record<string, Record<string, number>[]> = {
  'fefco.0201': [
    { L: 200, W: 150, H: 250, caliper: 3 },
    { L: 400, W: 300, H: 120, caliper: 5 },
    { L: 80, W: 80, H: 400, caliper: 1.5 },
  ],
};

for (const style of STYLES) {
  console.log(`\n${'━'.repeat(74)}`);
  console.log(`  ${style.standard ?? ''} ${style.code ?? ''}  ${style.name}  [${style.id}]`.trim());
  console.log('━'.repeat(74));
  console.log(`  ${style.description ?? ''}`);
  console.log(
    `  params: ${style.params.map((p) => `${p.id}(${p.group})`).join(', ')}`,
  );

  for (const [i, params] of (CASES[style.id] ?? [{}]).entries()) {
    const compiled = compileStyle(style, { params });
    const resolved = resolveGeometry(compiled.graph);
    const measured = blankSize(resolved)!;
    const folded = foldedFacePoints(resolved, 1);

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const { points } of folded.values()) {
      for (const q of points) {
        const c = [q.x, q.y, q.z];
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k]!, c[k]!);
          max[k] = Math.max(max[k]!, c[k]!);
        }
      }
    }
    const box = max
      .map((m, k) => m - min[k]!)
      .sort((a, b) => a - b)
      .map((v) => v.toFixed(1))
      .join(' × ');

    const p = compiled.params;
    console.log(
      `\n  ${Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')}`,
    );
    console.log(
      `    blank ${compiled.blank.width} × ${compiled.blank.height} mm  ` +
        `(measured ${measured.width.toFixed(1)} × ${measured.height.toFixed(1)})  ` +
        `board ${materialArea(resolved).toFixed(0)} mm²`,
    );
    console.log(
      `    ${resolved.faces.length} faces, ${resolved.hinges.length} hinges, ` +
        `${compiled.graph.seals.length} seal(s), ${resolved.unresolved.length} unresolved`,
    );
    const asked = [p.L ?? 0, p.W ?? 0, p.H ?? 0].sort((a, b) => a - b).join(' × ');
    console.log(`    folds to ${box} mm  (asked for ${asked})`);
    for (const w of compiled.warnings) console.log(`    ! ${w}`);

    const name = `${style.id.replace(/\./g, '')}-${i + 1}`;
    writeFileSync(resolvePath(OUT_DIR, `${name}.svg`), renderSvg(compiled.graph, resolved, { labelWith: 'role' }), 'utf8');
  }
}

console.log(`\nSVGs written to ${OUT_DIR}\n`);
