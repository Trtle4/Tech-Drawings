# orbit-controls

Renderer-agnostic orbit-camera state: angle wrapping, eased tweening, fixed-step nudging. No DOM, no canvas, no three.js — pure functions over `{azimuth, elevation}`.

Ported from the [RSC Dieline Generator](https://github.com/Trtle4/parametric-app)'s `rsc-designer/src/render/fold3d.js` and `viewcube.js`. See `src/orbitControls.ts`'s own doc comments for exactly what was ported verbatim (the wrap and easing formulas) versus adapted (the nudge directions' sign convention — see below).

## Status: not yet its own repository

This was meant to be a standalone repo consumed by both Tech-Drawings and the RSC Dieline Generator as a versioned package. A new GitHub repo could not be created from the session that built this (repo-creation access wasn't available, only push access to existing repos), so it lives here instead, under `packages/orbit-controls/` in Tech-Drawings, structured so extracting it later is a file move plus a `git init`, not a refactor:

- Zero dependencies, zero imports.
- One source file (`src/orbitControls.ts`), its own `package.json`, its own `tsconfig.json`, its own tests.
- `dist/` is committed — the "single-file build" any consumer (including a no-build-step, plain-JS-module app like the RSC Dieline Generator) can import directly, without needing TypeScript or this package's own toolchain.

Tech-Drawings' `src/app/pane3d.ts` imports the **built** `dist/orbitControls.js`, not the TypeScript source — so its own usage doubles as a check that the build is actually correct and self-contained, the same thing a second, separate consumer would be trusting.

The RSC Dieline Generator has not been updated to consume this yet (this session's access is scoped to Tech-Drawings only). Its `fold3d.js`/`viewcube.js` still carry their own original copies of this same logic. Adopting this package there means: replacing its local `wrapPi` with this one (same formula, so no behavior change), replacing its `short()`-based `tweenOrbit` internals with a call into this package's `tweenOrbit` (adapting from RSC's positional `(rotX, rotY)` to this package's `{azimuth, elevation}` — `rotY` <-> `azimuth`, `rotX` <-> `elevation`), and replacing `viewcube.js`'s `stepOrbit` with this one's — remapping the arrow buttons' `'left'/'right'` wiring to this package's sign convention (see below), not just swapping the import.

## Versioning

Semver in `package.json`. `v0.1.0` is the initial faithful port. Bump the version, rebuild (`npm run build` from this directory), and update both consumers' vendored copies together — there is no registry or CI wiring this up automatically yet.

## API

```ts
interface OrbitAngles { azimuth: number; elevation: number; }

wrapPi(a: number): number
tweenOrbit(from: OrbitAngles, to: OrbitAngles, durationMs: number, onFrame: (a: OrbitAngles) => void, onDone?: () => void): () => void  // returns a cancel fn
stepOrbit(dir: 'up' | 'down' | 'left' | 'right', current: OrbitAngles, nudge?: number): OrbitAngles
ORBIT_NUDGE: number  // π/12, 15°
```

## The one non-literal port: `stepOrbit`'s signs

RSC's own free-drag orbit handler inverts horizontal orbit on purpose (`rotY -= dx*0.008`, commented "horizontal inverted per user preference"). Tech-Drawings' free-drag orbit does the opposite (`azimuth += dx*sensitivity`). Both are correct — for their own app. A `stepOrbit` ported with RSC's exact `+`/`-` signs would therefore feel *inverted* relative to whichever app didn't originate it, silently, the first time someone wires an arrow button up to it.

This package picks ONE convention (`'right'` increases azimuth, `'up'` increases elevation — matching Tech-Drawings' existing, unmodified drag feel) and states it as the contract. RSC's own arrow-button wiring, when it adopts this package, needs its `'left'`/`'right'` call sites swapped to match — a one-line fix in `viewcube.js`'s DOM wiring, not in this package.

What ported with exact numeric fidelity regardless of that convention question: the nudge size (`ORBIT_NUDGE = π/12`, 15°) and the elevation clamp to ±90° on `'up'`/`'down'` (RSC's `clampRx` — present on the arrow-button step even though RSC's own free-drag orbit is deliberately unclamped and passes through the pole).
