import { describe, expect, it } from 'vitest';
import { assembleDimension, computeDimension, formatLength } from '../dimension.js';

describe('assembleDimension — the general 4-point case (the 3D pane\'s own shape)', () => {
  it('handles a dimension line NOT parallel to the measured segment (an offset applied before projection)', () => {
    // p1/p2 measured horizontally; d1/d2 (already offset+projected) sit
    // below and to the right, at a totally different angle than p1-p2.
    const g = assembleDimension({ x: 0, y: 0 }, { x: 10, y: 40 }, { x: 100, y: 0 }, { x: 110, y: 40 }, 6);
    expect(g.line).toEqual([{ x: 10, y: 40 }, { x: 110, y: 40 }]);
    expect(g.witnesses).toEqual([
      [{ x: 0, y: 0 }, { x: 10, y: 40 }],
      [{ x: 100, y: 0 }, { x: 110, y: 40 }],
    ]);
    // Line direction here is pure +x, so label angle should be ~0.
    expect(g.label.angle).toBeCloseTo(0);
  });

  it('the label sits further from the measured points than the dimension line itself, on the side the offset actually went', () => {
    const g = assembleDimension({ x: 0, y: 0 }, { x: 0, y: 30 }, { x: 100, y: 0 }, { x: 100, y: 30 }, 6);
    const midMeasured = 0; // y of p1/p2
    const midLine = 30; // y of d1/d2
    expect(g.label.pos.y).toBeGreaterThan(midLine);
    expect(g.label.pos.y).toBeGreaterThan(midMeasured);
  });

  it('computeDimension is expressible in terms of assembleDimension for the same 2-point-plus-offset case', () => {
    const p1 = { x: 5, y: 5 };
    const p2 = { x: 95, y: 5 };
    const viaComputeDimension = computeDimension(p1, p2, 1, 15, 6);
    const dir = { x: 1, y: 0 };
    const offset = { x: -dir.y * 15, y: dir.x * 15 }; // perp * offsetSide(1) * offsetPx
    const viaAssemble = assembleDimension(p1, { x: p1.x + offset.x, y: p1.y + offset.y }, p2, { x: p2.x + offset.x, y: p2.y + offset.y }, 6);
    expect(viaComputeDimension.line).toEqual(viaAssemble.line);
    expect(viaComputeDimension.label.pos.x).toBeCloseTo(viaAssemble.label.pos.x);
    expect(viaComputeDimension.label.pos.y).toBeCloseTo(viaAssemble.label.pos.y);
  });
});

describe('computeDimension', () => {
  it('offsets the dimension line perpendicular to a horizontal segment', () => {
    const g = computeDimension({ x: 0, y: 0 }, { x: 100, y: 0 }, 1, 20, 6);
    // perp((1,0)) = (0,1); side +1 keeps it as-is -> offset (0,20)
    expect(g.line[0]).toEqual({ x: 0, y: 20 });
    expect(g.line[1]).toEqual({ x: 100, y: 20 });
  });

  it('the opposite side offsets the other way', () => {
    const g = computeDimension({ x: 0, y: 0 }, { x: 100, y: 0 }, -1, 20, 6);
    expect(g.line[0]).toEqual({ x: 0, y: -20 });
    expect(g.line[1]).toEqual({ x: 100, y: -20 });
  });

  it('witness lines connect each measured point straight out to the dimension line', () => {
    const g = computeDimension({ x: 0, y: 0 }, { x: 100, y: 0 }, 1, 20, 6);
    expect(g.witnesses[0]).toEqual([{ x: 0, y: 0 }, { x: 0, y: 20 }]);
    expect(g.witnesses[1]).toEqual([{ x: 100, y: 0 }, { x: 100, y: 20 }]);
  });

  it('arrowheads sit exactly at the dimension line ends', () => {
    const g = computeDimension({ x: 0, y: 0 }, { x: 100, y: 0 }, 1, 20, 6);
    expect(g.arrowheads[0]![0]).toEqual(g.line[0]);
    expect(g.arrowheads[1]![0]).toEqual(g.line[1]);
  });

  it('label sits near the midpoint', () => {
    const g = computeDimension({ x: 0, y: 0 }, { x: 100, y: 0 }, 1, 20, 6);
    expect(g.label.pos.x).toBeCloseTo(50);
    expect(g.label.pos.y).toBeGreaterThan(20); // offset further out from the line
  });

  it('label angle matches the line direction for a left-to-right segment', () => {
    const g = computeDimension({ x: 0, y: 0 }, { x: 100, y: 0 }, 1, 20, 6);
    expect(g.label.angle).toBeCloseTo(0);
  });

  it('a right-to-left segment (p1 right of p2) flips the label 180° so it never reads upside down', () => {
    const rtl = computeDimension({ x: 100, y: 0 }, { x: 0, y: 0 }, 1, 20, 6);
    const ltr = computeDimension({ x: 0, y: 0 }, { x: 100, y: 0 }, 1, 20, 6);
    expect(rtl.label.angle).toBeCloseTo(ltr.label.angle);
  });

  it('a vertical segment keeps text upright too (angle within +-90deg)', () => {
    const down = computeDimension({ x: 0, y: 0 }, { x: 0, y: 100 }, 1, 20, 6);
    expect(Math.abs(down.label.angle)).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    const up = computeDimension({ x: 0, y: 100 }, { x: 0, y: 0 }, 1, 20, 6);
    expect(Math.abs(up.label.angle)).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
  });

  it('degenerate (coincident) points do not throw or produce NaN', () => {
    const g = computeDimension({ x: 5, y: 5 }, { x: 5, y: 5 }, 1, 20, 6);
    for (const p of [...g.line, g.label.pos]) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe('formatLength', () => {
  it('renders mm with one decimal place', () => {
    expect(formatLength(123.456, 'mm')).toBe('123.5 mm');
    expect(formatLength(0, 'mm')).toBe('0.0 mm');
  });

  it('renders inches, converted from mm, with two decimal places', () => {
    expect(formatLength(25.4, 'in')).toBe('1.00 in');
    expect(formatLength(0, 'in')).toBe('0.00 in');
  });
});
