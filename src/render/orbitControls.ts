/**
 * Renderer-agnostic 3D orbit-camera state helpers — angle-space math only,
 * no DOM, no canvas, no three.js. Ported from the RSC Dieline Generator's
 * `fold3d.js`/`viewcube.js` (a sibling project, three.js-based): its own
 * pointer/wheel handlers never redraw directly, they only mutate a
 * `{rotX, rotY}` pair that a per-frame callback reads back — this module is
 * that same "camera state only" idea, factored out so it works the same way
 * whether the caller paints with Canvas2D (this app's `pane3d.ts`) or a real
 * 3D scene graph. Tech-Drawings' own `azimuth`/`elevation` spherical
 * convention (see `render/iso.ts`'s `cameraBasis`) already matches RSC's
 * `rotY`/`rotX` model closely enough that porting is a rename, not a
 * redesign — the two genuinely new capabilities lifted from RSC are the
 * eased tween-to-target (`tweenOrbit`, used there for its ViewCube's
 * click-to-snap and Home button) and the fixed-step nudge (`stepOrbit`, its
 * four arrow buttons).
 */

export interface OrbitAngles {
  azimuth: number;
  elevation: number;
}

/** Normalize an angle into (-π, π]. */
export function wrapPi(a: number): number {
  let x = a % (2 * Math.PI);
  if (x <= -Math.PI) x += 2 * Math.PI;
  if (x > Math.PI) x -= 2 * Math.PI;
  return x;
}

/** Shortest signed distance from `a` to `b`, wrap-aware — negative or positive, never more than π in magnitude. */
function shortestDelta(a: number, b: number): number {
  return wrapPi(b - a);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Animate the orbit from `from` to `to` over `durationMs`, taking the
 * shortest way around each angle. Calls `onFrame` every animation frame
 * with the interpolated angles (never writes anything itself — the caller
 * owns wherever that state actually lives, a store, a plain variable,
 * whatever), and `onDone` once, on completion. Returns a cancel function;
 * cancelling after `onDone` has already fired is a harmless no-op.
 */
export function tweenOrbit(from: OrbitAngles, to: OrbitAngles, durationMs: number, onFrame: (a: OrbitAngles) => void, onDone?: () => void): () => void {
  const dAz = shortestDelta(from.azimuth, to.azimuth);
  const dEl = shortestDelta(from.elevation, to.elevation);
  const start = performance.now();
  let raf = 0;
  let cancelled = false;

  function frame(now: number): void {
    if (cancelled) return;
    const t = durationMs <= 0 ? 1 : Math.min(1, (now - start) / durationMs);
    const e = easeInOutCubic(t);
    onFrame({ azimuth: from.azimuth + dAz * e, elevation: from.elevation + dEl * e });
    if (t < 1) {
      raf = requestAnimationFrame(frame);
    } else {
      onDone?.();
    }
  }

  raf = requestAnimationFrame(frame);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}

export type NudgeDirection = 'up' | 'down' | 'left' | 'right';

/** RSC's ViewCube arrow buttons step by 15° (π/12) per click. */
export const ORBIT_NUDGE = Math.PI / 12;

/** One fixed-step nudge in azimuth or elevation — the ViewCube arrow buttons' math. */
export function stepOrbit(dir: NudgeDirection, current: OrbitAngles, nudge: number = ORBIT_NUDGE): OrbitAngles {
  switch (dir) {
    case 'up':
      return { azimuth: current.azimuth, elevation: current.elevation + nudge };
    case 'down':
      return { azimuth: current.azimuth, elevation: current.elevation - nudge };
    case 'left':
      return { azimuth: current.azimuth - nudge, elevation: current.elevation };
    case 'right':
      return { azimuth: current.azimuth + nudge, elevation: current.elevation };
  }
}
