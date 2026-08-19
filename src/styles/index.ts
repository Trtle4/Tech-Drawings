export * from './expr.js';
export * from './schema.js';
export * from './compile.js';

import type { StyleDefinition } from './schema.js';
import { fefco0201 } from './catalog/fefco0201.js';

/**
 * The style catalogue.
 *
 * v1 ships the RSC. The remaining FEFCO and ECMA entries are data files added
 * here — the compiler does not change to accept them.
 *
 * Still to come in v1: seal end carton, FEFCO 0300 slotted tray, and the three
 * bags (pillow, SUP, gusseted).
 */
export const STYLES: readonly StyleDefinition[] = [fefco0201];

export const STYLE_BY_ID: ReadonlyMap<string, StyleDefinition> = new Map(
  STYLES.map((s) => [s.id, s]),
);

export { fefco0201 };
