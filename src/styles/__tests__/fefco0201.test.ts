import { describe, expect, it } from 'vitest';
import { compileStyle } from '../compile.js';
import { fefco0201 } from '../catalog/fefco0201.js';
import { evalExpr, dependencies, ExprError } from '../expr.js';
import { blankSize, materialArea, resolveGeometry } from '../../geometry/resolve.js';
import { foldedFacePoints } from '../../geometry/fold.js';
import { rsc201 } from '../../geometry/fixtures.js';
import type { ResolvedGeometry } from '../../geometry/types.js';

function foldedExtents(resolved: ResolvedGeometry, ratio = 1): number[] {
  const folded = foldedFacePoints(resolved, ratio);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { points } of folded.values()) {
    for (const q of points) {
      const c = [q.x, q.y, q.z];
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i]!, c[i]!);
        max[i] = Math.max(max[i]!, c[i]!);
      }
    }
  }
  return max.map((m, i) => m - min[i]!).sort((a, b) => a - b);
}

describe('expression evaluator', () => {
  const scope = { W: 150, H: 250, caliper: 3 };

  it('evaluates arithmetic over declared parameters', () => {
    expect(evalExpr('W/2', scope)).toBe(75);
    expect(evalExpr('W + 2*caliper', scope)).toBe(156);
    expect(evalExpr('-(W - H)', scope)).toBe(100);
    expect(evalExpr('max(W, H) - min(W, H)', scope)).toBe(100);
    expect(evalExpr('(W + H) / 2', scope)).toBe(200);
    expect(evalExpr(42, scope)).toBe(42);
  });

  it('rejects unknown parameters rather than silently yielding NaN', () => {
    expect(() => evalExpr('depth * 2', scope)).toThrow(ExprError);
    expect(() => evalExpr('W +', scope)).toThrow(ExprError);
    expect(() => evalExpr('W / 0', scope)).toThrow(ExprError);
  });

  it('does not execute arbitrary code', () => {
    expect(() => evalExpr('constructor', scope)).toThrow(ExprError);
    expect(() => evalExpr('toString()', scope)).toThrow(ExprError);
  });

  it('reports what a formula depends on', () => {
    expect(dependencies('max(W, H) + caliper').sort()).toEqual(['H', 'W', 'caliper']);
    expect(dependencies(12)).toEqual([]);
  });
});

describe('FEFCO 0201 style definition', () => {
  const compiled = compileStyle(fefco0201);
  const resolved = resolveGeometry(compiled.graph);

  it('compiles without warnings at its defaults', () => {
    expect(compiled.warnings).toEqual([]);
  });

  it('derives the flat blank size from the grid', () => {
    // glue 35 + L 200 + W 150 + L 200 + W 150 = 735, by flap 75 + H 250 + 75.
    expect(compiled.blank).toEqual({ width: 735, height: 400 });
  });

  it('agrees with the geometry actually generated', () => {
    const measured = blankSize(resolved)!;
    expect(measured.width).toBeCloseTo(compiled.blank.width, 6);
    expect(measured.height).toBeCloseTo(compiled.blank.height, 6);
  });

  it('carries the schema payload the rest of the app will need', () => {
    expect(compiled.graph.caliper).toBe(3);
    expect(compiled.graph.faceSeeds).toHaveLength(13);
    expect(compiled.graph.seals).toHaveLength(1);
    expect(compiled.graph.seals[0]!.kind).toBe('glue_flap');
    expect(compiled.graph.features).toEqual([]);
    expect(compiled.graph.baseFaceRole).toBe('front_panel');
    for (const line of compiled.graph.lines) {
      expect(line.sourceStyle).toBe('fefco.0201');
      expect(line.role.length).toBeGreaterThan(0);
    }
  });

  it('gives every crease a default fold angle of 90 degrees', () => {
    const angles = compiled.graph.hingeAngles!;
    const creases = compiled.graph.lines.filter((l) => l.type === 'crease');
    expect(creases.length).toBeGreaterThan(0);
    for (const c of creases) expect(angles[c.role]).toBeCloseTo(Math.PI / 2, 12);
    for (const h of resolved.hinges) expect(h.angle).toBeCloseTo(Math.PI / 2, 12);
  });

  it('names all thirteen faces from its own seeds', () => {
    const roles = resolved.faces.map((f) => f.role).sort();
    expect(roles).toEqual(
      [
        'back_flap_bottom',
        'back_flap_top',
        'back_panel',
        'front_flap_bottom',
        'front_flap_top',
        'front_panel',
        'glue_flap',
        'left_flap_bottom',
        'left_flap_top',
        'left_panel',
        'right_flap_bottom',
        'right_flap_top',
        'right_panel',
      ].sort(),
    );
  });

  it('assigns the face kinds the definition declared', () => {
    const kind = (role: string) => resolved.faces.find((f) => f.role === role)!.kind;
    expect(kind('front_panel')).toBe('panel');
    expect(kind('front_flap_top')).toBe('flap');
    expect(kind('glue_flap')).toBe('seal');
  });

  it('resolves cleanly, with nothing unfolded', () => {
    expect(resolved.unresolved).toEqual([]);
    expect(resolved.unreachableFaceIds).toEqual([]);
    expect(resolved.foldTree!.closingHinges).toEqual([]);
  });
});

describe('generated RSC matches the hand-drawn one from step 1', () => {
  const generated = resolveGeometry(compileStyle(fefco0201).graph);
  const handDrawn = resolveGeometry(rsc201());

  it('resolves the same number of faces', () => {
    expect(generated.faces).toHaveLength(handDrawn.faces.length);
    expect(generated.faces).toHaveLength(13);
  });

  it('resolves the same number of hinges', () => {
    expect(generated.hinges).toHaveLength(handDrawn.hinges.length);
    expect(generated.hinges).toHaveLength(12);
  });

  it('produces the same board area', () => {
    expect(materialArea(generated)).toBeCloseTo(materialArea(handDrawn), 6);
  });

  it('produces the same set of face areas', () => {
    const areas = (r: typeof generated) =>
      r.faces.map((f) => Math.round(f.area * 1e6) / 1e6).sort((a, b) => a - b);
    expect(areas(generated)).toEqual(areas(handDrawn));
  });

  it('folds to a box of the internal dimensions it was generated from', () => {
    const extents = foldedExtents(generated);
    expect(extents[0]).toBeCloseTo(150, 6); // W
    expect(extents[1]).toBeCloseTo(200, 6); // L
    expect(extents[2]).toBeCloseTo(250, 6); // H
  });

  it('lies flat at fold ratio zero', () => {
    for (const { points } of foldedFacePoints(generated, 0).values()) {
      for (const q of points) expect(q.z).toBeCloseTo(0, 9);
    }
  });
});

describe('FEFCO 0201 is parametric, not a fixed drawing', () => {
  const cases: [number, number, number, number][] = [
    [300, 200, 150, 3],
    [120, 120, 120, 1.5],
    [500, 90, 400, 5],
    [60, 55, 700, 0.6],
  ];

  it.each(cases)('L=%s W=%s H=%s caliper=%s folds to those dimensions', (L, W, H, caliper) => {
    const compiled = compileStyle(fefco0201, { params: { L, W, H, caliper } });
    expect(compiled.warnings).toEqual([]);
    const resolved = resolveGeometry(compiled.graph);

    expect(resolved.faces).toHaveLength(13);
    expect(resolved.hinges).toHaveLength(12);
    expect(resolved.unresolved).toEqual([]);

    const extents = foldedExtents(resolved);
    expect(extents).toEqual(
      [L, W, H].sort((a, b) => a - b).map((v) => expect.closeTo(v, 6)),
    );
  });

  it('grows the blank exactly as the dimensions grow', () => {
    const compiled = compileStyle(fefco0201, {
      params: { L: 300, W: 200, H: 150, caliper: 3, glueFlap: 40 },
    });
    // glue 40 + 300 + 200 + 300 + 200 = 1040, by 100 + 150 + 100 = 350.
    expect(compiled.blank).toEqual({ width: 1040, height: 350 });
  });

  it('tracks flap depth off width unless overridden', () => {
    expect(compileStyle(fefco0201, { params: { W: 240 } }).params.flap).toBe(120);
    expect(compileStyle(fefco0201, { params: { W: 240, flap: 60 } }).params.flap).toBe(60);
  });

  it('ties slot width to caliper unless overridden', () => {
    expect(compileStyle(fefco0201, { params: { caliper: 5 } }).params.slot).toBe(5);
    expect(compileStyle(fefco0201, { params: { caliper: 5, slot: 0 } }).params.slot).toBe(0);
  });

  it('still resolves with zero-width slots, where flaps are only slit apart', () => {
    // A zero-width slot leaves board on both sides of the cut, which is the
    // locking-tab case: the flaps stay material and no area is lost.
    const compiled = compileStyle(fefco0201, { params: { slot: 0 } });
    const resolved = resolveGeometry(compiled.graph);
    expect(resolved.faces).toHaveLength(13);
    expect(materialArea(resolved)).toBeCloseTo(735 * 400 - 35 * 150, 6);
  });

  it('clamps an out-of-range dimension and says so instead of drawing nothing', () => {
    const compiled = compileStyle(fefco0201, { params: { L: -50 } });
    expect(compiled.params.L).toBe(20);
    expect(compiled.warnings.join(' ')).toContain('clamped');
    expect(resolveGeometry(compiled.graph).faces).toHaveLength(13);
  });
});
