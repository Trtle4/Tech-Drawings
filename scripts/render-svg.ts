/**
 * Debug renderer for the resolve pass. Not the app's 2D canvas — just enough to
 * look at a blank and see how it was subdivided.
 *
 * Palette is the shared design system (parametric_design_system.md): cool
 * paper, ink cut lines, petrol-teal folds, danger red only where it means
 * something.
 */
import type { GeometryGraph, ResolvedGeometry, Vec2 } from '../src/geometry/types.js';
import { flattenPath } from '../src/geometry/arrangement.js';

export const TOKEN = {
  paper: '#E9EDF0',
  panel: '#FFFFFF',
  panel2: '#F3F6F8',
  ink: '#192227',
  ink2: '#59656C',
  ink3: '#8A959B',
  line: '#D2D9DE',
  grid: '#DBE1E6',
  accent: '#0F6E77',
  accentSoft: '#E0F0F1',
  danger: '#B23A2E',
} as const;

/** Face tints: desaturated steps around the paper hue, so no face shouts. */
const FACE_FILL = [
  '#DCE4EA',
  '#D5E1E2',
  '#E0E2E8',
  '#D8E3DD',
  '#E3E1E4',
  '#D3DDE4',
  '#DEE4DC',
  '#D9DEE6',
];

const STROKE: Record<string, string> = {
  cut: `stroke="${TOKEN.ink}" stroke-width="1.1"`,
  crease: `stroke="${TOKEN.accent}" stroke-width="0.8" stroke-dasharray="6 3"`,
  perf: `stroke="${TOKEN.accent}" stroke-width="0.8" stroke-dasharray="8 2 1 2"`,
  score: `stroke="${TOKEN.accent}" stroke-width="0.6" stroke-dasharray="4 3"`,
  bleed: `stroke="${TOKEN.ink3}" stroke-width="0.5" stroke-dasharray="2 3"`,
  dimension: `stroke="${TOKEN.ink2}" stroke-width="0.4"`,
  construction: `stroke="${TOKEN.line}" stroke-width="0.4" stroke-dasharray="1 3"`,
};

const path = (pts: Vec2[]) => `M ${pts.map((p) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' L ')}`;

export interface RenderOptions {
  /** Label faces with their role instead of their id. */
  labelWith?: 'id' | 'role';
  /** Target width in px; the drawing scales to fit. */
  maxWidth?: number;
}

export function renderSvg(
  graph: GeometryGraph,
  resolved: ResolvedGeometry,
  opts: RenderOptions = {},
): string {
  const labelWith = opts.labelWith ?? 'id';
  const b = resolved.blankBounds ?? { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } };
  const pad = 24;
  const wmm = b.max.x - b.min.x + pad * 2;
  const hmm = b.max.y - b.min.y + pad * 2;
  const scale = Math.min(1, (opts.maxWidth ?? 900) / wmm);
  const parts: string[] = [];

  resolved.faces.forEach((f, i) => {
    const holes = f.holes.map((hole) => `${path(hole.points)} Z`).join(' ');
    parts.push(
      `<path d="${path(f.outer.points)} Z ${holes}" fill-rule="evenodd" ` +
        `fill="${FACE_FILL[i % FACE_FILL.length]}" fill-opacity="0.9" stroke="none"/>`,
    );
  });

  for (const line of graph.lines) {
    const pts = flattenPath(line.geometry);
    if (pts.length < 2) continue;
    parts.push(`<path d="${path(pts)}" fill="none" ${STROKE[line.type] ?? STROKE.cut}/>`);
  }

  for (const hinge of resolved.hinges) {
    const mid = { x: (hinge.a.x + hinge.b.x) / 2, y: (hinge.a.y + hinge.b.y) / 2 };
    // Danger red by meaning: this hinge has no rigid fold axis.
    parts.push(
      `<circle cx="${mid.x}" cy="${mid.y}" r="${2.2 / scale}" ` +
        `fill="${hinge.collinear ? TOKEN.accent : TOKEN.danger}"/>`,
    );
  }

  // Labels are drawn in a y-down group so the text is not mirrored.
  const labels: string[] = [];
  for (const f of resolved.faces) {
    const text = labelWith === 'role' ? f.role : f.id;
    labels.push(
      `<text x="${f.centroid.x.toFixed(2)}" y="${(-f.centroid.y).toFixed(2)}" ` +
        `font-family="'DM Mono',ui-monospace,monospace" font-size="${(9 / scale).toFixed(2)}" ` +
        `text-anchor="middle" dominant-baseline="middle" fill="${TOKEN.ink2}">${escapeXml(text)}</text>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${wmm} ${hmm}" width="${(wmm * scale).toFixed(0)}" height="${(hmm * scale).toFixed(0)}">
<rect width="100%" height="100%" fill="${TOKEN.paper}"/>
<defs><pattern id="g" width="24" height="24" patternUnits="userSpaceOnUse">
<path d="M24 0H0V24" fill="none" stroke="${TOKEN.grid}" stroke-width="1"/></pattern></defs>
<rect width="100%" height="100%" fill="url(#g)" opacity="0.55"/>
<g transform="translate(${pad - b.min.x} ${hmm - pad + b.min.y})">
<g transform="scale(1 -1)">
${parts.join('\n')}
</g>
${labels.join('\n')}
</g>
</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
