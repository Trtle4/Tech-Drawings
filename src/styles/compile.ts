/**
 * Style definition -> geometry graph.
 *
 * The compiler is the only code that understands the schema. Every style shares
 * it, so a new catalogue entry is a data file and nothing else.
 */

import type {
  DrawingLine,
  FaceSeed,
  FeatureInstance,
  GeometryGraph,
  LineType,
  Path,
  SealZone,
  Vec2,
} from '../geometry/types.js';
import { STRUCTURAL_TYPES } from '../geometry/types.js';
import { flattenPath } from '../geometry/arrangement.js';
import { boundsOf } from '../geometry/math.js';
import { evalExpr, type Expr, type Scope } from './expr.js';
import type {
  BoundaryKind,
  BoundarySpec,
  CellSpec,
  CompiledStyle,
  ExtraLineSpec,
  StyleDefinition,
} from './schema.js';

const DEFAULT_ANGLE_DEG = 90;

interface Track {
  id: string;
  size: number;
  start: number;
  end: number;
  index: number;
}

interface PlacedCell extends CellSpec {
  row: string;
  col: string;
  rowIndex: number;
  colIndex: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface CompileOptions {
  /** User-set parameter values, by param id. Clamped to the spec's range. */
  params?: Record<string, number>;
}

export function compileStyle(def: StyleDefinition, opts: CompileOptions = {}): CompiledStyle {
  const warnings: string[] = [];
  const params = resolveParams(def, opts.params ?? {}, warnings);
  const scope: Scope = params;

  const caliper = params.caliper;
  if (caliper === undefined) {
    warnings.push(`Style "${def.id}" declares no "caliper" parameter; assuming 0.5 mm.`);
  }

  const lines: DrawingLine[] = [];
  const seeds: FaceSeed[] = [];
  const hingeAngles: Record<string, number> = {};
  let nextId = 0;
  const idFor = (role: string) => `${def.id}:${role}#${++nextId}`;

  const emit = (
    type: LineType,
    role: string,
    points: Vec2[],
    extra: { closed?: boolean; angleDeg?: number } = {},
  ) => {
    lines.push({
      id: idFor(role),
      type,
      role,
      geometry: { kind: 'polyline', points, ...(extra.closed ? { closed: true } : {}) },
      sourceStyle: def.id,
    });
    if (extra.angleDeg !== undefined) hingeAngles[role] = (extra.angleDeg * Math.PI) / 180;
  };

  let blank = { width: 0, height: 0 };

  if (def.grid) {
    const columns = layoutTracks(def.grid.columns, scope);
    const rows = layoutTracks(def.grid.rows, scope);
    blank = {
      width: columns.length ? columns[columns.length - 1]!.end : 0,
      height: rows.length ? rows[rows.length - 1]!.end : 0,
    };

    const boundaries = def.grid.boundaries ?? [];
    const cells = placeCells(def.grid.cells, columns, rows, boundaries, scope, warnings);
    emitGrid(cells, columns, rows, boundaries, scope, emit, seeds);
  }

  for (const spec of def.extraLines ?? []) {
    if (!present(spec.presentIf, scope)) continue;
    emitExtraLine(spec, scope, def.id, idFor, lines, hingeAngles);
  }

  for (const spec of def.extraSeeds ?? []) {
    if (!present(spec.presentIf, scope)) continue;
    seeds.push({
      role: spec.role,
      point: { x: evalExpr(spec.point.x, scope), y: evalExpr(spec.point.y, scope) },
      ...(spec.kind ? { kind: spec.kind } : {}),
    });
  }

  const seals: SealZone[] = (def.seals ?? []).map((s) => ({
    id: s.id,
    kind: s.kind,
    role: s.role,
    boundFaceRoles: [...s.boundFaceRoles],
    width: evalExpr(s.width, scope),
    plies: s.plies === undefined ? 2 : Math.max(1, Math.round(evalExpr(s.plies, scope))),
    sourceStyle: def.id,
  }));

  const features: FeatureInstance[] = [];
  for (const f of def.features ?? []) {
    if (!present(f.presentIf, scope)) continue;
    features.push({
      id: f.id,
      kind: f.kind,
      anchorFaceRole: f.anchorFaceRole,
      referenceEdgeRole: f.referenceEdgeRole,
      offset: { x: evalExpr(f.offset.x, scope), y: evalExpr(f.offset.y, scope) },
      rotation: f.rotation === undefined ? 0 : (evalExpr(f.rotation, scope) * Math.PI) / 180,
      size: { x: evalExpr(f.size.x, scope), y: evalExpr(f.size.y, scope) },
      sourceStyle: def.id,
    });
  }

  // A gridless style has no tracks to measure, so the blank comes from the
  // geometry it emitted. Grid styles keep the declared figure, which is what
  // makes the cross-check against `resolveGeometry` meaningful.
  if (!def.grid) {
    const pts: Vec2[] = [];
    for (const line of lines) {
      if (!STRUCTURAL_TYPES.includes(line.type)) continue;
      pts.push(...flattenPath(line.geometry));
    }
    const b = boundsOf(pts);
    if (b) blank = { width: b.max.x - b.min.x, height: b.max.y - b.min.y };
  }

  const baseRole = def.baseFaceRole ?? def.grid?.cells.find((c) => c.base)?.role;

  const graph: GeometryGraph = {
    units: 'mm',
    caliper: caliper ?? 0.5,
    lines,
    seals,
    features,
    faceSeeds: seeds,
    hingeAngles,
    ...(baseRole ? { baseFaceRole: baseRole } : {}),
    meta: { styleId: def.id, styleName: def.name, standard: def.standard, code: def.code, params },
  };

  return { definition: def, params, graph, blank, warnings };
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

/**
 * Defaults may reference other parameters (`"W/2"`), so evaluation repeats
 * until it stops making progress rather than assuming a declaration order.
 */
function resolveParams(
  def: StyleDefinition,
  overrides: Record<string, number>,
  warnings: string[],
): Record<string, number> {
  const values: Record<string, number> = {};
  let pending = [...def.params];

  for (let pass = 0; pass <= def.params.length && pending.length > 0; pass++) {
    const stuck: typeof pending = [];
    for (const spec of pending) {
      const override = overrides[spec.id];
      if (override !== undefined && Number.isFinite(override)) {
        values[spec.id] = override;
        continue;
      }
      try {
        values[spec.id] = evalExpr(spec.default, values);
      } catch {
        stuck.push(spec);
      }
    }
    if (stuck.length === pending.length) {
      for (const spec of stuck) {
        warnings.push(
          `Parameter "${spec.id}" could not be resolved (circular or unknown reference); using 0.`,
        );
        values[spec.id] = 0;
      }
      pending = [];
      break;
    }
    pending = stuck;
  }

  // Clamp after everything resolves, so a bound may itself be an expression.
  for (const spec of def.params) {
    const v = values[spec.id]!;
    let clamped = v;
    if (spec.min !== undefined) clamped = Math.max(clamped, evalExpr(spec.min, values));
    if (spec.max !== undefined) clamped = Math.min(clamped, evalExpr(spec.max, values));
    if (clamped !== v) {
      warnings.push(`${spec.label} clamped from ${fmt(v)} to ${fmt(clamped)} mm.`);
      values[spec.id] = clamped;
    }
  }
  return values;
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

function present(expr: Expr | undefined, scope: Scope): boolean {
  if (expr === undefined) return true;
  try {
    return evalExpr(expr, scope) > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Grid layout
// ---------------------------------------------------------------------------

function layoutTracks(specs: readonly { id: string; size: Expr; presentIf?: Expr }[], scope: Scope): Track[] {
  const out: Track[] = [];
  let cursor = 0;
  for (const spec of specs) {
    if (!present(spec.presentIf, scope)) continue;
    const size = evalExpr(spec.size, scope);
    if (!(size > 0)) continue;
    out.push({ id: spec.id, size, start: cursor, end: cursor + size, index: out.length });
    cursor += size;
  }
  return out;
}

/** Matches a boundary override against a specific boundary. */
function matches(
  spec: BoundarySpec,
  axis: 'v' | 'h',
  afterId: string,
  withinId: string,
): boolean {
  if (spec.axis !== axis) return false;
  if (spec.after !== undefined) {
    const list = Array.isArray(spec.after) ? spec.after : [spec.after];
    if (!list.includes(afterId)) return false;
  }
  if (spec.within !== undefined) {
    const list = Array.isArray(spec.within) ? spec.within : [spec.within];
    if (!list.includes(withinId)) return false;
  }
  return true;
}

interface Boundary {
  kind: BoundaryKind;
  width: number;
  angleDeg: number;
  role?: string;
}

/** The last matching override wins, so later entries refine earlier ones. */
function boundaryFor(
  specs: readonly BoundarySpec[],
  axis: 'v' | 'h',
  afterId: string,
  withinId: string,
  scope: Scope,
): Boundary {
  let result: Boundary = { kind: 'crease', width: 0, angleDeg: DEFAULT_ANGLE_DEG };
  for (const spec of specs) {
    if (!matches(spec, axis, afterId, withinId)) continue;
    result = {
      kind: spec.kind,
      width: spec.width === undefined ? 0 : evalExpr(spec.width, scope),
      angleDeg: spec.angle === undefined ? DEFAULT_ANGLE_DEG : evalExpr(spec.angle, scope),
      ...(spec.role ? { role: spec.role } : {}),
    };
  }
  return result;
}

function placeCells(
  specs: readonly CellSpec[],
  columns: Track[],
  rows: Track[],
  boundaries: readonly BoundarySpec[],
  scope: Scope,
  warnings: string[],
): (PlacedCell | null)[][] {
  const colByIndex = new Map(columns.map((c) => [c.id, c]));
  const rowByIndex = new Map(rows.map((r) => [r.id, r]));
  const grid: (PlacedCell | null)[][] = rows.map(() => columns.map(() => null));
  const seenRoles = new Set<string>();

  for (const spec of specs) {
    const col = colByIndex.get(spec.col);
    const row = rowByIndex.get(spec.row);
    if (!col || !row) continue; // its track was omitted; not an error
    if (!present(spec.presentIf, scope)) continue;
    if (seenRoles.has(spec.role)) {
      warnings.push(`Duplicate cell role "${spec.role}"; the later one is ignored.`);
      continue;
    }
    seenRoles.add(spec.role);
    grid[row.index]![col.index] = {
      ...spec,
      rowIndex: row.index,
      colIndex: col.index,
      x0: col.start,
      x1: col.end,
      y0: row.start,
      y1: row.end,
    };
  }

  // Slots eat material from both cells they separate, so shrink the cells and
  // leave the gap as air.
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < columns.length; c++) {
      const cell = grid[r]![c];
      if (!cell) continue;
      const left = c > 0 ? grid[r]![c - 1] : null;
      const right = c + 1 < columns.length ? grid[r]![c + 1] : null;
      const below = r > 0 ? grid[r - 1]![c] : null;
      const above = r + 1 < rows.length ? grid[r + 1]![c] : null;

      if (left) {
        const b = boundaryFor(boundaries, 'v', columns[c - 1]!.id, rows[r]!.id, scope);
        if (b.kind === 'slot') cell.x0 += b.width / 2;
      }
      if (right) {
        const b = boundaryFor(boundaries, 'v', columns[c]!.id, rows[r]!.id, scope);
        if (b.kind === 'slot') cell.x1 -= b.width / 2;
      }
      if (below) {
        const b = boundaryFor(boundaries, 'h', rows[r - 1]!.id, columns[c]!.id, scope);
        if (b.kind === 'slot') cell.y0 += b.width / 2;
      }
      if (above) {
        const b = boundaryFor(boundaries, 'h', rows[r]!.id, columns[c]!.id, scope);
        if (b.kind === 'slot') cell.y1 -= b.width / 2;
      }
      // Per-cell inset, applied after slots so a cell can be both slotted and
      // shortened. This is what lets one flap row hold flaps of two depths.
      if (cell.inset) {
        if (cell.inset.left !== undefined) cell.x0 += evalExpr(cell.inset.left, scope);
        if (cell.inset.right !== undefined) cell.x1 -= evalExpr(cell.inset.right, scope);
        if (cell.inset.bottom !== undefined) cell.y0 += evalExpr(cell.inset.bottom, scope);
        if (cell.inset.top !== undefined) cell.y1 -= evalExpr(cell.inset.top, scope);
      }

      if (cell.x1 - cell.x0 <= 0 || cell.y1 - cell.y0 <= 0) {
        warnings.push(`Cell "${cell.role}" collapsed to nothing and was dropped.`);
        grid[r]![c] = null;
      }
    }
  }

  return grid;
}

type Emitter = (
  type: LineType,
  role: string,
  points: Vec2[],
  extra?: { closed?: boolean; angleDeg?: number },
) => void;

function emitGrid(
  grid: (PlacedCell | null)[][],
  columns: Track[],
  rows: Track[],
  boundaries: readonly BoundarySpec[],
  scope: Scope,
  emit: Emitter,
  seeds: FaceSeed[],
): void {
  const at = (r: number, c: number): PlacedCell | null =>
    r < 0 || r >= rows.length || c < 0 || c >= columns.length ? null : (grid[r]![c] ?? null);

  const foldType = (k: BoundaryKind): LineType =>
    k === 'score' ? 'score' : k === 'perf' ? 'perf' : 'crease';

  // Vertical boundaries, including the two outer edges (c = -1 and the last).
  for (let r = 0; r < rows.length; r++) {
    for (let c = -1; c < columns.length; c++) {
      const a = at(r, c);
      const b = at(r, c + 1);
      if (!a && !b) continue;

      if (a && !b) {
        emit('cut', `${a.role}.right_edge`, [
          { x: a.x1, y: a.y0 },
          { x: a.x1, y: a.y1 },
        ]);
        continue;
      }
      if (!a && b) {
        emit('cut', `${b.role}.left_edge`, [
          { x: b.x0, y: b.y0 },
          { x: b.x0, y: b.y1 },
        ]);
        continue;
      }

      const spec = boundaryFor(boundaries, 'v', columns[c]!.id, rows[r]!.id, scope);
      if (spec.kind === 'none') continue;
      const y0 = Math.min(a!.y0, b!.y0);
      const y1 = Math.max(a!.y1, b!.y1);

      if (spec.kind === 'slot') {
        emit('cut', `${a!.role}.right_edge`, [
          { x: a!.x1, y: a!.y0 },
          { x: a!.x1, y: a!.y1 },
        ]);
        emit('cut', `${b!.role}.left_edge`, [
          { x: b!.x0, y: b!.y0 },
          { x: b!.x0, y: b!.y1 },
        ]);
        // The knife closes the slot wherever there is board beyond its end.
        const slotRole = spec.role ?? `slot.${a!.role}__${b!.role}`;
        if (at(r - 1, c) || at(r - 1, c + 1)) {
          emit('cut', `${slotRole}.bottom_end`, [
            { x: a!.x1, y: y0 },
            { x: b!.x0, y: y0 },
          ]);
        }
        if (at(r + 1, c) || at(r + 1, c + 1)) {
          emit('cut', `${slotRole}.top_end`, [
            { x: a!.x1, y: y1 },
            { x: b!.x0, y: y1 },
          ]);
        }
        continue;
      }

      const role = spec.role ?? `fold.${a!.role}__${b!.role}`;
      const x = a!.x1;
      const type: LineType = spec.kind === 'cut' ? 'cut' : foldType(spec.kind);
      emit(
        type,
        role,
        [
          { x, y: y0 },
          { x, y: y1 },
        ],
        type === 'cut' ? {} : { angleDeg: spec.angleDeg },
      );
    }
  }

  // Horizontal boundaries, same shape.
  for (let c = 0; c < columns.length; c++) {
    for (let r = -1; r < rows.length; r++) {
      const a = at(r, c);
      const b = at(r + 1, c);
      if (!a && !b) continue;

      if (a && !b) {
        emit('cut', `${a.role}.top_edge`, [
          { x: a.x0, y: a.y1 },
          { x: a.x1, y: a.y1 },
        ]);
        continue;
      }
      if (!a && b) {
        emit('cut', `${b.role}.bottom_edge`, [
          { x: b.x0, y: b.y0 },
          { x: b.x1, y: b.y0 },
        ]);
        continue;
      }

      const spec = boundaryFor(boundaries, 'h', rows[r]!.id, columns[c]!.id, scope);
      if (spec.kind === 'none') continue;
      const x0 = Math.min(a!.x0, b!.x0);
      const x1 = Math.max(a!.x1, b!.x1);

      if (spec.kind === 'slot') {
        emit('cut', `${a!.role}.top_edge`, [
          { x: a!.x0, y: a!.y1 },
          { x: a!.x1, y: a!.y1 },
        ]);
        emit('cut', `${b!.role}.bottom_edge`, [
          { x: b!.x0, y: b!.y0 },
          { x: b!.x1, y: b!.y0 },
        ]);
        const slotRole = spec.role ?? `slot.${a!.role}__${b!.role}`;
        if (at(r, c - 1) || at(r + 1, c - 1)) {
          emit('cut', `${slotRole}.left_end`, [
            { x: x0, y: a!.y1 },
            { x: x0, y: b!.y0 },
          ]);
        }
        if (at(r, c + 1) || at(r + 1, c + 1)) {
          emit('cut', `${slotRole}.right_end`, [
            { x: x1, y: a!.y1 },
            { x: x1, y: b!.y0 },
          ]);
        }
        continue;
      }

      const role = spec.role ?? `fold.${a!.role}__${b!.role}`;
      const y = a!.y1;
      const type: LineType = spec.kind === 'cut' ? 'cut' : foldType(spec.kind);
      emit(
        type,
        role,
        [
          { x: x0, y },
          { x: x1, y },
        ],
        type === 'cut' ? {} : { angleDeg: spec.angleDeg },
      );
    }
  }

  // One seed per cell, at its centre — the style naming its own panels.
  for (const row of grid) {
    for (const cell of row) {
      if (!cell) continue;
      seeds.push({
        role: cell.role,
        kind: cell.kind,
        point: { x: (cell.x0 + cell.x1) / 2, y: (cell.y0 + cell.y1) / 2 },
      });
    }
  }
}

/**
 * Solve an arc from two endpoints and a sagitta.
 *
 * Writing this as centre + radius + angles in the definition would mean an
 * atan2 in the data for every curved edge; a curved edge is dimensioned by
 * where it starts, where it ends, and how far it bows.
 */
function solveArcThrough(a: Vec2, b: Vec2, sagitta: number): Path {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const chord = Math.hypot(dx, dy);
  // Too flat to be an arc, or degenerate endpoints — a straight line is the
  // right answer, not an error.
  if (chord < 1e-9 || Math.abs(sagitta) < 1e-6) {
    return { kind: 'polyline', points: [a, b] };
  }
  // Left normal of a -> b.
  const nx = -dy / chord;
  const ny = dx / chord;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

  // Signed radius: R = (c²/4 + u²) / 2u, centre at mid + n·(u − R).
  const rSigned = (chord * chord * 0.25 + sagitta * sagitta) / (2 * sagitta);
  const t = sagitta - rSigned;
  const center = { x: mid.x + nx * t, y: mid.y + ny * t };
  const radius = Math.abs(rSigned);

  const ang = (p: Vec2) => Math.atan2(p.y - center.y, p.x - center.x);
  const start = ang(a);
  let end = ang(b);
  const bulge = ang({ x: mid.x + nx * sagitta, y: mid.y + ny * sagitta });

  // Pick the winding that actually passes through the bulge point, so the
  // flattened chord run bows the way the definition asked for.
  const passesThrough = (e: number) => {
    const span = e - start;
    const toBulge = bulge - start;
    const norm = (v: number) => {
      let x = v;
      while (x > Math.PI) x -= 2 * Math.PI;
      while (x < -Math.PI) x += 2 * Math.PI;
      return x;
    };
    return Math.sign(norm(toBulge)) === Math.sign(span) && Math.abs(norm(toBulge)) <= Math.abs(span);
  };
  if (!passesThrough(end)) end += end > start ? -2 * Math.PI : 2 * Math.PI;

  return { kind: 'arc', center, radius, startAngle: start, endAngle: end };
}

function emitExtraLine(
  spec: ExtraLineSpec,
  scope: Scope,
  styleId: string,
  idFor: (role: string) => string,
  lines: DrawingLine[],
  hingeAngles: Record<string, number>,
): void {
  const pt = (q: { x: Expr; y: Expr }): Vec2 => ({
    x: evalExpr(q.x, scope),
    y: evalExpr(q.y, scope),
  });

  let geometry: Path;
  if (spec.arcThrough) {
    geometry = solveArcThrough(
      pt(spec.arcThrough.from),
      pt(spec.arcThrough.to),
      evalExpr(spec.arcThrough.sagitta, scope),
    );
  } else if (spec.arc) {
    geometry = {
      kind: 'arc',
      center: pt(spec.arc.center),
      radius: evalExpr(spec.arc.radius, scope),
      startAngle: (evalExpr(spec.arc.startAngle, scope) * Math.PI) / 180,
      endAngle: (evalExpr(spec.arc.endAngle, scope) * Math.PI) / 180,
    };
  } else {
    geometry = {
      kind: 'polyline',
      points: (spec.points ?? []).map(pt),
      ...(spec.closed ? { closed: true } : {}),
    };
  }

  lines.push({
    id: idFor(spec.role),
    type: spec.type,
    role: spec.role,
    geometry,
    sourceStyle: styleId,
  });
  if (spec.angle !== undefined) {
    hingeAngles[spec.role] = (evalExpr(spec.angle, scope) * Math.PI) / 180;
  }
}
