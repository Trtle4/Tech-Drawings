import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ORBIT_NUDGE, stepOrbit, tweenOrbit, wrapPi } from '../orbitControls.js';

describe('wrapPi', () => {
  it('leaves angles already in [-π, π) alone', () => {
    expect(wrapPi(0)).toBeCloseTo(0);
    expect(wrapPi(Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(wrapPi(-Math.PI)).toBeCloseTo(-Math.PI); // -π is IN range for this convention
  });

  it('maps +π to -π — RSC\'s own half-open convention, closed at -π not +π', () => {
    expect(wrapPi(Math.PI)).toBeCloseTo(-Math.PI);
  });

  it('wraps angles outside [-π, π) back into it', () => {
    expect(wrapPi(2 * Math.PI)).toBeCloseTo(0);
    expect(wrapPi(-2 * Math.PI)).toBeCloseTo(0);
    expect(wrapPi(3 * Math.PI)).toBeCloseTo(-Math.PI);
  });
});

describe('stepOrbit', () => {
  const current = { azimuth: 0.2, elevation: 0.1 };

  it('nudges elevation up/down and azimuth left/right by the step, leaving the other angle alone', () => {
    expect(stepOrbit('up', current)).toEqual({ azimuth: 0.2, elevation: 0.1 + ORBIT_NUDGE });
    expect(stepOrbit('down', current)).toEqual({ azimuth: 0.2, elevation: 0.1 - ORBIT_NUDGE });
    expect(stepOrbit('left', current)).toEqual({ azimuth: 0.2 - ORBIT_NUDGE, elevation: 0.1 });
    expect(stepOrbit('right', current)).toEqual({ azimuth: 0.2 + ORBIT_NUDGE, elevation: 0.1 });
  });

  it('accepts a custom nudge size', () => {
    expect(stepOrbit('right', current, 1)).toEqual({ azimuth: 1.2, elevation: 0.1 });
  });

  it('clamps elevation to +/-90 deg on up/down — RSC\'s clampRx, present on the arrow step even though free-drag orbit is unclamped', () => {
    const nearTop = { azimuth: 0, elevation: Math.PI / 2 - 0.05 };
    expect(stepOrbit('up', nearTop).elevation).toBeCloseTo(Math.PI / 2);
    const nearBottom = { azimuth: 0, elevation: -Math.PI / 2 + 0.05 };
    expect(stepOrbit('down', nearBottom).elevation).toBeCloseTo(-Math.PI / 2);
  });
});

describe('tweenOrbit', () => {
  let now = 0;
  let frameCb: FrameRequestCallback | null = null;

  beforeEach(() => {
    now = 0;
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frameCb = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      frameCb = null;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function tick(dt: number): void {
    now += dt;
    const cb = frameCb;
    frameCb = null;
    cb?.(now);
  }

  it('interpolates from the start angles toward the end angles and finishes exactly at the target', () => {
    const frames: { azimuth: number; elevation: number }[] = [];
    let done = false;
    tweenOrbit({ azimuth: 0, elevation: 0 }, { azimuth: 1, elevation: 0.5 }, 100, (a) => frames.push(a), () => (done = true));

    tick(50); // first frame fires at t=50/100 = halfway
    tick(50); // second frame fires at t=100/100 = done

    expect(frames.length).toBe(2);
    expect(frames[1]!.azimuth).toBeCloseTo(1);
    expect(frames[1]!.elevation).toBeCloseTo(0.5);
    expect(done).toBe(true);
  });

  it('eases with RSC\'s own quadratic ease-in-out, not a cubic curve', () => {
    const frames: { azimuth: number }[] = [];
    tweenOrbit({ azimuth: 0, elevation: 0 }, { azimuth: 1, elevation: 0 }, 100, (a) => frames.push(a));
    tick(25); // t=0.25 -> quadratic ease-in: 2*0.25^2 = 0.125
    expect(frames[0]!.azimuth).toBeCloseTo(0.125);
  });

  it('takes the shortest way around the wrap point instead of the long way', () => {
    const frames: { azimuth: number }[] = [];
    // From just past +π to just past -π the short way is forward through π, not backward through 0.
    tweenOrbit({ azimuth: Math.PI - 0.1, elevation: 0 }, { azimuth: -Math.PI + 0.1, elevation: 0 }, 100, (a) => frames.push(a));
    tick(50); // halfway through the short 0.2-radian path, should be near π (wrapped), not near 0
    const mid = wrapPi(frames[0]!.azimuth);
    expect(Math.abs(mid)).toBeGreaterThan(3); // close to ±π, not near 0
  });

  it('cancel() stops further frames from firing', () => {
    const frames: unknown[] = [];
    const cancel = tweenOrbit({ azimuth: 0, elevation: 0 }, { azimuth: 1, elevation: 0 }, 100, (a) => frames.push(a));
    tick(50);
    cancel();
    tick(50); // frameCb was cleared by cancelAnimationFrame's stub, so this is a no-op tick
    expect(frames.length).toBe(1);
  });
});
