import { describe, expect, it } from 'vitest';
import { cameraBasis, orbitTowards, type UpAxis } from '../iso.js';

describe('orbitTowards', () => {
  const upAxes: UpAxis[] = ['x', 'y', 'z'];

  it('inverts cameraBasis: orbitTowards(forward) round-trips to the same azimuth/elevation, for every up axis', () => {
    for (const upAxis of upAxes) {
      for (const azimuth of [0, 0.3, 1.1, -0.8, Math.PI / 2 - 0.01]) {
        for (const elevation of [-1, -0.4, 0, 0.5, 1]) {
          const cam = cameraBasis(upAxis, azimuth, elevation);
          const back = orbitTowards(cam.forward, upAxis);
          expect(back.azimuth).toBeCloseTo(azimuth, 5);
          expect(back.elevation).toBeCloseTo(elevation, 5);
        }
      }
    }
  });

  it('a click on the up-axis face resolves to straight-up elevation, azimuth-independent', () => {
    const up = orbitTowards({ x: 0, y: 1, z: 0 }, 'y');
    expect(up.elevation).toBeCloseTo(Math.PI / 2);
  });

  it('a click on the down (-up-axis) face resolves to straight-down elevation', () => {
    const down = orbitTowards({ x: 0, y: -1, z: 0 }, 'y');
    expect(down.elevation).toBeCloseTo(-Math.PI / 2);
  });

  it('clamps a direction outside [-1,1] dot range without throwing (defensive, not expected from a unit normal)', () => {
    expect(() => orbitTowards({ x: 0, y: 2, z: 0 }, 'y')).not.toThrow();
  });
});
