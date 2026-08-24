/**
 * Renderer-agnostic orbit-camera state — angle-space math only, no DOM, no
 * canvas, no three.js, no dependency on this package at all.
 *
 * A faithful port of the RSC Dieline Generator's orbit-camera math
 * (`rsc-designer/src/render/fold3d.js` and `viewcube.js`, both three.js +
 * plain JS, no build step): the wrap and easing formulas below are
 * transliterated from that source with the same numeric behaviour, not
 * independently redesigned. Its own pointer/wheel handlers never redraw
 * directly, they only mutate `{rotX, rotY}` for a per-frame callback to
 * read back — the same "camera state only" shape carries over here, so it
 * works the same way whether the caller paints with Canvas2D or a real 3D
 * scene graph.
 *
 * This package is meant to live in its own repository (a GitHub repo could
 * not be created for it from this session — see Tech-Drawings' own commit
 * history for why), consumed by both Tech-Drawings and the RSC Dieline
 * Generator as a versioned build. Until that split happens, `dist/` here
 * is the "single-file build" both would consume; `src/orbitControls.ts` is
 * the only source file, with zero imports, so lifting it into its own repo
 * later is a file move plus a package.json, not a refactor.
 *
 * One deliberate non-literal spot: `stepOrbit`'s `'left'`/`'right'`/`'up'`/
 * `'down'` directions are defined relative to THIS package's own
 * `OrbitAngles` sign convention (azimuth increases toward `'right'`,
 * elevation increases toward `'up'` — Tech-Drawings' own drag handler
 * already behaves this way). RSC's `stepOrbit` cannot be ported with
 * identical +/- signs and remain correct for both apps at once: its own
 * drag handler inverts horizontal orbit on purpose ("horizontal inverted
 * per user preference", `rotY -= dx*0.008`), the opposite of Tech-Drawings'
 * `azimuth += dx*sensitivity` — so RSC's `ry - NUDGE` for `'right'` and
 * Tech-Drawings' own already-shipped `azimuth + nudge` for `'right'` are
 * both "correct" only relative to their own app's drag feel. A byte-
 * identical sign port would silently invert the nudge arrows relative to
 * whichever app didn't originate them. The step SIZE (`ORBIT_NUDGE`, 15°)
 * and the elevation clamp to +/-90 deg on the up/down step (RSC's
 * `clampRx`, present on its arrow-button step even though its free-drag
 * orbit is deliberately unclamped) are ported exactly.
 */
export interface OrbitAngles {
    azimuth: number;
    elevation: number;
}
/**
 * Wrap an angle into [-pi, pi) — ported verbatim from RSC's `fold3d.js`
 * `wrapPi`: `(a => { const m = (a + PI) % (2*PI); return (m < 0 ? m + 2*PI
 * : m) - PI; })`. Note the half-open side: `wrapPi(Math.PI)` is `-Math.PI`,
 * not `Math.PI` — this is RSC's own canonical-storage convention, kept
 * exactly rather than "corrected" to the opposite half-open interval.
 */
export declare function wrapPi(a: number): number;
/**
 * Animate the orbit from `from` to `to` over `durationMs`, taking the
 * shortest way around each angle (RSC's `short()`, ported above) with
 * RSC's own quadratic ease-in-out. Calls `onFrame` every animation frame
 * with the interpolated angles — never writes anywhere itself, the caller
 * owns wherever that state actually lives — and `onDone` once, on
 * completion. Returns a cancel function; cancelling after `onDone` has
 * already fired is a harmless no-op.
 *
 * RSC's own tween is PASSIVE: `tweenOrbit` just records `{fromX, fromY,
 * toX, toY, t0, dur}`, and a separately-driven `updateTween()` is polled
 * once per frame from `fold3d.js`'s own always-running `startLoop`. This
 * port is ACTIVE instead — it drives its own `requestAnimationFrame` loop
 * — because Tech-Drawings' 3D pane has no continuously-running render loop
 * to poll it from (it renders on store changes and resize, not every
 * frame); an active tween works for RSC's continuously-running loop too
 * (RSC would simply stop needing its own `updateTween` poll and read the
 * `onFrame` callback instead), so this is a compatible generalization, not
 * a behavioural fork.
 */
export declare function tweenOrbit(from: OrbitAngles, to: OrbitAngles, durationMs: number | undefined, onFrame: (a: OrbitAngles) => void, onDone?: () => void): () => void;
export type NudgeDirection = 'up' | 'down' | 'left' | 'right';
/** RSC's `viewcube.js`: `NUDGE = Math.PI/12` — 15 deg per arrow click, six clicks bring the adjacent face into view. */
export declare const ORBIT_NUDGE: number;
/**
 * One fixed-step nudge — RSC's `viewcube.js` `stepOrbit`, with directions
 * defined relative to THIS package's own sign convention (see the module
 * doc comment above for why a literal sign port isn't meaningful across
 * both apps). Elevation is clamped to +/-90 deg on `'up'`/`'down'`,
 * matching RSC's own `clampRx` on its arrow-button step.
 */
export declare function stepOrbit(dir: NudgeDirection, current: OrbitAngles, nudge?: number): OrbitAngles;
