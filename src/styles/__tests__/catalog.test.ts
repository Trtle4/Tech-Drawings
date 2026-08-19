import { describe, expect, it } from 'vitest';
import { STYLES, compileStyle } from '../index.js';
import { sealEndCarton } from '../catalog/seal-end-carton.js';
import { fefco0300 } from '../catalog/fefco0300.js';
import { blankSize, materialArea, resolveGeometry } from '../../geometry/resolve.js';
import { foldedFacePoints } from '../../geometry/fold.js';
import type { GeometryGraph } from '../../geometry/types.js';

const DEG = Math.PI / 180;

function extents(g: GeometryGraph, ratio = 1): number[] {
  const folded = foldedFacePoints(resolveGeometry(g, { reanchorSeeds: false }), ratio);
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

describe('every catalogue style', () => {
  for (const style of STYLES) {
    describe(style.id, () => {
      const compiled = compileStyle(style);
      const resolved = resolveGeometry(compiled.graph);

      it('compiles clean at its defaults', () => {
        expect(compiled.warnings).toEqual([]);
      });

      it('resolves with nothing unfolded and no islands', () => {
        expect(resolved.unresolved).toEqual([]);
        expect(resolved.unreachableFaceIds).toEqual([]);
        expect(resolved.faces.length).toBeGreaterThan(1);
      });

      it('names every face it detected', () => {
        const roles = resolved.faces.map((f) => f.role);
        expect(new Set(roles).size).toBe(roles.length);
        // A face falling back to a positional id means a seed missed it.
        expect(roles.filter((r) => /^face\.\d+$/.test(r))).toEqual([]);
      });

      it('agrees with itself on the blank size', () => {
        const measured = blankSize(resolved)!;
        expect(measured.width).toBeCloseTo(compiled.blank.width, 3);
        expect(measured.height).toBeCloseTo(compiled.blank.height, 3);
      });

      it('lies flat at fold ratio zero', () => {
        for (const { points } of foldedFacePoints(resolved, 0).values()) {
          for (const q of points) expect(q.z).toBeCloseTo(0, 9);
        }
      });

      it('gives every hinge a finite angle and a straight axis', () => {
        for (const h of resolved.hinges) {
          expect(Number.isFinite(h.angle)).toBe(true);
          expect(h.collinear).toBe(true);
        }
      });

      it('declares each parameter with a group and a resolvable default', () => {
        for (const p of style.params) {
          expect(p.group).toBeTruthy();
          expect(compiled.params[p.id]).toBeTypeOf('number');
          expect(Number.isFinite(compiled.params[p.id])).toBe(true);
        }
      });
    });
  }
});

describe('seal end carton', () => {
  const compiled = compileStyle(sealEndCarton);
  const resolved = resolveGeometry(compiled.graph);
  const face = (role: string) => resolved.faces.find((f) => f.role === role)!;

  it('resolves a glue flap, four panels and eight flaps', () => {
    expect(resolved.faces).toHaveLength(13);
    expect(resolved.hinges).toHaveLength(12);
  });

  it('makes the minor flaps genuinely shorter than the majors', () => {
    const depth = (role: string) => {
      const ys = face(role).outer.points.map((p) => p.y);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(depth('front_flap_bottom')).toBeCloseTo(compiled.params.majorFlap!, 6);
    expect(depth('left_flap_bottom')).toBeCloseTo(compiled.params.minorFlap!, 6);
    expect(depth('left_flap_bottom')).toBeLessThan(depth('front_flap_bottom'));
  });

  it('keeps the crease on the track boundary despite the inset', () => {
    // Both flap kinds must still hinge at the same y, or the body panel would
    // be creased to a flap that no longer touches it.
    const top = (role: string) => Math.max(...face(role).outer.points.map((p) => p.y));
    expect(top('left_flap_bottom')).toBeCloseTo(top('front_flap_bottom'), 9);
    expect(top('right_flap_bottom')).toBeCloseTo(top('back_flap_bottom'), 9);
  });

  it('hinges every flap to its own body panel', () => {
    const pairs = resolved.hinges.map((h) => {
      const a = face(resolved.faces.find((f) => f.id === h.faceA)!.role).role;
      const b = resolved.faces.find((f) => f.id === h.faceB)!.role;
      return [a, b].sort().join(' | ');
    });
    for (const side of ['front', 'back', 'left', 'right']) {
      expect(pairs).toContain([`${side}_flap_bottom`, `${side}_panel`].sort().join(' | '));
      expect(pairs).toContain([`${side}_flap_top`, `${side}_panel`].sort().join(' | '));
    }
  });

  it('folds to its internal dimensions, flaps tucked inside', () => {
    const e = extents(compiled.graph);
    expect(e[0]).toBeCloseTo(45, 6);
    expect(e[1]).toBeCloseTo(90, 6);
    expect(e[2]).toBeCloseTo(160, 6);
  });

  it('carries the seam and both end seals', () => {
    const kinds = compiled.graph.seals.map((s) => s.kind).sort();
    expect(kinds).toEqual(['glue_flap', 'lap', 'lap']);
    expect(compiled.graph.seals.find((s) => s.role === 'side_seam')!.width).toBe(12);
  });

  it('stays parametric across the range', () => {
    for (const [L, W, H] of [
      [90, 45, 160],
      [200, 60, 90],
      [40, 40, 40],
      [300, 25, 220],
    ] as const) {
      const c = compileStyle(sealEndCarton, { params: { L, W, H } });
      expect(c.warnings, `${L}x${W}x${H}`).toEqual([]);
      const r = resolveGeometry(c.graph);
      expect(r.faces, `${L}x${W}x${H}`).toHaveLength(13);
      expect(r.unresolved).toEqual([]);
      const e = extents(c.graph);
      const want = [L, W, H].sort((a, b) => a - b);
      e.forEach((v, i) => expect(v).toBeCloseTo(want[i]!, 6));
    }
  });

  it('keeps the minor flaps clear of each other on a narrow carton', () => {
    // minorFlap defaults under L/2, so opposing minor flaps never collide.
    const c = compileStyle(sealEndCarton, { params: { L: 30, W: 120 } });
    expect(c.params.minorFlap!).toBeLessThanOrEqual(30 / 2);
  });
});

describe('slotted tray, FEFCO 0300', () => {
  const compiled = compileStyle(fefco0300);
  const resolved = resolveGeometry(compiled.graph);

  it('resolves a base, four walls and four corner tabs', () => {
    expect(resolved.faces).toHaveLength(9);
    expect(resolved.hinges).toHaveLength(8);
    expect(resolved.foldTree!.closingHinges).toEqual([]);
  });

  it('slits the corner tabs free of the front and back walls', () => {
    // A corner tab hinges to its side wall only; the boundary with the
    // front/back wall is a cut, so it is not a hinge.
    const role = (id: string) => resolved.faces.find((f) => f.id === id)!.role;
    const partners = (tab: string) =>
      resolved.hinges
        .filter((h) => role(h.faceA) === tab || role(h.faceB) === tab)
        .map((h) => (role(h.faceA) === tab ? role(h.faceB) : role(h.faceA)));

    expect(partners('corner_front_left')).toEqual(['left_wall']);
    expect(partners('corner_front_right')).toEqual(['right_wall']);
    expect(partners('corner_back_left')).toEqual(['left_wall']);
    expect(partners('corner_back_right')).toEqual(['right_wall']);
  });

  it('keeps the slit corners as material, losing no board', () => {
    // Slits remove nothing, so the board area is the whole rectangle.
    expect(materialArea(resolved)).toBeCloseTo(450 * 370, 6);
    expect(compiled.blank).toEqual({ width: 450, height: 370 });
  });

  it('folds to the tray it was generated from', () => {
    const e = extents(compiled.graph);
    expect(e[0]).toBeCloseTo(75, 6);
    expect(e[1]).toBeCloseTo(220, 6);
    expect(e[2]).toBeCloseTo(300, 6);
  });

  it('splays the walls when told to', () => {
    const splayed = compileStyle(fefco0300, { params: { wallAngle: 70 } });
    const r = resolveGeometry(splayed.graph);
    for (const h of r.hinges) {
      const isWallFold = h.lineIds.some((id) =>
        splayed.graph.lines.find((l) => l.id === id)?.role.includes('base'),
      );
      if (isWallFold) expect(h.angle).toBeCloseTo(70 * DEG, 9);
    }
    // The footprint grows by the walls' horizontal reach on each side.
    const e = extents(splayed.graph);
    expect(e[2]).toBeCloseTo(300 + 2 * 75 * Math.cos(70 * DEG), 3);
  });
});
