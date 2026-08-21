/**
 * Renders a graph's formed (or rigid-folded) shape to a self-contained,
 * auto-fitted SVG string — the one place that logic lives, used by the
 * static gallery build and by the fixed-view render check alike, so neither
 * can drift from what the live app actually draws.
 */
import type { GeometryGraph, ResolvedGeometry, Vec2 } from '../geometry/types.js';
import { computeFormedShape } from '../geometry/formedShape.js';
import { type CameraBasis, type ProjectedFacet, projectFormedFaces } from './iso.js';

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
  // Two passes, not one interleaved paint-order pass: an outline is a thin
  // line, and if it were painted in strict depth order against fill facets
  // from OTHER faces, a nearby facet at a slightly nearer average depth can
  // paint over part of it, breaking a real edge into dashes. Outlines drawn
  // after every fill always read as complete lines; the (rare, minor) cost
  // is an outline for a face that is otherwise fully hidden showing anyway.
  const fillPath = (f: ProjectedFacet) => {
    const opacity = (0.55 + 0.45 * f.shade).toFixed(3);
    return (
      `<path d="${d(f.pts)} Z" fill="var(--board)" fill-opacity="${opacity}" ` +
      `stroke="var(--board)" stroke-opacity="${opacity}" stroke-width="${seamWidth.toFixed(3)}" stroke-linejoin="round"/>`
    );
  };
  const outlinePath = (f: ProjectedFacet) =>
    `<path d="${d(f.pts)} Z" fill="none" stroke="var(--board-edge)" stroke-width="${outlineWidth.toFixed(3)}" stroke-linejoin="round"/>`;
  const body = [...ordered.filter((f) => !f.outline).map(fillPath), ...ordered.filter((f) => f.outline).map(outlinePath)].join('\n');

  return `<svg ${svgAttrs} viewBox="${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}" xmlns="http://www.w3.org/2000/svg">
${body}
</svg>`;
}
