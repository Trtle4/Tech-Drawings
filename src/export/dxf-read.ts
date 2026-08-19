/**
 * Minimal DXF R12 reader.
 *
 * Exists so the exporter can be verified rather than eyeballed: read the file
 * back, rebuild a geometry graph from it, resolve that, and compare the faces
 * against the model the DXF came from. If the two agree face for face and area
 * for area, the export carries the geometry.
 *
 * Deliberately narrow — it handles exactly what `dxf.ts` writes (LINE, ARC,
 * CIRCLE, POLYLINE/VERTEX, TEXT) and nothing else. It is not a general DXF
 * importer, and should not be pressed into service as one without widening the
 * entity coverage and the error handling.
 */

import type { DrawingLine, LineType, Vec2 } from '../geometry/types.js';

export interface DxfEntity {
  kind: 'LINE' | 'ARC' | 'CIRCLE' | 'POLYLINE' | 'TEXT';
  layer: string;
  /** LINE, POLYLINE */
  points?: Vec2[];
  closed?: boolean;
  /** ARC, CIRCLE */
  center?: Vec2;
  radius?: number;
  /** ARC, degrees, counter-clockwise from start to end. */
  startAngle?: number;
  endAngle?: number;
  /** TEXT */
  value?: string;
  height?: number;
}

export interface DxfDocument {
  version: string;
  /** $INSUNITS: 4 = millimetres. */
  units: number;
  layers: string[];
  entities: DxfEntity[];
  header: Record<string, string[]>;
}

/** Split the file into (code, value) pairs. */
function pairs(src: string): [number, string][] {
  const lines = src.split(/\r\n|\r|\n/);
  const out: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    if (!Number.isFinite(code)) continue;
    out.push([code, lines[i + 1]!]);
  }
  return out;
}

export function readDxf(src: string): DxfDocument {
  const p = pairs(src);
  const doc: DxfDocument = { version: '', units: 0, layers: [], entities: [], header: {} };

  let i = 0;
  let section = '';
  let pendingVar = '';
  let entity: DxfEntity | null = null;
  let polyVertices: Vec2[] | null = null;

  const flush = () => {
    if (!entity) return;
    if (entity.kind === 'POLYLINE' && polyVertices) entity.points = polyVertices;
    doc.entities.push(entity);
    entity = null;
    polyVertices = null;
  };

  for (; i < p.length; i++) {
    const [code, raw] = p[i]!;
    const value = raw.trim();

    if (code === 0) {
      if (value === 'SECTION') {
        const next = p[i + 1];
        section = next && next[0] === 2 ? next[1]!.trim() : '';
        continue;
      }
      if (value === 'ENDSEC') {
        flush();
        section = '';
        continue;
      }
      if (value === 'EOF') {
        flush();
        break;
      }

      if (section === 'TABLES') {
        if (value === 'LAYER') {
          const next = p[i + 1];
          // The TABLE header also emits a LAYER record; only entries with a
          // name (code 2) are real layers.
          if (next && next[0] === 2) doc.layers.push(next[1]!.trim());
        }
        continue;
      }

      if (section !== 'ENTITIES') continue;

      if (value === 'VERTEX') {
        // Belongs to the open POLYLINE; handled by the coordinate codes below.
        polyVertices ??= [];
        polyVertices.push({ x: 0, y: 0 });
        continue;
      }
      if (value === 'SEQEND') {
        flush();
        continue;
      }

      flush();
      if (value === 'LINE' || value === 'ARC' || value === 'CIRCLE' || value === 'TEXT') {
        entity = { kind: value, layer: '0' };
        if (value === 'LINE') entity.points = [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ];
      } else if (value === 'POLYLINE') {
        entity = { kind: 'POLYLINE', layer: '0', closed: false };
        polyVertices = [];
      }
      continue;
    }

    if (section === 'HEADER') {
      if (code === 9) {
        pendingVar = value;
        doc.header[pendingVar] = [];
        continue;
      }
      if (pendingVar) {
        doc.header[pendingVar]!.push(value);
        if (pendingVar === '$ACADVER') doc.version = value;
        if (pendingVar === '$INSUNITS') doc.units = Number(value);
      }
      continue;
    }

    if (section !== 'ENTITIES' || !entity) continue;

    const n = Number(value);
    const vtx = polyVertices && polyVertices.length > 0 ? polyVertices[polyVertices.length - 1]! : null;

    switch (code) {
      case 8:
        entity.layer = value;
        break;
      case 10:
        if (entity.kind === 'POLYLINE' && vtx) vtx.x = n;
        else if (entity.kind === 'LINE') entity.points![0]!.x = n;
        else if (entity.kind === 'TEXT') (entity.center ??= { x: 0, y: 0 }).x = n;
        else (entity.center ??= { x: 0, y: 0 }).x = n;
        break;
      case 20:
        if (entity.kind === 'POLYLINE' && vtx) vtx.y = n;
        else if (entity.kind === 'LINE') entity.points![0]!.y = n;
        else (entity.center ??= { x: 0, y: 0 }).y = n;
        break;
      case 11:
        if (entity.kind === 'LINE') entity.points![1]!.x = n;
        break;
      case 21:
        if (entity.kind === 'LINE') entity.points![1]!.y = n;
        break;
      case 40:
        if (entity.kind === 'TEXT') entity.height = n;
        else entity.radius = n;
        break;
      case 50:
        entity.startAngle = n;
        break;
      case 51:
        entity.endAngle = n;
        break;
      case 70:
        if (entity.kind === 'POLYLINE') entity.closed = (n & 1) === 1;
        break;
      case 1:
        entity.value = value;
        break;
      default:
        break;
    }
  }

  flush();
  return doc;
}

/** DXF layer back to the line type the geometry model uses. */
const TYPE_FOR_LAYER: Record<string, LineType> = {
  CUT: 'cut',
  CREASE: 'crease',
  PERF: 'perf',
  BLEED: 'bleed',
  DIMENSIONS: 'dimension',
};

/**
 * Rebuild drawing lines from a parsed document, for round-trip verification.
 *
 * TEXT and TITLEBLOCK are annotation and carry no structure, so they are
 * dropped — a blank rebuilt from this should resolve to the same faces as the
 * one that produced the file.
 */
export function linesFromDxf(doc: DxfDocument, sourceStyle = 'dxf'): DrawingLine[] {
  const out: DrawingLine[] = [];
  let n = 0;

  for (const e of doc.entities) {
    const type = TYPE_FOR_LAYER[e.layer];
    if (!type) continue; // TEXT / TITLEBLOCK / unknown
    const id = `${sourceStyle}.${++n}`;
    const role = `${e.layer.toLowerCase()}.${n}`;

    if (e.kind === 'LINE' && e.points) {
      out.push({ id, type, role, sourceStyle, geometry: { kind: 'polyline', points: e.points } });
    } else if (e.kind === 'POLYLINE' && e.points && e.points.length >= 2) {
      out.push({
        id,
        type,
        role,
        sourceStyle,
        geometry: { kind: 'polyline', points: e.points, ...(e.closed ? { closed: true } : {}) },
      });
    } else if (e.kind === 'ARC' && e.center && e.radius !== undefined) {
      const start = ((e.startAngle ?? 0) * Math.PI) / 180;
      let end = ((e.endAngle ?? 0) * Math.PI) / 180;
      // DXF arcs always run counter-clockwise; unwrap so end > start.
      if (end <= start) end += Math.PI * 2;
      out.push({
        id,
        type,
        role,
        sourceStyle,
        geometry: { kind: 'arc', center: e.center, radius: e.radius, startAngle: start, endAngle: end },
      });
    } else if (e.kind === 'CIRCLE' && e.center && e.radius !== undefined) {
      out.push({
        id,
        type,
        role,
        sourceStyle,
        geometry: {
          kind: 'arc',
          center: e.center,
          radius: e.radius,
          startAngle: 0,
          endAngle: Math.PI * 2,
        },
      });
    }
  }
  return out;
}
