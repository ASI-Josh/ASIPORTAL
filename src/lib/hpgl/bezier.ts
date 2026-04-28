// Bezier flattening — converts cubic and quadratic Bezier curves into
// polyline approximations within a target tolerance (in user units).
// Uses adaptive subdivision: split until the curve is "flat enough",
// measured by the perpendicular distance from each control point to
// the chord between endpoints.

import type { Point } from "./types";

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointToLineDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(p, a);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return dist(p, proj);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Cubic Bezier subdivision via de Casteljau
function subdivideCubic(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
): [Point, Point, Point, Point, Point, Point, Point] {
  const p01 = midpoint(p0, p1);
  const p12 = midpoint(p1, p2);
  const p23 = midpoint(p2, p3);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const p0123 = midpoint(p012, p123);
  return [p0, p01, p012, p0123, p123, p23, p3];
}

export function flattenCubic(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  tolerance: number,
  out: Point[],
  depth = 0,
): void {
  // Safety: cap recursion depth so a pathological curve can't blow the stack.
  if (depth > 18) {
    out.push(p3);
    return;
  }
  const d1 = pointToLineDistance(p1, p0, p3);
  const d2 = pointToLineDistance(p2, p0, p3);
  if (Math.max(d1, d2) <= tolerance) {
    out.push(p3);
    return;
  }
  const [, l1, l2, mid, r1, r2] = subdivideCubic(p0, p1, p2, p3);
  flattenCubic(p0, l1, l2, mid, tolerance, out, depth + 1);
  flattenCubic(mid, r1, r2, p3, tolerance, out, depth + 1);
}

export function flattenQuadratic(
  p0: Point,
  p1: Point,
  p2: Point,
  tolerance: number,
  out: Point[],
): void {
  // Promote quadratic to cubic and reuse cubic flattener
  const c1: Point = { x: p0.x + (2 / 3) * (p1.x - p0.x), y: p0.y + (2 / 3) * (p1.y - p0.y) };
  const c2: Point = { x: p2.x + (2 / 3) * (p1.x - p2.x), y: p2.y + (2 / 3) * (p1.y - p2.y) };
  flattenCubic(p0, c1, c2, p2, tolerance, out);
}
