// HP-GL/2 emitter. Targets vinyl/film cutting plotters that speak
// the common HPGL dialect (Summa S One, Roland, Graphtec, generic).
// Summa-specific extensions (FS for force, VS for velocity in cm/s,
// SP for tool select) are gated behind `includeSummaConfig`. Drop
// to vanilla HPGL by setting it false.
//
// Coordinate system: HPGL uses y-up. SVG uses y-down. We flip Y
// when emitting so a pattern that looks correct on screen cuts
// correct-side-up on the plotter.

import type { HpglOptions, HpglResult, Path, SvgGeometry } from "./types";
import { unitToMm } from "./svg";

const DEFAULTS = {
  flattenToleranceMm: 0.1,
  unitsPerMm: 40,
  includeSummaConfig: true,
  mediaWidthMm: 1600,
  originOffsetMm: { x: 0, y: 0 },
};

function pathLength(path: Path): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

function bbox(paths: Path[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) {
    for (const pt of p) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

export function geometryToHpgl(geom: SvgGeometry, options: HpglOptions): HpglResult {
  const opts = { ...DEFAULTS, ...options, profile: options.profile, originOffsetMm: { ...DEFAULTS.originOffsetMm, ...(options.originOffsetMm ?? {}) } };

  // Determine SVG user-unit → mm scale.
  // Priority: explicit width/height on the <svg> → use unit conversion.
  // Otherwise assume the viewBox is in user units that equal mm.
  let unitToMmScale = 1;
  if (geom.width && geom.viewBox && geom.viewBox.width > 0) {
    const widthMm = unitToMm(geom.width.value, geom.width.unit);
    unitToMmScale = widthMm / geom.viewBox.width;
  } else if (geom.width) {
    unitToMmScale = unitToMm(1, geom.width.unit);
  }

  // Convert user-unit paths to mm.
  const mmPaths: Path[] = geom.paths.map((p) =>
    p.map((pt) => ({ x: pt.x * unitToMmScale, y: pt.y * unitToMmScale }))
  );

  const box = bbox(mmPaths);
  const mediaHeight = box.maxY - box.minY;
  const mediaWidth = box.maxX - box.minX;

  // Emit. HPGL Y is inverted relative to SVG. Translate so cut starts
  // at originOffsetMm (default 0,0) and Y points up the roll.
  const u = opts.unitsPerMm;
  const ox = opts.originOffsetMm.x;
  const oy = opts.originOffsetMm.y;

  const toUnits = (xMm: number, yMm: number): [number, number] => {
    const xLocal = xMm - box.minX + ox;
    const yLocal = mediaHeight - (yMm - box.minY) + oy;
    return [Math.round(xLocal * u), Math.round(yLocal * u)];
  };

  const lines: string[] = [];
  lines.push("IN;");                                    // initialise
  if (opts.includeSummaConfig) {
    const tool = opts.profile.toolNumber ?? 1;
    lines.push(`SP${tool};`);                           // select tool
    // Summa FS = force in grams (0..400). Clamp to be safe.
    const force = Math.max(0, Math.min(400, Math.round(opts.profile.cuttingForceGrams)));
    lines.push(`FS${force};`);
    // Summa VS = velocity in cm/s (max ~100). Convert from mm/s.
    const vel = Math.max(1, Math.min(100, Math.round(opts.profile.speedMmPerSec / 10)));
    lines.push(`VS${vel};`);
  }
  lines.push("PA;");                                    // plot absolute

  let totalLength = 0;
  const passes = Math.max(1, Math.round(opts.profile.passCount));

  for (let pass = 0; pass < passes; pass++) {
    for (const path of mmPaths) {
      if (path.length < 2) continue;
      totalLength += pathLength(path);
      const [sx, sy] = toUnits(path[0].x, path[0].y);
      lines.push(`PU${sx},${sy};`);
      const segs: string[] = [];
      for (let i = 1; i < path.length; i++) {
        const [x, y] = toUnits(path[i].x, path[i].y);
        segs.push(`${x},${y}`);
      }
      // Single PD with comma-separated coords. Most plotters accept
      // arbitrarily long PD instructions; chunk every 100 points to
      // keep individual lines under typical buffer limits.
      for (let i = 0; i < segs.length; i += 100) {
        lines.push(`PD${segs.slice(i, i + 100).join(",")};`);
      }
      lines.push("PU;");
    }
  }

  lines.push("PU0,0;");                                 // park head
  lines.push("PG;");                                    // page advance / job end
  lines.push("SP0;");                                   // tool home

  return {
    hpgl: lines.join("\n") + "\n",
    pathCount: mmPaths.length,
    totalLengthMm: totalLength * passes,
    boundingBoxMm: { width: mediaWidth, height: mediaHeight },
  };
}
