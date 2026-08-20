/**
 * Builds the real interactive editor: `index.html` at the repo root, the page
 * the Pages workflow serves.
 *
 *   npm run build:app
 *
 * Step 3 of the build order — the live 2D canvas, param panel, inspector and
 * companion 3D pane. Unlike the throwaway gallery (`build:gallery`), nothing
 * here is pre-rendered: `src/app/main.ts` is bundled for the browser with
 * esbuild and mounts a real app against the geometry/styles library, the same
 * modules the test suite and the DXF exporter use.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, '..');
const THEME = readFileSync(resolvePath(ROOT, 'src/ui/theme.css'), 'utf8');

const result = await esbuild.build({
  entryPoints: [resolvePath(ROOT, 'src/app/main.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2020',
  sourcemap: 'inline',
  logLevel: 'info',
});

const bundle = result.outputFiles[0]!.text;

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dieline Studio</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${THEME}
</style>
</head>
<body>
<div id="app"></div>
<script>
${bundle}
</script>
</body>
</html>
`;

writeFileSync(resolvePath(ROOT, 'index.html'), page, 'utf8');
console.log(`index.html -> ${resolvePath(ROOT, 'index.html')}  (${(page.length / 1024).toFixed(0)} KB)`);
