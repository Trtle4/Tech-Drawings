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
import { applyOverrides, describeStaleOp, type OverrideOp } from './overrides.js';
import { DEFAULT_SNAP, fitToBounds, type Camera2D, type SnapSettings, type Viewport } from './camera2d.js';

export type Selection = { kind: 'line'; lineId: string } | { kind: 'face'; faceId: string } | null;

/**
 * The currently-applied artwork. Purely a rendering overlay — see
 * `Store.setArtwork`. `image` is pre-loaded (decoded) so the 2D and 3D
 * panes can read `naturalWidth`/`naturalHeight` and draw synchronously on
 * every render, rather than every consumer separately awaiting a decode.
 */
export interface ArtworkState {
  kind: 'png' | 'jpg' | 'svg' | 'test';
  name: string;
  dataUrl: string;
  image: HTMLImageElement;
}

/** Orbit angles plus a pan/zoom of the resulting projected plane — see camera2d.ts's Camera2D, reused as-is for the 2D plane a 3D projection lands on. */
export interface Camera3DState {
  azimuth: number;
  elevation: number;
  view: Camera2D;
}

// A three-quarter view facing the model's own "front" — azimuth 0 looks
// straight down the up-axis-perpendicular plane that reads widest (a bag's
// front panel, a case's widest face); 48deg put the camera close enough to
// side-on that a bag's cross-section read as edge-on and unreadable.
export const DEFAULT_ORBIT = { azimuth: (30 * Math.PI) / 180, elevation: (18 * Math.PI) / 180 };

export interface AppState {
  styleId: string;
  params: Record<string, number>;
  ops: OverrideOp[];
  selection: Selection;
  camera: Camera2D;
  camera3d: Camera3DState;
  snap: SnapSettings;
  primaryView: '2d' | '3d';
  /**
   * View state, not content — like `camera`, not tracked by undo/redo.
   * `null` means no artwork applied; both panes fall back to their plain
   * shaded rendering. Updating it never touches `styleId`/`params`/`ops`,
   * so applying, replacing or removing artwork never re-derives geometry —
   * "artwork updates the texture only, never rebuilds the mesh," literally:
   * `getDerived()`'s cache key is `state`, but `derive()` itself never reads
   * `state.artwork`, so a `derive()` call that DOES re-run because some
   * unrelated field changed still reuses the same mesh either way.
   */
  artwork: ArtworkState | null;
  /** 3D pane background — 'white' for a clean screenshot/handoff backdrop. */
  bg3d: 'theme' | 'white';
}

export interface StaleOverride {
  op: OverrideOp;
  message: string;
}

export interface Derived {
  def: StyleDefinition;
  /** Every parameter after defaults, overrides and clamping. */
  compiledParams: Record<string, number>;
  warnings: string[];
  /** The edited graph: the compiled base with every op in `state.ops` replayed on top. */
  graph: GeometryGraph;
  resolved: ResolvedGeometry;
  /**
   * Ops still in `state.ops` that no longer apply at the current dimensions —
   * their target line or hinge is gone. Never dropped from `ops` on their
   * own (a dimension change back could make them apply again), just flagged
   * here so the unfolded-geometry panel can show them instead of the edit
   * silently doing nothing.
   */
  staleOverrides: StaleOverride[];
}

function derive(state: AppState): Derived {
  const def = STYLE_BY_ID.get(state.styleId) ?? STYLES[0]!;
  const compiled = compileStyle(def, { params: state.params });
  const { graph, hingeAngleOverrides, staleOps } = applyOverrides(compiled.graph, state.ops);
  const resolved = resolveGeometry(graph, { angles: hingeAngleOverrides });

  const staleOverrides: StaleOverride[] = staleOps.map((op) => ({ op, message: describeStaleOp(op) }));
  for (const op of state.ops) {
    if (op.kind !== 'set_hinge_angle') continue;
    const stillMatches = resolved.hinges.some(
      (h) => (h.faceA === op.faceA && h.faceB === op.faceB) || (h.faceA === op.faceB && h.faceB === op.faceA),
    );
    if (!stillMatches) staleOverrides.push({ op, message: describeStaleOp(op) });
  }

  return { def, compiledParams: compiled.params, warnings: compiled.warnings, graph, resolved, staleOverrides };
}

/** The part of app state undo/redo tracks — content, not view state like camera or selection. */
interface ContentSnapshot {
  styleId: string;
  params: Record<string, number>;
  ops: OverrideOp[];
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
    camera3d: { ...DEFAULT_ORBIT, view: { cx: 0, cy: 0, zoom: 1 } },
    snap: DEFAULT_SNAP,
    primaryView: '2d',
    artwork: null,
    bg3d: 'theme',
  };
}

export type Listener = () => void;

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();
  private cache: { state: AppState; derived: Derived } | null = null;
  // Undo/redo tracks content (style, params, ops) only — not camera, selection
  // or snap toggles, the same way undoing in a drawing app does not jerk the
  // viewport around. Every content-mutating method calls `pushHistory()`
  // before it changes anything.
  private undoStack: ContentSnapshot[] = [];
  private redoStack: ContentSnapshot[] = [];

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

  private snapshotContent(): ContentSnapshot {
    return { styleId: this.state.styleId, params: this.state.params, ops: this.state.ops };
  }

  /** Record where content was before a mutation, and drop any redo history it invalidates. */
  private pushHistory(): void {
    this.undoStack.push(this.snapshotContent());
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshotContent());
    this.set({ ...prev, selection: null });
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshotContent());
    this.set({ ...next, selection: null });
  }

  /**
   * Switching style starts clean: a different style's dimensions and a
   * stranger's hand edits do not mix. Artwork goes too, for the same
   * reason — it's registered to the OLD style's own blank bounds, and would
   * render stretched and meaningless across a completely different shape.
   */
  setStyle(styleId: string): void {
    const def = STYLE_BY_ID.get(styleId);
    if (!def) return;
    this.pushHistory();
    const compiled = compileStyle(def);
    this.set({ styleId, params: compiled.params, ops: [], selection: null, artwork: null });
  }

  setParam(id: string, value: number): void {
    if (!Number.isFinite(value)) return;
    this.pushHistory();
    this.set({ params: { ...this.state.params, [id]: value } });
  }

  select(selection: Selection): void {
    this.set({ selection });
  }

  setCamera(camera: Camera2D): void {
    this.set({ camera });
  }

  setCamera3D(camera3d: Camera3DState): void {
    this.set({ camera3d });
  }

  setSnap(patch: Partial<SnapSettings>): void {
    this.set({ snap: { ...this.state.snap, ...patch } });
  }

  setPrimaryView(view: '2d' | '3d'): void {
    this.set({ primaryView: view });
  }

  /** Apply (or replace) artwork. A pure rendering-layer overlay — see `AppState.artwork`. */
  setArtwork(artwork: ArtworkState): void {
    this.set({ artwork });
  }

  clearArtwork(): void {
    this.set({ artwork: null });
  }

  setBg3D(mode: 'theme' | 'white'): void {
    this.set({ bg3d: mode });
  }

  pushOp(op: OverrideOp): void {
    this.pushHistory();
    this.set({ ops: [...this.state.ops, op] });
  }

  /**
   * Undo every edit touching this one line — a hand-drawn addition
   * disappears, a template line returns to what the style generates. A
   * shared-vertex move is one topological edit across every line it
   * touched, so reverting any one of them drops the whole move rather than
   * leaving the rest welded to a point this line no longer shares.
   */
  revertLine(lineId: string): void {
    this.pushHistory();
    const ops = this.state.ops.filter((op) => {
      if (op.kind === 'add_line') return op.id !== lineId;
      if (op.kind === 'set_hinge_angle') return true;
      if (op.kind === 'move_vertex') return !op.targets.some((t) => t.lineId === lineId);
      return op.lineId !== lineId;
    });
    this.set({ ops, selection: null });
  }

  /** Undo every edit in the drawing. Dimensions are not an override and are left alone. */
  revertAll(): void {
    this.pushHistory();
    this.set({ ops: [], selection: null });
  }

  /** Detach one line's endpoint — the deliberate opposite of `moveVertex`. */
  moveLinePoint(lineId: string, pointIndex: number, to: Vec2): void {
    this.pushOp({ kind: 'move_point', lineId, pointIndex, to });
  }

  /** The default drag: move a shared vertex and every line that has a point coincident with it. */
  moveVertex(targets: { lineId: string; pointIndex: number }[], to: Vec2): void {
    this.pushOp({ kind: 'move_vertex', targets, to });
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
