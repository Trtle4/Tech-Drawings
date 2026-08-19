/**
 * DXF R12 (AC1009) export for a cutting table.
 *
 * Written against the same constraints as the Cookie Tray / VFFS exporter,
 * which is proven on the shop's Kongsberg:
 *   - Strict R12. POLYLINE/VERTEX/SEQEND, LINE, ARC, CIRCLE, TEXT. No
 *     LWPOLYLINE (R13+), no splines.
 *   - Millimetres, y-up, 1:1. Nothing is scaled anywhere in this file.
 *
 * IMPORTANT: this exports from `graph.lines`, NOT from the resolved
 * arrangement. The arrangement flattens arcs to chords and splits every line at
 * its intersections, both of which are exactly what a cutting table should not
 * receive. The line objects are the authoritative geometry: an arc in the graph
 * becomes an ARC entity, and a slit stays one continuous cut.
 */

import type { DrawingLine, GeometryGraph, LineType, ResolvedGeometry, Vec2 } from '../geometry/types.js';
import { blankSize, materialArea } from '../geometry/resolve.js';
import { faceInteriorPoint } from '../geometry/faces.js';

export const DXF_LAYERS = [
  'CUT',
  'CREASE',
  'PERF',
  'BLEED',
  'DIMENSIONS',
  'TEXT',
  'TITLEBLOCK',
] as const;

export type DxfLayer = (typeof DXF_LAYERS)[number];

/** AutoCAD Color Index per layer. */
const LAYER_COLOR: Record<DxfLayer, number> = {
  CUT: 7, // white/black — the knife
  CREASE: 4, // cyan
  PERF: 3, // green
  BLEED: 5, // blue
  DIMENSIONS: 8, // grey
  TEXT: 8,
  TITLEBLOCK: 8,
};

/**
 * Line type to layer.
 *
 * `score` maps onto CREASE: the requested layer set has no SCORE layer, and a
 * score is a fold assist, so CREASE is the closest honest home. The report
 * counts how many were remapped so it is never silent.
 *
 * `construction` is reference geometry and has no business on a cutting table,
 * so it is dropped — again, counted in the report.
 */
const LAYER_FOR: Record<LineType, DxfLayer | null> = {
  cut: 'CUT',
  crease: 'CREASE',
  perf: 'PERF',
  score: 'CREASE',
  bleed: 'BLEED',
  dimension: 'DIMENSIONS',
  construction: null,
};

export interface DxfReport {
  entities: number;
  byLayer: Record<string, number>;
  /** Arcs written as true ARC entities. */
  arcs: number;
  /** Full circles written as CIRCLE entities. */
  circles: number;
  /**
   * Curves that had to be written as chord polylines. Must be 0 — if this is
   * ever non-zero the exporter has silently approximated something and the
   * caller should be told.
   */
  chordApproximated: { role: string; reason: string }[];
  /** Exactly coincident duplicate paths merged, to avoid double-cutting. */
  duplicatesMerged: number;
  /** Lines remapped to a layer that is not their natural one. */
  remapped: { role: string; from: LineType; to: DxfLayer }[];
  /** Lines deliberately not exported. */
  skipped: { role: string; type: LineType; reason: string }[];
  bounds: { min: Vec2; max: Vec2 } | null;
}

export interface DxfOptions {
  /** Panel labels on TEXT. Default true. */
  labels?: boolean;
  /** Overall blank dimensions on DIMENSIONS. Default true. */
  dimensions?: boolean;
  /** Title block on TITLEBLOCK. Default true. */
  titleBlock?: boolean;
  /** Free text row in the title block. */
  note?: string;
  /** Overrides the date row, for reproducible output in tests. */
  date?: string;
  /** Text height in mm for panel labels. Default 3.5. */
  textHeight?: number;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

class DxfWriter {
  private out: string[] = [];

  pair(code: number, value: string | number): void {
    this.out.push(String(code));
    this.out.push(typeof value === 'number' ? fmt(value) : value);
  }

  toString(): string {
    return this.out.join('\r\n') + '\r\n';
  }
}

/**
 * Coordinates go out untouched. The geometry model is already millimetres with
 * y increasing upward, which is the DXF convention, so there is no transform
 * here at all — that is what makes 1:1 verifiable rather than asserted.
 */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return '0';
  // 9 decimals: far beyond a cutting table's resolution, and enough that an
  // export/parse round trip compares exactly.
  const r = Math.round(v * 1e9) / 1e9;
  return Object.is(r, -0) ? '0' : String(r);
}

/** R12 strings are ASCII. Map what we can, drop the rest. */
function sanitize(s: string): string {
  return s
    .replace(/×/g, 'x')
    .replace(/⌀/g, 'DIA')
    .replace(/½/g, '1/2')
    .replace(/[–—]/g, '-')
    .replace(/[’']/g, "'")
    .replace(/°/g, 'DEG')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, '');
}

/** Below this a path is a point, not a cut. Millimetres. */
const ZERO_LENGTH = 1e-6;

function pathLength(pts: readonly Vec2[]): number {
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    total += Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);
  }
  return total;
}

const TAU = Math.PI * 2;
const degOf = (rad: number) => {
  let d = (rad * 180) / Math.PI;
  d %= 360;
  if (d < 0) d += 360;
  return d;
};

export function buildDxf(
  graph: GeometryGraph,
  resolved: ResolvedGeometry,
  opts: DxfOptions = {},
): { dxf: string; report: DxfReport } {
  const w = new DxfWriter();
  const report: DxfReport = {
    entities: 0,
    byLayer: Object.fromEntries(DXF_LAYERS.map((l) => [l, 0])),
    arcs: 0,
    circles: 0,
    chordApproximated: [],
    duplicatesMerged: 0,
    remapped: [],
    skipped: [],
    bounds: resolved.blankBounds,
  };

  const count = (layer: DxfLayer) => {
    report.entities++;
    report.byLayer[layer] = (report.byLayer[layer] ?? 0) + 1;
  };

  // ---- HEADER ----
  const b = resolved.blankBounds ?? { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  w.pair(0, 'SECTION');
  w.pair(2, 'HEADER');
  w.pair(9, '$ACADVER');
  w.pair(1, 'AC1009');
  w.pair(9, '$INSUNITS');
  w.pair(70, 4); // millimetres
  w.pair(9, '$MEASUREMENT');
  w.pair(70, 1); // metric
  w.pair(9, '$LTSCALE');
  w.pair(40, 1);
  w.pair(9, '$EXTMIN');
  w.pair(10, b.min.x);
  w.pair(20, b.min.y);
  w.pair(9, '$EXTMAX');
  w.pair(10, b.max.x);
  w.pair(20, b.max.y);
  w.pair(0, 'ENDSEC');

  // ---- TABLES ----
  w.pair(0, 'SECTION');
  w.pair(2, 'TABLES');
  w.pair(0, 'TABLE');
  w.pair(2, 'LAYER');
  w.pair(70, DXF_LAYERS.length);
  for (const layer of DXF_LAYERS) {
    w.pair(0, 'LAYER');
    w.pair(2, layer);
    w.pair(70, 0);
    w.pair(62, LAYER_COLOR[layer]);
    w.pair(6, 'CONTINUOUS');
  }
  w.pair(0, 'ENDTAB');
  w.pair(0, 'ENDSEC');

  // ---- ENTITIES ----
  w.pair(0, 'SECTION');
  w.pair(2, 'ENTITIES');

  // Exactly coincident paths would send the knife down the same line twice.
  // A zero-width slot produces exactly that: two cut edges at the same place.
  // Merge them, but never to nothing — one cut still has to happen.
  const seen = new Set<string>();

  for (const line of graph.lines) {
    const layer = LAYER_FOR[line.type];
    if (layer === null) {
      report.skipped.push({
        role: line.role,
        type: line.type,
        reason: 'construction geometry is not sent to the table',
      });
      continue;
    }
    if (layer !== LAYER_FOR.cut && line.type === 'score') {
      report.remapped.push({ role: line.role, from: line.type, to: layer });
    }

    const key = `${layer}|${signature(line)}`;
    if (seen.has(key)) {
      report.duplicatesMerged++;
      continue;
    }
    seen.add(key);

    if (line.geometry.kind === 'arc') {
      const { center, radius, startAngle, endAngle } = line.geometry;
      const sweep = endAngle - startAngle;
      if (radius <= ZERO_LENGTH || Math.abs(sweep) * radius <= ZERO_LENGTH) {
        report.skipped.push({
          role: line.role,
          type: line.type,
          reason: 'collapsed to zero length',
        });
        continue;
      }
      if (Math.abs(Math.abs(sweep) - TAU) < 1e-9 || Math.abs(sweep) > TAU - 1e-9) {
        circle(w, layer, center, radius);
        report.circles++;
        count(layer);
      } else {
        // A DXF arc always runs counter-clockwise from 50 to 51. A clockwise
        // sweep is the same curve with the ends swapped, so swap rather than
        // approximate.
        const ccw = sweep >= 0;
        arc(w, layer, center, radius, ccw ? startAngle : endAngle, ccw ? endAngle : startAngle);
        report.arcs++;
        count(layer);
      }
      continue;
    }

    const pts = line.geometry.points;
    if (pts.length < 2) {
      report.skipped.push({ role: line.role, type: line.type, reason: 'fewer than two points' });
      continue;
    }
    // A zero-width slot collapses its own end caps to a point. The slot walls
    // are real and must survive; a zero-length knife path is junk and must not
    // reach the table.
    if (pathLength(pts) <= ZERO_LENGTH) {
      report.skipped.push({
        role: line.role,
        type: line.type,
        reason: 'collapsed to zero length',
      });
      continue;
    }
    if (pts.length === 2) {
      segment(w, layer, pts[0]!, pts[1]!);
    } else {
      polyline(w, layer, pts, line.geometry.closed === true);
    }
    count(layer);
  }

  // ---- annotation layers ----
  const h = opts.textHeight ?? 3.5;
  if (opts.labels !== false) {
    for (const face of resolved.faces) {
      const at = faceInteriorPoint(face);
      if (!at) continue;
      text(w, 'TEXT', at, h, face.role.replace(/_/g, ' ').toUpperCase(), 1);
      count('TEXT');
    }
  }
  if (opts.dimensions !== false && resolved.blankBounds) {
    for (const n of overallDimensions(w, resolved, h)) count(n);
  }
  if (opts.titleBlock !== false) {
    for (const n of titleBlock(w, graph, resolved, h, opts)) count(n);
  }

  w.pair(0, 'ENDSEC');
  w.pair(0, 'EOF');

  return { dxf: w.toString(), report };
}

/** Direction-independent key for a path, so a reversed duplicate still matches. */
function signature(line: DrawingLine): string {
  if (line.geometry.kind === 'arc') {
    const g = line.geometry;
    return `arc:${fmt(g.center.x)},${fmt(g.center.y)},${fmt(g.radius)},${fmt(
      Math.min(g.startAngle, g.endAngle),
    )},${fmt(Math.max(g.startAngle, g.endAngle))}`;
  }
  const pts = line.geometry.points.map((p) => `${fmt(p.x)},${fmt(p.y)}`);
  const fwd = pts.join(';');
  const rev = [...pts].reverse().join(';');
  return `poly:${fwd < rev ? fwd : rev}`;
}

// ---------------------------------------------------------------------------
// Entity writers
// ---------------------------------------------------------------------------

function segment(w: DxfWriter, layer: DxfLayer, a: Vec2, b: Vec2): void {
  w.pair(0, 'LINE');
  w.pair(8, layer);
  w.pair(10, a.x);
  w.pair(20, a.y);
  w.pair(30, 0);
  w.pair(11, b.x);
  w.pair(21, b.y);
  w.pair(31, 0);
}

function polyline(w: DxfWriter, layer: DxfLayer, pts: readonly Vec2[], closed: boolean): void {
  w.pair(0, 'POLYLINE');
  w.pair(8, layer);
  w.pair(66, 1); // vertices follow — required in R12
  w.pair(70, closed ? 1 : 0);
  for (const p of pts) {
    w.pair(0, 'VERTEX');
    w.pair(8, layer);
    w.pair(10, p.x);
    w.pair(20, p.y);
    w.pair(30, 0);
  }
  w.pair(0, 'SEQEND');
  w.pair(8, layer);
}

function arc(
  w: DxfWriter,
  layer: DxfLayer,
  center: Vec2,
  radius: number,
  startRad: number,
  endRad: number,
): void {
  w.pair(0, 'ARC');
  w.pair(8, layer);
  w.pair(10, center.x);
  w.pair(20, center.y);
  w.pair(30, 0);
  w.pair(40, radius);
  w.pair(50, degOf(startRad));
  w.pair(51, degOf(endRad));
}

function circle(w: DxfWriter, layer: DxfLayer, center: Vec2, radius: number): void {
  w.pair(0, 'CIRCLE');
  w.pair(8, layer);
  w.pair(10, center.x);
  w.pair(20, center.y);
  w.pair(30, 0);
  w.pair(40, radius);
}

/** halign: 0 left, 1 centre, 2 right. */
function text(
  w: DxfWriter,
  layer: DxfLayer,
  at: Vec2,
  height: number,
  value: string,
  halign: 0 | 1 | 2,
  rotation = 0,
): void {
  w.pair(0, 'TEXT');
  w.pair(8, layer);
  w.pair(10, at.x);
  w.pair(20, at.y);
  w.pair(30, 0);
  w.pair(40, height);
  w.pair(1, sanitize(value));
  if (rotation) w.pair(50, rotation);
  if (halign !== 0) {
    w.pair(72, halign);
    w.pair(11, at.x);
    w.pair(21, at.y);
    w.pair(31, 0);
  }
}

// ---------------------------------------------------------------------------
// Annotation
// ---------------------------------------------------------------------------

/** Arrowhead as two short strokes, so it survives R12 with no block table. */
function arrowhead(w: DxfWriter, layer: DxfLayer, tip: Vec2, from: Vec2, size: number): void {
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
  for (const spread of [0.35, -0.35]) {
    segment(w, layer, tip, {
      x: tip.x - size * Math.cos(ang + spread),
      y: tip.y - size * Math.sin(ang + spread),
    });
  }
}

function overallDimensions(w: DxfWriter, resolved: ResolvedGeometry, h: number): DxfLayer[] {
  const b = resolved.blankBounds!;
  const size = blankSize(resolved)!;
  const off = Math.max(size.width, size.height) * 0.04 + h * 2;
  const arrow = h * 0.9;
  const emitted: DxfLayer[] = [];
  const push = (n: number) => {
    for (let i = 0; i < n; i++) emitted.push('DIMENSIONS');
  };

  // Width, below the blank.
  const yd = b.min.y - off;
  segment(w, 'DIMENSIONS', { x: b.min.x, y: b.min.y - h * 0.5 }, { x: b.min.x, y: yd - h });
  segment(w, 'DIMENSIONS', { x: b.max.x, y: b.min.y - h * 0.5 }, { x: b.max.x, y: yd - h });
  segment(w, 'DIMENSIONS', { x: b.min.x, y: yd }, { x: b.max.x, y: yd });
  arrowhead(w, 'DIMENSIONS', { x: b.min.x, y: yd }, { x: b.min.x + arrow, y: yd }, arrow);
  arrowhead(w, 'DIMENSIONS', { x: b.max.x, y: yd }, { x: b.max.x - arrow, y: yd }, arrow);
  push(7);
  text(w, 'DIMENSIONS', { x: (b.min.x + b.max.x) / 2, y: yd + h * 0.6 }, h, size.width.toFixed(1), 1);
  push(1);

  // Height, to the right.
  const xd = b.max.x + off;
  segment(w, 'DIMENSIONS', { x: b.max.x + h * 0.5, y: b.min.y }, { x: xd + h, y: b.min.y });
  segment(w, 'DIMENSIONS', { x: b.max.x + h * 0.5, y: b.max.y }, { x: xd + h, y: b.max.y });
  segment(w, 'DIMENSIONS', { x: xd, y: b.min.y }, { x: xd, y: b.max.y });
  arrowhead(w, 'DIMENSIONS', { x: xd, y: b.min.y }, { x: xd, y: b.min.y + arrow }, arrow);
  arrowhead(w, 'DIMENSIONS', { x: xd, y: b.max.y }, { x: xd, y: b.max.y - arrow }, arrow);
  push(7);
  text(w, 'DIMENSIONS', { x: xd + h * 0.6, y: (b.min.y + b.max.y) / 2 }, h, size.height.toFixed(1), 1, 90);
  push(1);

  return emitted;
}

function titleBlock(
  w: DxfWriter,
  graph: GeometryGraph,
  resolved: ResolvedGeometry,
  h: number,
  opts: DxfOptions,
): DxfLayer[] {
  const b = resolved.blankBounds;
  if (!b) return [];
  const size = blankSize(resolved)!;
  const meta = (graph.meta ?? {}) as Record<string, unknown>;

  const rows: [string, string][] = [
    ['STYLE', String(meta.styleName ?? 'Untitled')],
    ['CODE', meta.code ? `${meta.standard ?? ''} ${meta.code}`.trim() : '-'],
    ['BLANK', `${size.width.toFixed(1)} x ${size.height.toFixed(1)} mm`],
    ['CALIPER', `${graph.caliper} mm`],
    ['BOARD', `${Math.round(materialArea(resolved))} mm2`],
    ['FACES', `${resolved.faces.length} / ${resolved.hinges.length} hinges`],
    ['SCALE', '1:1'],
    ['DATE', opts.date ?? new Date().toISOString().slice(0, 10)],
    ['NOTE', opts.note ?? ''],
  ];

  const rowH = h * 2;
  const keyW = h * 8;
  const valW = h * 22;
  const boxW = keyW + valW;
  const boxH = rowH * (rows.length + 1);
  // Below the blank, to the right, clear of the dimension lines.
  const x0 = b.max.x - boxW;
  const y0 = b.min.y - Math.max(size.width, size.height) * 0.04 - h * 2 - boxH - rowH * 2;

  const emitted: DxfLayer[] = [];
  const push = (n = 1) => {
    for (let i = 0; i < n; i++) emitted.push('TITLEBLOCK');
  };

  // Outer box.
  polyline(
    w,
    'TITLEBLOCK',
    [
      { x: x0, y: y0 },
      { x: x0 + boxW, y: y0 },
      { x: x0 + boxW, y: y0 + boxH },
      { x: x0, y: y0 + boxH },
    ],
    true,
  );
  push();

  // Header strip.
  const headY = y0 + boxH - rowH;
  segment(w, 'TITLEBLOCK', { x: x0, y: headY }, { x: x0 + boxW, y: headY });
  push();
  text(w, 'TITLEBLOCK', { x: x0 + h * 0.6, y: headY + rowH * 0.3 }, h * 1.1, 'DIELINE STUDIO', 0);
  push();

  rows.forEach(([k, v], i) => {
    const y = headY - rowH * (i + 1);
    segment(w, 'TITLEBLOCK', { x: x0, y }, { x: x0 + boxW, y });
    push();
    text(w, 'TITLEBLOCK', { x: x0 + h * 0.6, y: y + rowH * 0.3 }, h * 0.85, k, 0);
    push();
    text(w, 'TITLEBLOCK', { x: x0 + keyW + h * 0.6, y: y + rowH * 0.3 }, h, v, 0);
    push();
  });

  // Column divider.
  segment(w, 'TITLEBLOCK', { x: x0 + keyW, y: y0 }, { x: x0 + keyW, y: headY });
  push();

  return emitted;
}
