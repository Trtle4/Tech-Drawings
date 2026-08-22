/**
 * The 2D flat drawing, with its overall dimensions, rendered to a
 * `<canvas>` for PNG export — a reviewable picture of the dieline, not the
 * artwork round trip's registration-critical template (see
 * artworkTemplate.ts): this one has margin, face labels and dimension
 * callouts on purpose, all outside the blank's own bounds, on a white page.
 */
import type { DrawingLine, GeometryGraph, ResolvedGeometry, Vec2 } from '../geometry/types.js';
import { faceInteriorPoint } from '../geometry/faces.js';
import { flattenPath } from '../geometry/arrangement.js';
import { computeDimension, drawDimensionCanvas, formatLengthMm } from './dimension.js';

const LINE_STYLE: Record<string, { color: string; width: number; dash: number[] }> = {
  cut: { color: '#1a1a1a', width: 1.6, dash: [] },
  crease: { color: '#0f6e77', width: 1.1, dash: [7, 4] },
  perf: { color: '#0f6e77', width: 1.1, dash: [9, 3, 1.5, 3] },
  score: { color: '#0f6e77', width: 0.9, dash: [4, 3] },
  bleed: { color: '#5b7fb5', width: 0.8, dash: [3, 3] },
  dimension: { color: '#7a7a7a', width: 0.8, dash: [2, 2] },
  construction: { color: '#9a9a9a', width: 0.8, dash: [1, 3] },
};

const PX_PER_MM = 4;
const MARGIN_MM = 30;
const DIM_OFFSET_PX = 34;
const DIM_ARROW_PX = 6;

export interface Drawing2DExportResult {
  canvas: HTMLCanvasElement;
  widthPx: number;
  heightPx: number;
}

/**
 * Renders every structural/annotation line, each face's role label, and
 * overall width/height dimension lines onto a white-background canvas at a
 * fixed 4px/mm — legible on screen and in an email/doc, not meant as a
 * print-at-scale file (that's what the DXF export is for).
 */
export function renderDrawing2D(graph: GeometryGraph, resolved: ResolvedGeometry): Drawing2DExportResult {
  const blank = resolved.blankBounds;
  const inner = blank ?? { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } };
  const outer = {
    min: { x: inner.min.x - MARGIN_MM, y: inner.min.y - MARGIN_MM },
    max: { x: inner.max.x + MARGIN_MM, y: inner.max.y + MARGIN_MM },
  };

  const widthPx = Math.max(1, Math.round((outer.max.x - outer.min.x) * PX_PER_MM));
  const heightPx = Math.max(1, Math.round((outer.max.y - outer.min.y) * PX_PER_MM));
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);

  // Model mm (y-up) to canvas px (y-down) — same convention as `mmToPx` in
  // texture.ts, re-derived locally because this frame's origin (outer.min)
  // is a margin-expanded box, not the blank bounds that module's callers
  // always mean.
  const toPx = (p: Vec2): Vec2 => ({
    x: (p.x - outer.min.x) * PX_PER_MM,
    y: (outer.max.y - p.y) * PX_PER_MM,
  });

  drawLines(ctx, graph.lines, toPx);
  drawFaceLabels(ctx, resolved, toPx);
  if (blank) drawOverallDimensions(ctx, blank, toPx);

  return { canvas, widthPx, heightPx };
}

function drawLines(ctx: CanvasRenderingContext2D, lines: readonly DrawingLine[], toPx: (p: Vec2) => Vec2): void {
  for (const line of lines) {
    const style = LINE_STYLE[line.type] ?? LINE_STYLE.cut!;
    const pts = flattenPath(line.geometry).map(toPx);
    if (pts.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.setLineDash(style.dash);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawFaceLabels(ctx: CanvasRenderingContext2D, resolved: ResolvedGeometry, toPx: (p: Vec2) => Vec2): void {
  ctx.fillStyle = '#444444';
  ctx.font = '600 10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const face of resolved.faces) {
    const at = faceInteriorPoint(face);
    if (!at) continue;
    const p = toPx(at);
    ctx.fillText(face.role.replace(/_/g, ' ').toUpperCase(), p.x, p.y);
  }
}

function drawOverallDimensions(ctx: CanvasRenderingContext2D, bounds: { min: Vec2; max: Vec2 }, toPx: (p: Vec2) => Vec2): void {
  const bl = toPx({ x: bounds.min.x, y: bounds.min.y });
  const br = toPx({ x: bounds.max.x, y: bounds.min.y });
  const tl = toPx({ x: bounds.min.x, y: bounds.max.y });
  const width = computeDimension(bl, br, 1, DIM_OFFSET_PX, DIM_ARROW_PX);
  const height = computeDimension(bl, tl, -1, DIM_OFFSET_PX, DIM_ARROW_PX);
  const color = '#0f6e77';
  drawDimensionCanvas(ctx, width, formatLengthMm(bounds.max.x - bounds.min.x), color);
  drawDimensionCanvas(ctx, height, formatLengthMm(bounds.max.y - bounds.min.y), color);
}
