/**
 * Headless verification for the artwork round trip: loads the real built
 * app (index.html), switches to each target style, applies the one-click
 * test artwork, and screenshots the 3D pane (plus the 2D pane and a
 * white-background pass) so orientation and registration can be checked by
 * eye — the same app code a user runs, not a stand-in.
 *
 *   npx tsx scripts/verify-artwork.ts [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, '..');
const outDir = resolvePath(ROOT, process.argv[2] ?? 'artwork-check');
mkdirSync(outDir, { recursive: true });

const STYLES = ['fefco.0201', 'carton.seal_end', 'bag.pillow', 'bag.sup', 'bag.gusseted', 'bag.block_bottom'];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

const errors: string[] = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
});

await page.goto(`file://${resolvePath(ROOT, 'index.html')}`);
await page.waitForSelector('#pane3d-canvas');

for (const styleId of STYLES) {
  console.log(`=== ${styleId} ===`);
  const navBtn = page.locator(`button[data-style="${styleId}"]`);
  await navBtn.click();
  await page.waitForTimeout(150);

  // Apply the one-click test artwork.
  await page.locator('#art-test').click();
  await page.waitForTimeout(300); // image decode + re-render

  const pane3d = page.locator('#pane-3d');
  await pane3d.screenshot({ path: resolvePath(outDir, `${styleId}.3d.png`) });

  const pane2d = page.locator('#pane-2d');
  await pane2d.screenshot({ path: resolvePath(outDir, `${styleId}.2d.png`) });

  // White background pass.
  await page.locator('#pane3d-bg').click();
  await page.waitForTimeout(100);
  await pane3d.screenshot({ path: resolvePath(outDir, `${styleId}.3d.white.png`) });
  await page.locator('#pane3d-bg').click(); // toggle back off for the next style
  await page.waitForTimeout(50);

  // Remove artwork so the next style starts clean.
  await page.locator('#art-remove').click();
  await page.waitForTimeout(50);
}

await browser.close();

if (errors.length > 0) {
  console.error(`\n${errors.length} console error(s)/page error(s):`);
  for (const e of errors) console.error(' ', e);
  process.exitCode = 1;
} else {
  console.log('\nNo console errors.');
}
