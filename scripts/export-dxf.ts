/**
 * Writes a DXF per catalogue style at its defaults, into out/dxf/.
 *
 *   npm run export:dxf
 *
 * These are the files to cut. 1:1 in mm, R12, arcs as true arcs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STYLES, compileStyle, proofTaperedTray } from '../src/styles/index.js';
import { blankSize, resolveGeometry } from '../src/geometry/resolve.js';
import { buildDxf } from '../src/export/dxf.js';
import { readDxf, linesFromDxf } from '../src/export/dxf-read.js';

const OUT = resolvePath(dirname(fileURLToPath(import.meta.url)), '../out/dxf');
mkdirSync(OUT, { recursive: true });

let bad = 0;
for (const def of [...STYLES, proofTaperedTray]) {
  const compiled = compileStyle(def);
  const resolved = resolveGeometry(compiled.graph);
  const { dxf, report } = buildDxf(compiled.graph, resolved, {
    note: `${def.name} - sample`,
  });

  const file = resolvePath(OUT, `${def.id.replace(/[^a-z0-9]/gi, '_')}.dxf`);
  writeFileSync(file, dxf, 'ascii');

  // Verify what was just written, rather than trusting it.
  const back = resolveGeometry(
    {
      ...compiled.graph,
      lines: linesFromDxf(readDxf(dxf)),
      faceSeeds: compiled.graph.faceSeeds!.map((s) => ({ ...s })),
    },
    { reanchorSeeds: false },
  );
  const ok = back.faces.length === resolved.faces.length && back.hinges.length === resolved.hinges.length;
  if (!ok) bad++;

  const size = blankSize(resolved)!;
  console.log(
    `${def.id.padEnd(20)} ${size.width.toFixed(1).padStart(7)} x ${size.height.toFixed(1).padStart(6)} mm  ` +
      `${String(report.entities).padStart(4)} ent  ${String(report.arcs).padStart(2)} arc  ` +
      `${resolved.faces.length}f/${resolved.hinges.length}h  ` +
      `${ok ? 'verified' : 'MISMATCH'}` +
      (report.duplicatesMerged ? `  (${report.duplicatesMerged} dupes merged)` : '') +
      (report.skipped.length ? `  (${report.skipped.length} skipped)` : ''),
  );
}
console.log(`\n${bad === 0 ? 'All exports verified against the model.' : `${bad} MISMATCHES`}`);
console.log(`DXF written to ${OUT}\n`);
