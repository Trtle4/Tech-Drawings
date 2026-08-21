/**
 * Renders a style's formed 3D shape from four fixed camera angles to PNG —
 * front, side, top, three-quarter (the app's own default view) — so a
 * lofted/formed shape can be checked visually, not just against numeric
 * invariants. Numeric tests can pass while the render is unreadable; this is
 * the other half of validating a formed-shape change.
 *
 *   npx tsx scripts/render-formed-check.ts [styleId] [outDir]
 *
 * Defaults to bag.pillow, writing PNGs to ./render-check/.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STYLES, compileStyle } from '../src/styles/index.js';
import { resolveGeometry } from '../src/geometry/resolve.js';
import { cameraBasis } from '../src/render/iso.js';
import { renderFormedSvg } from '../src/render/formedSvg.js';
import { DEFAULT_ORBIT } from '../src/app/state.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, '..');
const THEME = readFileSync(resolvePath(ROOT, 'src/ui/theme.css'), 'utf8');

const styleId = process.argv[2] ?? 'bag.pillow';
const outDir = resolvePath(ROOT, process.argv[3] ?? 'render-check');
mkdirSync(outDir, { recursive: true });

const def = STYLES.find((s) => s.id === styleId);
if (!def) {
  console.error(`Unknown style "${styleId}". Known: ${STYLES.map((s) => s.id).join(', ')}`);
  process.exit(1);
}

const compiled = compileStyle(def);
const resolved = resolveGeometry(compiled.graph);
const upAxis = compiled.graph.upAxis ?? 'y';

// azimuth 0 (or 180) looks along the axis perpendicular to the model's own
// widest silhouette — "front" for a wrap-style bag or case. 90 (or -90)
// looks along the perpendicular axis — the narrow "side". Both at true
// elevation 0 — these are meant as orthographic elevations, and even a small
// nonzero elevation leaks a bit of the OTHER horizontal axis into the
// picture, which is enough to visibly distort a long thin shape's silhouette
// (a real bug this caught: a fin's own width leaking into apparent length at
// 8deg elevation drew a pinched loop at the tip of the "side" view). Top's
// elevation ~88deg is near-straight-down without hitting the basis
// singularity at exactly 90. Three-quarter reuses the app's own
// DEFAULT_ORBIT so this is checking exactly what a user sees on load, not a
// separately-tuned angle.
const VIEWS: { name: string; azimuth: number; elevation: number }[] = [
  { name: 'front', azimuth: 0, elevation: 0 },
  { name: 'side', azimuth: Math.PI / 2, elevation: 0 },
  { name: 'top', azimuth: 0, elevation: (88 * Math.PI) / 180 },
  { name: 'three-quarter', azimuth: DEFAULT_ORBIT.azimuth, elevation: DEFAULT_ORBIT.elevation },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });

for (const view of VIEWS) {
  const cam = cameraBasis(upAxis, view.azimuth, view.elevation);
  const svg = renderFormedSvg(compiled.graph, resolved, cam, {
    svgAttrs: 'width="820" height="820"',
  });
  const html = `<!doctype html><html><head><style>${THEME}
    html,body{margin:0;background:var(--panel-bg,#f4f1ea);display:flex;align-items:center;justify-content:center;height:100%;}
  </style></head><body>${svg}</body></html>`;
  await page.setContent(html);
  await page.waitForTimeout(50);
  const outPath = resolvePath(outDir, `${styleId}.${view.name}.png`);
  await page.screenshot({ path: outPath });
  console.log(`${view.name.padEnd(16)} -> ${outPath}`);
}

await browser.close();
