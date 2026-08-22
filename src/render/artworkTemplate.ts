/**
 * Artwork template export — the PNG a designer draws onto externally.
 *
 * The canvas's pixel bounds are exactly `resolved.blankBounds`, scaled by
 * DPI: no title block, no dimension text, no margin, no padding. That
 * equality with the blank bounds IS the registration contract the artwork
 * round trip depends on — the exact same `mmToPx` this module uses is also
 * what the 2D/3D panes use to sample an uploaded image back onto the model,
 * so a file exported here lines up automatically on re-upload.
 */
import type { DrawingLine, GeometryGraph, ResolvedGeometry, Vec2 } from '../geometry/types.js';
import { STRUCTURAL_TYPES } from '../geometry/types.js';
import { flattenPath } from '../geometry/arrangement.js';
import { mmToPx, pixelFrameAtDpi, templatePixelSize, type PixelFrame } from './texture.js';

export interface TemplateCanvasResult {
  canvas: HTMLCanvasElement;
  widthPx: number;
  heightPx: number;
}

/**
 * Renders the dieline (every structural line — cut, crease, perf, score;
 * bleed/dimension/construction are drawing furniture, not tooling, so they
 * never appear here) as faint guide strokes at the given DPI. `guides:
 * false` renders nothing at all — a fully transparent canvas at the same
 * pixel size, the "blank" file a designer works in directly.
 */
export function renderArtworkTemplate(
  graph: GeometryGraph,
  resolved: ResolvedGeometry,
  dpi: number,
  guides: boolean,
): TemplateCanvasResult {
  const bounds = resolved.blankBounds ?? { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } };
  const { width, height } = templatePixelSize(bounds, dpi);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, width, height); // transparent by construction — no fill call at all

  if (guides) {
    const frame = pixelFrameAtDpi(bounds, dpi);
    drawGuides(ctx, graph.lines, frame);
  }

  return { canvas, widthPx: width, heightPx: height };
}

function drawGuides(ctx: CanvasRenderingContext2D, lines: readonly DrawingLine[], frame: PixelFrame): void {
  const structural = new Set(STRUCTURAL_TYPES);
  ctx.save();
  ctx.strokeStyle = 'rgba(20, 20, 20, 0.28)';
  ctx.lineWidth = Math.max(1, 0.25 * ((frame.pxPerMmX + frame.pxPerMmY) / 2));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const line of lines) {
    if (!structural.has(line.type)) continue;
    const pts = flattenPath(line.geometry).map((p: Vec2) => mmToPx(p, frame));
    if (pts.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Encode a canvas as a PNG Blob — a thin promise wrapper over `toBlob`. */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas failed to encode as PNG.'));
    }, 'image/png');
  });
}

/** Trigger a browser download of a blob under the given filename. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has had a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
