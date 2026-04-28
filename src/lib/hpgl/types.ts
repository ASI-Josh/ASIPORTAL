// HPGL plotter abstraction — plotter-agnostic by design.
// Summa S One D160 is the first target; future plotters (APEAX Cut,
// Roland, Graphtec) plug in by extending MaterialProfileInput with
// profile-specific fields. Keep this file dependency-free.

export type Point = { x: number; y: number };

export type Path = Point[]; // single open or closed polyline (>= 2 pts)

export interface SvgGeometry {
  paths: Path[];
  // SVG viewBox in user units; absent → derived from path bounds
  viewBox?: { minX: number; minY: number; width: number; height: number };
  // SVG width/height attributes if specified, used for unit scaling
  width?: { value: number; unit: SvgUnit };
  height?: { value: number; unit: SvgUnit };
}

export type SvgUnit = "px" | "mm" | "cm" | "in" | "pt" | "pc";

export interface MaterialProfileInput {
  name: string;
  cuttingForceGrams: number;
  speedMmPerSec: number;
  bladeDepthMm?: number;
  passCount: number;
  toolNumber?: number;
}

export interface HpglOptions {
  profile: MaterialProfileInput;
  // Curve flattening tolerance in mm — smaller = more polyline points
  flattenToleranceMm?: number;       // default 0.1mm
  // HPGL plotter step size — Summa S One = 0.025mm (40 plotter units / mm)
  unitsPerMm?: number;               // default 40
  // If true, prepend Summa-specific config commands (FS/V/etc).
  includeSummaConfig?: boolean;      // default true
  // Page setup: cutting width in mm. Summa S One D160 = 1600mm.
  mediaWidthMm?: number;             // default 1600
  // Origin offset for the cut (mm) — useful when pattern doesn't
  // start at 0,0 on the roll.
  originOffsetMm?: { x: number; y: number };
}

export interface HpglResult {
  hpgl: string;                      // raw .plt text
  pathCount: number;
  totalLengthMm: number;             // estimated cut length
  boundingBoxMm: { width: number; height: number };
}
