/**
 * Dimension-line geometry, in screen pixels — the math only, shared by the
 * 2D canvas (which draws it as SVG path strings) and the 3D pane (which
 * draws it with Canvas2D calls). Both panes project their own geometry to
 * screen space first (the 2D canvas via `modelToScreen`, the 3D pane via
 * `project` + `modelToScreen`), then hand the two measured points here —
 * this module knows nothing about mm, models or cameras, only 2D pixels,
 * so it is the one place the actual witness/arrowhead/label layout is
 * decided and gets to be pure and unit-tested.
 */
import type { Vec2 } from '../geometry/types.js';

export interface DimensionGeometry {
  /** The dimension line itself, offset out from the measured points. */
  line: [Vec2, Vec2];
  /** Extension ("witness") line segments running from each measured point out to the dimension line. */
  witnesses: [Vec2, Vec2][];
  /** One filled triangle per arrowhead, points in draw order. */
  arrowheads: [Vec2, Vec2, Vec2][];
  /** Where the label sits, and the angle (radians) to draw it at — flipped 180° whenever a literal reading would come out upside down. */
  label: { pos: Vec2; angle: number };
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
const len = (a: Vec2): number => Math.hypot(a.x, a.y);
const norm = (a: Vec2): Vec2 => {
  const l = len(a) || 1;
  return scale(a, 1 / l);
};
/** 90° CCW in screen space (y-down) — i.e. visually clockwise. */
const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

/**
 * Assembles a full dimension (witnesses, arrowheads, label) from FOUR
 * already-known screen points: each measured point (`p1`, `p2`) and where
 * its own witness line lands on the dimension line (`d1`, `d2`) — the line
 * connecting `d1`/`d2` need not be parallel to, or offset any particular
 * distance from, the `p1`/`p2` segment; nothing here assumes how `d1`/`d2`
 * were derived. That's what lets the SAME assembly serve two different
 * callers: `computeDimension` below, which derives `d1`/`d2` with a single
 * 2D perpendicular offset (right for the flat 2D pane), and the 3D pane,
 * which offsets in WORLD space along a third axis before projecting —
 * `d1`/`d2` there aren't even parallel to `p1`-`p2` in general once
 * projected, and this still assembles correctly because it never assumes
 * they are.
 */
export function assembleDimension(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2, arrowSizePx: number): DimensionGeometry {
  const dir = norm(sub(d2, d1));

  const arrow = (at: Vec2, pointInto: Vec2): [Vec2, Vec2, Vec2] => {
    const back = scale(pointInto, -arrowSizePx);
    const wing = scale(perp(pointInto), arrowSizePx * 0.38);
    return [at, add(add(at, back), wing), add(add(at, back), scale(wing, -1))];
  };

  let angle = Math.atan2(dir.y, dir.x);
  // Keep text upright: never let it read upside down (roughly -90..90 stays as-is).
  if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle -= Math.sign(angle) * Math.PI;

  const mid = scale(add(d1, d2), 0.5);
  // Push the label further out along whichever direction the dimension
  // line already sits offset from the measured points — general enough to
  // work whether that offset came from a single 2D perpendicular (the flat
  // pane) or a 3D offset collapsed by projection (the 3D pane), unlike a
  // fixed perp(dir) which would assume the former.
  const midMeasured = scale(add(p1, p2), 0.5);
  const away = norm(sub(mid, midMeasured));
  const labelOffset = scale(away, arrowSizePx * 0.9);

  return {
    line: [d1, d2],
    witnesses: [
      [p1, d1],
      [p2, d2],
    ],
    arrowheads: [arrow(d1, dir), arrow(d2, scale(dir, -1))],
    label: { pos: add(mid, labelOffset), angle },
  };
}

/**
 * The dimension line for the segment p1->p2, offset perpendicular to it by
 * `offsetPx` toward `offsetSide` (+1 or -1, which of the two perpendicular
 * directions) — the flat 2D pane's case, where the offset is a single fixed
 * screen-space distance because the measured segment and the page it's
 * drawn on share one plane. `assembleDimension` does the rest.
 */
export function computeDimension(p1: Vec2, p2: Vec2, offsetSide: 1 | -1, offsetPx: number, arrowSizePx: number): DimensionGeometry {
  const dir = norm(sub(p2, p1));
  const offset = scale(perp(dir), offsetSide * offsetPx);
  return assembleDimension(p1, add(p1, offset), p2, add(p2, offset), arrowSizePx);
}

export type LengthUnit = 'mm' | 'in';

/** `123.4 mm` or `4.86 in` — the one place a dimension value becomes display text, so the mm/inch toggle has one call site to change. Values stay mm internally everywhere else; this is display-only. */
export function formatLength(mm: number, unit: LengthUnit): string {
  return unit === 'in' ? `${(mm / 25.4).toFixed(2)} in` : `${mm.toFixed(1)} mm`;
}

/**
 * Draws an already-assembled dimension with Canvas2D calls — shared by
 * every canvas-based consumer (the 3D pane, the 2D drawing's PNG export)
 * so the visual language (witness weight, arrowhead shape, label
 * placement) can't drift between them. The SVG-based live 2D canvas draws
 * the same `DimensionGeometry` its own way, as path strings, since it has
 * no `CanvasRenderingContext2D` to hand this.
 */
export function drawDimensionCanvas(ctx: CanvasRenderingContext2D, g: DimensionGeometry, text: string, color: string, fontPx = 11): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  for (const [a, b] of g.witnesses) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(g.line[0].x, g.line[0].y);
  ctx.lineTo(g.line[1].x, g.line[1].y);
  ctx.stroke();
  for (const tri of g.arrowheads) {
    ctx.beginPath();
    ctx.moveTo(tri[0].x, tri[0].y);
    ctx.lineTo(tri[1].x, tri[1].y);
    ctx.lineTo(tri[2].x, tri[2].y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.save();
  ctx.translate(g.label.pos.x, g.label.pos.y);
  ctx.rotate(g.label.angle);
  ctx.font = `${fontPx}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}
