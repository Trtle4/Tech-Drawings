import { describe, expect, it } from 'vitest';
import {
  STYLES,
  compileStyle,
  proofTaperedTray,
  fefco0201,
  slitCornerTray,
} from '../../styles/index.js';
import { blankSize, materialArea, resolveGeometry } from '../../geometry/resolve.js';
import { DXF_LAYERS, buildDxf } from '../dxf.js';
import { linesFromDxf, readDxf } from '../dxf-read.js';
import { ARC_CHORD_TOL } from '../../geometry/arrangement.js';
import type { GeometryGraph, ResolvedGeometry } from '../../geometry/types.js';

const ALL = [...STYLES, proofTaperedTray];

/** Export, read back, and resolve the result as if it were a fresh drawing. */
function roundTrip(graph: GeometryGraph, resolved: ResolvedGeometry) {
  const { dxf, report } = buildDxf(graph, resolved, { date: '2026-01-01' });
  const doc = readDxf(dxf);
  // Seeds are app state, not DXF content, so they are carried across
  // deliberately — that is what lets face ROLES be compared, not just areas.
  const back = resolveGeometry(
    { ...graph, lines: linesFromDxf(doc), faceSeeds: graph.faceSeeds!.map((s) => ({ ...s })) },
    { reanchorSeeds: false },
  );
  return { dxf, report, doc, back };
}

describe('DXF file structure', () => {
  const { graph } = compileStyle(fefco0201);
  const resolved = resolveGeometry(graph);
  const { dxf, doc } = roundTrip(graph, resolved);

  it('is R12 in millimetres', () => {
    expect(doc.version).toBe('AC1009');
    expect(doc.units).toBe(4); // 4 = mm
    expect(doc.header.$MEASUREMENT).toEqual(['1']); // metric
  });

  it('declares all seven layers', () => {
    expect(doc.layers.sort()).toEqual([...DXF_LAYERS].sort());
  });

  it('uses CRLF line endings and ends with EOF', () => {
    expect(dxf.includes('\r\n')).toBe(true);
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
  });

  it('contains no R13+ entities', () => {
    for (const banned of ['LWPOLYLINE', 'SPLINE', 'ELLIPSE', 'MTEXT', 'HATCH']) {
      expect(dxf, banned).not.toContain(banned);
    }
  });

  it('closes every POLYLINE with SEQEND', () => {
    const opens = (dxf.match(/\r\nPOLYLINE\r\n/g) ?? []).length;
    const ends = (dxf.match(/\r\nSEQEND\r\n/g) ?? []).length;
    expect(ends).toBe(opens);
  });
});

describe('1:1, no scaling', () => {
  it.each(ALL.map((d) => [d.id, d] as const))('%s exports at model coordinates', (_id, def) => {
    const { graph } = compileStyle(def);
    const resolved = resolveGeometry(graph);
    const { doc } = roundTrip(graph, resolved);
    const b = resolved.blankBounds!;

    // Structural extents from real endpoints. An arc's centre can sit far
    // outside the blank when the arc is shallow, so centre +/- radius is not a
    // usable proxy — the endpoints are.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const note = (p: { x: number; y: number }) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    };
    for (const e of doc.entities) {
      if (e.layer !== 'CUT' && e.layer !== 'CREASE' && e.layer !== 'PERF') continue;
      for (const p of e.points ?? []) note(p);
      if (e.kind === 'ARC' && e.center && e.radius !== undefined) {
        // An arc's extremes are its endpoints PLUS whichever cardinal points
        // its sweep passes through — the tapered tray's lip bulges well past
        // both of its ends.
        const a0 = (e.startAngle! * Math.PI) / 180;
        let a1 = (e.endAngle! * Math.PI) / 180;
        if (a1 <= a0) a1 += Math.PI * 2;
        const angles = [a0, a1];
        for (let k = 0; k < 8; k++) {
          const t = (k * Math.PI) / 2;
          if (t >= a0 && t <= a1) angles.push(t);
        }
        for (const t of angles) {
          note({ x: e.center.x + e.radius * Math.cos(t), y: e.center.y + e.radius * Math.sin(t) });
        }
      }
    }

    // The blank's own extents, with no transform applied.
    //
    // A style with arcs is allowed to land OUTSIDE the model bounds by up to
    // the chord tolerance, and only outside: `blankBounds` is measured on the
    // flattened polygon, and the true arc the DXF carries contains it. That is
    // the export being more accurate than the in-memory approximation, not a
    // scale error.
    const hasArcs = graph.lines.some((l) => l.geometry.kind === 'arc');
    const tol = hasArcs ? ARC_CHORD_TOL : 1e-6;
    expect(minX).toBeGreaterThan(b.min.x - tol - 1e-9);
    expect(minX).toBeLessThanOrEqual(b.min.x + 1e-6);
    expect(minY).toBeGreaterThan(b.min.y - tol - 1e-9);
    expect(minY).toBeLessThanOrEqual(b.min.y + 1e-6);
    expect(maxX).toBeLessThan(b.max.x + tol + 1e-9);
    expect(maxX).toBeGreaterThanOrEqual(b.max.x - 1e-6);
    expect(maxY).toBeLessThan(b.max.y + tol + 1e-9);
    expect(maxY).toBeGreaterThanOrEqual(b.max.y - 1e-6);

    const size = blankSize(resolved)!;
    expect(maxX - minX).toBeCloseTo(size.width, hasArcs ? 1 : 6);
    expect(maxY - minY).toBeCloseTo(size.height, hasArcs ? 1 : 6);
    expect(Number(doc.header.$EXTMAX![0])).toBeCloseTo(b.max.x, 6);
  });
});

describe('face-level round trip', () => {
  it.each(ALL.map((d) => [d.id, d] as const))(
    '%s re-resolves to the same faces from its own DXF',
    (_id, def) => {
      const { graph } = compileStyle(def);
      const model = resolveGeometry(graph);
      const { back, report } = roundTrip(graph, model);

      expect(back.faces).toHaveLength(model.faces.length);
      expect(back.hinges).toHaveLength(model.hinges.length);
      expect(back.unresolved.map((u) => u.reason)).toEqual(
        model.unresolved.map((u) => u.reason),
      );

      // Face for face, by area.
      const areas = (r: ResolvedGeometry) => r.faces.map((f) => f.area).sort((a, b) => a - b);
      areas(back).forEach((a, i) => expect(a).toBeCloseTo(areas(model)[i]!, 6));

      // And by name, which only matches if the geometry landed identically.
      expect(back.faces.map((f) => f.role).sort()).toEqual(model.faces.map((f) => f.role).sort());
      expect(materialArea(back)).toBeCloseTo(materialArea(model), 6);

      // Nothing was quietly approximated on the way out.
      expect(report.chordApproximated).toEqual([]);
    },
  );
});

describe('arcs export as true arcs', () => {
  // The SUP's pinch is a straight chamfer now (see bag-sup.ts) — the tapered
  // tray proof style is the arc-bearing case (its lip), and stays in the
  // catalogue/proof set specifically to exercise this.
  it('the tapered tray lip is a true ARC entity, not a chord', () => {
    const { graph } = compileStyle(proofTaperedTray);
    const resolved = resolveGeometry(graph);
    const { doc, report } = roundTrip(graph, resolved);

    expect(report.arcs).toBe(1);
    expect(report.chordApproximated).toEqual([]);
    expect(doc.entities.filter((e) => e.kind === 'ARC')).toHaveLength(1);

    // No multi-point polyline on a structural layer — that would be a
    // flattened curve sneaking through.
    const flattened = doc.entities.filter(
      (e) => (e.layer === 'CUT' || e.layer === 'CREASE') && e.kind === 'POLYLINE' && (e.points?.length ?? 0) > 2,
    );
    expect(flattened).toEqual([]);
  });

  it('keeps every style’s arc geometry exactly, radius and centre', () => {
    for (const def of ALL) {
      const { graph } = compileStyle(def);
      const resolved = resolveGeometry(graph);
      const { doc } = roundTrip(graph, resolved);
      const fileArcs = doc.entities.filter((e) => e.kind === 'ARC');

      for (const line of graph.lines) {
        const g = line.geometry;
        if (g.kind !== 'arc') continue;
        const match = fileArcs.find(
          (f) =>
            Math.abs(f.center!.x - g.center.x) < 1e-9 &&
            Math.abs(f.center!.y - g.center.y) < 1e-9 &&
            Math.abs(f.radius! - g.radius) < 1e-9,
        );
        expect(match, `${def.id}: no ARC for ${line.role}`).toBeDefined();
      }
    }
  });

  it('writes a full circle as CIRCLE rather than a degenerate arc', () => {
    const graph: GeometryGraph = {
      units: 'mm',
      caliper: 1,
      seals: [],
      features: [],
      faceSeeds: [],
      lines: [
        {
          id: 'o',
          type: 'cut',
          role: 'blank.outline',
          sourceStyle: 't',
          geometry: {
            kind: 'polyline',
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
              { x: 0, y: 100 },
            ],
          },
        },
        {
          id: 'h',
          type: 'cut',
          role: 'peg_hole',
          sourceStyle: 't',
          geometry: { kind: 'arc', center: { x: 50, y: 50 }, radius: 8, startAngle: 0, endAngle: Math.PI * 2 },
        },
      ],
    };
    const resolved = resolveGeometry(graph);
    const { report, dxf } = buildDxf(graph, resolved, { date: '2026-01-01' });
    expect(dxf).toContain('CIRCLE');
    expect(report.circles).toBe(1);
  });
});

describe('slits and zero-width slots survive', () => {
  it('exports the slit corner tray’s corner slits on CUT', () => {
    const { graph } = compileStyle(slitCornerTray);
    const model = resolveGeometry(graph);
    const { doc, back } = roundTrip(graph, model);

    // The corner cuts are a real punched slot now (matching the RSC's flap
    // slots), each wall of which is pruned from the material boundary as its
    // own cut but must still reach the knife.
    const cuts = doc.entities.filter((e) => e.layer === 'CUT');
    expect(cuts.length).toBeGreaterThanOrEqual(16);

    // Rebuilt from the file alone, the tray still resolves to base + 4 walls +
    // 4 corner tabs, which only happens if the slits are present.
    expect(back.faces).toHaveLength(9);
    expect(back.hinges).toHaveLength(8);
    expect(materialArea(back)).toBeCloseTo(materialArea(model), 6);
  });

  it('a zero-width slot still cuts, and does not double-cut', () => {
    const { graph } = compileStyle(fefco0201, { params: { slot: 0 } });
    const model = resolveGeometry(graph);
    const { doc, report, back } = roundTrip(graph, model);

    // Coincident walls merged rather than sending the knife down twice.
    expect(report.duplicatesMerged).toBeGreaterThan(0);

    // But the cut is still there: the slot line at x = 235 carries both flap
    // walls, one entity each, full length.
    const onSlot = doc.entities.filter(
      (e) =>
        e.layer === 'CUT' &&
        e.points?.length === 2 &&
        Math.abs(e.points[0]!.x - 235) < 1e-9 &&
        Math.abs(e.points[1]!.x - 235) < 1e-9,
    );
    expect(onSlot).toHaveLength(2);
    for (const e of onSlot) {
      expect(Math.abs(e.points![1]!.y - e.points![0]!.y)).toBeCloseTo(75, 6);
    }

    expect(back.faces).toHaveLength(13);
    expect(materialArea(back)).toBeCloseTo(materialArea(model), 6);
  });

  it('drops zero-length paths instead of emitting a point', () => {
    const { graph } = compileStyle(fefco0201, { params: { slot: 0 } });
    const model = resolveGeometry(graph);
    const { doc, report } = roundTrip(graph, model);

    // The slot end caps collapse when the slot has no width.
    expect(report.skipped.some((s) => s.reason === 'collapsed to zero length')).toBe(true);
    for (const e of doc.entities) {
      if (!e.points || e.points.length !== 2) continue;
      const len = Math.hypot(
        e.points[1]!.x - e.points[0]!.x,
        e.points[1]!.y - e.points[0]!.y,
      );
      expect(len, `zero-length entity on ${e.layer}`).toBeGreaterThan(1e-9);
    }
  });
});

describe('annotation layers', () => {
  const { graph } = compileStyle(fefco0201);
  const resolved = resolveGeometry(graph);

  it('puts a label per face on TEXT', () => {
    const { report } = buildDxf(graph, resolved, { date: '2026-01-01' });
    expect(report.byLayer.TEXT).toBe(resolved.faces.length);
  });

  it('puts dimensions and a title block on their own layers', () => {
    const { report } = buildDxf(graph, resolved, { date: '2026-01-01', note: 'sample' });
    expect(report.byLayer.DIMENSIONS).toBeGreaterThan(0);
    expect(report.byLayer.TITLEBLOCK).toBeGreaterThan(0);
  });

  it('annotation is strippable — dropping it changes no geometry', () => {
    const bare = buildDxf(graph, resolved, {
      labels: false,
      dimensions: false,
      titleBlock: false,
    });
    expect(bare.report.byLayer.TEXT).toBe(0);
    expect(bare.report.byLayer.DIMENSIONS).toBe(0);
    expect(bare.report.byLayer.TITLEBLOCK).toBe(0);
    expect(bare.report.byLayer.CUT).toBeGreaterThan(0);

    const back = resolveGeometry(
      { ...graph, lines: linesFromDxf(readDxf(bare.dxf)), faceSeeds: graph.faceSeeds!.map((s) => ({ ...s })) },
      { reanchorSeeds: false },
    );
    expect(back.faces).toHaveLength(resolved.faces.length);
  });

  it('keeps text ASCII for R12', () => {
    const { dxf } = buildDxf(graph, resolved, { date: '2026-01-01', note: 'Ø 12 × 4 — café' });
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7F]/.test(dxf)).toBe(false);
  });
});

describe('export report is honest', () => {
  it.each(ALL.map((d) => [d.id, d] as const))('%s reports what it did', (_id, def) => {
    const { graph } = compileStyle(def);
    const resolved = resolveGeometry(graph);
    const { report } = buildDxf(graph, resolved, { date: '2026-01-01' });

    expect(report.entities).toBe(
      Object.values(report.byLayer).reduce((a, b) => a + b, 0),
    );
    expect(report.chordApproximated).toEqual([]);
    // Nothing structural should ever be silently dropped.
    for (const s of report.skipped) {
      expect(['construction geometry is not sent to the table', 'collapsed to zero length']).toContain(
        s.reason,
      );
    }
  });
});

describe('formedShape hook', () => {
  it('is declared on the bags and carried onto the graph', () => {
    for (const id of ['bag.pillow', 'bag.sup', 'bag.gusseted']) {
      const def = STYLES.find((s) => s.id === id)!;
      expect(def.formedShape, id).toBeDefined();
      expect(compileStyle(def).graph.formedShape, id).toEqual(def.formedShape);
    }
  });

  it('is absent on cartons and cases, where the fold IS the formed state', () => {
    for (const id of ['fefco.0201', 'fefco.0200', 'carton.seal_end', 'tray.slit_corner']) {
      const def = STYLES.find((s) => s.id === id)!;
      expect(def.formedShape, id).toBeUndefined();
      expect(compileStyle(def).graph.formedShape, id).toBeUndefined();
    }
  });

  it('names only faces the fold graph actually resolved', () => {
    // A formed shape may reinterpret resolved faces; it may not invent them.
    for (const def of STYLES.filter((s) => s.formedShape)) {
      const compiled = compileStyle(def);
      const roles = new Set(resolveGeometry(compiled.graph).faces.map((f) => f.role));
      const spec = def.formedShape!;
      for (const r of [...(spec.faceRoles ?? []), ...(spec.flatFaceRoles ?? [])]) {
        expect(roles.has(r), `${def.id}: ${r} is not a resolved face`).toBe(true);
      }
    }
  });

  it('changes nothing about the dieline', () => {
    // The hook is inert in v1 — the graph it rides on must be unaffected.
    const def = STYLES.find((s) => s.id === 'bag.sup')!;
    const withHook = resolveGeometry(compileStyle(def).graph);
    const withoutHook = resolveGeometry(compileStyle({ ...def, formedShape: undefined }).graph);
    expect(withHook.faces.map((f) => f.area)).toEqual(withoutHook.faces.map((f) => f.area));
    expect(withHook.hinges).toHaveLength(withoutHook.hinges.length);
  });
});
