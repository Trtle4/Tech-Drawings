/**
 * Renders a graph's formed (or rigid-folded) shape to a self-contained,
 * auto-fitted SVG string — the one place that logic lives, used by the
 * static gallery build and by the fixed-view render check alike, so neither
 * can drift from what the live app actually draws.
 */
import type { GeometryGraph, ResolvedGeometry, Vec2 } from '../geometry/types.js';
import { computeFormedShape } from '../geometry/formedShape.js';
import { type CameraBasis, projectFormedFaces } from './iso.js';

export interface FormedSvgOptions {
  /** Overrides how full the pack is, 0 to 1. Defaults to the style's own formedShape.fill. */
  fill?: number;
  /** Fraction of the model's own extent added as margin on every side. */
  padFrac?: number;
  /** Extra attributes on the root <svg>, e.g. `width="800" height="800"`. */
  svgAttrs?: string;
}

const d = (pts: Vec2[]) => `M ${pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')}`;

export function renderFormedSvg(
  graph: GeometryGraph,
  resolved: ResolvedGeometry,
  cam: CameraBasis,
  opts: FormedSvgOptions = {},
): string {
  const { fill, padFrac = 0.12, svgAttrs = '' } = opts;
  const folded = computeFormedShape(graph, resolved, fill);
  const ordered = projectFormedFaces(folded, cam);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of ordered) {
    for (const q of f.pts) {
      minX = Math.min(minX, q.x);
      minY = Math.min(minY, q.y);
      maxX = Math.max(maxX, q.x);
      maxY = Math.max(maxY, q.y);
    }
  }
  if (!Number.isFinite(minX)) {
    return `<svg ${svgAttrs} viewBox="0 0 1 1" xmlns="http://www.w3.org/2000/svg"></svg>`;
  }

  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const pad = Math.max(w, h) * padFrac;
  // A lofted face is many small facets, not one polygon — stroking every
  // facet in the outline colour would draw a visible grid across every
  // curved panel, which reads as faceted in exactly the way this
  // tessellation fix is for. Each facet's seam is stroked in its OWN fill
  // colour/opacity instead, present only to close antialiasing gaps between
  // adjacent quads, so a curved surface reads as a shading gradient. The
  // face's own outer boundary (a real edge — a different panel, a folded-on
  // fin) is a separate, unfilled, outline-coloured stroke on top.
  const seamWidth = Math.max(w, h) * 0.0015;
  const outlineWidth = Math.max(w, h) * 0.0025;
  // One interleaved paint-order pass: a face on the far side of the loft
  // (the back seam, viewed from the front) must be genuinely occludable by
  // a nearer face's fill, or a boundary that should be hidden — the panel
  // join opposite whatever the camera faces — draws through it regardless
  // of camera angle. Each outline edge is its own short segment (see
  // projectFormedFaces), sorted by its own local depth, so this is accurate
  // along the whole boundary rather than an average that can lose locally
  // even where a segment should clearly win.
  const body = ordered
    .map((f) => {
      if (f.outline) {
        return `<path d="${d(f.pts)}" fill="none" stroke="var(--board-edge)" stroke-width="${outlineWidth.toFixed(3)}" stroke-linecap="round"/>`;
      }
      const opacity = (0.55 + 0.45 * f.shade).toFixed(3);
      return (
        `<path d="${d(f.pts)} Z" fill="var(--board)" fill-opacity="${opacity}" ` +
        `stroke="var(--board)" stroke-opacity="${opacity}" stroke-width="${seamWidth.toFixed(3)}" stroke-linejoin="round"/>`
      );
    })
    .join('\n');

  return `<svg ${svgAttrs} viewBox="${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}" xmlns="http://www.w3.org/2000/svg">
${body}
</svg>`;
}
