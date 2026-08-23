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
/**
 * Wrap an angle into [-pi, pi) — ported verbatim from RSC's `fold3d.js`
 * `wrapPi`: `(a => { const m = (a + PI) % (2*PI); return (m < 0 ? m + 2*PI
 * : m) - PI; })`. Note the half-open side: `wrapPi(Math.PI)` is `-Math.PI`,
 * not `Math.PI` — this is RSC's own canonical-storage convention, kept
 * exactly rather than "corrected" to the opposite half-open interval.
 */
export function wrapPi(a) {
    const m = (a + Math.PI) % (2 * Math.PI);
    return (m < 0 ? m + 2 * Math.PI : m) - Math.PI;
}
/**
 * Shortest signed delta that reaches `b` from `a` — RSC's own private
 * `short()` helper inside `tweenOrbit`, ported as its own function since
 * this module's `tweenOrbit` needs it by name. Note this is NOT the same
 * function as `wrapPi` above despite the similar shape: RSC keeps two
 * separate wrap conventions (this one is closed at +pi via strict
 * inequalities, `wrapPi` is closed at -pi) for two different purposes, and
 * this port keeps that same separation rather than collapsing them into
 * one "wrap" function that would change `tweenOrbit`'s exact behaviour at
 * the +/-pi boundary.
 */
function shortestDelta(a, b) {
    let d = b - a;
    while (d > Math.PI)
        d -= 2 * Math.PI;
    while (d < -Math.PI)
        d += 2 * Math.PI;
    return d;
}
/** RSC's inline `updateTween` easing: `t < 0.5 ? 2*t*t : 1 - pow(-2*t+2, 2)/2` — quadratic ease-in-out, not cubic. */
function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
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
export function tweenOrbit(from, to, durationMs = 450, onFrame, onDone) {
    const toAzimuth = from.azimuth + shortestDelta(from.azimuth, to.azimuth);
    const toElevation = from.elevation + shortestDelta(from.elevation, to.elevation);
    const start = performance.now();
    let raf = 0;
    let cancelled = false;
    function frame(now) {
        if (cancelled)
            return;
        const t = durationMs <= 0 ? 1 : Math.min(1, (now - start) / durationMs);
        const e = easeInOutQuad(t);
        onFrame({ azimuth: from.azimuth + (toAzimuth - from.azimuth) * e, elevation: from.elevation + (toElevation - from.elevation) * e });
        if (t < 1) {
            raf = requestAnimationFrame(frame);
        }
        else {
            onDone?.();
        }
    }
    raf = requestAnimationFrame(frame);
    return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
    };
}
/** RSC's `viewcube.js`: `NUDGE = Math.PI/12` — 15 deg per arrow click, six clicks bring the adjacent face into view. */
export const ORBIT_NUDGE = Math.PI / 12;
/** RSC's `clampRx` — the arrow-button step clamps elevation to +/-90 deg even though free-drag orbit does not. */
function clampElevationForStep(e) {
    return Math.max(-Math.PI / 2, Math.min(Math.PI / 2, e));
}
/**
 * One fixed-step nudge — RSC's `viewcube.js` `stepOrbit`, with directions
 * defined relative to THIS package's own sign convention (see the module
 * doc comment above for why a literal sign port isn't meaningful across
 * both apps). Elevation is clamped to +/-90 deg on `'up'`/`'down'`,
 * matching RSC's own `clampRx` on its arrow-button step.
 */
export function stepOrbit(dir, current, nudge = ORBIT_NUDGE) {
    switch (dir) {
        case 'up':
            return { azimuth: current.azimuth, elevation: clampElevationForStep(current.elevation + nudge) };
        case 'down':
            return { azimuth: current.azimuth, elevation: clampElevationForStep(current.elevation - nudge) };
        case 'left':
            return { azimuth: current.azimuth - nudge, elevation: current.elevation };
        case 'right':
            return { azimuth: current.azimuth + nudge, elevation: current.elevation };
    }
}
