import { describe, expect, it } from 'vitest';
import { STYLES, compileStyle } from '../index.js';
import { sealEndCarton } from '../catalog/seal-end-carton.js';
import { slitCornerTray } from '../catalog/slit-corner-tray.js';
import { fefco0200 } from '../catalog/fefco0200.js';
import { fefco0201 } from '../catalog/fefco0201.js';
import { bagPillow } from '../catalog/bag-pillow.js';
import { bagGusseted } from '../catalog/bag-gusseted.js';
import { bagSup } from '../catalog/bag-sup.js';
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

      it('gives every face a finite integer ply', () => {
        for (const f of resolved.faces) {
          expect(Number.isInteger(f.ply), `${f.role}: ply ${f.ply}`).toBe(true);
        }
      });

      it('declares a valid up axis, or none', () => {
        expect(['x', 'y', 'z', undefined]).toContain(compiled.graph.upAxis);
      });
    });
  }
});

describe('ply order — closure order for rendering, not for folding', () => {
  const plyOf = (styleId: string, role: string) => {
    const style = STYLES.find((s) => s.id === styleId)!;
    const resolved = resolveGeometry(compileStyle(style).graph);
    return resolved.faces.find((f) => f.role === role)!.ply;
  };

  it('RSC: minor flaps sit under major flaps, glue tab under its panel', () => {
    expect(plyOf('fefco.0201', 'left_flap_top')).toBeLessThan(plyOf('fefco.0201', 'front_flap_top'));
    expect(plyOf('fefco.0201', 'right_flap_bottom')).toBeLessThan(
      plyOf('fefco.0201', 'back_flap_bottom'),
    );
    expect(plyOf('fefco.0201', 'glue_flap')).toBeLessThan(plyOf('fefco.0201', 'right_panel'));
  });

  it('HSC inherits the RSC’s ply assignment unchanged', () => {
    expect(plyOf('fefco.0200', 'left_flap_bottom')).toBeLessThan(
      plyOf('fefco.0200', 'front_flap_bottom'),
    );
    expect(plyOf('fefco.0200', 'glue_flap')).toBeLessThan(plyOf('fefco.0200', 'right_panel'));
  });

  it('seal end carton: minor flaps under major, glue tab under its panel', () => {
    expect(plyOf('carton.seal_end', 'left_flap_top')).toBeLessThan(
      plyOf('carton.seal_end', 'front_flap_top'),
    );
    expect(plyOf('carton.seal_end', 'glue_flap')).toBeLessThan(
      plyOf('carton.seal_end', 'right_panel'),
    );
  });

  it('slit corner tray: corner tabs sit under the walls', () => {
    expect(plyOf('tray.slit_corner', 'corner_front_left')).toBeLessThan(
      plyOf('tray.slit_corner', 'left_wall'),
    );
  });

  it('ply is orthogonal to fold order — changing it never changes the geometry', () => {
    const withPly = resolveGeometry(compileStyle(fefco0201).graph);
    const noPly = resolveGeometry({
      ...compileStyle(fefco0201).graph,
      faceSeeds: compileStyle(fefco0201).graph.faceSeeds!.map((s) => ({ ...s, ply: 0 })),
    });
    expect(withPly.faces.map((f) => f.area).sort()).toEqual(noPly.faces.map((f) => f.area).sort());
    expect(withPly.hinges.map((h) => h.angle)).toEqual(noPly.hinges.map((h) => h.angle));
  });
});

describe('up axis — which world axis is up when displayed', () => {
  const upOf = (styleId: string) => STYLES.find((s) => s.id === styleId)!.upAxis;

  it('wrap-style cases, cartons and bags stand on the axis their wrap folds preserve', () => {
    // Wrap hinges are vertical creases (column boundaries); rotating about a
    // vertical axis leaves y untouched, so y is what is left standing.
    for (const id of ['fefco.0201', 'fefco.0200', 'carton.seal_end', 'bag.pillow', 'bag.gusseted']) {
      expect(upOf(id), id).toBe('y');
    }
  });

  it('base-and-walls trays stand on the axis their walls fold away from', () => {
    // The base is flat (identity) and every wall folds OUT of its plane, so
    // there is no in-plane axis left untouched — up is the fold-out direction.
    expect(upOf('tray.slit_corner')).toBe('z');
  });

  it('is carried from the style onto the compiled graph unchanged', () => {
    for (const style of STYLES) {
      if (!style.upAxis) continue;
      expect(compileStyle(style).graph.upAxis).toBe(style.upAxis);
    }
  });
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

describe('slit corner tray', () => {
  const compiled = compileStyle(slitCornerTray);
  const resolved = resolveGeometry(compiled.graph);

  it('resolves a base, four walls and four corner tabs', () => {
    expect(resolved.faces).toHaveLength(9);
    expect(resolved.hinges).toHaveLength(8);
    expect(resolved.foldTree!.closingHinges).toEqual([]);
  });

  it('assigns corner tabs a lower ply than the walls, since they are never seen', () => {
    for (const role of [
      'corner_front_left',
      'corner_front_right',
      'corner_back_left',
      'corner_back_right',
    ]) {
      expect(resolved.faces.find((f) => f.role === role)!.ply).toBe(-1);
    }
    for (const role of ['base', 'left_wall', 'right_wall', 'front_wall', 'back_wall']) {
      expect(resolved.faces.find((f) => f.role === role)!.ply).toBe(0);
    }
  });

  it('slits the corner tabs free of the front and back walls', () => {
    // A corner tab hinges to its side wall only; the boundary with the
    // front/back wall is a punched slot, so it is not a hinge.
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

  it('loses exactly the corner slots worth of board, same treatment as the RSC', () => {
    // Four slots, each caliper wide and wallH deep.
    const lost = 4 * compiled.params.slot! * compiled.params.wallH!;
    expect(materialArea(resolved)).toBeCloseTo(450 * 370 - lost, 6);
    expect(compiled.blank).toEqual({ width: 450, height: 370 });
  });

  it('still resolves with a zero-width corner slot, where tabs are only slit apart', () => {
    const zero = compileStyle(slitCornerTray, { params: { slot: 0 } });
    const r = resolveGeometry(zero.graph);
    expect(r.faces).toHaveLength(9);
    expect(materialArea(r)).toBeCloseTo(450 * 370, 6);
  });

  it('folds to the tray it was generated from', () => {
    const e = extents(compiled.graph);
    expect(e[0]).toBeCloseTo(75, 6);
    expect(e[1]).toBeCloseTo(220, 6);
    expect(e[2]).toBeCloseTo(300, 6);
  });

  it('splays the walls when told to', () => {
    const splayed = compileStyle(slitCornerTray, { params: { wallAngle: 70 } });
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

describe('FEFCO 0200 half slotted container', () => {
  const hsc = compileStyle(fefco0200);
  const rsc = compileStyle(fefco0201);
  const resolved = resolveGeometry(hsc.graph);

  it('is derived from 0201 by one change and nothing else', () => {
    // The claim the grid model makes. If this test needs loosening, the grid
    // has stopped earning its place.
    expect(fefco0200.params).toBe(fefco0201.params);
    expect(fefco0200.grid!.columns).toBe(fefco0201.grid!.columns);
    expect(fefco0200.grid!.cells).toBe(fefco0201.grid!.cells);
    expect(fefco0200.grid!.boundaries).toBe(fefco0201.grid!.boundaries);

    // Only the flap_top row differs, and only by being marked absent.
    const changed = fefco0200.grid!.rows.filter(
      (r, i) => JSON.stringify(r) !== JSON.stringify(fefco0201.grid!.rows[i]),
    );
    expect(changed).toHaveLength(1);
    expect(changed[0]!.id).toBe('flap_top');
    expect(changed[0]!.presentIf).toBe('0');
  });

  it('drops the four top flaps and keeps everything else', () => {
    const roles = resolved.faces.map((f) => f.role).sort();
    expect(roles).toEqual([
      'back_flap_bottom', 'back_panel',
      'front_flap_bottom', 'front_panel',
      'glue_flap',
      'left_flap_bottom', 'left_panel',
      'right_flap_bottom', 'right_panel',
    ]);
    expect(resolved.faces).toHaveLength(9);
    expect(resolved.hinges).toHaveLength(8);
    expect(resolved.unresolved).toEqual([]);
  });

  it('shortens the blank by exactly one flap row', () => {
    expect(hsc.blank.width).toBe(rsc.blank.width);
    expect(hsc.blank.height).toBe(rsc.blank.height - hsc.params.flap!);
  });

  it('loses exactly the top flaps worth of board', () => {
    const rscArea = materialArea(resolveGeometry(rsc.graph));
    const topFlaps = resolveGeometry(rsc.graph)
      .faces.filter((f) => f.role.endsWith('_flap_top'))
      .reduce((s, f) => s + f.area, 0);
    expect(materialArea(resolved)).toBeCloseTo(rscArea - topFlaps, 6);
  });

  it('folds to the same box as the RSC, open at the top', () => {
    const e = extents(hsc.graph);
    expect(e[0]).toBeCloseTo(150, 6);
    expect(e[1]).toBeCloseTo(200, 6);
    expect(e[2]).toBeCloseTo(250, 6);
  });

  it('tracks 0201 when the shared parameters change', () => {
    for (const [L, W, H] of [[300, 200, 150], [80, 80, 400]] as const) {
      const a = compileStyle(fefco0200, { params: { L, W, H } });
      const b = compileStyle(fefco0201, { params: { L, W, H } });
      expect(a.blank.width).toBe(b.blank.width);
      expect(a.blank.height).toBe(b.blank.height - a.params.flap!);
      const r = resolveGeometry(a.graph);
      expect(r.faces).toHaveLength(9);
      expect(r.unresolved).toEqual([]);
    }
  });
});

describe('the tray carries no unverified catalogue code', () => {
  it('claims no standard or code', () => {
    // It was wrongly published as FEFCO 0300. 03xx is the telescope group and
    // multi-piece; this is one piece. Left unassigned rather than guessed again.
    expect(slitCornerTray.id).toBe('tray.slit_corner');
    expect(slitCornerTray.standard).toBeUndefined();
    expect(slitCornerTray.code).toBeUndefined();
  });

  it('is not the half slotted container, and does not share its numbers', () => {
    const tray = resolveGeometry(compileStyle(slitCornerTray).graph);
    const hsc = resolveGeometry(compileStyle(fefco0200).graph);
    expect(tray.faces).toHaveLength(9);
    expect(hsc.faces).toHaveLength(9);
    // Same face count, entirely different structure.
    expect(tray.faces.map((f) => f.role).sort()).not.toEqual(hsc.faces.map((f) => f.role).sort());
    expect(materialArea(tray)).not.toBeCloseTo(materialArea(hsc), 0);
  });
});

describe('bags', () => {
  const pillow = compileStyle(bagPillow);
  const gusseted = compileStyle(bagGusseted);
  const sup = compileStyle(bagSup);

  it('pillow: web is 2 fins plus 2 bag widths', () => {
    const p = pillow.params;
    expect(pillow.blank.width).toBeCloseTo(2 * p.finSeal! + 2 * p.bagW!, 6);
    expect(pillow.blank.height).toBeCloseTo(p.bagL!, 6);
  });

  it('pillow: folds lay-flat to width x length x fin', () => {
    const p = pillow.params;
    const e = extents(pillow.graph);
    // sorted ascending: fin, width, length
    expect(e[0]).toBeCloseTo(p.finSeal!, 6);
    expect(e[1]).toBeCloseTo(p.bagW!, 6);
    expect(e[2]).toBeCloseTo(p.bagL!, 6);
  });

  it('gusseted: web adds two gusset depths to the pillow web', () => {
    const g = gusseted.params;
    expect(gusseted.blank.width).toBeCloseTo(2 * g.finSeal! + 2 * g.bagW! + 2 * g.bagD!, 6);
  });

  it('gusseted: still folds lay-flat, gussets tucked between the panels', () => {
    const g = gusseted.params;
    const e = extents(gusseted.graph);
    expect(e[0]).toBeCloseTo(g.finSeal!, 6);
    expect(e[1]).toBeCloseTo(g.bagW!, 6);
    expect(e[2]).toBeCloseTo(g.bagL!, 6);
  });

  it('gusseted: loses no film — the blank is a full rectangle', () => {
    const r = resolveGeometry(gusseted.graph);
    expect(materialArea(r)).toBeCloseTo(gusseted.blank.width * gusseted.blank.height, 3);
  });

  it('SUP: is built without touching the grid', () => {
    expect(bagSup.grid).toBeUndefined();
    expect(bagSup.extraLines!.length).toBeGreaterThan(0);
    expect(bagSup.extraSeeds).toHaveLength(8);
  });

  it('SUP: resolves front, back, two gusset halves and four seal strips', () => {
    const r = resolveGeometry(sup.graph);
    expect(r.faces.map((f) => f.role).sort()).toEqual([
      'back_panel', 'back_seal_left', 'back_seal_right',
      'front_panel', 'front_seal_left', 'front_seal_right',
      'gusset_back', 'gusset_front',
    ]);
    expect(r.unresolved).toEqual([]);
  });

  it('SUP: the pinch is straight, not an arc, and removes exactly two triangles', () => {
    expect(sup.graph.lines.some((l) => l.geometry.kind === 'arc')).toBe(false);
    const r = resolveGeometry(sup.graph);
    const rect = sup.blank.width * sup.blank.height;
    const p = sup.params;
    // Each side chamfer is a triangle: base 2G (the gusset's full height), and
    // depth `pinch`.
    const triangle = 0.5 * (2 * p.G!) * p.pinch!;
    expect(rect - materialArea(r)).toBeCloseTo(2 * triangle, 6);
  });

  it('SUP: puts the front panel on top of the 2D layout and back on the bottom', () => {
    const r = resolveGeometry(sup.graph);
    const front = r.faces.find((f) => f.role === 'front_panel')!;
    const back = r.faces.find((f) => f.role === 'back_panel')!;
    expect(front.centroid.y).toBeGreaterThan(back.centroid.y);
    // The gusset half nearer each panel takes that panel's name.
    const gf = r.faces.find((f) => f.role === 'gusset_front')!;
    const gb = r.faces.find((f) => f.role === 'gusset_back')!;
    expect(gf.centroid.y).toBeGreaterThan(gb.centroid.y);
  });

  it('SUP: front is visible from outside on lay-flat, so it outranks the back', () => {
    const front = resolveGeometry(sup.graph).faces.find((f) => f.role === 'front_panel')!;
    const back = resolveGeometry(sup.graph).faces.find((f) => f.role === 'back_panel')!;
    expect(front.ply).toBeGreaterThan(back.ply);
  });

  it('SUP: widening the pinch removes more film', () => {
    const area = (pinch: number) =>
      materialArea(resolveGeometry(compileStyle(bagSup, { params: { pinch } }).graph));
    expect(area(2)).toBeGreaterThan(area(6));
    expect(area(6)).toBeGreaterThan(area(9));
  });

  it('SUP: folds lay-flat, back exactly onto front', () => {
    const p = sup.params;
    const e = extents(sup.graph);
    expect(e[0]).toBeCloseTo(0, 6); // no thickness — a bag has no rigid form
    expect(e[1]).toBeCloseTo(p.W! + 2 * p.S!, 6);
    expect(e[2]).toBeCloseTo(p.L!, 6);
  });

  it('SUP: keeps the pinch clear of the side seal', () => {
    // Cutting past the seal would remove the seal itself.
    const c = compileStyle(bagSup, { params: { pinch: 50, S: 10 } });
    expect(c.params.pinch!).toBeLessThan(c.params.S!);
    expect(c.warnings.join(' ')).toContain('clamped');
  });

  it('every bag stays parametric', () => {
    for (const [def, params] of [
      [bagPillow, { bagW: 90, bagL: 400, finSeal: 6, endSeal: 8 }],
      [bagGusseted, { bagW: 200, bagD: 40, bagL: 180, finSeal: 12 }],
      [bagSup, { W: 90, L: 300, G: 20, S: 8, pinch: 6 }],
    ] as const) {
      const c = compileStyle(def, { params });
      expect(c.warnings, def.id).toEqual([]);
      const r = resolveGeometry(c.graph);
      expect(r.unresolved, def.id).toEqual([]);
      expect(r.unreachableFaceIds, def.id).toEqual([]);
    }
  });
});
