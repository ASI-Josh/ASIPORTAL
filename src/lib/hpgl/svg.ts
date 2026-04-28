// Minimal SVG → geometry parser. Targets the subset used by 3M
// Pattern Marketplace and Summa GoSign exports: <path d="...">,
// <polyline>, <polygon>, <line>, <rect>. <circle>/<ellipse> handled
// via Bezier approximation. Elliptical arc (A/a) supported via
// endpoint→centre conversion + flattenCubic (approximated as cubic
// segments). No CSS, no transforms beyond top-level.

import { flattenCubic, flattenQuadratic } from "./bezier";
import type { Path, Point, SvgGeometry, SvgUnit } from "./types";

const NUMBER_RE = /-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;
const COMMAND_RE = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;

function readNumbers(args: string): number[] {
  const matches = args.match(NUMBER_RE);
  return matches ? matches.map(Number) : [];
}

function reflect(p: Point, anchor: Point): Point {
  return { x: 2 * anchor.x - p.x, y: 2 * anchor.y - p.y };
}

// Parse an SVG path 'd' attribute into one or more polylines.
export function parsePathD(d: string, flattenTolerance: number): Path[] {
  const paths: Path[] = [];
  let current: Path = [];
  let cursor: Point = { x: 0, y: 0 };
  let pathStart: Point = { x: 0, y: 0 };
  let lastControl: Point | null = null;
  let lastCommand = "";

  function pushPoint(p: Point) {
    if (current.length === 0 || current[current.length - 1].x !== p.x || current[current.length - 1].y !== p.y) {
      current.push(p);
    }
    cursor = p;
  }

  function startNewPath(p: Point) {
    if (current.length >= 2) paths.push(current);
    current = [p];
    cursor = p;
    pathStart = p;
  }

  let match: RegExpExecArray | null;
  COMMAND_RE.lastIndex = 0;
  while ((match = COMMAND_RE.exec(d)) !== null) {
    const cmd = match[1];
    const nums = readNumbers(match[2]);
    const isRel = cmd === cmd.toLowerCase();
    let i = 0;

    switch (cmd.toUpperCase()) {
      case "M": {
        const x = isRel ? cursor.x + nums[i++] : nums[i++];
        const y = isRel ? cursor.y + nums[i++] : nums[i++];
        startNewPath({ x, y });
        // Subsequent pairs after M are implicit lineto
        while (i + 1 < nums.length) {
          const lx = isRel ? cursor.x + nums[i++] : nums[i++];
          const ly = isRel ? cursor.y + nums[i++] : nums[i++];
          pushPoint({ x: lx, y: ly });
        }
        lastControl = null;
        break;
      }
      case "L": {
        while (i + 1 < nums.length) {
          const x = isRel ? cursor.x + nums[i++] : nums[i++];
          const y = isRel ? cursor.y + nums[i++] : nums[i++];
          pushPoint({ x, y });
        }
        lastControl = null;
        break;
      }
      case "H": {
        while (i < nums.length) {
          const x = isRel ? cursor.x + nums[i++] : nums[i++];
          pushPoint({ x, y: cursor.y });
        }
        lastControl = null;
        break;
      }
      case "V": {
        while (i < nums.length) {
          const y = isRel ? cursor.y + nums[i++] : nums[i++];
          pushPoint({ x: cursor.x, y });
        }
        lastControl = null;
        break;
      }
      case "C": {
        while (i + 5 < nums.length) {
          const c1: Point = { x: isRel ? cursor.x + nums[i++] : nums[i++], y: isRel ? cursor.y + nums[i++] : nums[i++] };
          const c2: Point = { x: isRel ? cursor.x + nums[i++] : nums[i++], y: isRel ? cursor.y + nums[i++] : nums[i++] };
          const end: Point = { x: isRel ? cursor.x + nums[i++] : nums[i++], y: isRel ? cursor.y + nums[i++] : nums[i++] };
          flattenCubic(cursor, c1, c2, end, flattenTolerance, current);
          cursor = end;
          lastControl = c2;
        }
        break;
      }
      case "S": {
        while (i + 3 < nums.length) {
          const c1: Point = lastControl && (lastCommand === "C" || lastCommand === "S")
            ? reflect(lastControl, cursor)
            : { x: cursor.x, y: cursor.y };
          const c2: Point = { x: isRel ? cursor.x + nums[i++] : nums[i++], y: isRel ? cursor.y + nums[i++] : nums[i++] };
          const end: Point = { x: isRel ? cursor.x + nums[i++] : nums[i++], y: isRel ? cursor.y + nums[i++] : nums[i++] };
          flattenCubic(cursor, c1, c2, end, flattenTolerance, current);
          cursor = end;
          lastControl = c2;
        }
        break;
      }
      case "Q": {
        while (i + 3 < nums.length) {
          const c1: Point = { x: isRel ? cursor.x + nums[i++] : nums[i++], y: isRel ? cursor.y + nums[i++] : nums[i++] };
          const end: Point = { x: isRel ? cursor.x + nums[i++] : nums[i++], y: isRel ? cursor.y + nums[i++] : nums[i++] };
          flattenQuadratic(cursor, c1, end, flattenTolerance, current);
          cursor = end;
          lastControl = c1;
        }
        break;
      }
      case "T": {
        while (i + 1 < nums.length) {
          const c1: Point = lastControl && (lastCommand === "Q" || lastCommand === "T")
            ? reflect(lastControl, cursor)
            : { x: cursor.x, y: cursor.y };
          const end: Point = { x: isRel ? cursor.x + nums[i++] : nums[i++], y: isRel ? cursor.y + nums[i++] : nums[i++] };
          flattenQuadratic(cursor, c1, end, flattenTolerance, current);
          cursor = end;
          lastControl = c1;
        }
        break;
      }
      case "A": {
        // Endpoint → centre parameterisation per SVG spec, then
        // approximate the arc as cubic Bezier segments and flatten.
        while (i + 6 < nums.length) {
          const rx = Math.abs(nums[i++]);
          const ry = Math.abs(nums[i++]);
          const xRot = (nums[i++] * Math.PI) / 180;
          const largeArc = nums[i++] !== 0;
          const sweep = nums[i++] !== 0;
          const end: Point = { x: isRel ? cursor.x + nums[i++] : nums[i++], y: isRel ? cursor.y + nums[i++] : nums[i++] };
          flattenArc(cursor, end, rx, ry, xRot, largeArc, sweep, flattenTolerance, current);
          cursor = end;
        }
        lastControl = null;
        break;
      }
      case "Z": {
        if (current.length > 0) {
          pushPoint(pathStart);
        }
        lastControl = null;
        break;
      }
    }
    lastCommand = cmd.toUpperCase();
  }

  if (current.length >= 2) paths.push(current);
  return paths;
}

// Approximate an SVG elliptical arc as a series of cubic Beziers,
// each ≤ 90° of arc sweep, then flatten via flattenCubic.
function flattenArc(
  start: Point,
  end: Point,
  rx: number,
  ry: number,
  xRot: number,
  largeArc: boolean,
  sweep: boolean,
  tolerance: number,
  out: Point[],
): void {
  if (rx === 0 || ry === 0 || (start.x === end.x && start.y === end.y)) {
    out.push(end);
    return;
  }

  const cosR = Math.cos(xRot);
  const sinR = Math.sin(xRot);
  const dx = (start.x - end.x) / 2;
  const dy = (start.y - end.y) / 2;
  const x1p = cosR * dx + sinR * dy;
  const y1p = -sinR * dx + cosR * dy;

  let rxs = rx * rx;
  let rys = ry * ry;
  const x1ps = x1p * x1p;
  const y1ps = y1p * y1p;
  const radiiCheck = x1ps / rxs + y1ps / rys;
  if (radiiCheck > 1) {
    const s = Math.sqrt(radiiCheck);
    rx *= s;
    ry *= s;
    rxs = rx * rx;
    rys = ry * ry;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const sq = Math.max(0, (rxs * rys - rxs * y1ps - rys * x1ps) / (rxs * y1ps + rys * x1ps));
  const coef = sign * Math.sqrt(sq);
  const cxp = (coef * (rx * y1p)) / ry;
  const cyp = (coef * -(ry * x1p)) / rx;

  const cx = cosR * cxp - sinR * cyp + (start.x + end.x) / 2;
  const cy = sinR * cxp + cosR * cyp + (start.y + end.y) / 2;

  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };

  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const segments = Math.ceil(Math.abs(dTheta) / (Math.PI / 2));
  const segAngle = dTheta / segments;
  const alpha = (4 / 3) * Math.tan(segAngle / 4);

  let p0 = start;
  let t = theta1;
  for (let s = 0; s < segments; s++) {
    const t2 = t + segAngle;
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    const cosT2 = Math.cos(t2);
    const sinT2 = Math.sin(t2);
    const e: Point = {
      x: cx + cosR * rx * cosT2 - sinR * ry * sinT2,
      y: cy + sinR * rx * cosT2 + cosR * ry * sinT2,
    };
    const c1: Point = {
      x: p0.x + alpha * (-cosR * rx * sinT - sinR * ry * cosT),
      y: p0.y + alpha * (-sinR * rx * sinT + cosR * ry * cosT),
    };
    const c2: Point = {
      x: e.x - alpha * (-cosR * rx * sinT2 - sinR * ry * cosT2),
      y: e.y - alpha * (-sinR * rx * sinT2 + cosR * ry * cosT2),
    };
    flattenCubic(p0, c1, c2, e, tolerance, out);
    p0 = e;
    t = t2;
  }
}

// Top-level <svg> parsing. Returns paths in user-unit coordinates.
export function parseSvg(svgText: string, flattenTolerance = 0.1): SvgGeometry {
  const paths: Path[] = [];

  const viewBoxMatch = svgText.match(/viewBox\s*=\s*"([^"]+)"/);
  let viewBox: SvgGeometry["viewBox"];
  if (viewBoxMatch) {
    const [minX, minY, w, h] = viewBoxMatch[1].split(/[\s,]+/).map(Number);
    viewBox = { minX, minY, width: w, height: h };
  }

  const widthMatch = svgText.match(/<svg[^>]*\swidth\s*=\s*"([^"]+)"/);
  const heightMatch = svgText.match(/<svg[^>]*\sheight\s*=\s*"([^"]+)"/);
  const parseLen = (raw: string): { value: number; unit: SvgUnit } => {
    const m = raw.trim().match(/^(-?\d*\.?\d+)\s*(px|mm|cm|in|pt|pc)?$/);
    if (!m) return { value: Number(raw) || 0, unit: "px" };
    return { value: Number(m[1]), unit: (m[2] as SvgUnit) || "px" };
  };

  // <path d="...">
  const pathRe = /<path\b[^>]*\sd\s*=\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(svgText)) !== null) {
    paths.push(...parsePathD(m[1], flattenTolerance));
  }

  // <polyline points="..."> and <polygon points="...">
  const polyRe = /<(polyline|polygon)\b[^>]*\spoints\s*=\s*"([^"]+)"/g;
  while ((m = polyRe.exec(svgText)) !== null) {
    const nums = m[2].match(NUMBER_RE)?.map(Number) ?? [];
    const pts: Path = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      pts.push({ x: nums[i], y: nums[i + 1] });
    }
    if (m[1] === "polygon" && pts.length > 0) pts.push(pts[0]);
    if (pts.length >= 2) paths.push(pts);
  }

  // <line x1 y1 x2 y2>
  const lineRe = /<line\b([^>]*)>/g;
  while ((m = lineRe.exec(svgText)) !== null) {
    const attrs = m[1];
    const get = (name: string) => Number((attrs.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]+)"`)) ?? [])[1] ?? NaN);
    const x1 = get("x1"), y1 = get("y1"), x2 = get("x2"), y2 = get("y2");
    if ([x1, y1, x2, y2].every(Number.isFinite)) {
      paths.push([{ x: x1, y: y1 }, { x: x2, y: y2 }]);
    }
  }

  // <rect x y width height [rx ry]>
  const rectRe = /<rect\b([^>]*)>/g;
  while ((m = rectRe.exec(svgText)) !== null) {
    const attrs = m[1];
    const get = (name: string, def = 0) => {
      const mm = attrs.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]+)"`));
      return mm ? Number(mm[1]) : def;
    };
    const x = get("x"), y = get("y"), w = get("width"), h = get("height");
    const rx = Math.min(get("rx", 0), w / 2);
    const ry = Math.min(get("ry", rx), h / 2);
    if (w <= 0 || h <= 0) continue;
    if (rx > 0 || ry > 0) {
      // Rounded rect — build as path
      const d =
        `M ${x + rx} ${y} ` +
        `H ${x + w - rx} ` +
        `A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry} ` +
        `V ${y + h - ry} ` +
        `A ${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} ` +
        `H ${x + rx} ` +
        `A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry} ` +
        `V ${y + ry} ` +
        `A ${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`;
      paths.push(...parsePathD(d, flattenTolerance));
    } else {
      paths.push([
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
        { x, y },
      ]);
    }
  }

  // <circle cx cy r>
  const circleRe = /<circle\b([^>]*)>/g;
  while ((m = circleRe.exec(svgText)) !== null) {
    const attrs = m[1];
    const get = (name: string) => {
      const mm = attrs.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]+)"`));
      return mm ? Number(mm[1]) : NaN;
    };
    const cx = get("cx"), cy = get("cy"), r = get("r");
    if (![cx, cy, r].every(Number.isFinite) || r <= 0) continue;
    const d =
      `M ${cx + r} ${cy} ` +
      `A ${r} ${r} 0 0 1 ${cx} ${cy + r} ` +
      `A ${r} ${r} 0 0 1 ${cx - r} ${cy} ` +
      `A ${r} ${r} 0 0 1 ${cx} ${cy - r} ` +
      `A ${r} ${r} 0 0 1 ${cx + r} ${cy} Z`;
    paths.push(...parsePathD(d, flattenTolerance));
  }

  // <ellipse cx cy rx ry>
  const ellipseRe = /<ellipse\b([^>]*)>/g;
  while ((m = ellipseRe.exec(svgText)) !== null) {
    const attrs = m[1];
    const get = (name: string) => {
      const mm = attrs.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]+)"`));
      return mm ? Number(mm[1]) : NaN;
    };
    const cx = get("cx"), cy = get("cy"), rx = get("rx"), ry = get("ry");
    if (![cx, cy, rx, ry].every(Number.isFinite) || rx <= 0 || ry <= 0) continue;
    const d =
      `M ${cx + rx} ${cy} ` +
      `A ${rx} ${ry} 0 0 1 ${cx} ${cy + ry} ` +
      `A ${rx} ${ry} 0 0 1 ${cx - rx} ${cy} ` +
      `A ${rx} ${ry} 0 0 1 ${cx} ${cy - ry} ` +
      `A ${rx} ${ry} 0 0 1 ${cx + rx} ${cy} Z`;
    paths.push(...parsePathD(d, flattenTolerance));
  }

  return {
    paths,
    viewBox,
    width: widthMatch ? parseLen(widthMatch[1]) : undefined,
    height: heightMatch ? parseLen(heightMatch[1]) : undefined,
  };
}

// SVG user units → mm. CSS default is 96dpi, which makes 1px = 0.2645833mm.
export function unitToMm(value: number, unit: SvgUnit): number {
  switch (unit) {
    case "mm": return value;
    case "cm": return value * 10;
    case "in": return value * 25.4;
    case "pt": return value * 25.4 / 72;
    case "pc": return value * 25.4 / 6;
    case "px":
    default: return value * 25.4 / 96;
  }
}
