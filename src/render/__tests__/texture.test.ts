import { describe, expect, it } from 'vitest';
import { mmToPx, pixelFrame, pixelFrameAtDpi, templatePixelSize, triangleAffine } from '../texture.js';

describe('mmToPx — the flat-blank-to-template-pixel registration', () => {
  const bounds = { min: { x: 0, y: 0 }, max: { x: 100, y: 200 } };

  it('maps the blank min (bottom-left in model space) to the bottom-left pixel', () => {
    const frame = pixelFrame(bounds, 100, 200); // 1 px/mm
    const p = mmToPx({ x: 0, y: 0 }, frame);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(200); // y-up model min lands at the bottom of a y-down image
  });

  it('maps the blank max (top-right in model space) to the top-right pixel', () => {
    const frame = pixelFrame(bounds, 100, 200);
    const p = mmToPx({ x: 100, y: 200 }, frame);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(0);
  });

  it('is exactly onto for an offset, non-zero-origin bounds box', () => {
    const b = { min: { x: -30, y: 40 }, max: { x: 70, y: 140 } };
    const frame = pixelFrame(b, 100, 100);
    expect(mmToPx({ x: -30, y: 140 }, frame)).toEqual({ x: 0, y: 0 });
    expect(mmToPx({ x: 70, y: 40 }, frame)).toEqual({ x: 100, y: 100 });
    const mid = mmToPx({ x: 20, y: 90 }, frame);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(50);
  });

  it('pixelFrameAtDpi produces square pixels at the stated DPI', () => {
    const frame = pixelFrameAtDpi(bounds, 300);
    expect(frame.pxPerMmX).toBeCloseTo(300 / 25.4);
    expect(frame.pxPerMmY).toBeCloseTo(300 / 25.4);
  });

  it('templatePixelSize matches pixelFrameAtDpi exactly — export and texture sampling never disagree', () => {
    const dpi = 300;
    const size = templatePixelSize(bounds, dpi);
    const frame = pixelFrameAtDpi(bounds, dpi);
    expect(size.width).toBeCloseTo((bounds.max.x - bounds.min.x) * frame.pxPerMmX, 0);
    expect(size.height).toBeCloseTo((bounds.max.y - bounds.min.y) * frame.pxPerMmY, 0);
  });
});

describe('triangleAffine', () => {
  it('the identity transform for a triangle mapped to itself', () => {
    const s0 = { x: 0, y: 0 };
    const s1 = { x: 10, y: 0 };
    const s2 = { x: 0, y: 10 };
    const m = triangleAffine(s0, s1, s2, s0, s1, s2)!;
    expect(m).not.toBeNull();
    for (const p of [s0, s1, s2, { x: 3, y: 4 }]) {
      const x = m.a * p.x + m.c * p.y + m.e;
      const y = m.b * p.x + m.d * p.y + m.f;
      expect(x).toBeCloseTo(p.x);
      expect(y).toBeCloseTo(p.y);
    }
  });

  it('a pure translation', () => {
    const s0 = { x: 0, y: 0 };
    const s1 = { x: 10, y: 0 };
    const s2 = { x: 0, y: 10 };
    const d0 = { x: 5, y: 5 };
    const d1 = { x: 15, y: 5 };
    const d2 = { x: 5, y: 15 };
    const m = triangleAffine(s0, s1, s2, d0, d1, d2)!;
    const apply = (p: { x: number; y: number }) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
    expect(apply(s0)).toEqual({ x: 5, y: 5 });
    expect(apply(s1)).toEqual({ x: 15, y: 5 });
    expect(apply(s2)).toEqual({ x: 5, y: 15 });
  });

  it('a rotation + scale, verified at all three correspondences and an interior point', () => {
    const s0 = { x: 0, y: 0 };
    const s1 = { x: 1, y: 0 };
    const s2 = { x: 0, y: 1 };
    // 90 deg rotation and 2x scale
    const d0 = { x: 0, y: 0 };
    const d1 = { x: 0, y: 2 };
    const d2 = { x: -2, y: 0 };
    const m = triangleAffine(s0, s1, s2, d0, d1, d2)!;
    const apply = (p: { x: number; y: number }) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
    expect(apply(s0)).toEqual({ x: 0, y: 0 });
    expect(apply(s1)).toEqual({ x: 0, y: 2 });
    expect(apply(s2)).toEqual({ x: -2, y: 0 });
    const mid = apply({ x: 0.5, y: 0.5 });
    expect(mid.x).toBeCloseTo(-1);
    expect(mid.y).toBeCloseTo(1);
  });

  it('returns null for a degenerate (collinear / zero-area) source triangle', () => {
    const m = triangleAffine({ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 });
    expect(m).toBeNull();
  });
});
