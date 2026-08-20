/**
 * Central app state: the one place the editor's pieces (panel, canvas,
 * inspector, 3D pane) read from and write through. No framework — a tiny
 * pub-sub store, because this app has four listeners, not four hundred.
 *
 * The recompute pipeline is always the same three steps, in order:
 *
 *   compileStyle(def, params) -> applyOverrides(base, ops) -> resolveGeometry
 *
 * Every mutation (a param slider, a dragged line, a retyped crease, a hinge
 * angle) goes through `pushOp` or `setParam` and re-runs that pipeline from
 * scratch. Nothing is patched in place, so a dimension change and a hand
 * edit can never drift out of sync with each other.
 */
import type { DrawingLine, GeometryGraph, LineType, ResolvedGeometry, Vec2 } from '../geometry/types.js';
import { resolveGeometry } from '../geometry/resolve.js';
import { STYLES, STYLE_BY_ID } from '../styles/index.js';
import { compileStyle } from '../styles/compile.js';
import type { StyleDefinition } from '../styles/schema.js';
import { applyOverrides, type OverrideOp } from './overrides.js';
import { DEFAULT_SNAP, fitToBounds, type Camera2D, type SnapSettings, type Viewport } from './camera2d.js';

export type Selection = { kind: 'line'; lineId: string } | { kind: 'face'; faceId: string } | null;

export interface AppState {
  styleId: string;
  params: Record<string, number>;
  ops: OverrideOp[];
  selection: Selection;
  camera: Camera2D;
  snap: SnapSettings;
  primaryView: '2d' | '3d';
}

export interface Derived {
  def: StyleDefinition;
  /** Every parameter after defaults, overrides and clamping. */
  compiledParams: Record<string, number>;
  warnings: string[];
  /** The edited graph: the compiled base with every op in `state.ops` replayed on top. */
  graph: GeometryGraph;
  resolved: ResolvedGeometry;
}

function derive(state: AppState): Derived {
  const def = STYLE_BY_ID.get(state.styleId) ?? STYLES[0]!;
  const compiled = compileStyle(def, { params: state.params });
  const { graph, hingeAngleOverrides } = applyOverrides(compiled.graph, state.ops);
  const resolved = resolveGeometry(graph, { angles: hingeAngleOverrides });
  return { def, compiledParams: compiled.params, warnings: compiled.warnings, graph, resolved };
}

export function createInitialState(styleId?: string): AppState {
  const def = (styleId && STYLE_BY_ID.get(styleId)) || STYLES[0]!;
  const compiled = compileStyle(def);
  return {
    styleId: def.id,
    params: compiled.params,
    ops: [],
    selection: null,
    camera: { cx: 0, cy: 0, zoom: 1 },
    snap: DEFAULT_SNAP,
    primaryView: '2d',
  };
}

export type Listener = () => void;

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();
  private cache: { state: AppState; derived: Derived } | null = null;

  constructor(initial: AppState) {
    this.state = initial;
  }

  getState(): AppState {
    return this.state;
  }

  /** Recomputed lazily and cached until the next mutation. */
  getDerived(): Derived {
    if (this.cache && this.cache.state === this.state) return this.cache.derived;
    const derived = derive(this.state);
    this.cache = { state: this.state, derived };
    return derived;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Switching style starts clean: a different style's dimensions and a stranger's hand edits do not mix. */
  setStyle(styleId: string): void {
    const def = STYLE_BY_ID.get(styleId);
    if (!def) return;
    const compiled = compileStyle(def);
    this.set({ styleId, params: compiled.params, ops: [], selection: null });
  }

  setParam(id: string, value: number): void {
    if (!Number.isFinite(value)) return;
    this.set({ params: { ...this.state.params, [id]: value } });
  }

  select(selection: Selection): void {
    this.set({ selection });
  }

  setCamera(camera: Camera2D): void {
    this.set({ camera });
  }

  setSnap(patch: Partial<SnapSettings>): void {
    this.set({ snap: { ...this.state.snap, ...patch } });
  }

  setPrimaryView(view: '2d' | '3d'): void {
    this.set({ primaryView: view });
  }

  pushOp(op: OverrideOp): void {
    this.set({ ops: [...this.state.ops, op] });
  }

  moveLinePoint(lineId: string, pointIndex: number, to: Vec2): void {
    this.pushOp({ kind: 'move_point', lineId, pointIndex, to });
  }

  moveLine(lineId: string, dx: number, dy: number): void {
    this.pushOp({ kind: 'move_line', lineId, dx, dy });
  }

  /** Type is required up front — there is no way to call this without one. */
  addLine(type: LineType, points: [Vec2, Vec2]): string {
    const id = `user:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
    this.pushOp({ kind: 'add_line', id, type, role: `user.${id}`, points });
    return id;
  }

  deleteLine(lineId: string): void {
    this.pushOp({ kind: 'delete_line', lineId });
    if (this.state.selection?.kind === 'line' && this.state.selection.lineId === lineId) {
      this.select(null);
    }
  }

  setLineType(lineId: string, type: LineType): void {
    this.pushOp({ kind: 'set_line_type', lineId, type });
  }

  setHingeAngle(faceA: string, faceB: string, angleRad: number): void {
    this.pushOp({ kind: 'set_hinge_angle', faceA, faceB, angleRad });
  }

  fitToBlank(vp: Viewport): void {
    const bounds = this.getDerived().resolved.blankBounds;
    if (!bounds) return;
    this.setCamera(fitToBounds(bounds, vp));
  }
}

/** Convenience for callers that just need to find a line by id in the derived graph. */
export function findLine(graph: GeometryGraph, lineId: string): DrawingLine | undefined {
  return graph.lines.find((l) => l.id === lineId);
}
