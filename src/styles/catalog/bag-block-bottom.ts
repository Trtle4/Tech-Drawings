import type { StyleDefinition } from '../schema.js';

/**
 * Block-bottom (fold-under) gusseted bag — fin seal.
 *
 * Structurally IDENTICAL to bag-gusseted.ts — same grid, same params, same
 * lofted cross-section (superellipse, girth-conserving, dog-eared crimp
 * bands) — because it is the same bag. The only difference is what happens
 * to the BOTTOM crimp band once it's sealed: instead of hanging off the
 * bottom the way the top seal does, it folds back 180° at the hinge where
 * it meets the round body, and lies flat against it — a real, common
 * construction (a "fold-under" or "pinch and fold" bottom), not a
 * separately-built flat box floor. Front view should read almost exactly
 * like the gusseted bag, but with a visible folded tab at the bottom instead
 * of a band hanging past the last row of body panels.
 *
 *   columns   fin(F) | back½(W/2) | gusset_l_back(D/2) | gusset_l_front(D/2)
 *             | FRONT(W) |
 *             gusset_r_front(D/2) | gusset_r_back(D/2) | back½(W/2) | fin(F)
 *
 * Web = 2F + 2W + 2D, identical to the gusseted bag.
 *
 * Folds to the LAY-FLAT bag, as the gusseted bag does — 180° at every tube
 * fold so the gussets tuck flat between front and back, 90° at each fin so
 * the two fin strips stand face to face. Extents are W × L × F. The fold-back
 * of the bottom band is out of scope for the rigid fold and lives entirely
 * in formedShape, as a y remap — the band's own cross-section shape is
 * untouched, only where it ends up in the assembled bag.
 *
 * ASSUMPTIONS TO CHECK: gusset depth D is the formed front-to-back depth, and
 * each gusset contributes D of flat material folded at its centre. Both end
 * seals count inside the cutoff length.
 */
export const bagBlockBottom: StyleDefinition = {
  id: 'bag.block_bottom',
  name: 'Block-Bottom Bag',
  family: 'bag',
  description: 'Side-gusseted, fin-seal bag whose bottom crimp seal folds back flat against the body instead of hanging past it.',

  // Same reasoning as the other wrap-style bags: vertical wrap creases leave y alone.
  upAxis: 'y',

  params: [
    {
      id: 'bagW',
      label: 'Bag width',
      group: 'internal',
      unit: 'mm',
      default: 100,
      min: 20,
      step: 1,
      hint: 'Front panel width of the formed bag.',
    },
    {
      id: 'bagD',
      label: 'Gusset depth',
      group: 'internal',
      unit: 'mm',
      default: 60,
      min: 10,
      step: 1,
      hint: 'Formed front-to-back depth.',
    },
    {
      id: 'bagL',
      label: 'Bag length',
      group: 'internal',
      unit: 'mm',
      default: 280,
      min: 60,
      step: 1,
      hint: 'Cutoff length, including both end seal bands.',
    },
    {
      id: 'caliper',
      label: 'Film gauge',
      group: 'material',
      unit: 'mm',
      default: 0.11,
      min: 0.01,
      max: 0.5,
      step: 0.005,
    },
    { id: 'finSeal', label: 'Fin seal', group: 'allowance', unit: 'mm', default: 10, min: 3 },
    {
      id: 'endSeal',
      label: 'End seal',
      group: 'allowance',
      unit: 'mm',
      default: 14,
      min: 3,
      max: 'bagL/2 - 5',
    },
  ],

  grid: {
    columns: [
      { id: 'fin_l', size: 'finSeal' },
      { id: 'back_l', size: 'bagW/2' },
      { id: 'gusset_l_back', size: 'bagD/2' },
      { id: 'gusset_l_front', size: 'bagD/2' },
      { id: 'front', size: 'bagW' },
      { id: 'gusset_r_front', size: 'bagD/2' },
      { id: 'gusset_r_back', size: 'bagD/2' },
      { id: 'back_r', size: 'bagW/2' },
      { id: 'fin_r', size: 'finSeal' },
    ],
    rows: [
      { id: 'end_bottom', size: 'endSeal' },
      { id: 'body', size: 'bagL - 2*endSeal' },
      { id: 'end_top', size: 'endSeal' },
    ],
    cells: [
      { row: 'body', col: 'fin_l', role: 'fin_left', kind: 'seal' },
      { row: 'body', col: 'back_l', role: 'back_panel_left', kind: 'panel' },
      { row: 'body', col: 'gusset_l_back', role: 'gusset_left_back', kind: 'panel' },
      { row: 'body', col: 'gusset_l_front', role: 'gusset_left_front', kind: 'panel' },
      { row: 'body', col: 'front', role: 'front_panel', kind: 'panel', base: true },
      { row: 'body', col: 'gusset_r_front', role: 'gusset_right_front', kind: 'panel' },
      { row: 'body', col: 'gusset_r_back', role: 'gusset_right_back', kind: 'panel' },
      { row: 'body', col: 'back_r', role: 'back_panel_right', kind: 'panel' },
      { row: 'body', col: 'fin_r', role: 'fin_right', kind: 'seal' },

      { row: 'end_bottom', col: 'fin_l', role: 'fin_left_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'back_l', role: 'back_left_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'gusset_l_back', role: 'gusset_left_back_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'gusset_l_front', role: 'gusset_left_front_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'front', role: 'front_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'gusset_r_front', role: 'gusset_right_front_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'gusset_r_back', role: 'gusset_right_back_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'back_r', role: 'back_right_end_bottom', kind: 'seal' },
      { row: 'end_bottom', col: 'fin_r', role: 'fin_right_end_bottom', kind: 'seal' },

      { row: 'end_top', col: 'fin_l', role: 'fin_left_end_top', kind: 'seal' },
      { row: 'end_top', col: 'back_l', role: 'back_left_end_top', kind: 'seal' },
      { row: 'end_top', col: 'gusset_l_back', role: 'gusset_left_back_end_top', kind: 'seal' },
      { row: 'end_top', col: 'gusset_l_front', role: 'gusset_left_front_end_top', kind: 'seal' },
      { row: 'end_top', col: 'front', role: 'front_end_top', kind: 'seal' },
      { row: 'end_top', col: 'gusset_r_front', role: 'gusset_right_front_end_top', kind: 'seal' },
      { row: 'end_top', col: 'gusset_r_back', role: 'gusset_right_back_end_top', kind: 'seal' },
      { row: 'end_top', col: 'back_r', role: 'back_right_end_top', kind: 'seal' },
      { row: 'end_top', col: 'fin_r', role: 'fin_right_end_top', kind: 'seal' },
    ],
    boundaries: [
      { axis: 'v', kind: 'crease', angle: 180 },
      { axis: 'v', after: ['fin_l', 'back_r'], kind: 'crease', angle: 90 },
      { axis: 'h', kind: 'crease', angle: 0 },
    ],
  },

  // Byte-for-byte the gusseted bag's own loft (see bag-gusseted.ts) — same
  // stations, same superellipse sharpness, same girth-derived halfWidth and
  // dog-eared crimp bands — plus one addition: faceWorldY folds the BOTTOM
  // band's own output y back across its hinge with the body (y = endSeal)
  // instead of leaving it running out past y = 0. The band's own
  // cross-section (x, z) is computed exactly as it would be for a normal
  // hanging crimp band — surfaceAt only ever sees flat y, never the remapped
  // one — so this is purely a placement change, not a different shape.
  formedShape: {
    kind: 'lofted_profile',
    faceRoles: [
      'front_panel', 'front_end_bottom', 'front_end_top',
      'back_panel_left', 'back_left_end_bottom', 'back_left_end_top',
      'back_panel_right', 'back_right_end_bottom', 'back_right_end_top',
      'gusset_left_front', 'gusset_left_front_end_bottom', 'gusset_left_front_end_top',
      'gusset_left_back', 'gusset_left_back_end_bottom', 'gusset_left_back_end_top',
      'gusset_right_front', 'gusset_right_front_end_bottom', 'gusset_right_front_end_top',
      'gusset_right_back', 'gusset_right_back_end_bottom', 'gusset_right_back_end_top',
    ],
    flapFaceRoles: [
      'fin_left', 'fin_left_end_bottom', 'fin_left_end_top',
      'fin_right', 'fin_right_end_bottom', 'fin_right_end_top',
    ],
    flapFold: 'left',
    sealStyle: 'fin',
    girthPhaseDeg: -90,
    // Every bottom-band role has the SAME flat y-range (0..endSeal, with
    // endSeal — the hinge, shared with the body — its own max.y), so the
    // same reflection pair applies to all of them: y = endSeal stays put,
    // y = 0 (the band's own free edge) swings across it to 2*endSeal —
    // INTO the body's own y-range, where the fold physically lands it,
    // instead of past y = 0 where an un-folded band would hang.
    faceWorldY: {
      front_end_bottom: ['2*endSeal', 'endSeal'],
      back_left_end_bottom: ['2*endSeal', 'endSeal'],
      back_right_end_bottom: ['2*endSeal', 'endSeal'],
      gusset_left_back_end_bottom: ['2*endSeal', 'endSeal'],
      gusset_left_front_end_bottom: ['2*endSeal', 'endSeal'],
      gusset_right_front_end_bottom: ['2*endSeal', 'endSeal'],
      gusset_right_back_end_bottom: ['2*endSeal', 'endSeal'],
      fin_left_end_bottom: ['2*endSeal', 'endSeal'],
      fin_right_end_bottom: ['2*endSeal', 'endSeal'],
    },
    // The fold-back alone (faceWorldY, above) repositions the bottom band's
    // points in y but leaves its (x, z) cross-section exactly as a normal
    // hanging crimp band would have it — nearly flat, nearly z = 0 — which
    // is also where the body panel it now overlaps in y already sits, so
    // the two surfaces coincide and the fold reads as "missing" rather than
    // "folded flat against the body". Nudging the band toward the back pole
    // (negative z, this engine's convention) separates it enough to
    // paint-sort as a real, glued tab lying against the body — visible as a
    // distinct crease/seam line from the front, hidden behind the body from
    // the back, the way the actual folded seal occludes. Sized off bagD
    // (capped at 3mm) rather than caliper, since caliper alone (a fraction
    // of a mm) is invisible at this scale.
    faceDepthOffset: {
      front_end_bottom: '-min(3, bagD*0.05)',
      back_left_end_bottom: '-min(3, bagD*0.05)',
      back_right_end_bottom: '-min(3, bagD*0.05)',
      gusset_left_back_end_bottom: '-min(3, bagD*0.05)',
      gusset_left_front_end_bottom: '-min(3, bagD*0.05)',
      gusset_right_front_end_bottom: '-min(3, bagD*0.05)',
      gusset_right_back_end_bottom: '-min(3, bagD*0.05)',
      fin_left_end_bottom: '-min(3, bagD*0.05)',
      fin_right_end_bottom: '-min(3, bagD*0.05)',
    },
    stations: [
      { y: '0', halfDepth: 'max(caliper, bagD*0.06)', profile: { family: 'superellipse', sharpness: 10 } },
      { y: 'endSeal', halfDepth: 'max(caliper, bagD*0.06)', profile: { family: 'superellipse', sharpness: 10 } },
      { y: 'endSeal + (bagL - 2*endSeal)*0.15', halfDepth: 'bagD/2*0.92', profile: { family: 'superellipse', sharpness: 10 } },
      { y: 'bagL/2', halfDepth: 'bagD/2', profile: { family: 'superellipse', sharpness: 10 } },
      { y: 'bagL - endSeal - (bagL - 2*endSeal)*0.15', halfDepth: 'bagD/2*0.92', profile: { family: 'superellipse', sharpness: 10 } },
      { y: 'bagL - endSeal', halfDepth: 'max(caliper, bagD*0.06)', profile: { family: 'superellipse', sharpness: 10 } },
      { y: 'bagL', halfDepth: 'max(caliper, bagD*0.06)', profile: { family: 'superellipse', sharpness: 10 } },
    ],
    fill: '0.8',
  },

  seals: [
    {
      id: 'bag.block_bottom:fin',
      kind: 'fin',
      role: 'back_fin_seal',
      boundFaceRoles: ['fin_left', 'fin_right'],
      width: 'finSeal',
      plies: 2,
    },
    {
      id: 'bag.block_bottom:end_bottom',
      kind: 'fin',
      role: 'bottom_end_seal',
      boundFaceRoles: ['front_end_bottom', 'back_left_end_bottom', 'back_right_end_bottom'],
      width: 'endSeal',
      plies: 6,
    },
    {
      id: 'bag.block_bottom:end_top',
      kind: 'fin',
      role: 'top_end_seal',
      boundFaceRoles: ['front_end_top', 'back_left_end_top', 'back_right_end_top'],
      width: 'endSeal',
      plies: 6,
    },
  ],
};
