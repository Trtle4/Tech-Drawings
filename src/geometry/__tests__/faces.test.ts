import { describe, expect, it } from 'vitest';
import { awkwardBlank, rectangleTwoCreases, rsc201, shallowTray } from '../fixtures.js';
import { blankSize, materialArea, resolveGeometry } from '../resolve.js';
import { circle, graph, rect, seg } from '../build.js';
import { foldedFacePoints } from '../fold.js';
import type { ResolvedGeometry } from '../types.js';

const p = (x: number, y: number) => ({ x, y });

function reasons(r: ResolvedGeometry): string[] {
  return r.unresolved.map((u) => u.reason);
}

describe('rectangle with two creases', () => {
  const resolved = resolveGeometry(rectangleTwoCreases());

  it('resolves three faces without knowing what the shape is', () => {
    expect(resolved.faces).toHaveLength(3);
    for (const f of resolved.faces) expect(f.area).toBeCloseTo(10_000, 6);
  });

  it('resolves two hinges, each between a distinct pair of faces', () => {
    expect(resolved.hinges).toHaveLength(2);
    const pairs = new Set(resolved.hinges.map((h) => `${h.faceA}|${h.faceB}`));
    expect(pairs.size).toBe(2);
    for (const h of resolved.hinges) expect(h.collinear).toBe(true);
  });

  it('defaults every hinge to 90 degrees', () => {
    for (const h of resolved.hinges) expect(h.angle).toBeCloseTo(Math.PI / 2, 12);
  });

  it('reaches every face from the base face and reports nothing unresolved', () => {
    expect(resolved.foldTree).not.toBeNull();
    expect(resolved.foldTree!.order).toHaveLength(3);
    expect(resolved.unreachableFaceIds).toEqual([]);
    expect(resolved.unresolved).toEqual([]);
  });

  it('reports the flat blank size', () => {
    expect(blankSize(resolved)).toEqual({ width: 300, height: 100 });
  });
});

describe('face detection is orientation independent', () => {
  it('gives the same result for a clockwise outline', () => {
    const cw = graph([
      {
        id: 'outline',
        type: 'cut',
        role: 'blank.outline',
        sourceStyle: 'test',
        geometry: {
          kind: 'polyline',
          closed: true,
          points: [p(0, 0), p(0, 100), p(300, 100), p(300, 0)],
        },
      },
      seg('crease', 'crease.a', p(100, 0), p(100, 100)),
      seg('crease', 'crease.b', p(200, 0), p(200, 100)),
    ]);
    const resolved = resolveGeometry(cw);
    expect(resolved.faces).toHaveLength(3);
    expect(resolved.hinges).toHaveLength(2);
    for (const f of resolved.faces) expect(f.outer.signedArea).toBeGreaterThan(0);
  });

  it('resolves the same faces whether creases are drawn before or after the outline', () => {
    const creasesFirst = graph([
      seg('crease', 'crease.a', p(100, 0), p(100, 100)),
      seg('crease', 'crease.b', p(200, 0), p(200, 100)),
      rect('cut', 'blank.outline', 0, 0, 300, 100),
    ]);
    const a = resolveGeometry(creasesFirst);
    const b = resolveGeometry(rectangleTwoCreases());
    expect(a.faces.map((f) => f.area)).toEqual(b.faces.map((f) => f.area));
    expect(a.hinges).toHaveLength(b.hinges.length);
  });
});

describe('RSC, FEFCO 201', () => {
  const resolved = resolveGeometry(rsc201());

  it('resolves the glue flap, four body panels and eight flaps', () => {
    expect(resolved.faces).toHaveLength(13);
  });

  it('hinges every flap and body fold, and nothing else', () => {
    // 4 flap folds top + 4 bottom + 3 body folds + 1 glue flap fold.
    expect(resolved.hinges).toHaveLength(12);
    for (const h of resolved.hinges) expect(h.collinear).toBe(true);
  });

  it('folds as a tree with no closing hinges and nothing left over', () => {
    expect(resolved.foldTree!.order).toHaveLength(13);
    expect(resolved.foldTree!.closingHinges).toEqual([]);
    expect(resolved.unresolved).toEqual([]);
  });

  it('reports blank size and board area', () => {
    const size = blankSize(resolved)!;
    expect(size.width).toBeCloseTo(735, 6);
    expect(size.height).toBeCloseTo(400, 6);
    expect(materialArea(resolved)).toBeCloseTo(287_400, 3);
  });

  it('names panels from seed points rather than from bounding line names', () => {
    const roles = resolved.faces.map((f) => f.role).sort();
    expect(roles).toContain('front_panel');
    expect(roles).toContain('back_flap_top');
    expect(roles).toContain('glue_flap');
    expect(new Set(roles).size).toBe(13);
  });

  it('honours the declared base face', () => {
    const root = resolved.faces.find((f) => f.id === resolved.foldTree!.rootFaceId)!;
    expect(root.role).toBe('front_panel');
  });

  it('folds to a box of exactly the internal dimensions it was drawn from', () => {
    const folded = foldedFacePoints(resolved, 1);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const { points } of folded.values()) {
      for (const q of [...points]) {
        const c = [q.x, q.y, q.z];
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i]!, c[i]!);
          max[i] = Math.max(max[i]!, c[i]!);
        }
      }
    }
    const extents = max.map((m, i) => m - min[i]!).sort((a, b) => a - b);
    // L 200, W 150, H 250 — the flaps fold flat into the top and bottom, so
    // they add nothing to the outside of the case.
    expect(extents[0]).toBeCloseTo(150, 6);
    expect(extents[1]).toBeCloseTo(200, 6);
    expect(extents[2]).toBeCloseTo(250, 6);
  });
});

describe('the awkward blank', () => {
  const resolved = resolveGeometry(awkwardBlank());
  const byArea = [...resolved.faces].sort((a, b) => b.area - a.area);

  it('subdivides a concave L outline with crossing creases', () => {
    // 4 regions in the main blank, +1 for the crease loop interior, +2 island.
    expect(resolved.faces).toHaveLength(7);
  });

  it('cuts the peg hole out of the face that contains it, not out of the blank', () => {
    const lFace = byArea[0]!;
    expect(lFace.holes).toHaveLength(1);
    // L-shaped region is 10 800 mm² before the 6 mm radius hole comes out. The
    // hole is flattened to chords, so the removed area is slightly under πr².
    expect(lFace.area).toBeGreaterThan(10_800 - Math.PI * 36);
    expect(lFace.area).toBeLessThan(10_800 - Math.PI * 36 + 2);
  });

  it('does not treat a closed crease loop as removed material', () => {
    const total = materialArea(resolved);
    // L outline 21 600 + island 4 800, less only the peg hole.
    const expected = 21_600 + 4_800 - Math.PI * 36;
    expect(total).toBeGreaterThan(expected);
    expect(total).toBeLessThan(expected + 2);
    const loop = resolved.faces.find((f) => Math.abs(f.area - 625) < 1e-6);
    expect(loop).toBeDefined();
  });

  it('hinges the closed crease loop to the face it sits inside', () => {
    const loop = resolved.faces.find((f) => Math.abs(f.area - 625) < 1e-6)!;
    const touching = resolved.hinges.filter((h) => h.faceA === loop.id || h.faceB === loop.id);
    expect(touching).toHaveLength(1);
  });

  it('flags the closed crease loop as having no rigid fold axis', () => {
    expect(reasons(resolved)).toContain('non_collinear_hinge');
    const bent = resolved.hinges.filter((h) => !h.collinear);
    expect(bent).toHaveLength(1);
  });

  it('flags the crease that stops halfway across a panel', () => {
    const dangling = resolved.unresolved.filter((u) => u.reason === 'dangling');
    expect(dangling).toHaveLength(1);
    expect(dangling[0]!.message).toContain('dangles inside');
  });

  it('flags the crease floating outside every blank', () => {
    const outside = resolved.unresolved.filter((u) => u.reason === 'outside_blank');
    expect(outside).toHaveLength(1);
  });

  it('reports the disconnected island rather than folding it', () => {
    expect(resolved.unreachableFaceIds).toHaveLength(2);
    expect(reasons(resolved).filter((r) => r === 'unreachable_face')).toHaveLength(2);
  });

  it('splits one crease into separate hinges where it borders different faces', () => {
    // cross.vertical and cross.horizontal each separate two distinct face
    // pairs, so each yields two hinges rather than one.
    expect(resolved.hinges).toHaveLength(6);
  });

  it('ignores bleed and dimension lines entirely', () => {
    const furniture = new Set(['blank.bleed', 'dim.overall_width']);
    for (const u of resolved.unresolved) {
      for (const id of u.lineIds) {
        const role = awkwardBlank().lines.find((l) => l.id === id)?.role ?? '';
        expect(furniture.has(role)).toBe(false);
      }
    }
  });

  it('still gives every face a transform, including the ones it cannot fold', () => {
    const folded = foldedFacePoints(resolved, 1);
    expect(folded.size).toBe(resolved.faces.length);
    for (const { points } of folded.values()) {
      for (const q of points) expect(Number.isFinite(q.x + q.y + q.z)).toBe(true);
    }
  });
});

describe('fold traversal', () => {
  it('handles a face graph with cycles by folding a spanning tree', () => {
    const resolved = resolveGeometry(shallowTray());
    expect(resolved.faces).toHaveLength(9); // base, 4 walls, 4 corners
    expect(resolved.hinges).toHaveLength(12);
    expect(resolved.foldTree!.order).toHaveLength(9);
    expect(resolved.foldTree!.closingHinges).toHaveLength(4);
    expect(resolved.unreachableFaceIds).toEqual([]);
  });

  it('reads each hinge angle rather than assuming 90 degrees', () => {
    for (const angle of [Math.PI / 3, Math.PI / 2, (2 * Math.PI) / 3]) {
      const resolved = resolveGeometry(shallowTray());
      for (const h of resolved.hinges) h.angle = angle;
      const tree = resolved.foldTree!;
      const folded = foldedFacePoints(resolved, 1);
      // The four walls hang directly off the base, so each rises by exactly
      // wall × sin(angle). Corner tabs hang off the walls and compound.
      const walls = tree.children.get(tree.rootFaceId)!;
      let maxZ = 0;
      for (const id of walls) for (const q of folded.get(id)!.points) maxZ = Math.max(maxZ, q.z);
      expect(maxZ).toBeCloseTo(25 * Math.sin(angle), 6);
    }
  });

  it('leaves the blank flat at fold ratio zero', () => {
    const resolved = resolveGeometry(rsc201());
    const folded = foldedFacePoints(resolved, 0);
    for (const { points } of folded.values()) {
      for (const q of points) expect(q.z).toBeCloseTo(0, 9);
    }
  });

  it('folds every face out of plane by ratio 1 except the base', () => {
    const resolved = resolveGeometry(rectangleTwoCreases());
    const folded = foldedFacePoints(resolved, 1);
    const root = resolved.foldTree!.rootFaceId;
    for (const [id, { points }] of folded) {
      const lifted = points.some((q) => Math.abs(q.z) > 1e-6);
      expect(lifted).toBe(id !== root);
    }
  });
});

describe('degenerate input never throws', () => {
  it('handles an empty graph', () => {
    const resolved = resolveGeometry(graph([]));
    expect(resolved.faces).toEqual([]);
    expect(resolved.foldTree).toBeNull();
    expect(resolved.blankBounds).toBeNull();
  });

  it('handles an open outline that encloses nothing', () => {
    const resolved = resolveGeometry(
      graph([
        seg('cut', 'open.a', p(0, 0), p(100, 0)),
        seg('cut', 'open.b', p(100, 0), p(100, 100)),
        seg('crease', 'open.crease', p(0, 50), p(100, 50)),
      ]),
    );
    expect(resolved.faces).toEqual([]);
    expect(resolved.hinges).toEqual([]);
  });

  it('handles a zero-length line', () => {
    const resolved = resolveGeometry(
      graph([rect('cut', 'blank.outline', 0, 0, 100, 100), seg('crease', 'nil', p(50, 50), p(50, 50))]),
    );
    expect(resolved.faces).toHaveLength(1);
    expect(reasons(resolved)).toContain('zero_length');
  });

  it('handles duplicate coincident lines', () => {
    const resolved = resolveGeometry(
      graph([
        rect('cut', 'blank.outline', 0, 0, 100, 100),
        rect('cut', 'blank.outline_duplicate', 0, 0, 100, 100),
        seg('crease', 'mid', p(50, 0), p(50, 100)),
        seg('crease', 'mid_duplicate', p(50, 0), p(50, 100)),
      ]),
    );
    expect(resolved.faces).toHaveLength(2);
    expect(resolved.hinges).toHaveLength(1);
  });

  it('keeps a crease that a cut overlaps as a cut', () => {
    const resolved = resolveGeometry(
      graph([
        rect('cut', 'blank.outline', 0, 0, 100, 100),
        // A crease drawn exactly along the outline is not a hinge.
        seg('crease', 'stray.on_edge', p(0, 0), p(100, 0)),
      ]),
    );
    expect(resolved.faces).toHaveLength(1);
    expect(resolved.hinges).toEqual([]);
  });
});

describe('face seeds', () => {
  const base = () => [rect('cut', 'blank.outline', 0, 0, 300, 100), seg('crease', 'c', p(100, 0), p(100, 100))];

  it('names the face containing the seed', () => {
    const resolved = resolveGeometry(
      graph(base(), {
        faceSeeds: [
          { role: 'body', point: p(200, 50), kind: 'panel' },
          { role: 'glue_flap', point: p(50, 50), kind: 'seal' },
        ],
      }),
    );
    const body = resolved.faces.find((f) => f.role === 'body')!;
    expect(body.area).toBeCloseTo(20_000, 6);
    expect(body.kind).toBe('panel');
    expect(resolved.faces.find((f) => f.role === 'glue_flap')!.kind).toBe('seal');
  });

  it('reports a seed that no longer lands on a face', () => {
    const resolved = resolveGeometry(
      graph(base(), { faceSeeds: [{ role: 'ghost_panel', point: p(400, 50) }] }),
    );
    const miss = resolved.unresolved.find((u) => u.message.includes('ghost_panel'));
    expect(miss).toBeDefined();
  });

  it('does not name a face through one of its holes', () => {
    const resolved = resolveGeometry(
      graph([...base(), circle('cut', 'peg', p(200, 50), 10)], {
        faceSeeds: [{ role: 'inside_the_hole', point: p(200, 50) }],
      }),
    );
    expect(resolved.faces.some((f) => f.role === 'inside_the_hole')).toBe(false);
    expect(resolved.unresolved.some((u) => u.message.includes('inside_the_hole'))).toBe(true);
  });
});

describe('held fold angles', () => {
  it('reapplies angles across a rebuild', () => {
    const angles = new Map<string, number>([['hinge.1', Math.PI]]);
    const resolved = resolveGeometry(rectangleTwoCreases(), { angles });
    const h = resolved.hinges.find((x) => x.id === 'hinge.1')!;
    expect(h.angle).toBeCloseTo(Math.PI, 12);
  });
});
