// Public API for the HPGL output module.
// Standalone, plotter-agnostic, dependency-free. Call svgToHpgl
// with a raw SVG string and a material profile and it returns a
// .plt-ready HPGL payload plus stats (path count, cut length,
// bounding box) for material consumption tracking and previewing.

import { parseSvg } from "./svg";
import { geometryToHpgl } from "./emit";
import type { HpglOptions, HpglResult } from "./types";

export type { HpglOptions, HpglResult, MaterialProfileInput, Point, Path, SvgGeometry } from "./types";

export function svgToHpgl(svgText: string, options: HpglOptions): HpglResult {
  const tolerance = options.flattenToleranceMm ?? 0.1;
  const geom = parseSvg(svgText, tolerance);
  return geometryToHpgl(geom, options);
}

// Convenience: known-good test SVG (60x40mm rounded rectangle) + a
// caller can compare the .plt output against a checked-in fixture.
export const TEST_SVG_ROUNDED_RECT = `<?xml version="1.0" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40">
  <rect x="0" y="0" width="60" height="40" rx="5" ry="5" fill="none" stroke="black" />
</svg>`;
