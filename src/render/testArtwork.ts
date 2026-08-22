/**
 * The one-click orientation test artwork: every panel gets its own big "F"
 * (an asymmetric glyph — mirrored or rotated is immediately obvious, unlike
 * a symmetric shape) and its own role name, both drawn upright and unrotated
 * in the flat image — "right way up in the flat" literally means no
 * per-panel rotation here, only per-panel position.
 *
 * This is the actual test: apply it, look at the FORMED 3D pack from its
 * normal exterior view, and every panel's F and label should read forward
 * and upright there too. A panel that comes out mirrored means that face's
 * UV needs flipping (see `faceUVFlip` in schema.ts) — this generator itself
 * never needs to change to fix it, which is what makes it trustworthy as a
 * test: the same artwork, unmodified, either passes or fails per style.
 */
import type { ResolvedGeometry, Vec2 } from '../geometry/types.js';
import { mmToPx, pixelFrameAtDpi, templatePixelSize } from './texture.js';

const PALETTE = [
  { bg: '#fbe8d6', ink: '#7a3b12' },
  { bg: '#dcefe1', ink: '#1f5c3a' },
  { bg: '#dde7fb', ink: '#1e3d7a' },
  { bg: '#fbe3ec', ink: '#7a1f4d' },
  { bg: '#fff6cf', ink: '#7a6206' },
  { bg: '#e6e0fb', ink: '#442f8a' },
];

export interface TestArtworkResult {
  canvas: HTMLCanvasElement;
  widthPx: number;
  heightPx: number;
}

/** Default DPI for the generated test artwork — legible without being huge. */
export const TEST_ARTWORK_DPI = 150;

export function renderTestArtwork(resolved: ResolvedGeometry, dpi = TEST_ARTWORK_DPI): TestArtworkResult {
  const bounds = resolved.blankBounds ?? { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } };
  const { width, height } = templatePixelSize(bounds, dpi);
  const frame = pixelFrameAtDpi(bounds, dpi);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, width, height);

  resolved.faces.forEach((face, i) => {
    const palette = PALETTE[i % PALETTE.length]!;
    const outer = face.outer.points.map((p: Vec2) => mmToPx(p, frame));
    if (outer.length < 3) return;

    const path = new Path2D();
    addRing(path, outer);
    for (const hole of face.holes) addRing(path, hole.points.map((p: Vec2) => mmToPx(p, frame)));

    ctx.save();
    ctx.clip(path, 'evenodd');

    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, width, height);

    const bboxW = Math.max(...outer.map((p) => p.x)) - Math.min(...outer.map((p) => p.x));
    const bboxH = Math.max(...outer.map((p) => p.y)) - Math.min(...outer.map((p) => p.y));
    const centre = mmToPx(face.centroid, frame);

    // The big F. `min(bboxW, bboxH)` so a long narrow flap gets a letter
    // sized to its short axis instead of overflowing it.
    const fSize = Math.max(10, Math.min(bboxW, bboxH) * 0.72);
    ctx.fillStyle = palette.ink;
    ctx.globalAlpha = 0.35;
    ctx.font = `900 ${fSize.toFixed(0)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('F', centre.x, centre.y);
    ctx.globalAlpha = 1;

    // The role label, small enough to fit even a narrow flap, still upright.
    const labelSize = Math.max(6, Math.min(bboxW, bboxH) * 0.14);
    ctx.font = `600 ${labelSize.toFixed(0)}px system-ui, sans-serif`;
    ctx.fillStyle = palette.ink;
    wrapLabel(ctx, face.role, centre.x, centre.y, Math.max(bboxW * 0.9, labelSize), labelSize * 1.2);

    ctx.restore();
  });

  return { canvas, widthPx: width, heightPx: height };
}

function addRing(path: Path2D, pts: Vec2[]): void {
  path.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i]!.x, pts[i]!.y);
  path.closePath();
}

/** Break a role like `back_panel_left.end_seal` across a couple of lines so it fits a narrow panel, still centred and upright. */
function wrapLabel(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, maxWidth: number, lineHeight: number): void {
  const words = text.split(/[._]/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const startY = cy + lineHeight * 2.1; // below the big F, not on top of it
  lines.forEach((line, i) => ctx.fillText(line, cx, startY + i * lineHeight));
}
