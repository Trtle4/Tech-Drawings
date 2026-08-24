# Changelog

## 0.1.0

Initial port of the RSC Dieline Generator's orbit-camera state math (`fold3d.js`'s `wrapPi` and `tweenOrbit`, `viewcube.js`'s `stepOrbit`/`NUDGE`) into a standalone, renderer-agnostic module.

Corrects two fidelity gaps from an earlier, non-standalone copy of this logic that lived directly in Tech-Drawings (`src/render/orbitControls.ts`, now removed in favor of this package):

- Easing was cubic (`4*t*t*t` / `1-pow(-2t+2,3)/2`); RSC's own `updateTween` is quadratic (`2*t*t` / `1-pow(-2t+2,2)/2`). Fixed to match.
- `wrapPi`'s half-open boundary was `(-π, π]`; RSC's own `wrapPi` is `[-π, π)` (`wrapPi(π) === -π`, not `π`). Fixed to match exactly.

Also added, faithfully ported and not present in the earlier copy: the elevation clamp to ±90° on `stepOrbit`'s `'up'`/`'down'` (RSC's `clampRx`).
