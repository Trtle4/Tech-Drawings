export * from './expr.js';
export * from './schema.js';
export * from './compile.js';

import type { StyleDefinition } from './schema.js';
import { fefco0201 } from './catalog/fefco0201.js';
import { fefco0300 } from './catalog/fefco0300.js';
import { sealEndCarton } from './catalog/seal-end-carton.js';
import { proofTaperedTray } from './catalog/proof-tapered-tray.js';

/**
 * The style catalogue.
 *
 * v1 ships the RSC. The remaining FEFCO and ECMA entries are data files added
 * here — the compiler does not change to accept them.
 *
 * Still to come in v1: the three bags (pillow, SUP, gusseted).
 */
export const STYLES: readonly StyleDefinition[] = [fefco0201, fefco0300, sealEndCarton];

export const STYLE_BY_ID: ReadonlyMap<string, StyleDefinition> = new Map(
  STYLES.map((s) => [s.id, s]),
);

export { fefco0201, fefco0300, sealEndCarton };

/**
 * Not part of the catalogue. A throwaway style defined without the grid, kept
 * so the test suite keeps proving the grid is a convenience layer rather than
 * the canonical model. Delete once the real curved styles cover the same
 * ground.
 */
export { proofTaperedTray };
