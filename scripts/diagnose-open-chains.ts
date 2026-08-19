/**
 * Diagnostic for the even-odd material rule on open cut chains.
 *
 * Casts a ray in several directions from inside each of the four features and
 * counts cut crossings. If the parity disagrees between directions, the cut
 * boundary is not closed and even-odd cannot classify that region.
 *
 *   npx tsx scripts/diagnose-open-chains.ts
 */
import { openCutChains } from '../src/geometry/fixtures.js';
import { buildArrangement } from '../src/geometry/arrangement.js';
import { resolveGeometry } from '../src/geometry/resolve.js';
import type { Vec2 } from '../src/geometry/types.js';

const graph = openCutChains();
const arr = buildArrangement(graph.lines);

const cutSegs: [Vec2, Vec2][] = [];
for (const e of arr.edges) {
  if (!e.types.includes('cut')) continue;
  cutSegs.push([arr.vertices[e.a]!.p, arr.vertices[e.b]!.p]);
}

/** Even-odd crossing count along a ray of the given direction. */
function crossings(p: Vec2, theta: number): number {
  const c = Math.cos(-theta);
  const s = Math.sin(-theta);
  const rot = (q: Vec2): Vec2 => ({ x: q.x * c - q.y * s, y: q.x * s + q.y * c });
  const pr = rot(p);
  let n = 0;
  for (const [a0, b0] of cutSegs) {
    const a = rot(a0);
    const b = rot(b0);
    if (a.y > pr.y !== b.y > pr.y) {
      const x = ((b.x - a.x) * (pr.y - a.y)) / (b.y - a.y) + a.x;
      if (pr.x < x) n++;
    }
  }
  return n;
}

const PROBES: { name: string; expected: 'material' | 'void'; at: Vec2 }[] = [
  { name: '(a) closed slot     ', expected: 'void', at: { x: 40, y: 70 } },
  { name: '(b) locking tab     ', expected: 'material', at: { x: 120, y: 58 } },
  { name: '(c) thumb notch     ', expected: 'void', at: { x: 200, y: 132 } },
  { name: '(d) hand hole flap  ', expected: 'material', at: { x: 280, y: 65 } },
  { name: '    parent panel    ', expected: 'material', at: { x: 60, y: 20 } },
  { name: '    outside blank   ', expected: 'void', at: { x: 400, y: 70 } },
];

const DIRS: [string, number][] = [
  ['+x', 0],
  ['+y', Math.PI / 2],
  ['-x', Math.PI],
  ['-y', -Math.PI / 2],
  ['37°', 0.6458],
];

console.log('\nRay crossing parity by direction (odd = material, even = void)\n');
console.log(
  '  region                 expected  ' + DIRS.map(([d]) => d.padStart(9)).join('') + '   verdict',
);
console.log('  ' + '─'.repeat(88));

for (const probe of PROBES) {
  const cells: string[] = [];
  const verdicts = new Set<string>();
  for (const [, theta] of DIRS) {
    const n = crossings(probe.at, theta);
    const odd = n % 2 === 1;
    verdicts.add(odd ? 'material' : 'void');
    cells.push(`${n}:${odd ? 'mat' : 'void'}`.padStart(9));
  }
  const stable = verdicts.size === 1;
  const got = stable ? [...verdicts][0]! : 'DIRECTION DEPENDENT';
  const mark = !stable ? '  ✗ unstable' : got === probe.expected ? '  ✓' : '  ✗ wrong';
  console.log(`  ${probe.name}   ${probe.expected.padEnd(9)}${cells.join('')}   ${got}${mark}`);
}

// ---------------------------------------------------------------------------
// Two candidate rules, compared on the same blank.
//
//  B — "a crease closes the ring": add crease edges whose endpoints are the
//      loose ends of a cut chain, then ray cast against cuts + those creases.
//  C — "only closing cuts bound material": keep a cut edge only if it survives
//      iteratively pruning degree-1 vertices from the cut-only subgraph, i.e.
//      only if it lies on a cycle. Ray cast against those.
// ---------------------------------------------------------------------------

const cutDegree = new Map<number, number>();
for (const e of arr.edges) {
  if (!e.types.includes('cut')) continue;
  cutDegree.set(e.a, (cutDegree.get(e.a) ?? 0) + 1);
  cutDegree.set(e.b, (cutDegree.get(e.b) ?? 0) + 1);
}

// Rule B: cuts, plus creases bridging two loose cut ends.
const setB: [Vec2, Vec2][] = [...cutSegs];
for (const e of arr.edges) {
  if (e.types.includes('cut')) continue;
  if ((cutDegree.get(e.a) ?? 0) === 1 && (cutDegree.get(e.b) ?? 0) === 1) {
    setB.push([arr.vertices[e.a]!.p, arr.vertices[e.b]!.p]);
  }
}

// Rule C: prune cut chains that do not close.
const deg = new Map(cutDegree);
const alive = new Set(arr.edges.filter((e) => e.types.includes('cut')).map((e) => e.id));
const queue = [...deg.entries()].filter(([, d]) => d === 1).map(([v]) => v);
while (queue.length) {
  const v = queue.pop()!;
  if ((deg.get(v) ?? 0) !== 1) continue;
  const e = arr.edges.find((x) => alive.has(x.id) && (x.a === v || x.b === v));
  if (!e) continue;
  alive.delete(e.id);
  for (const end of [e.a, e.b]) {
    const d = (deg.get(end) ?? 0) - 1;
    deg.set(end, d);
    if (d === 1) queue.push(end);
  }
}
const setC: [Vec2, Vec2][] = arr.edges
  .filter((e) => alive.has(e.id))
  .map((e) => [arr.vertices[e.a]!.p, arr.vertices[e.b]!.p]);

function crossingsIn(segs: [Vec2, Vec2][], p: Vec2, theta: number): number {
  const c = Math.cos(-theta);
  const s = Math.sin(-theta);
  const rot = (q: Vec2): Vec2 => ({ x: q.x * c - q.y * s, y: q.x * s + q.y * c });
  const pr = rot(p);
  let n = 0;
  for (const [a0, b0] of segs) {
    const a = rot(a0);
    const b = rot(b0);
    if (a.y > pr.y !== b.y > pr.y) {
      const x = ((b.x - a.x) * (pr.y - a.y)) / (b.y - a.y) + a.x;
      if (pr.x < x) n++;
    }
  }
  return n;
}

function verdictOf(segs: [Vec2, Vec2][], at: Vec2): string {
  const seen = new Set<string>();
  for (const [, theta] of DIRS) {
    seen.add(crossingsIn(segs, at, theta) % 2 === 1 ? 'material' : 'void');
  }
  return seen.size === 1 ? [...seen][0]! : 'UNSTABLE';
}

console.log('\n\nCandidate rules\n');
console.log('  region                 expected     B: crease closes ring    C: only closing cuts');
console.log('  ' + '─'.repeat(88));
for (const probe of PROBES) {
  const b = verdictOf(setB, probe.at);
  const c = verdictOf(setC, probe.at);
  const mk = (got: string) => (got === probe.expected ? '✓' : '✗');
  console.log(
    `  ${probe.name}   ${probe.expected.padEnd(11)}${(mk(b) + ' ' + b).padEnd(25)}${mk(c) + ' ' + c}`,
  );
}
console.log(
  `\n  cut edges: ${cutSegs.length} total, ${setC.length} on a cycle, ` +
    `${cutSegs.length - setC.length} pruned as slits\n`,
);

const resolved = resolveGeometry(graph);
console.log(`\nresolveGeometry: ${resolved.faces.length} faces, ${resolved.hinges.length} hinges`);
for (const f of resolved.faces) {
  console.log(`  ${f.id}  ${f.area.toFixed(1)} mm²  ${f.holes.length} hole(s)`);
}
for (const u of resolved.unresolved) console.log(`  [${u.reason}] ${u.message}`);
console.log();
