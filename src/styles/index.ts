export * from './expr.js';
export * from './schema.js';
export * from './compile.js';

import type { StyleDefinition } from './schema.js';
import { fefco0201 } from './catalog/fefco0201.js';
import { fefco0200 } from './catalog/fefco0200.js';
import { slitCornerTray } from './catalog/slit-corner-tray.js';
import { sealEndCarton } from './catalog/seal-end-carton.js';
import { bagPillow } from './catalog/bag-pillow.js';
import { bagGusseted } from './catalog/bag-gusseted.js';
import { bagSup } from './catalog/bag-sup.js';
import { bagBlockBottom } from './catalog/bag-block-bottom.js';
import { proofTaperedTray } from './catalog/proof-tapered-tray.js';

/**
 * The style catalogue.
 *
 * v1 ships the RSC. The remaining FEFCO and ECMA entries are data files added
 * here — the compiler does not change to accept them.
 *
 * All v1 styles are present. Further FEFCO and ECMA entries are data files
 * added here — the compiler does not change to accept them.
 */
export const STYLES: readonly StyleDefinition[] = [
  fefco0201,
  fefco0200,
  slitCornerTray,
  sealEndCarton,
  bagPillow,
  bagSup,
  bagGusseted,
  bagBlockBottom,
];

export const STYLE_BY_ID: ReadonlyMap<string, StyleDefinition> = new Map(
  STYLES.map((s) => [s.id, s]),
);

export { fefco0201, fefco0200, slitCornerTray, sealEndCarton, bagPillow, bagSup, bagGusseted, bagBlockBottom };

/**
 * Not part of the catalogue. A throwaway style defined without the grid, kept
 * so the test suite keeps proving the grid is a convenience layer rather than
 * the canonical model. Delete once the real curved styles cover the same
 * ground.
 */
export { proofTaperedTray };
