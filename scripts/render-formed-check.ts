/**
 * Renders a style's formed 3D shape from five fixed camera angles to PNG —
 * front, side, top, bottom, three-quarter (the app's own default view) — so
 * a lofted/formed shape can be checked visually, not just against numeric
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
import { boundsOf } from '../src/geometry/math.js';
import { computeFormedShape } from '../src/geometry/formedShape.js';
import { cameraBasis, project } from '../src/render/iso.js';
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
  // The mirror of 'top' — looking up from underneath, e.g. a stand-up
  // pouch's own base and where it welds to the walls, which 'top' cannot
  // show (it's on the far, occluded side from directly overhead).
  { name: 'bottom', azimuth: 0, elevation: (-88 * Math.PI) / 180 },
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

// ---------------------------------------------------------------------------
// A fifth, dimensioned view: the numbers a picture alone can't verify.
// ---------------------------------------------------------------------------
//
// Numeric tests can pass and a render can still be lying — the only way to
// catch that is to put the same numbers ON the picture, measured from the
// actual formed geometry rather than assumed from the spec, so a mismatch is
// visible rather than requiring a second script to notice. Role names below
// are the pillow bag's own vocabulary; this block only runs when they're
// all present, so it degrades to a no-op for styles it doesn't understand
// rather than guessing.

const params = (compiled.graph.meta?.params as Record<string, number>) ?? {};
const byRole = new Map(resolved.faces.map((f) => [f.role, f]));
const bodyRoles = ['front_panel', 'back_panel_left', 'back_panel_right'];
// The TOP band, not the bottom — a style may fold its bottom band back
// against the body (see bag-block-bottom.ts), which moves its formed points
// well away from its own flat-pattern y. The top band is a plain hanging
// crimp for every style that has one, so measuring there is safe uniformly.
const crimpCapRoles = ['front_end_top', 'back_left_end_top', 'back_right_end_top'];

if (
  bodyRoles.every((r) => byRole.has(r)) &&
  crimpCapRoles.every((r) => byRole.has(r)) &&
  'endSeal' in params &&
  'caliper' in params &&
  'bagD' in params &&
  'bagL' in params
) {
  const formed = computeFormedShape(compiled.graph, resolved, 1);
  const pointsOf = (role: string) => formed.get(byRole.get(role)!.id)!.facets.flatMap((f) => f.points);
  const bodyPoints = bodyRoles.flatMap(pointsOf);
  // The crimp cap faces (y 0..endSeal) are SEPARATE faces from the round
  // body (y endSeal..bagL-endSeal) — measuring "at the crimp" from the body
  // points alone finds nothing there at all, since the body doesn't reach
  // that far.
  const crimpPoints = crimpCapRoles.flatMap(pointsOf);
  const near = <T extends { y: number }>(pts: T[], y: number, tol = 1) => pts.filter((p) => Math.abs(p.y - y) < tol);
  const xExtent = (pts: { x: number }[]) => Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
  const maxAbsZ = (pts: { z: number }[]) => Math.max(...pts.map((p) => Math.abs(p.z)));

  // Crimp band height: a grid fact, independent of the loft — the flat
  // pattern's own y-extent for the crimp cap cell, not something the 3D
  // engine could get wrong without also breaking the dieline.
  const crimpBnd = boundsOf(byRole.get('front_end_top')!.outer.points)!;
  const measuredCrimpHeight = crimpBnd.max.y - crimpBnd.min.y;

  const midY = params.bagL / 2;
  // The band's own free (non-hinge) edge — the top band's is its max.y.
  const crimpPts = near(crimpPoints, crimpBnd.max.y, 1);
  // The row grid's spacing depends on each style's own body height (see
  // rowsForHeight in formedShape.ts), so a fixed tolerance can miss the
  // nearest sampled row entirely for a style whose body doesn't divide it
  // evenly (it did, by coincidence, for the pillow). Snap to whichever
  // sampled y is actually closest to the target instead of guessing a
  // tolerance wide enough for every style's row spacing.
  const nearestY = bodyPoints.reduce((best, p) => (Math.abs(p.y - midY) < Math.abs(best - midY) ? p.y : best), bodyPoints[0]?.y ?? midY);
  const midPts = near(bodyPoints, nearestY, 1e-6);
  const measuredCrimpThickness = 2 * maxAbsZ(crimpPts);
  const measuredWidthAtCrimp = xExtent(crimpPts);
  const measuredWidthAtMid = xExtent(midPts);
  const measuredDepthAtMid = 2 * maxAbsZ(midPts);

  // The crimp band's halfDepth in the 3D preview is max(caliper, bagD*0.06),
  // a deliberate DISPLAY FLOOR — true film thickness draws as a bare outline
  // with no visible fill (see bag-pillow.ts). measuredCrimpThickness reflects
  // that floor, not the true caliper, so report both explicitly rather than
  // comparing the floor against true 2x caliper as if they were meant to
  // match: they never will, on purpose, and that must not be read as an
  // error. This floor lives ONLY in formedShape.stations for the 3D preview;
  // it is never read by dimensions, an outside-dimension toggle, or export.
  const trueCrimpThickness = 2 * params.caliper;
  const displayFloorThickness = 2 * Math.max(params.caliper, params.bagD * 0.06);

  const checks = [
    { label: 'Crimp band height', measured: measuredCrimpHeight, spec: params.endSeal, specLabel: 'end seal width' },
    { label: 'Crimp band thickness (true 2 x caliper)', measured: trueCrimpThickness, spec: trueCrimpThickness, specLabel: 'true 2 x caliper (not what is drawn)' },
    { label: 'Crimp band thickness (display floor, drawn)', measured: measuredCrimpThickness, spec: displayFloorThickness, specLabel: 'display floor = 2 x max(caliper, bagD*0.06)' },
    { label: 'Width at crimp', measured: measuredWidthAtCrimp, spec: measuredWidthAtMid, specLabel: 'width at midpoint' },
    { label: 'Depth at midpoint', measured: measuredDepthAtMid, spec: params.bagD, specLabel: 'bagD' },
  ];

  console.log('\ndimensioned check —', styleId);
  for (const c of checks) console.log(`  ${c.label}: measured ${c.measured.toFixed(2)}mm vs ${c.specLabel} ${c.spec.toFixed(2)}mm`);

  const cam = cameraBasis(upAxis, Math.PI / 2, 0);
  const sideSvg = renderFormedSvg(compiled.graph, resolved, cam, { svgAttrs: 'id="dimbase"' });
  const vb = /viewBox="([^"]+)"/.exec(sideSvg)![1]!.split(' ').map(Number) as [number, number, number, number];
  const [vx, vy, vw, vh] = vb;

  // crimpBnd.max.y is the top band's own free (non-hinge) edge — where
  // crimpPts was actually sampled from, above.
  const p = (v: { x: number; y: number; z: number }) => project(v, cam);
  const crimpTopL = p({ x: 0, y: crimpBnd.max.y, z: -measuredCrimpThickness / 2 });
  const crimpTopR = p({ x: 0, y: crimpBnd.max.y, z: measuredCrimpThickness / 2 });
  const crimpBotY = p({ x: 0, y: crimpBnd.min.y, z: 0 }).y;
  const crimpTopY = p({ x: 0, y: crimpBnd.max.y, z: 0 }).y;
  const midL = p({ x: 0, y: midY, z: -measuredDepthAtMid / 2 });
  const midR = p({ x: 0, y: midY, z: measuredDepthAtMid / 2 });

  const dimStroke = '#c0392b';
  const arrow = (x1: number, y1: number, x2: number, y2: number) => {
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const s = vw * 0.012;
    const mk = (a: number) => `L ${(x2 - s * Math.cos(ang - a)).toFixed(2)} ${(y2 - s * Math.sin(ang - a)).toFixed(2)}`;
    return `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)}" stroke="${dimStroke}" stroke-width="${(vw * 0.0018).toFixed(3)}" fill="none"/>
    <path d="M ${x2.toFixed(2)} ${y2.toFixed(2)} ${mk(0.4)} M ${x2.toFixed(2)} ${y2.toFixed(2)} ${mk(-0.4)}" stroke="${dimStroke}" stroke-width="${(vw * 0.0018).toFixed(3)}" fill="none" stroke-linecap="round"/>`;
  };
  const witness = (x1: number, y1: number, x2: number, y2: number) =>
    `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)}" stroke="${dimStroke}" stroke-width="${(vw * 0.0008).toFixed(3)}" stroke-dasharray="${(vw * 0.004).toFixed(2)},${(vw * 0.004).toFixed(2)}"/>`;
  const fs = vw * 0.022;
  const label = (x: number, y: number, text: string, anchor = 'middle') =>
    `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${fs.toFixed(2)}" font-family="monospace" fill="${dimStroke}" text-anchor="${anchor}">${text}</text>`;

  const crimpHeightX = vx + vw * 0.14;
  const crimpThickY = crimpBotY + vh * 0.05;
  const midDepthY = midL.y - vh * 0.045;

  const overlay = `
    ${witness(crimpTopL.x, crimpTopY, crimpHeightX, crimpTopY)}
    ${witness(crimpTopL.x, crimpBotY, crimpHeightX, crimpBotY)}
    ${arrow(crimpHeightX, crimpTopY, crimpHeightX, crimpBotY)}
    ${arrow(crimpHeightX, crimpBotY, crimpHeightX, crimpTopY)}
    ${label(crimpHeightX - vw * 0.012, (crimpTopY + crimpBotY) / 2, `${measuredCrimpHeight.toFixed(1)} / ${params.endSeal.toFixed(1)}`, 'end')}

    ${witness(crimpTopL.x, crimpTopL.y, crimpTopL.x, crimpThickY)}
    ${witness(crimpTopR.x, crimpTopR.y, crimpTopR.x, crimpThickY)}
    ${arrow(crimpTopL.x, crimpThickY, crimpTopR.x, crimpThickY)}
    ${arrow(crimpTopR.x, crimpThickY, crimpTopL.x, crimpThickY)}
    ${label((crimpTopL.x + crimpTopR.x) / 2, crimpThickY + fs * 1.3, `t ${measuredCrimpThickness.toFixed(2)} (display floor ${displayFloorThickness.toFixed(2)}) / true ${trueCrimpThickness.toFixed(2)}`)}

    ${witness(midL.x, midL.y, midL.x, midDepthY)}
    ${witness(midR.x, midR.y, midR.x, midDepthY)}
    ${arrow(midL.x, midDepthY, midR.x, midDepthY)}
    ${arrow(midR.x, midDepthY, midL.x, midDepthY)}
    ${label((midL.x + midR.x) / 2, midDepthY - fs * 0.6, `depth ${measuredDepthAtMid.toFixed(1)} / ${params.bagD.toFixed(1)}`)}

    <g font-family="monospace" font-size="${fs.toFixed(2)}" fill="${dimStroke}">
      <text x="${(vx + vw * 0.03).toFixed(2)}" y="${(vy + vh * 0.06).toFixed(2)}">width @ crimp:    ${measuredWidthAtCrimp.toFixed(1)} mm</text>
      <text x="${(vx + vw * 0.03).toFixed(2)}" y="${(vy + vh * 0.06 + fs * 1.4).toFixed(2)}">width @ midpoint: ${measuredWidthAtMid.toFixed(1)} mm</text>
      <text x="${(vx + vw * 0.03).toFixed(2)}" y="${(vy + vh * 0.06 + fs * 2.8).toFixed(2)}">flare:            ${(measuredWidthAtCrimp - measuredWidthAtMid).toFixed(1)} mm wider at crimp</text>
    </g>`;

  const dimSvg = sideSvg.replace('</svg>', `${overlay}\n</svg>`).replace('<svg id="dimbase"', '<svg width="820" height="820" id="dimbase"');
  const html = `<!doctype html><html><head><style>${THEME}
    html,body{margin:0;background:var(--panel-bg,#f4f1ea);display:flex;align-items:center;justify-content:center;height:100%;}
  </style></head><body>${dimSvg}</body></html>`;
  await page.setContent(html);
  await page.waitForTimeout(50);
  const outPath = resolvePath(outDir, `${styleId}.dimensioned.png`);
  await page.screenshot({ path: outPath });
  console.log(`\n${'dimensioned'.padEnd(16)} -> ${outPath}`);
}

await browser.close();
