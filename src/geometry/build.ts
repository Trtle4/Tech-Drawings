import type { DrawingLine, GeometryGraph, LineType, Path, SourceStyle, Vec2 } from './types.js';
import { USER_SOURCE } from './types.js';

/**
 * Small authoring helpers. Style generators use these so every style emits the
 * same shape of line object, and tests can build fixtures without ceremony.
 */

let counter = 0;
export function nextLineId(prefix = 'ln'): string {
  return `${prefix}.${++counter}`;
}

/** Reset id numbering. Tests call this so ids stay stable across runs. */
export function resetIds(): void {
  counter = 0;
}

export interface LineSpec {
  type: LineType;
  role: string;
  points?: Vec2[];
  closed?: boolean;
  path?: Path;
  sourceStyle?: SourceStyle;
  id?: string;
  meta?: Record<string, unknown>;
}

export function line(spec: LineSpec): DrawingLine {
  const geometry: Path =
    spec.path ?? { kind: 'polyline', points: spec.points ?? [], closed: spec.closed ?? false };
  return {
    id: spec.id ?? nextLineId(),
    type: spec.type,
    role: spec.role,
    geometry,
    sourceStyle: spec.sourceStyle ?? USER_SOURCE,
    ...(spec.meta ? { meta: spec.meta } : {}),
  };
}

export const seg = (
  type: LineType,
  role: string,
  a: Vec2,
  b: Vec2,
  sourceStyle?: SourceStyle,
): DrawingLine => line({ type, role, points: [a, b], ...(sourceStyle ? { sourceStyle } : {}) });

/** Closed rectangle from a corner and a size. */
export function rect(
  type: LineType,
  role: string,
  x: number,
  y: number,
  w: number,
  h: number,
  sourceStyle?: SourceStyle,
): DrawingLine {
  return line({
    type,
    role,
    closed: true,
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    ...(sourceStyle ? { sourceStyle } : {}),
  });
}

export function circle(
  type: LineType,
  role: string,
  center: Vec2,
  radius: number,
  sourceStyle?: SourceStyle,
): DrawingLine {
  return line({
    type,
    role,
    path: { kind: 'arc', center, radius, startAngle: 0, endAngle: Math.PI * 2 },
    ...(sourceStyle ? { sourceStyle } : {}),
  });
}

export function graph(
  lines: DrawingLine[],
  opts: Partial<Omit<GeometryGraph, 'lines'>> = {},
): GeometryGraph {
  return {
    units: 'mm',
    caliper: opts.caliper ?? 0.5,
    lines,
    seals: opts.seals ?? [],
    features: opts.features ?? [],
    ...(opts.faceSeeds ? { faceSeeds: opts.faceSeeds } : {}),
    ...(opts.baseFaceRole ? { baseFaceRole: opts.baseFaceRole } : {}),
    ...(opts.meta ? { meta: opts.meta } : {}),
  };
}
