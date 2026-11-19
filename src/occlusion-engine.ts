import { Frame, Locator, Page } from 'playwright';
import { DOMCandidate } from './types';

// ============================================================================
// PROMPT 10: ROOT-LEVEL ELEMENT OCCLUSION & SPATIAL HIT-TESTING ENGINE
// 100% Physical Click Fidelity (isTrusted: true) - ZERO JS Synthetic Click Bypass
// ============================================================================

export const SAFE_BAND_MARGIN_PX = 20;
export const DEFAULT_CORNER_INSET_PX = 5;
export const MIN_EXPOSED_AREA_RATIO = 0.4;
export const MIN_CLICKABLE_DIMENSION_PX = 24;

export interface Point2D {
  x: number;
  y: number;
}

export type Polygon2D = Point2D[];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ObstacleCategory =
  | 'sticky-header'
  | 'sticky-footer'
  | 'floating-action-bar'
  | 'modal'
  | 'toast'
  | 'dropdown'
  | 'overlay'
  | 'element';

export interface ObstacleMetadata {
  tag: string;
  id?: string;
  className?: string;
  role?: string;
  ariaLabel?: string;
  textPreview?: string;
  descriptor: string;
  rect: Rect;
  position: string;
  zIndex: string;
  category: ObstacleCategory;
}

export interface SafeViewportBand {
  viewportWidth: number;
  viewportHeight: number;
  /** H_top: Height occluded at top by sticky/fixed headers */
  headerHeight: number;
  /** H_bottom: Height occluded at bottom by sticky/fixed footers & centered bottom floating action bars */
  footerHeight: number;
  /** Safety padding added to both ends (default 20px) */
  marginPx: number;
  /** Top boundary of safe viewport band: H_top + marginPx */
  safeTop: number;
  /** Bottom boundary of safe viewport band: ViewportHeight - H_bottom - marginPx */
  safeBottom: number;
  /** Vertical midpoint of safe viewport band */
  safeCenterY: number;
  /** Usable vertical height inside safe band */
  safeHeight: number;
  stickyHeaders: ObstacleMetadata[];
  stickyFooters: ObstacleMetadata[];
  floatingActionBars: ObstacleMetadata[];
}

export type SamplePointName =
  | 'center'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export interface SamplePoint {
  name: SamplePointName;
  x: number;
  y: number;
}

export interface SamplePointResult extends SamplePoint {
  hitsTarget: boolean;
  inViewport: boolean;
  occludedBy?: ObstacleMetadata;
}

export interface FivePointHitTestResult {
  targetRect: Rect;
  samples: SamplePointResult[];
  centerExposed: boolean;
  exposedPoints: SamplePointResult[];
  occludedPoints: SamplePointResult[];
  obstacles: ObstacleMetadata[];
  selectedPoint: { x: number; y: number; source: SamplePointName } | null;
  allExposed: boolean;
  allOccluded: boolean;
}

export interface ExposedSubRegion {
  polygon: Polygon2D;
  boundingBox: Rect;
  area: number;
  areaRatio: number;
  centroid: Point2D;
  meetsMinDimensions: boolean;
}

export type PolygonOcclusionStatus =
  | 'CLEAR'
  | 'EXPOSED_CLICKABLE'
  | 'INSUFFICIENT_EXPOSED_AREA'
  | 'FULLY_OCCLUDED';

export interface OcclusionGeometryOptions {
  minExposedAreaRatio?: number;
  minClickableWidthPx?: number;
  minClickableHeightPx?: number;
}

export interface PolygonOcclusionResult {
  status: PolygonOcclusionStatus;
  targetRect: Rect;
  targetArea: number;
  occludedArea: number;
  exposedArea: number;
  /** Fraction in [0, 1] */
  exposedAreaRatio: number;
  /** Clipped obstacle polygons intersecting the target via Sutherland-Hodgman */
  clippedObstaclePolygons: Polygon2D[];
  /** Disjoint exposed polygons covering target \ union(obstacles) */
  exposedPolygons: Polygon2D[];
  /** Largest contiguous exposed sub-region (prioritizing regions >= 24x24px) */
  largestExposedSubRegion: ExposedSubRegion | null;
  /** All candidate exposed sub-regions sorted by clickability & area descending */
  exposedSubRegions: ExposedSubRegion[];
  /** Physical click centroid when status is CLEAR or EXPOSED_CLICKABLE; otherwise null */
  centroid: Point2D | null;
  meetsAreaThreshold: boolean;
  meetsDimensionThreshold: boolean;
  reason: string;
}

export type TargetReference = Locator | Rect | string | DOMCandidate;

export interface ScrollIntoSafeBandOptions {
  marginPx?: number;
  frame?: Frame;
  alwaysCenter?: boolean;
  maxPasses?: number;
  settleMs?: number;
}

export interface ScrollIntoSafeBandResult {
  scrolled: boolean;
  inSafeBand: boolean;
  beforeRect: Rect | null;
  afterRect: Rect | null;
  scrollDeltaY: number;
  scrollDeltaX: number;
  safeBand: SafeViewportBand;
  passes: number;
}

export type SafeClickStatus =
  | 'CLEAR'
  | 'SHIFTED_CORNER'
  | 'SHIFTED_CENTROID'
  | 'INSUFFICIENT_EXPOSED_AREA'
  | 'FULLY_OCCLUDED'
  | 'TARGET_NOT_FOUND';

export interface ResolveSafeClickPointOptions extends OcclusionGeometryOptions {
  autoScroll?: boolean;
  marginPx?: number;
  insetPx?: number;
  frame?: Frame;
  scanOverlappingObstacles?: boolean;
  alwaysCenterScroll?: boolean;
}

export interface SafeClickResolution {
  status: SafeClickStatus;
  canClick: boolean;
  /** Viewport physical coordinates for page.mouse.click(x, y) (isTrusted: true) */
  clickPoint: Point2D | null;
  strategy: 'CENTER' | 'SAFE_CORNER' | 'POLYGON_CENTROID' | 'NONE';
  scrolledToSafeBand: boolean;
  safeBand: SafeViewportBand;
  targetRect: Rect | null;
  fivePointResult: FivePointHitTestResult | null;
  polygonResult: PolygonOcclusionResult | null;
  obstacles: ObstacleMetadata[];
  /** True when Stage 2 runner should escalate to Prompt 11 / Prompt 13 dismissal & evasion ladder */
  requiresDismissalLadder: boolean;
  reason: string;
}

export interface TrustedClickResult {
  clicked: boolean;
  clickPoint: Point2D | null;
  resolution: SafeClickResolution;
}

// ============================================================================
// INTERNAL TYPE GUARDS & BROWSER HELPER
// ============================================================================

function isPlaywrightLocator(ref: unknown): ref is Locator {
  return (
    typeof ref === 'object' &&
    ref !== null &&
    typeof (ref as Locator).boundingBox === 'function' &&
    typeof (ref as Locator).evaluate === 'function'
  );
}

function isDOMCandidate(ref: unknown): ref is DOMCandidate {
  return (
    typeof ref === 'object' &&
    ref !== null &&
    typeof (ref as DOMCandidate).selectorPath === 'string' &&
    typeof (ref as DOMCandidate).candidateId === 'number' &&
    typeof (ref as DOMCandidate).rect === 'object'
  );
}

function isRect(ref: unknown): ref is Rect {
  return (
    typeof ref === 'object' &&
    ref !== null &&
    typeof (ref as Rect).x === 'number' &&
    typeof (ref as Rect).y === 'number' &&
    typeof (ref as Rect).width === 'number' &&
    typeof (ref as Rect).height === 'number' &&
    !('selectorPath' in ref)
  );
}

/**
 * Injects tsx/esbuild __name helper into a Page or Frame before evaluation
 * to prevent ReferenceError: __name is not defined.
 */
async function ensureBrowserNameHelper(target: Page | Frame): Promise<void> {
  try {
    await target.evaluate(
      'var __name = globalThis.__name = window.__name = globalThis.__name || function(fn) { return fn; };'
    );
  } catch {
    // Frame may be navigating or cross-origin
  }
}

async function getFrameViewportOffset(page: Page, frame?: Frame): Promise<Point2D> {
  if (!frame || frame === page.mainFrame()) {
    return { x: 0, y: 0 };
  }
  try {
    const frameEl = await frame.frameElement();
    const box = await frameEl.boundingBox();
    if (box) {
      return { x: box.x, y: box.y };
    }
  } catch {
    // Fallback to zero offset if cross-origin/detached
  }
  return { x: 0, y: 0 };
}

function rectsAlmostEqual(a: Rect, b: Rect, tolerance = 2): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

function deduplicateObstacles(obstacles: ObstacleMetadata[]): ObstacleMetadata[] {
  const unique: ObstacleMetadata[] = [];
  for (const obs of obstacles) {
    const exists = unique.some(
      (u) => u.descriptor === obs.descriptor && rectsAlmostEqual(u.rect, obs.rect, 2)
    );
    if (!exists) {
      unique.push(obs);
    }
  }
  return unique;
}

// ============================================================================
// PART 1: PURE 2D GEOMETRY & SUTHERLAND-HODGMAN POLYGON CLIPPING ENGINE
// ============================================================================

const EPS = 1e-6;

/** Convert an axis-aligned Rect into a 4-vertex polygon (CW in screen Y-down coords). */
export function rectToPolygon(rect: Rect): Polygon2D {
  if (rect.width <= 0 || rect.height <= 0) return [];
  const x1 = rect.x;
  const y1 = rect.y;
  const x2 = rect.x + rect.width;
  const y2 = rect.y + rect.height;
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
}

/** Compute the axis-aligned bounding box of a 2D polygon. */
export function getPolygonBoundingBox(polygon: Polygon2D): Rect {
  if (polygon.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

/** Shoelace signed area of a simple polygon. */
export function computePolygonSignedArea(polygon: Polygon2D): number {
  const n = polygon.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Unsigned area of a simple polygon. */
export function computePolygonArea(polygon: Polygon2D): number {
  return Math.abs(computePolygonSignedArea(polygon));
}

/** Exact geometric centroid of a simple polygon via the Shoelace centroid formula. */
export function computePolygonCentroid(polygon: Polygon2D): Point2D | null {
  const n = polygon.length;
  if (n === 0) return null;
  if (n < 3) {
    let sx = 0;
    let sy = 0;
    for (const p of polygon) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / n, y: sy / n };
  }

  const signedArea = computePolygonSignedArea(polygon);
  if (Math.abs(signedArea) < 1e-9) {
    const bb = getPolygonBoundingBox(polygon);
    return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
  }

  let cxSum = 0;
  let cySum = 0;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const cross = a.x * b.y - b.x * a.y;
    cxSum += (a.x + b.x) * cross;
    cySum += (a.y + b.y) * cross;
  }

  const denom = 6 * signedArea;
  return {
    x: cxSum / denom,
    y: cySum / denom,
  };
}

/** Checks if point lies inside or on the boundary of a polygon. */
export function isPointInPolygon(point: Point2D, polygon: Polygon2D): boolean {
  const n = polygon.length;
  if (n < 3) return false;

  // Boundary check first
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const cross = (point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y);
    if (Math.abs(cross) <= 1e-5) {
      const minX = Math.min(a.x, b.x) - 1e-5;
      const maxX = Math.max(a.x, b.x) + 1e-5;
      const minY = Math.min(a.y, b.y) - 1e-5;
      const maxY = Math.max(a.y, b.y) + 1e-5;
      if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
        return true;
      }
    }
  }

  // Ray casting
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Single half-plane Sutherland-Hodgman clip.
 * Keeps vertices where cross(edgeEnd - edgeStart, p - edgeStart) >= -EPS.
 */
export function clipPolygonByHalfPlane(
  polygon: Polygon2D,
  edgeStart: Point2D,
  edgeEnd: Point2D
): Polygon2D {
  if (polygon.length === 0) return [];

  const ex = edgeEnd.x - edgeStart.x;
  const ey = edgeEnd.y - edgeStart.y;

  const signedDist = (p: Point2D): number =>
    ex * (p.y - edgeStart.y) - ey * (p.x - edgeStart.x);

  const intersect = (a: Point2D, b: Point2D, da: number, db: number): Point2D => {
    const denom = da - db;
    if (Math.abs(denom) < 1e-12) {
      return { x: a.x, y: a.y };
    }
    const t = da / denom;
    return {
      x: a.x + t * (b.x - a.x),
      y: a.y + t * (b.y - a.y),
    };
  };

  const output: Polygon2D = [];
  let prev = polygon[polygon.length - 1];
  let prevDist = signedDist(prev);
  let prevInside = prevDist >= -EPS;

  for (let i = 0; i < polygon.length; i++) {
    const curr = polygon[i];
    const currDist = signedDist(curr);
    const currInside = currDist >= -EPS;

    if (currInside) {
      if (!prevInside) {
        output.push(intersect(prev, curr, prevDist, currDist));
      }
      output.push(curr);
    } else if (prevInside) {
      output.push(intersect(prev, curr, prevDist, currDist));
    }

    prev = curr;
    prevDist = currDist;
    prevInside = currInside;
  }

  // Deduplicate near-identical consecutive vertices
  const cleaned: Polygon2D = [];
  for (const p of output) {
    const last = cleaned[cleaned.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-5) {
      cleaned.push(p);
    }
  }
  if (
    cleaned.length > 1 &&
    Math.hypot(
      cleaned[0].x - cleaned[cleaned.length - 1].x,
      cleaned[0].y - cleaned[cleaned.length - 1].y
    ) <= 1e-5
  ) {
    cleaned.pop();
  }

  return cleaned.length >= 3 ? cleaned : [];
}

/**
 * Exact 2D Sutherland-Hodgman polygon clipping algorithm.
 * Clips `subjectPolygon` against a convex `clipPolygon` (supports both CW and CCW winding).
 */
export function sutherlandHodgmanClip(
  subjectPolygon: Polygon2D,
  clipPolygon: Polygon2D
): Polygon2D {
  if (subjectPolygon.length < 3 || clipPolygon.length < 3) {
    return [];
  }

  // Normalize clip polygon to positive signed area (in screen Y-down coords, CW)
  const clipArea = computePolygonSignedArea(clipPolygon);
  if (Math.abs(clipArea) < 1e-9) {
    return [];
  }
  const normalizedClip = clipArea > 0 ? clipPolygon : [...clipPolygon].reverse();

  let output = [...subjectPolygon];
  for (let i = 0; i < normalizedClip.length; i++) {
    const edgeStart = normalizedClip[i];
    const edgeEnd = normalizedClip[(i + 1) % normalizedClip.length];
    output = clipPolygonByHalfPlane(output, edgeStart, edgeEnd);
    if (output.length < 3) return [];
  }

  return computePolygonArea(output) > 1e-4 ? output : [];
}

/**
 * Axis-aligned half-plane clip helpers built directly on Sutherland-Hodgman clipPolygonByHalfPlane.
 * In screen Y-down coords, cross(edgeEnd - edgeStart, p - edgeStart) >= 0 keeps:
 * - x <= maxX: edge going UP   (maxX, 1) -> (maxX, 0)  => ex=0, ey=-1 => -(-1)*(p.x - maxX) = maxX - p.x >= 0
 * - x >= minX: edge going DOWN (minX, 0) -> (minX, 1)  => ex=0, ey=+1 => -(1)*(p.x - minX)  WAIT: check sign!
 *   Let's verify: cross = ex*(p.y - y0) - ey*(p.x - x0).
 *   For (minX, 1) -> (minX, 0): ex=0, ey=-1 => cross = +1 * (p.x - minX) >= 0  <=> p.x >= minX!
 *   For (maxX, 0) -> (maxX, 1): ex=0, ey=+1 => cross = -1 * (p.x - maxX) >= 0  <=> p.x <= maxX!
 *   For (0, minY) -> (1, minY): ex=+1, ey=0 => cross = +1 * (p.y - minY) >= 0  <=> p.y >= minY!
 *   For (1, maxY) -> (0, maxY): ex=-1, ey=0 => cross = -1 * (p.y - maxY) >= 0  <=> p.y <= maxY!
 */
function clipLeftOf(poly: Polygon2D, maxX: number): Polygon2D {
  return clipPolygonByHalfPlane(poly, { x: maxX, y: 0 }, { x: maxX, y: 1 });
}

function clipRightOf(poly: Polygon2D, minX: number): Polygon2D {
  return clipPolygonByHalfPlane(poly, { x: minX, y: 1 }, { x: minX, y: 0 });
}

function clipAbove(poly: Polygon2D, maxY: number): Polygon2D {
  return clipPolygonByHalfPlane(poly, { x: 1, y: maxY }, { x: 0, y: maxY });
}

function clipBelow(poly: Polygon2D, minY: number): Polygon2D {
  return clipPolygonByHalfPlane(poly, { x: 0, y: minY }, { x: 1, y: minY });
}

/**
 * Exact geometric subtraction of an obstacle Rect from a Polygon2D via Sutherland-Hodgman half-plane clipping.
 * Returns disjoint convex sub-polygons representing `polygon \ obstacle`.
 */
export function subtractRectFromPolygon(
  polygon: Polygon2D,
  obstacle: Rect,
  splitOrder: 'vertical-first' | 'horizontal-first' = 'vertical-first'
): Polygon2D[] {
  if (polygon.length < 3) return [];
  if (obstacle.width <= 0 || obstacle.height <= 0) return [polygon];

  const obsPoly = rectToPolygon(obstacle);
  const overlap = sutherlandHodgmanClip(polygon, obsPoly);
  if (overlap.length < 3 || computePolygonArea(overlap) <= 1e-4) {
    return [polygon];
  }

  const ox1 = obstacle.x;
  const oy1 = obstacle.y;
  const ox2 = obstacle.x + obstacle.width;
  const oy2 = obstacle.y + obstacle.height;

  const pieces: Polygon2D[] = [];

  if (splitOrder === 'vertical-first') {
    const left = clipLeftOf(polygon, ox1);
    const right = clipRightOf(polygon, ox2);
    const midBand = clipLeftOf(clipRightOf(polygon, ox1), ox2);
    const midTop = midBand.length >= 3 ? clipAbove(midBand, oy1) : [];
    const midBottom = midBand.length >= 3 ? clipBelow(midBand, oy2) : [];

    for (const p of [left, right, midTop, midBottom]) {
      if (p.length >= 3 && computePolygonArea(p) > 1e-3) {
        pieces.push(p);
      }
    }
  } else {
    const top = clipAbove(polygon, oy1);
    const bottom = clipBelow(polygon, oy2);
    const midBand = clipAbove(clipBelow(polygon, oy1), oy2);
    const midLeft = midBand.length >= 3 ? clipLeftOf(midBand, ox1) : [];
    const midRight = midBand.length >= 3 ? clipRightOf(midBand, ox2) : [];

    for (const p of [top, bottom, midLeft, midRight]) {
      if (p.length >= 3 && computePolygonArea(p) > 1e-3) {
        pieces.push(p);
      }
    }
  }

  return pieces;
}

/**
 * Finds all maximal exposed axis-aligned rectangles inside `targetRect \ union(clippedObstacles)`
 * using exact coordinate-compression grid decomposition.
 * Ensures multi-obstacle layouts always discover the single largest contiguous exposed touch region.
 */
function findMaximalExposedRectangles(
  targetRect: Rect,
  clippedObstacles: Rect[]
): Rect[] {
  const xSet = new Set<number>([targetRect.x, targetRect.x + targetRect.width]);
  const ySet = new Set<number>([targetRect.y, targetRect.y + targetRect.height]);

  for (const obs of clippedObstacles) {
    xSet.add(obs.x);
    xSet.add(obs.x + obs.width);
    ySet.add(obs.y);
    ySet.add(obs.y + obs.height);
  }

  const xs = Array.from(xSet).sort((a, b) => a - b);
  const ys = Array.from(ySet).sort((a, b) => a - b);

  // Merge near-duplicate coordinates within epsilon
  const uniqX: number[] = [];
  for (const x of xs) {
    if (uniqX.length === 0 || x - uniqX[uniqX.length - 1] > 1e-4) {
      uniqX.push(x);
    }
  }
  const uniqY: number[] = [];
  for (const y of ys) {
    if (uniqY.length === 0 || y - uniqY[uniqY.length - 1] > 1e-4) {
      uniqY.push(y);
    }
  }

  const cols = uniqX.length - 1;
  const rows = uniqY.length - 1;
  if (cols <= 0 || rows <= 0) return [];

  const free: boolean[][] = [];
  for (let r = 0; r < rows; r++) {
    const rowArr: boolean[] = [];
    const cy = (uniqY[r] + uniqY[r + 1]) / 2;
    for (let c = 0; c < cols; c++) {
      const cx = (uniqX[c] + uniqX[c + 1]) / 2;
      let blocked = false;
      for (const obs of clippedObstacles) {
        if (
          cx > obs.x + 1e-6 &&
          cx < obs.x + obs.width - 1e-6 &&
          cy > obs.y + 1e-6 &&
          cy < obs.y + obs.height - 1e-6
        ) {
          blocked = true;
          break;
        }
      }
      rowArr.push(!blocked);
    }
    free.push(rowArr);
  }

  // Enumerate maximal free rectangles across row spans
  const results: Rect[] = [];
  for (let r1 = 0; r1 < rows; r1++) {
    const colFree = new Array<boolean>(cols).fill(true);
    for (let r2 = r1; r2 < rows; r2++) {
      for (let c = 0; c < cols; c++) {
        colFree[c] = colFree[c] && free[r2][c];
      }
      let c = 0;
      while (c < cols) {
        if (!colFree[c]) {
          c++;
          continue;
        }
        const cStart = c;
        while (c < cols && colFree[c]) c++;
        const cEnd = c;
        const rect: Rect = {
          x: uniqX[cStart],
          y: uniqY[r1],
          width: uniqX[cEnd] - uniqX[cStart],
          height: uniqY[r2 + 1] - uniqY[r1],
        };
        if (rect.width > 1e-3 && rect.height > 1e-3) {
          results.push(rect);
        }
      }
    }
  }

  // Filter out rectangles strictly contained inside another candidate rectangle
  const maximal: Rect[] = [];
  for (let i = 0; i < results.length; i++) {
    const a = results[i];
    let dominated = false;
    for (let j = 0; j < results.length; j++) {
      if (i === j) continue;
      const b = results[j];
      if (
        b.x <= a.x + 1e-4 &&
        b.y <= a.y + 1e-4 &&
        b.x + b.width >= a.x + a.width - 1e-4 &&
        b.y + b.height >= a.y + a.height - 1e-4
      ) {
        if (
          Math.abs(b.x - a.x) > 1e-4 ||
          Math.abs(b.y - a.y) > 1e-4 ||
          Math.abs(b.width - a.width) > 1e-4 ||
          Math.abs(b.height - a.height) > 1e-4 ||
          j < i
        ) {
          dominated = true;
          break;
        }
      }
    }
    if (!dominated) {
      maximal.push(a);
    }
  }

  return maximal;
}

/**
 * Computes exact Sutherland-Hodgman polygon subtraction of one or more obstacle
 * bounding boxes from a target bounding box, returning exposed area ratio,
 * largest exposed sub-region, and clickable centroid (when >= 40% area AND >= 24x24px).
 */
export function subtractObstaclesFromRect(
  targetRect: Rect,
  obstacleRects: Rect[],
  options: OcclusionGeometryOptions = {}
): PolygonOcclusionResult {
  const minExposedAreaRatio = options.minExposedAreaRatio ?? MIN_EXPOSED_AREA_RATIO;
  const minW = options.minClickableWidthPx ?? MIN_CLICKABLE_DIMENSION_PX;
  const minH = options.minClickableHeightPx ?? MIN_CLICKABLE_DIMENSION_PX;

  const targetPoly = rectToPolygon(targetRect);
  const targetArea = computePolygonArea(targetPoly);

  if (targetArea <= 1e-4) {
    return {
      status: 'FULLY_OCCLUDED',
      targetRect,
      targetArea: 0,
      occludedArea: 0,
      exposedArea: 0,
      exposedAreaRatio: 0,
      clippedObstaclePolygons: [],
      exposedPolygons: [],
      largestExposedSubRegion: null,
      exposedSubRegions: [],
      centroid: null,
      meetsAreaThreshold: false,
      meetsDimensionThreshold: false,
      reason: 'Target bounding box has zero area.',
    };
  }

  // 1. Clip each obstacle strictly against targetRect using Sutherland-Hodgman
  const clippedObstaclePolygons: Polygon2D[] = [];
  const clippedObstacleRects: Rect[] = [];

  for (const obs of obstacleRects) {
    if (obs.width <= 0 || obs.height <= 0) continue;
    const clipped = sutherlandHodgmanClip(targetPoly, rectToPolygon(obs));
    if (clipped.length >= 3 && computePolygonArea(clipped) > 1e-3) {
      clippedObstaclePolygons.push(clipped);
      clippedObstacleRects.push(getPolygonBoundingBox(clipped));
    }
  }

  // 2. No intersecting obstacles -> target is completely clear
  if (clippedObstacleRects.length === 0) {
    const center = computePolygonCentroid(targetPoly) || {
      x: targetRect.x + targetRect.width / 2,
      y: targetRect.y + targetRect.height / 2,
    };
    const sub: ExposedSubRegion = {
      polygon: targetPoly,
      boundingBox: { ...targetRect },
      area: targetArea,
      areaRatio: 1,
      centroid: center,
      meetsMinDimensions:
        targetRect.width >= minW - 1e-6 && targetRect.height >= minH - 1e-6,
    };
    return {
      status: 'CLEAR',
      targetRect,
      targetArea,
      occludedArea: 0,
      exposedArea: targetArea,
      exposedAreaRatio: 1,
      clippedObstaclePolygons: [],
      exposedPolygons: [targetPoly],
      largestExposedSubRegion: sub,
      exposedSubRegions: [sub],
      centroid: center,
      meetsAreaThreshold: true,
      meetsDimensionThreshold: sub.meetsMinDimensions,
      reason: 'No obstacles intersect target bounding box.',
    };
  }

  // 3. Iteratively subtract all obstacles using Sutherland-Hodgman half-plane clipping
  let vertPolys: Polygon2D[] = [targetPoly];
  let horizPolys: Polygon2D[] = [targetPoly];

  for (const obsRect of clippedObstacleRects) {
    const nextVert: Polygon2D[] = [];
    for (const poly of vertPolys) {
      nextVert.push(...subtractRectFromPolygon(poly, obsRect, 'vertical-first'));
    }
    vertPolys = nextVert;

    const nextHoriz: Polygon2D[] = [];
    for (const poly of horizPolys) {
      nextHoriz.push(...subtractRectFromPolygon(poly, obsRect, 'horizontal-first'));
    }
    horizPolys = nextHoriz;
  }

  // Exact total exposed area from disjoint Sutherland-Hodgman pieces
  let rawExposedArea = 0;
  for (const p of vertPolys) {
    rawExposedArea += computePolygonArea(p);
  }
  const exposedArea = Math.max(0, Math.min(targetArea, rawExposedArea));
  const occludedArea = Math.max(0, targetArea - exposedArea);
  const exposedAreaRatio = exposedArea / targetArea;

  if (exposedArea <= 1e-2 || vertPolys.length === 0) {
    return {
      status: 'FULLY_OCCLUDED',
      targetRect,
      targetArea,
      occludedArea: targetArea,
      exposedArea: 0,
      exposedAreaRatio: 0,
      clippedObstaclePolygons,
      exposedPolygons: [],
      largestExposedSubRegion: null,
      exposedSubRegions: [],
      centroid: null,
      meetsAreaThreshold: false,
      meetsDimensionThreshold: false,
      reason: 'Target is 100% occluded by obstacles; escalate to dismissal/evasion ladder.',
    };
  }

  // 4. Build candidate exposed sub-regions from maximal exposed rects + both SH decompositions
  const candidatePolys: Polygon2D[] = [
    ...findMaximalExposedRectangles(targetRect, clippedObstacleRects).map(rectToPolygon),
    ...vertPolys,
    ...horizPolys,
  ];

  const subRegions: ExposedSubRegion[] = [];
  for (const poly of candidatePolys) {
    const area = computePolygonArea(poly);
    if (area <= 1e-3) continue;
    const bb = getPolygonBoundingBox(poly);
    const centroid = computePolygonCentroid(poly);
    if (!centroid) continue;

    // Deduplicate identical bounding boxes
    const dup = subRegions.some((s) => rectsAlmostEqual(s.boundingBox, bb, 0.5));
    if (dup) continue;

    // Sanity check via Sutherland-Hodgman that sub-region does not intersect any obstacle
    let validFree = true;
    for (const obsPoly of clippedObstaclePolygons) {
      const checkClip = sutherlandHodgmanClip(poly, obsPoly);
      if (checkClip.length >= 3 && computePolygonArea(checkClip) > 1e-2) {
        validFree = false;
        break;
      }
    }
    if (!validFree) continue;

    subRegions.push({
      polygon: poly,
      boundingBox: bb,
      area,
      areaRatio: area / targetArea,
      centroid,
      meetsMinDimensions: bb.width >= minW - 1e-6 && bb.height >= minH - 1e-6,
    });
  }

  // Rank: regions meeting min 24x24px first, then largest area, then largest min-dimension
  subRegions.sort((a, b) => {
    if (a.meetsMinDimensions !== b.meetsMinDimensions) {
      return a.meetsMinDimensions ? -1 : 1;
    }
    if (Math.abs(b.area - a.area) > 1e-3) {
      return b.area - a.area;
    }
    const minDimA = Math.min(a.boundingBox.width, a.boundingBox.height);
    const minDimB = Math.min(b.boundingBox.width, b.boundingBox.height);
    return minDimB - minDimA;
  });

  const largest = subRegions[0] || null;
  const meetsAreaThreshold = exposedAreaRatio >= minExposedAreaRatio - 1e-6;
  const meetsDimensionThreshold = largest ? largest.meetsMinDimensions : false;

  if (meetsAreaThreshold && meetsDimensionThreshold && largest) {
    return {
      status: 'EXPOSED_CLICKABLE',
      targetRect,
      targetArea,
      occludedArea,
      exposedArea,
      exposedAreaRatio,
      clippedObstaclePolygons,
      exposedPolygons: vertPolys,
      largestExposedSubRegion: largest,
      exposedSubRegions: subRegions,
      centroid: largest.centroid,
      meetsAreaThreshold: true,
      meetsDimensionThreshold: true,
      reason: `Exposed area ${(exposedAreaRatio * 100).toFixed(1)}% (>= ${(minExposedAreaRatio * 100).toFixed(0)}%) with clickable sub-region ${Math.round(largest.boundingBox.width)}x${Math.round(largest.boundingBox.height)}px.`,
    };
  }

  const dimDesc = largest
    ? `${Math.round(largest.boundingBox.width)}x${Math.round(largest.boundingBox.height)}px`
    : '0x0px';

  return {
    status: 'INSUFFICIENT_EXPOSED_AREA',
    targetRect,
    targetArea,
    occludedArea,
    exposedArea,
    exposedAreaRatio,
    clippedObstaclePolygons,
    exposedPolygons: vertPolys,
    largestExposedSubRegion: largest,
    exposedSubRegions: subRegions,
    centroid: null,
    meetsAreaThreshold,
    meetsDimensionThreshold,
    reason: `Insufficient exposed clickable region: area ${(exposedAreaRatio * 100).toFixed(1)}% (min ${(minExposedAreaRatio * 100).toFixed(0)}%), largest sub-region ${dimDesc} (min ${minW}x${minH}px).`,
  };
}

// ============================================================================
// PART 2: SAFE VIEWPORT BAND ENGINE
// ============================================================================

/**
 * Pure computation of the Safe Viewport Band `[H_top + 20px, ViewportHeight - H_bottom - 20px]`
 * from detected sticky headers, sticky footers, and floating action bars.
 */
export function calculateSafeViewportBand(
  viewportWidth: number,
  viewportHeight: number,
  obstacles: ObstacleMetadata[],
  marginPx: number = SAFE_BAND_MARGIN_PX
): SafeViewportBand {
  const stickyHeaders: ObstacleMetadata[] = [];
  const stickyFooters: ObstacleMetadata[] = [];
  const floatingActionBars: ObstacleMetadata[] = [];

  let headerHeight = 0;
  let footerHeight = 0;

  for (const obs of obstacles) {
    const r = obs.rect;
    if (r.width <= 0 || r.height <= 0) continue;

    if (obs.category === 'sticky-header') {
      stickyHeaders.push(obs);
      const bottomEdge = Math.min(viewportHeight * 0.45, Math.max(0, r.y + r.height));
      headerHeight = Math.max(headerHeight, Math.ceil(bottomEdge));
    } else if (obs.category === 'sticky-footer') {
      stickyFooters.push(obs);
      const bottomOccupancy = Math.min(
        viewportHeight * 0.45,
        Math.max(0, viewportHeight - r.y)
      );
      footerHeight = Math.max(footerHeight, Math.ceil(bottomOccupancy));
    } else if (obs.category === 'floating-action-bar') {
      floatingActionBars.push(obs);
      // If a floating action bar spans horizontally across the center zone of the viewport,
      // reserve its vertical space in H_top / H_bottom so centered scrolling avoids it too.
      const overlapsCenterX =
        r.x < viewportWidth * 0.65 && r.x + r.width > viewportWidth * 0.35;
      if (overlapsCenterX) {
        if (r.y >= viewportHeight * 0.55) {
          const occ = Math.min(viewportHeight * 0.4, Math.max(0, viewportHeight - r.y));
          footerHeight = Math.max(footerHeight, Math.ceil(occ));
        } else if (r.y + r.height <= viewportHeight * 0.45) {
          const occ = Math.min(viewportHeight * 0.4, Math.max(0, r.y + r.height));
          headerHeight = Math.max(headerHeight, Math.ceil(occ));
        }
      }
    }
  }

  let safeTop = headerHeight + marginPx;
  let safeBottom = viewportHeight - footerHeight - marginPx;

  // Graceful clamp for ultra-small viewports or oversized bars
  if (safeBottom <= safeTop) {
    const fallbackTop = Math.min(headerHeight, viewportHeight * 0.45);
    const fallbackBottom = viewportHeight - Math.min(footerHeight, viewportHeight * 0.45);
    if (fallbackBottom > fallbackTop + 10) {
      safeTop = fallbackTop;
      safeBottom = fallbackBottom;
    } else {
      safeTop = Math.max(0, viewportHeight * 0.15);
      safeBottom = Math.min(viewportHeight, viewportHeight * 0.85);
    }
  }

  const safeHeight = Math.max(0, safeBottom - safeTop);
  const safeCenterY = safeTop + safeHeight / 2;

  return {
    viewportWidth,
    viewportHeight,
    headerHeight,
    footerHeight,
    marginPx,
    safeTop,
    safeBottom,
    safeCenterY,
    safeHeight,
    stickyHeaders,
    stickyFooters,
    floatingActionBars,
  };
}

/** Checks whether a target rect sits safely inside the Safe Viewport Band. */
export function isRectInSafeViewportBand(rect: Rect, band: SafeViewportBand): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  const horizontallyVisible =
    rect.x + rect.width > 0 && rect.x < band.viewportWidth;
  if (!horizontallyVisible) return false;

  if (rect.height <= band.safeHeight) {
    return (
      rect.y >= band.safeTop - 1 &&
      rect.y + rect.height <= band.safeBottom + 1
    );
  }
  // For elements taller than the entire safe band, ensure they span across safeCenterY
  return rect.y <= band.safeTop + 1 && rect.y + rect.height >= band.safeBottom - 1;
}

/**
 * Scans the live DOM (including Open Shadow DOM) to detect fixed/sticky headers,
 * sticky footers, and floating action bars, returning the computed SafeViewportBand.
 */
export async function detectSafeViewportBand(
  page: Page,
  options: { marginPx?: number; frame?: Frame } = {}
): Promise<SafeViewportBand> {
  const marginPx = options.marginPx ?? SAFE_BAND_MARGIN_PX;
  const evalTarget = options.frame || page;
  await ensureBrowserNameHelper(evalTarget);

  const scan = await evalTarget.evaluate(() => {
    const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
    const vh = window.innerHeight || document.documentElement.clientHeight || 720;

    const detected: Array<{
      tag: string;
      id?: string;
      className?: string;
      role?: string;
      ariaLabel?: string;
      textPreview?: string;
      descriptor: string;
      rect: { x: number; y: number; width: number; height: number };
      position: string;
      zIndex: string;
      category: 'sticky-header' | 'sticky-footer' | 'floating-action-bar';
    }> = [];

    const matchedElements: Element[] = [];
    const stack: Element[] = [];
    if (document.body) {
      stack.push(document.body);
    }

    while (stack.length > 0) {
      const el = stack.pop()!;
      if (el !== document.body) {
        const style = window.getComputedStyle(el);
        const pos = style.position;

        if (
          (pos === 'fixed' || pos === 'sticky') &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          parseFloat(style.opacity || '1') > 0 &&
          style.pointerEvents !== 'none'
        ) {
          const rect = el.getBoundingClientRect();
          const inViewport =
            rect.width > 4 &&
            rect.height > 4 &&
            rect.bottom > 0 &&
            rect.top < vh &&
            rect.right > 0 &&
            rect.left < vw;

          // Exclude full-screen overlays/modals and full-height sidebars
          const isNotFullHeight = rect.height < vh * 0.45;
          const isNotFullScreenArea = rect.width * rect.height < vw * vh * 0.5;

          if (inViewport && isNotFullHeight && isNotFullScreenArea) {
            // Skip if already enclosed by a detected fixed/sticky ancestor
            let ancestorMatched = false;
            for (let i = 0; i < matchedElements.length; i++) {
              if (matchedElements[i].contains(el)) {
                ancestorMatched = true;
                break;
              }
            }

            if (!ancestorMatched) {
              const tag = el.tagName.toLowerCase();
              const id = el.id || undefined;
              const cls = typeof el.className === 'string' ? el.className.trim() : '';
              const role = el.getAttribute('role') || undefined;
              const ariaLabel = el.getAttribute('aria-label') || undefined;
              const combined = (tag + ' ' + (id || '') + ' ' + cls + ' ' + (role || '')).toLowerCase();

              const isStickyEngagedTop =
                pos === 'fixed' ||
                (pos === 'sticky' && style.top !== 'auto' && rect.top <= 60);
              const isStickyEngagedBottom =
                pos === 'fixed' ||
                (pos === 'sticky' && style.bottom !== 'auto' && rect.bottom >= vh - 60);

              const isHeaderSemantic =
                tag === 'header' ||
                tag === 'nav' ||
                role === 'banner' ||
                /\b(header|navbar|nav-bar|topbar|top-bar|appbar|app-bar|sticky-header|fixed-header)\b/.test(
                  combined
                );
              const isFooterSemantic =
                tag === 'footer' ||
                role === 'contentinfo' ||
                /\b(footer|bottom-bar|bottombar|sticky-footer|fixed-footer|cookie-bar|consent-bar)\b/.test(
                  combined
                );
              const isFabSemantic =
                role === 'toolbar' ||
                /\b(fab|floating-action|action-bar|floating-bar|quick-action|floating-toolbar|sticky-bar|floating-btn)\b/.test(
                  combined
                );

              // Ignore toast/notification/modal elements from being classified as sticky bars
              const isModalOrToast =
                role === 'dialog' ||
                role === 'alertdialog' ||
                role === 'alert' ||
                role === 'listbox' ||
                el.getAttribute('aria-modal') === 'true' ||
                /\b(modal|dialog|toast|snackbar|notification|ant-message|dropdown|popover)\b/.test(
                  combined
                );

              let category: 'sticky-header' | 'sticky-footer' | 'floating-action-bar' | null =
                null;

              if (!isModalOrToast) {
                if (
                  isStickyEngagedTop &&
                  rect.top >= -10 &&
                  rect.top <= 60 &&
                  (rect.width >= vw * 0.35 || (isHeaderSemantic && rect.width >= vw * 0.2))
                ) {
                  category = 'sticky-header';
                } else if (
                  isFabSemantic &&
                  (rect.bottom >= vh - 160 || rect.top <= 160)
                ) {
                  category = 'floating-action-bar';
                } else if (
                  isStickyEngagedBottom &&
                  rect.bottom <= vh + 10 &&
                  rect.bottom >= vh - 60 &&
                  (rect.width >= vw * 0.35 || (isFooterSemantic && rect.width >= vw * 0.2))
                ) {
                  category = 'sticky-footer';
                } else if (
                  pos === 'fixed' &&
                  rect.bottom >= vh - 140 &&
                  rect.height <= 120 &&
                  rect.width >= 32
                ) {
                  category = 'floating-action-bar';
                }
              }

              if (category) {
                matchedElements.push(el);
                const clsSlug = cls
                  ? '.' + cls.split(/\s+/).filter(Boolean).slice(0, 3).join('.')
                  : '';
                const descriptor = `${tag}${id ? '#' + id : ''}${clsSlug}`;
                const textRaw = (el.textContent || '').replace(/\s+/g, ' ').trim();
                detected.push({
                  tag,
                  id,
                  className: cls || undefined,
                  role,
                  ariaLabel,
                  textPreview: textRaw ? textRaw.slice(0, 80) : undefined,
                  descriptor,
                  rect: {
                    x: Math.round(rect.left * 100) / 100,
                    y: Math.round(rect.top * 100) / 100,
                    width: Math.round(rect.width * 100) / 100,
                    height: Math.round(rect.height * 100) / 100,
                  },
                  position: pos,
                  zIndex: style.zIndex || 'auto',
                  category,
                });
              }
            }
          }
        }
      }

      if (el.shadowRoot) {
        const shadowChildren = el.shadowRoot.children;
        for (let i = shadowChildren.length - 1; i >= 0; i--) {
          stack.push(shadowChildren[i]);
        }
      }
      const children = el.children;
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        const cTag = child.tagName;
        if (cTag !== 'SCRIPT' && cTag !== 'STYLE' && cTag !== 'NOSCRIPT') {
          stack.push(child);
        }
      }
    }

    return { vw, vh, detected };
  });

  return calculateSafeViewportBand(scan.vw, scan.vh, scan.detected, marginPx);
}

/**
 * Resolves a TargetReference into a Playwright Locator when possible.
 */
function resolveLocatorFromRef(
  page: Page,
  ref: TargetReference | undefined,
  explicitFrame?: Frame
): { locator: Locator | null; frame: Frame } {
  const defaultFrame = explicitFrame || page.mainFrame();
  if (!ref) {
    return { locator: null, frame: defaultFrame };
  }
  if (isPlaywrightLocator(ref)) {
    return { locator: ref, frame: defaultFrame };
  }
  if (isDOMCandidate(ref)) {
    const frames = page.frames();
    const frame =
      explicitFrame ||
      (ref.frameIndex !== undefined && ref.frameIndex < frames.length
        ? frames[ref.frameIndex]
        : page.mainFrame());
    return { locator: frame.locator(ref.selectorPath).first(), frame };
  }
  if (typeof ref === 'string') {
    const trimmed = ref.trim();
    if (!trimmed) return { locator: null, frame: defaultFrame };
    // Check if looks like CSS / attribute / Playwright selector vs plain text hint
    const looksLikeSelector =
      /^[#.\[]/.test(trimmed) ||
      /[#.\[\]>+=:~]/.test(trimmed) ||
      /^[a-z][a-z0-9]*-[a-z0-9-]+$/i.test(trimmed) ||
      /^(button|a|input|select|textarea|div|span|label|li|tr|td|th|form|section|article|header|footer|nav|main|aside|p|h[1-6]|img|svg)\b/i.test(
        trimmed
      ) ||
      trimmed.startsWith('xpath=') ||
      trimmed.startsWith('text=') ||
      trimmed.startsWith('css=');
    if (looksLikeSelector) {
      return { locator: defaultFrame.locator(trimmed).first(), frame: defaultFrame };
    }
    return {
      locator: defaultFrame.getByText(trimmed, { exact: false }).first(),
      frame: defaultFrame,
    };
  }
  return { locator: null, frame: defaultFrame };
}

/**
 * Scrolls the target element/rect into the vertical center of the Safe Viewport Band
 * `[H_top + 20px, ViewportHeight - H_bottom - 20px]`, preventing sticky headers,
 * sticky footers, and floating action bars from swallowing clicks.
 */
export async function scrollIntoSafeViewportBand(
  page: Page,
  targetRectOrLocator: TargetReference,
  options: ScrollIntoSafeBandOptions = {}
): Promise<ScrollIntoSafeBandResult> {
  const marginPx = options.marginPx ?? SAFE_BAND_MARGIN_PX;
  const maxPasses = Math.max(1, options.maxPasses ?? 2);
  const settleMs = options.settleMs ?? 50;

  let safeBand = await detectSafeViewportBand(page, { marginPx, frame: options.frame });

  // Case 1: Caller passed a pure Rect (viewport-relative coordinates)
  if (isRect(targetRectOrLocator)) {
    const beforeRect: Rect = { ...targetRectOrLocator };
    let currentRect: Rect = { ...targetRectOrLocator };
    let totalDeltaY = 0;
    let totalDeltaX = 0;
    let passes = 0;

    if (!options.alwaysCenter && isRectInSafeViewportBand(currentRect, safeBand)) {
      return {
        scrolled: false,
        inSafeBand: true,
        beforeRect,
        afterRect: currentRect,
        scrollDeltaY: 0,
        scrollDeltaX: 0,
        safeBand,
        passes: 0,
      };
    }

    await ensureBrowserNameHelper(page);
    for (let pass = 1; pass <= maxPasses; pass++) {
      passes = pass;
      const targetCenterY = currentRect.y + currentRect.height / 2;
      const desiredDeltaY = targetCenterY - safeBand.safeCenterY;

      let desiredDeltaX = 0;
      if (currentRect.x < marginPx || currentRect.x + currentRect.width > safeBand.viewportWidth - marginPx) {
        desiredDeltaX = currentRect.x + currentRect.width / 2 - safeBand.viewportWidth / 2;
      }

      const applied = await page.evaluate(
        ({ dx, dy }) => {
          const prevX = window.scrollX;
          const prevY = window.scrollY;
          window.scrollBy({ left: dx, top: dy, behavior: 'instant' });
          return {
            actualDx: window.scrollX - prevX,
            actualDy: window.scrollY - prevY,
          };
        },
        { dx: desiredDeltaX, dy: desiredDeltaY }
      );

      totalDeltaX += applied.actualDx;
      totalDeltaY += applied.actualDy;
      currentRect = {
        x: currentRect.x - applied.actualDx,
        y: currentRect.y - applied.actualDy,
        width: currentRect.width,
        height: currentRect.height,
      };

      if (settleMs > 0) {
        await page.waitForTimeout(settleMs);
      }
      safeBand = await detectSafeViewportBand(page, { marginPx, frame: options.frame });

      if (isRectInSafeViewportBand(currentRect, safeBand)) {
        break;
      }
      if (Math.abs(applied.actualDy) < 1 && Math.abs(applied.actualDx) < 1) {
        break;
      }
    }

    return {
      scrolled: Math.abs(totalDeltaY) > 0.5 || Math.abs(totalDeltaX) > 0.5,
      inSafeBand: isRectInSafeViewportBand(currentRect, safeBand),
      beforeRect,
      afterRect: currentRect,
      scrollDeltaY: totalDeltaY,
      scrollDeltaX: totalDeltaX,
      safeBand,
      passes,
    };
  }

  // Case 2: Locator / CSS selector / DOMCandidate
  const { locator, frame } = resolveLocatorFromRef(page, targetRectOrLocator, options.frame);
  if (!locator) {
    return {
      scrolled: false,
      inSafeBand: false,
      beforeRect: null,
      afterRect: null,
      scrollDeltaY: 0,
      scrollDeltaX: 0,
      safeBand,
      passes: 0,
    };
  }

  await ensureBrowserNameHelper(frame);
  await ensureBrowserNameHelper(page);

  const count = await locator.count().catch(() => 0);
  if (count === 0) {
    return {
      scrolled: false,
      inSafeBand: false,
      beforeRect: null,
      afterRect: null,
      scrollDeltaY: 0,
      scrollDeltaX: 0,
      safeBand,
      passes: 0,
    };
  }

  const initialBox = await locator.boundingBox().catch(() => null);
  const beforeRect: Rect | null = initialBox
    ? {
        x: initialBox.x,
        y: initialBox.y,
        width: initialBox.width,
        height: initialBox.height,
      }
    : null;

  if (!beforeRect) {
    return {
      scrolled: false,
      inSafeBand: false,
      beforeRect: null,
      afterRect: null,
      scrollDeltaY: 0,
      scrollDeltaX: 0,
      safeBand,
      passes: 0,
    };
  }

  if (!options.alwaysCenter && isRectInSafeViewportBand(beforeRect, safeBand)) {
    return {
      scrolled: false,
      inSafeBand: true,
      beforeRect,
      afterRect: beforeRect,
      scrollDeltaY: 0,
      scrollDeltaX: 0,
      safeBand,
      passes: 0,
    };
  }

  let currentRect = { ...beforeRect };
  let totalDeltaY = 0;
  let totalDeltaX = 0;
  let passes = 0;

  for (let pass = 1; pass <= maxPasses; pass++) {
    passes = pass;
    const frameOffset = await getFrameViewportOffset(page, frame);

    // Step 1: Center inside any scrollable ancestor container first, then align into window Safe Viewport Band
    const moveRes = await locator
      .evaluate(
        (el, args) => {
          const prevWinX = window.scrollX;
          const prevWinY = window.scrollY;
          let ancestorMovedY = 0;
          let ancestorMovedX = 0;

          // Adjust scrollable ancestor containers if they clip the element
          let anc: HTMLElement | null = el.parentElement;
          while (anc && anc !== document.body && anc !== document.documentElement) {
            const st = window.getComputedStyle(anc);
            const canScrollY =
              (st.overflowY === 'auto' || st.overflowY === 'scroll') &&
              anc.scrollHeight > anc.clientHeight + 1;
            const canScrollX =
              (st.overflowX === 'auto' || st.overflowX === 'scroll') &&
              anc.scrollWidth > anc.clientWidth + 1;

            if (canScrollY || canScrollX) {
              const ancRect = anc.getBoundingClientRect();
              const elRect = el.getBoundingClientRect();
              if (canScrollY) {
                const desiredTop = ancRect.top + ancRect.height / 2 - elRect.height / 2;
                const dY = elRect.top - desiredTop;
                if (Math.abs(dY) > 2) {
                  const before = anc.scrollTop;
                  anc.scrollTop += dY;
                  ancestorMovedY += anc.scrollTop - before;
                }
              }
              if (canScrollX) {
                const desiredLeft = ancRect.left + ancRect.width / 2 - elRect.width / 2;
                const dX = elRect.left - desiredLeft;
                if (Math.abs(dX) > 2) {
                  const before = anc.scrollLeft;
                  anc.scrollLeft += dX;
                  ancestorMovedX += anc.scrollLeft - before;
                }
              }
            }
            anc = anc.parentElement;
          }

          // Now scroll the frame/window so the element centers on safeCenterY
          const rectNow = el.getBoundingClientRect();
          const elCenterInTopViewportY = rectNow.top + rectNow.height / 2 + args.offsetY;
          const deltaY = elCenterInTopViewportY - args.safeCenterY;

          let deltaX = 0;
          const elLeftInTopViewport = rectNow.left + args.offsetX;
          const elRightInTopViewport = rectNow.right + args.offsetX;
          if (
            elLeftInTopViewport < args.marginPx ||
            elRightInTopViewport > args.viewportWidth - args.marginPx
          ) {
            deltaX =
              elLeftInTopViewport + rectNow.width / 2 - args.viewportWidth / 2;
          }

          if (Math.abs(deltaY) > 0.5 || Math.abs(deltaX) > 0.5) {
            window.scrollBy({ left: deltaX, top: deltaY, behavior: 'instant' });
          }

          return {
            winDx: window.scrollX - prevWinX,
            winDy: window.scrollY - prevWinY,
            ancestorMovedX,
            ancestorMovedY,
          };
        },
        {
          safeCenterY: safeBand.safeCenterY,
          viewportWidth: safeBand.viewportWidth,
          marginPx,
          offsetX: frameOffset.x,
          offsetY: frameOffset.y,
        }
      )
      .catch(() => ({ winDx: 0, winDy: 0, ancestorMovedX: 0, ancestorMovedY: 0 }));

    // If element lives inside a child iframe, we may also need to scroll the top-level page
    let topWinDx = 0;
    let topWinDy = 0;
    if (frame !== page.mainFrame()) {
      const boxMid = await locator.boundingBox().catch(() => null);
      if (boxMid) {
        const topDeltaY = boxMid.y + boxMid.height / 2 - safeBand.safeCenterY;
        const topApplied = await page.evaluate(
          (dy) => {
            const py = window.scrollY;
            window.scrollBy({ left: 0, top: dy, behavior: 'instant' });
            return window.scrollY - py;
          },
          topDeltaY
        );
        topWinDy = topApplied;
      }
    }

    totalDeltaX += moveRes.winDx + moveRes.ancestorMovedX + topWinDx;
    totalDeltaY += moveRes.winDy + moveRes.ancestorMovedY + topWinDy;

    if (settleMs > 0) {
      await page.waitForTimeout(settleMs);
    }

    // Wait 1 animation frame so sticky headers/compositor settle before re-measuring
    await page
      .evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())))
      .catch(() => {});

    safeBand = await detectSafeViewportBand(page, { marginPx, frame: options.frame });
    const refreshedBox = await locator.boundingBox().catch(() => null);
    if (refreshedBox) {
      currentRect = {
        x: refreshedBox.x,
        y: refreshedBox.y,
        width: refreshedBox.width,
        height: refreshedBox.height,
      };
    }

    if (isRectInSafeViewportBand(currentRect, safeBand)) {
      break;
    }

    const movedThisPass =
      Math.abs(moveRes.winDy) +
      Math.abs(moveRes.ancestorMovedY) +
      Math.abs(topWinDy) +
      Math.abs(moveRes.winDx) +
      Math.abs(moveRes.ancestorMovedX);
    if (movedThisPass < 1) {
      break;
    }
  }

  return {
    scrolled: Math.abs(totalDeltaY) > 0.5 || Math.abs(totalDeltaX) > 0.5,
    inSafeBand: isRectInSafeViewportBand(currentRect, safeBand),
    beforeRect,
    afterRect: currentRect,
    scrollDeltaY: totalDeltaY,
    scrollDeltaX: totalDeltaX,
    safeBand,
    passes,
  };
}

// ============================================================================
// PART 3: 5-POINT MULTI-SAMPLING PHYSICAL HIT-TESTER
// ============================================================================

/**
 * Generates the 5 multi-sampling hit-test points for a target bounding box:
 * 1. Center: (x + w/2, y + h/2)
 * 2. Top-Left: (x + inset, y + inset)
 * 3. Top-Right: (x + w - inset, y + inset)
 * 4. Bottom-Left: (x + inset, y + h - inset)
 * 5. Bottom-Right: (x + w - inset, y + h - inset)
 * Gracefully clamps the 5px inset for tiny elements so all 4 corners remain inside the box.
 */
export function generate5SamplePoints(
  rect: Rect,
  insetPx: number = DEFAULT_CORNER_INSET_PX
): SamplePoint[] {
  const safeInsetX =
    rect.width >= insetPx * 2 + 2
      ? insetPx
      : Math.max(0.5, Math.min(insetPx, rect.width / 4));
  const safeInsetY =
    rect.height >= insetPx * 2 + 2
      ? insetPx
      : Math.max(0.5, Math.min(insetPx, rect.height / 4));

  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;

  return [
    { name: 'center', x: cx, y: cy },
    { name: 'top-left', x: rect.x + safeInsetX, y: rect.y + safeInsetY },
    { name: 'top-right', x: rect.x + rect.width - safeInsetX, y: rect.y + safeInsetY },
    { name: 'bottom-left', x: rect.x + safeInsetX, y: rect.y + rect.height - safeInsetY },
    {
      name: 'bottom-right',
      x: rect.x + rect.width - safeInsetX,
      y: rect.y + rect.height - safeInsetY,
    },
  ];
}

/**
 * Picks the optimal exposed corner from 5-point sampling when center is occluded,
 * preferring the exposed corner farthest from detected obstacle bounding boxes.
 */
function selectBestExposedPoint(
  samples: SamplePointResult[],
  obstacles: ObstacleMetadata[]
): { x: number; y: number; source: SamplePointName } | null {
  const center = samples.find((s) => s.name === 'center');
  if (center && center.hitsTarget) {
    return { x: center.x, y: center.y, source: 'center' };
  }

  const exposedCorners = samples.filter((s) => s.name !== 'center' && s.hitsTarget);
  if (exposedCorners.length === 0) return null;
  if (exposedCorners.length === 1 || obstacles.length === 0) {
    return {
      x: exposedCorners[0].x,
      y: exposedCorners[0].y,
      source: exposedCorners[0].name,
    };
  }

  // Choose the exposed corner with maximum distance to the closest obstacle boundary
  let best = exposedCorners[0];
  let bestMinDist = -1;

  for (const pt of exposedCorners) {
    let minDistToObstacle = Infinity;
    for (const obs of obstacles) {
      const r = obs.rect;
      const dx = Math.max(r.x - pt.x, 0, pt.x - (r.x + r.width));
      const dy = Math.max(r.y - pt.y, 0, pt.y - (r.y + r.height));
      const d = Math.hypot(dx, dy);
      if (d < minDistToObstacle) {
        minDistToObstacle = d;
      }
    }
    if (minDistToObstacle > bestMinDist) {
      bestMinDist = minDistToObstacle;
      best = pt;
    }
  }

  return { x: best.x, y: best.y, source: best.name };
}

/**
 * Performs browser-side shadow-piercing hit-testing for an arbitrary list of points
 * against a target element (or target rect when no element reference is supplied).
 * NOTE: Deliberately avoids any inner named functions inside evaluate() to prevent
 * esbuild/tsx __name ReferenceErrors in Chromium browser contexts.
 */
async function evaluateHitTestPoints(
  page: Page,
  points: SamplePoint[],
  targetRect: Rect,
  targetSelectorOrLocator?: Locator | string | DOMCandidate,
  explicitFrame?: Frame
): Promise<SamplePointResult[]> {
  const { locator, frame } = resolveLocatorFromRef(
    page,
    targetSelectorOrLocator,
    explicitFrame
  );
  const frameOffset = await getFrameViewportOffset(page, frame);
  await ensureBrowserNameHelper(frame);
  await ensureBrowserNameHelper(page);

  const localPoints = points.map((p) => ({
    name: p.name,
    x: p.x - frameOffset.x,
    y: p.y - frameOffset.y,
    pageX: p.x,
    pageY: p.y,
  }));

  const localTargetRect: Rect = {
    x: targetRect.x - frameOffset.x,
    y: targetRect.y - frameOffset.y,
    width: targetRect.width,
    height: targetRect.height,
  };

  let rawResults: Array<{
    name: SamplePointName;
    x: number;
    y: number;
    hitsTarget: boolean;
    inViewport: boolean;
    occludedBy?: ObstacleMetadata;
  }>;

  const hasLocator = locator !== null && (await locator.count().catch(() => 0)) > 0;

  if (hasLocator && locator) {
    rawResults = await locator.evaluate(
      (targetEl, args) => {
        const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
        const vh = window.innerHeight || document.documentElement.clientHeight || 720;
        const out: Array<{
          name: SamplePointName;
          x: number;
          y: number;
          hitsTarget: boolean;
          inViewport: boolean;
          occludedBy?: ObstacleMetadata;
        }> = [];

        for (let idx = 0; idx < args.pts.length; idx++) {
          const pt = args.pts[idx];
          if (pt.x < 0 || pt.y < 0 || pt.x >= vw || pt.y >= vh) {
            out.push({
              name: pt.name,
              x: pt.pageX,
              y: pt.pageY,
              hitsTarget: false,
              inViewport: false,
            });
            continue;
          }

          // Pierce Open Shadow DOM to find deepest elementFromPoint
          let topEl: Element | null = document.elementFromPoint(pt.x, pt.y);
          let depth = 0;
          while (topEl && topEl.shadowRoot && depth < 10) {
            const inner: Element | null = topEl.shadowRoot.elementFromPoint(pt.x, pt.y);
            if (!inner || inner === topEl) break;
            topEl = inner;
            depth++;
          }

          // Collect full shadow-pierced hit stack via elementsFromPoint (supports nested Shadow DOM)
          const stackEls: Element[] = [];
          const pendingRoots: Array<Document | ShadowRoot> = [document];
          const visitedRoots: Array<Document | ShadowRoot> = [document];
          let rootCursor = 0;
          while (rootCursor < pendingRoots.length && rootCursor < 12) {
            const curRoot = pendingRoots[rootCursor++];
            const rootStack = curRoot.elementsFromPoint(pt.x, pt.y);
            for (let s = 0; s < rootStack.length; s++) {
              const cur = rootStack[s];
              if (cur.shadowRoot && visitedRoots.indexOf(cur.shadowRoot) === -1) {
                visitedRoots.push(cur.shadowRoot);
                pendingRoots.push(cur.shadowRoot);
              }
              if (stackEls.indexOf(cur) === -1) {
                stackEls.push(cur);
              }
            }
          }

          if (!topEl) {
            out.push({
              name: pt.name,
              x: pt.pageX,
              y: pt.pageY,
              hitsTarget: false,
              inViewport: true,
            });
            continue;
          }

          // Check relationship between topEl and targetEl (including across Shadow DOM hosts)
          let isTargetOrDescendant = topEl === targetEl || targetEl.contains(topEl);
          if (!isTargetOrDescendant) {
            let walk: Node | null = topEl;
            let hop = 0;
            while (walk && hop < 30) {
              if (walk === targetEl) {
                isTargetOrDescendant = true;
                break;
              }
              if (walk.parentNode) {
                walk = walk.parentNode;
              } else {
                const root = walk.getRootNode();
                if (root && (root as ShadowRoot).host) {
                  walk = (root as ShadowRoot).host;
                } else {
                  walk = null;
                }
              }
              hop++;
            }
          }

          // Check associated <label> for <input> or direct interactive wrapper (<label>, <a>, <button>)
          let isInteractiveWrapper = false;
          if (!isTargetOrDescendant && topEl !== document.body && topEl !== document.documentElement) {
            if (targetEl.tagName === 'INPUT' && topEl.tagName === 'LABEL') {
              const lblFor = topEl.getAttribute('for');
              if (topEl.contains(targetEl) || (lblFor && lblFor === targetEl.id)) {
                isInteractiveWrapper = true;
              }
            } else if (
              (topEl.tagName === 'BUTTON' || topEl.tagName === 'A' || topEl.tagName === 'LABEL') &&
              topEl.contains(targetEl)
            ) {
              isInteractiveWrapper = true;
            }
          }

          if (isTargetOrDescendant || isInteractiveWrapper) {
            out.push({
              name: pt.name,
              x: pt.pageX,
              y: pt.pageY,
              hitsTarget: true,
              inViewport: true,
            });
            continue;
          }

          // Occluded! Walk up topEl's ancestor chain to find the true occluding container
          // (must NOT contain targetEl, must appear in hit stack before targetEl, pointerEvents != none)
          const targetStackIndex = stackEls.indexOf(targetEl);
          let obstacleEl: Element = topEl;
          let curAnc: Element | null = topEl;
          let climb = 0;

          while (
            curAnc &&
            curAnc !== document.body &&
            curAnc !== document.documentElement &&
            climb < 15
          ) {
            // Check if curAnc contains targetEl (including across Shadow DOM)
            let ancContainsTarget = curAnc.contains(targetEl);
            if (!ancContainsTarget) {
              let tw: Node | null = targetEl;
              let th = 0;
              while (tw && th < 30) {
                if (tw === curAnc) {
                  ancContainsTarget = true;
                  break;
                }
                if (tw.parentNode) {
                  tw = tw.parentNode;
                } else {
                  const r = tw.getRootNode();
                  tw = r && (r as ShadowRoot).host ? (r as ShadowRoot).host : null;
                }
                th++;
              }
            }
            if (ancContainsTarget) break;

            const ancStyle = window.getComputedStyle(curAnc);
            const ancRect = curAnc.getBoundingClientRect();
            const coversPt =
              pt.x >= ancRect.left - 1 &&
              pt.x <= ancRect.right + 1 &&
              pt.y >= ancRect.top - 1 &&
              pt.y <= ancRect.bottom + 1;
            const ancIdx = stackEls.indexOf(curAnc);
            const isAboveTarget =
              ancIdx !== -1 && (targetStackIndex === -1 || ancIdx < targetStackIndex);

            if (ancStyle.pointerEvents !== 'none' && coversPt && isAboveTarget) {
              obstacleEl = curAnc;
            }

            if (curAnc.parentElement) {
              curAnc = curAnc.parentElement;
            } else {
              const r = curAnc.getRootNode();
              curAnc = r && (r as ShadowRoot).host ? (r as ShadowRoot).host : null;
            }
            climb++;
          }

          const obsRect = obstacleEl.getBoundingClientRect();
          const obsStyle = window.getComputedStyle(obstacleEl);
          const tag = obstacleEl.tagName.toLowerCase();
          const id = obstacleEl.id || undefined;
          const cls = typeof obstacleEl.className === 'string' ? obstacleEl.className.trim() : '';
          const role = obstacleEl.getAttribute('role') || undefined;
          const ariaLabel = obstacleEl.getAttribute('aria-label') || undefined;
          const combined = (tag + ' ' + (id || '') + ' ' + cls + ' ' + (role || '')).toLowerCase();
          const pos = obsStyle.position || 'static';

          let category: ObstacleCategory = 'element';
          if (
            role === 'dialog' ||
            role === 'alertdialog' ||
            obstacleEl.getAttribute('aria-modal') === 'true' ||
            /\b(modal|dialog|backdrop|drawer)\b/.test(combined)
          ) {
            category = 'modal';
          } else if (
            role === 'alert' ||
            role === 'status' ||
            /\b(toast|snackbar|notification|ant-message|ant-notification|muisnackbar)\b/.test(
              combined
            )
          ) {
            category = 'toast';
          } else if (
            role === 'listbox' ||
            role === 'menu' ||
            /\b(dropdown|popover|popper|select__menu|ant-select-dropdown|muipopover)\b/.test(
              combined
            )
          ) {
            category = 'dropdown';
          } else if (
            (pos === 'fixed' || pos === 'sticky') &&
            obsRect.top <= 60 &&
            obsRect.bottom <= vh * 0.45 &&
            obsRect.width >= vw * 0.35
          ) {
            category = 'sticky-header';
          } else if (
            (pos === 'fixed' || pos === 'sticky') &&
            obsRect.bottom >= vh - 60 &&
            obsRect.top >= vh * 0.55 &&
            obsRect.width >= vw * 0.35
          ) {
            category = 'sticky-footer';
          } else if (
            (pos === 'fixed' || pos === 'sticky') &&
            (role === 'toolbar' ||
              /\b(fab|floating|action-bar|bottom-bar|toolbar)\b/.test(combined))
          ) {
            category = 'floating-action-bar';
          } else if (
            pos === 'fixed' ||
            pos === 'absolute' ||
            pos === 'sticky' ||
            /\b(overlay|banner|promo|cookie|popup|sticky)\b/.test(combined)
          ) {
            category = 'overlay';
          }

          const clsSlug = cls
            ? '.' + cls.split(/\s+/).filter(Boolean).slice(0, 3).join('.')
            : '';
          const descriptor = `${tag}${id ? '#' + id : ''}${clsSlug}`;
          const textRaw = (obstacleEl.textContent || '').replace(/\s+/g, ' ').trim();

          out.push({
            name: pt.name,
            x: pt.pageX,
            y: pt.pageY,
            hitsTarget: false,
            inViewport: true,
            occludedBy: {
              tag,
              id,
              className: cls || undefined,
              role,
              ariaLabel,
              textPreview: textRaw ? textRaw.slice(0, 80) : undefined,
              descriptor,
              rect: {
                x: Math.round((obsRect.left + args.offsetX) * 100) / 100,
                y: Math.round((obsRect.top + args.offsetY) * 100) / 100,
                width: Math.round(obsRect.width * 100) / 100,
                height: Math.round(obsRect.height * 100) / 100,
              },
              position: pos,
              zIndex: obsStyle.zIndex || 'auto',
              category,
            },
          });
        }

        return out;
      },
      {
        pts: localPoints,
        offsetX: frameOffset.x,
        offsetY: frameOffset.y,
      }
    );
  } else {
    // Rect-only hit-test mode (no DOM selector provided): match topmost element against targetRect
    rawResults = await frame.evaluate(
      (args) => {
        const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
        const vh = window.innerHeight || document.documentElement.clientHeight || 720;
        const tr = args.localTargetRect;
        const out: Array<{
          name: SamplePointName;
          x: number;
          y: number;
          hitsTarget: boolean;
          inViewport: boolean;
          occludedBy?: ObstacleMetadata;
        }> = [];

        for (let idx = 0; idx < args.pts.length; idx++) {
          const pt = args.pts[idx];
          if (pt.x < 0 || pt.y < 0 || pt.x >= vw || pt.y >= vh) {
            out.push({
              name: pt.name,
              x: pt.pageX,
              y: pt.pageY,
              hitsTarget: false,
              inViewport: false,
            });
            continue;
          }

          let topEl: Element | null = document.elementFromPoint(pt.x, pt.y);
          let depth = 0;
          while (topEl && topEl.shadowRoot && depth < 10) {
            const inner: Element | null = topEl.shadowRoot.elementFromPoint(pt.x, pt.y);
            if (!inner || inner === topEl) break;
            topEl = inner;
            depth++;
          }

          if (!topEl || topEl === document.body || topEl === document.documentElement) {
            out.push({
              name: pt.name,
              x: pt.pageX,
              y: pt.pageY,
              hitsTarget: false,
              inViewport: true,
            });
            continue;
          }

          const stack = document.elementsFromPoint(pt.x, pt.y);
          // Find element in stack whose bounding rect best matches targetRect
          let matchedTargetEl: Element | null = null;
          for (let s = 0; s < stack.length; s++) {
            const cand = stack[s];
            const cr = cand.getBoundingClientRect();
            if (
              Math.abs(cr.left - tr.x) <= 8 &&
              Math.abs(cr.top - tr.y) <= 8 &&
              Math.abs(cr.width - tr.width) <= 8 &&
              Math.abs(cr.height - tr.height) <= 8
            ) {
              matchedTargetEl = cand;
              break;
            }
          }

          const topRect = topEl.getBoundingClientRect();
          const topFitsInsideTarget =
            topRect.left >= tr.x - 4 &&
            topRect.top >= tr.y - 4 &&
            topRect.right <= tr.x + tr.width + 4 &&
            topRect.bottom <= tr.y + tr.height + 4;

          const hits =
            matchedTargetEl !== null
              ? topEl === matchedTargetEl || matchedTargetEl.contains(topEl)
              : topFitsInsideTarget;

          if (hits) {
            out.push({
              name: pt.name,
              x: pt.pageX,
              y: pt.pageY,
              hitsTarget: true,
              inViewport: true,
            });
          } else {
            const obsStyle = window.getComputedStyle(topEl);
            const tag = topEl.tagName.toLowerCase();
            const id = topEl.id || undefined;
            const cls = typeof topEl.className === 'string' ? topEl.className.trim() : '';
            const role = topEl.getAttribute('role') || undefined;
            const ariaLabel = topEl.getAttribute('aria-label') || undefined;
            const pos = obsStyle.position || 'static';
            const clsSlug = cls
              ? '.' + cls.split(/\s+/).filter(Boolean).slice(0, 3).join('.')
              : '';
            const descriptor = `${tag}${id ? '#' + id : ''}${clsSlug}`;
            const textRaw = (topEl.textContent || '').replace(/\s+/g, ' ').trim();

            out.push({
              name: pt.name,
              x: pt.pageX,
              y: pt.pageY,
              hitsTarget: false,
              inViewport: true,
              occludedBy: {
                tag,
                id,
                className: cls || undefined,
                role,
                ariaLabel,
                textPreview: textRaw ? textRaw.slice(0, 80) : undefined,
                descriptor,
                rect: {
                  x: Math.round((topRect.left + args.offsetX) * 100) / 100,
                  y: Math.round((topRect.top + args.offsetY) * 100) / 100,
                  width: Math.round(topRect.width * 100) / 100,
                  height: Math.round(topRect.height * 100) / 100,
                },
                position: pos,
                zIndex: obsStyle.zIndex || 'auto',
                category: pos === 'fixed' || pos === 'sticky' ? 'overlay' : 'element',
              },
            });
          }
        }

        return out;
      },
      {
        pts: localPoints,
        localTargetRect,
        offsetX: frameOffset.x,
        offsetY: frameOffset.y,
      }
    );
  }

  return rawResults;
}

/**
 * Single-point live browser hit-test (Shadow DOM & descendant aware).
 * Used to verify Sutherland-Hodgman centroids before returning physical click coordinates.
 */
export async function hitTestPoint(
  page: Page,
  point: Point2D,
  targetSelectorOrLocator?: Locator | string | DOMCandidate,
  options: { frame?: Frame; targetRect?: Rect } = {}
): Promise<{ hitsTarget: boolean; inViewport: boolean; occludedBy?: ObstacleMetadata }> {
  const rect = options.targetRect || { x: point.x - 1, y: point.y - 1, width: 2, height: 2 };
  const results = await evaluateHitTestPoints(
    page,
    [{ name: 'center', x: point.x, y: point.y }],
    rect,
    targetSelectorOrLocator,
    options.frame
  );
  const first = results[0];
  if (!first) {
    return { hitsTarget: false, inViewport: false };
  }
  return {
    hitsTarget: first.hitsTarget,
    inViewport: first.inViewport,
    occludedBy: first.occludedBy,
  };
}

/**
 * 5-Point Multi-Sampling Physical Hit-Tester:
 * Samples center + 4 safe inset corners (5px inset, clamped for tiny elements).
 * Identifies occluding obstacles (collecting obstacle rects & metadata) and
 * selects an exposed safe corner automatically when center is occluded.
 */
export async function hitTest5Points(
  page: Page,
  targetRect: Rect,
  targetSelectorOrLocator?: Locator | string | DOMCandidate,
  options: { insetPx?: number; frame?: Frame } = {}
): Promise<FivePointHitTestResult> {
  const insetPx = options.insetPx ?? DEFAULT_CORNER_INSET_PX;
  const samplePoints = generate5SamplePoints(targetRect, insetPx);
  const samples = await evaluateHitTestPoints(
    page,
    samplePoints,
    targetRect,
    targetSelectorOrLocator,
    options.frame
  );

  const exposedPoints = samples.filter((s) => s.hitsTarget);
  const occludedPoints = samples.filter((s) => !s.hitsTarget);
  const centerSample = samples.find((s) => s.name === 'center');
  const centerExposed = Boolean(centerSample && centerSample.hitsTarget);

  const rawObstacles: ObstacleMetadata[] = [];
  for (const s of occludedPoints) {
    if (s.occludedBy) {
      rawObstacles.push(s.occludedBy);
    }
  }
  const obstacles = deduplicateObstacles(rawObstacles);
  const selectedPoint = selectBestExposedPoint(samples, obstacles);

  return {
    targetRect,
    samples,
    centerExposed,
    exposedPoints,
    occludedPoints,
    obstacles,
    selectedPoint,
    allExposed: exposedPoints.length === samples.length,
    allOccluded: exposedPoints.length === 0,
  };
}

/**
 * Discovers any additional positioned/elevated elements in the DOM whose bounding box
 * overlaps `targetRect` AND actually paints above `targetEl` (verified via elementsFromPoint).
 * Useful when an obstacle covers a strip of the target between the 5 sample points.
 */
async function collectAdditionalOverlappingObstacles(
  page: Page,
  targetRect: Rect,
  targetSelectorOrLocator?: Locator | string | DOMCandidate,
  explicitFrame?: Frame
): Promise<ObstacleMetadata[]> {
  const { locator, frame } = resolveLocatorFromRef(
    page,
    targetSelectorOrLocator,
    explicitFrame
  );
  if (!locator) return [];
  const count = await locator.count().catch(() => 0);
  if (count === 0) return [];

  const frameOffset = await getFrameViewportOffset(page, frame);
  await ensureBrowserNameHelper(frame);

  const found = await locator
    .evaluate(
      (targetEl, args) => {
        const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
        const vh = window.innerHeight || document.documentElement.clientHeight || 720;
        const tr = targetEl.getBoundingClientRect();
        const obstacles: ObstacleMetadata[] = [];

        // Resolve outermost light-DOM host if targetEl lives inside Shadow DOM
        let targetLightHost: Element = targetEl;
        let hostHop = 0;
        while (hostHop < 10) {
          const root = targetLightHost.getRootNode();
          if (root && (root as ShadowRoot).host) {
            targetLightHost = (root as ShadowRoot).host;
            hostHop++;
          } else {
            break;
          }
        }

        const stack: Element[] = [];
        if (document.body) stack.push(document.body);

        while (stack.length > 0) {
          const el = stack.pop()!;
          if (
            el !== document.body &&
            el !== targetEl &&
            el !== targetLightHost &&
            !el.contains(targetEl) &&
            !el.contains(targetLightHost) &&
            !targetEl.contains(el) &&
            !targetLightHost.contains(el)
          ) {
            const st = window.getComputedStyle(el);
            const pos = st.position;
            if (
              (pos === 'fixed' || pos === 'sticky' || pos === 'absolute' || st.zIndex !== 'auto') &&
              st.display !== 'none' &&
              st.visibility !== 'hidden' &&
              parseFloat(st.opacity || '1') > 0 &&
              st.pointerEvents !== 'none'
            ) {
              const r = el.getBoundingClientRect();
              const ix1 = Math.max(tr.left, r.left);
              const iy1 = Math.max(tr.top, r.top);
              const ix2 = Math.min(tr.right, r.right);
              const iy2 = Math.min(tr.bottom, r.bottom);

              if (ix2 - ix1 > 2 && iy2 - iy1 > 2) {
                const probeX = (ix1 + ix2) / 2;
                const probeY = (iy1 + iy2) / 2;
                if (probeX >= 0 && probeY >= 0 && probeX < vw && probeY < vh) {
                  const hitStack = document.elementsFromPoint(probeX, probeY);
                  const elIdx = hitStack.indexOf(el);
                  const targetIdx = hitStack.indexOf(targetLightHost);
                  const paintsAbove =
                    elIdx !== -1 && (targetIdx === -1 || elIdx < targetIdx);
                  if (paintsAbove) {
                    const tag = el.tagName.toLowerCase();
                    const id = el.id || undefined;
                    const cls = typeof el.className === 'string' ? el.className.trim() : '';
                    const role = el.getAttribute('role') || undefined;
                    const ariaLabel = el.getAttribute('aria-label') || undefined;
                    const combined = (
                      tag +
                      ' ' +
                      (id || '') +
                      ' ' +
                      cls +
                      ' ' +
                      (role || '')
                    ).toLowerCase();

                    let category: ObstacleCategory = 'overlay';
                    if (
                      role === 'dialog' ||
                      role === 'alertdialog' ||
                      el.getAttribute('aria-modal') === 'true' ||
                      /\b(modal|dialog|backdrop|drawer)\b/.test(combined)
                    ) {
                      category = 'modal';
                    } else if (
                      role === 'alert' ||
                      role === 'status' ||
                      /\b(toast|snackbar|notification|ant-message)\b/.test(combined)
                    ) {
                      category = 'toast';
                    } else if (
                      role === 'listbox' ||
                      role === 'menu' ||
                      /\b(dropdown|popover|popper|select__menu)\b/.test(combined)
                    ) {
                      category = 'dropdown';
                    } else if (
                      (pos === 'fixed' || pos === 'sticky') &&
                      r.top <= 60 &&
                      r.bottom <= vh * 0.45 &&
                      r.width >= vw * 0.35
                    ) {
                      category = 'sticky-header';
                    } else if (
                      (pos === 'fixed' || pos === 'sticky') &&
                      r.bottom >= vh - 60 &&
                      r.top >= vh * 0.55 &&
                      r.width >= vw * 0.35
                    ) {
                      category = 'sticky-footer';
                    } else if (
                      (pos === 'fixed' || pos === 'sticky') &&
                      /\b(fab|floating|action-bar|bottom-bar|toolbar)\b/.test(combined)
                    ) {
                      category = 'floating-action-bar';
                    }

                    const clsSlug = cls
                      ? '.' + cls.split(/\s+/).filter(Boolean).slice(0, 3).join('.')
                      : '';
                    const descriptor = `${tag}${id ? '#' + id : ''}${clsSlug}`;
                    const textRaw = (el.textContent || '').replace(/\s+/g, ' ').trim();

                    obstacles.push({
                      tag,
                      id,
                      className: cls || undefined,
                      role,
                      ariaLabel,
                      textPreview: textRaw ? textRaw.slice(0, 80) : undefined,
                      descriptor,
                      rect: {
                        x: Math.round((r.left + args.offsetX) * 100) / 100,
                        y: Math.round((r.top + args.offsetY) * 100) / 100,
                        width: Math.round(r.width * 100) / 100,
                        height: Math.round(r.height * 100) / 100,
                      },
                      position: pos,
                      zIndex: st.zIndex || 'auto',
                      category,
                    });
                    // Do not descend into an already-captured occluding container
                    continue;
                  }
                }
              }
            }
          }

          if (el.shadowRoot) {
            const sc = el.shadowRoot.children;
            for (let i = sc.length - 1; i >= 0; i--) {
              stack.push(sc[i]);
            }
          }
          const ch = el.children;
          for (let i = ch.length - 1; i >= 0; i--) {
            const cTag = ch[i].tagName;
            if (cTag !== 'SCRIPT' && cTag !== 'STYLE' && cTag !== 'NOSCRIPT') {
              stack.push(ch[i]);
            }
          }
        }

        return obstacles;
      },
      {
        offsetX: frameOffset.x,
        offsetY: frameOffset.y,
        targetRect,
      }
    )
    .catch(() => []);

  return deduplicateObstacles(found);
}

// ============================================================================
// PART 4: END-TO-END SAFE CLICK POINT RESOLVER & TRUSTED PHYSICAL CLICKER
// ============================================================================

/**
 * End-to-end Safe Physical Click Point Resolver (ready for Stage 2 runner.ts integration):
 * 1. Scrolls target into the center of the Safe Viewport Band `[H_top+20, VH-H_bottom-20]`.
 * 2. Runs 5-Point Multi-Sampling Physical Hit-Testing (Shadow DOM & descendant aware).
 * 3. When any occlusion is detected, runs Sutherland-Hodgman Polygon Sub-region subtraction
 *    to verify >= 40% exposed area and >= 24x24px clickable region, verifies the exposed
 *    centroid via live hit-test, and falls back to verified exposed safe corners when needed.
 * 4. Returns status 'FULLY_OCCLUDED' / 'INSUFFICIENT_EXPOSED_AREA' with obstacle metadata
 *    and `requiresDismissalLadder: true` so Stage 2 triggers Prompt 11 / Prompt 13.
 */
export async function resolveSafeClickPoint(
  page: Page,
  rect: Rect | null,
  selectorOrHint?: Locator | string | DOMCandidate,
  options: ResolveSafeClickPointOptions = {}
): Promise<SafeClickResolution> {
  const autoScroll = options.autoScroll !== false;
  const marginPx = options.marginPx ?? SAFE_BAND_MARGIN_PX;
  const insetPx = options.insetPx ?? DEFAULT_CORNER_INSET_PX;
  const scanOverlapping = options.scanOverlappingObstacles !== false;
  const minW = options.minClickableWidthPx ?? MIN_CLICKABLE_DIMENSION_PX;
  const minH = options.minClickableHeightPx ?? MIN_CLICKABLE_DIMENSION_PX;

  const geomOptions: OcclusionGeometryOptions = {
    minExposedAreaRatio: options.minExposedAreaRatio ?? MIN_EXPOSED_AREA_RATIO,
    minClickableWidthPx: minW,
    minClickableHeightPx: minH,
  };

  let safeBand: SafeViewportBand;
  let scrolledToSafeBand = false;
  let currentRect: Rect | null = rect ? { ...rect } : null;

  const scrollTarget: TargetReference | null = selectorOrHint || currentRect;

  if (!scrollTarget) {
    safeBand = await detectSafeViewportBand(page, { marginPx, frame: options.frame });
    return {
      status: 'TARGET_NOT_FOUND',
      canClick: false,
      clickPoint: null,
      strategy: 'NONE',
      scrolledToSafeBand: false,
      safeBand,
      targetRect: null,
      fivePointResult: null,
      polygonResult: null,
      obstacles: [],
      requiresDismissalLadder: false,
      reason: 'Neither a target bounding rect nor a target selector/locator was provided.',
    };
  }

  // Step 1: Safe Viewport Band scroll
  if (autoScroll) {
    const scrollRes = await scrollIntoSafeViewportBand(page, scrollTarget, {
      marginPx,
      frame: options.frame,
      alwaysCenter: options.alwaysCenterScroll,
    });
    safeBand = scrollRes.safeBand;
    scrolledToSafeBand = scrollRes.scrolled;
    if (scrollRes.afterRect) {
      currentRect = scrollRes.afterRect;
    }
  } else {
    safeBand = await detectSafeViewportBand(page, { marginPx, frame: options.frame });
    if (!currentRect && selectorOrHint) {
      const { locator } = resolveLocatorFromRef(page, selectorOrHint, options.frame);
      const box = locator ? await locator.boundingBox().catch(() => null) : null;
      if (box) {
        currentRect = { x: box.x, y: box.y, width: box.width, height: box.height };
      }
    }
  }

  if (!currentRect || currentRect.width <= 0 || currentRect.height <= 0) {
    return {
      status: 'TARGET_NOT_FOUND',
      canClick: false,
      clickPoint: null,
      strategy: 'NONE',
      scrolledToSafeBand,
      safeBand,
      targetRect: null,
      fivePointResult: null,
      polygonResult: null,
      obstacles: [],
      requiresDismissalLadder: false,
      reason: 'Target element could not be measured or has zero dimensions.',
    };
  }

  // Step 2: 5-Point Multi-Sampling Physical Hit-Test
  const fivePointResult = await hitTest5Points(page, currentRect, selectorOrHint, {
    insetPx,
    frame: options.frame,
  });

  // Fast Path: All 5 points cleanly hit the target
  if (fivePointResult.allExposed) {
    const center = fivePointResult.samples[0];
    const clearPoly = subtractObstaclesFromRect(currentRect, [], geomOptions);
    return {
      status: 'CLEAR',
      canClick: true,
      clickPoint: { x: center.x, y: center.y },
      strategy: 'CENTER',
      scrolledToSafeBand,
      safeBand,
      targetRect: currentRect,
      fivePointResult,
      polygonResult: clearPoly,
      obstacles: [],
      requiresDismissalLadder: false,
      reason: scrolledToSafeBand
        ? 'Target scrolled into Safe Viewport Band and all 5 hit-test points are clear.'
        : 'All 5 hit-test points are clear; clicking target center.',
    };
  }

  // Step 3: Collect all occluding obstacles (from 5-point hit-test + overlapping positioned overlays)
  let obstacles = [...fivePointResult.obstacles];
  if (scanOverlapping && selectorOrHint) {
    const extra = await collectAdditionalOverlappingObstacles(
      page,
      currentRect,
      selectorOrHint,
      options.frame
    );
    obstacles = deduplicateObstacles([...obstacles, ...extra]);
  }

  // Handle case where target is simply clipped outside viewport with no DOM obstacle
  if (obstacles.length === 0) {
    if (fivePointResult.centerExposed) {
      const center = fivePointResult.samples[0];
      return {
        status: 'CLEAR',
        canClick: true,
        clickPoint: { x: center.x, y: center.y },
        strategy: 'CENTER',
        scrolledToSafeBand,
        safeBand,
        targetRect: currentRect,
        fivePointResult,
        polygonResult: subtractObstaclesFromRect(currentRect, [], geomOptions),
        obstacles: [],
        requiresDismissalLadder: false,
        reason: 'Center point hits target cleanly.',
      };
    }
    if (fivePointResult.selectedPoint) {
      return {
        status: 'SHIFTED_CORNER',
        canClick: true,
        clickPoint: {
          x: fivePointResult.selectedPoint.x,
          y: fivePointResult.selectedPoint.y,
        },
        strategy: 'SAFE_CORNER',
        scrolledToSafeBand,
        safeBand,
        targetRect: currentRect,
        fivePointResult,
        polygonResult: subtractObstaclesFromRect(currentRect, [], geomOptions),
        obstacles: [],
        requiresDismissalLadder: false,
        reason: `Center unavailable; shifted to exposed corner (${fivePointResult.selectedPoint.source}).`,
      };
    }
    return {
      status: 'FULLY_OCCLUDED',
      canClick: false,
      clickPoint: null,
      strategy: 'NONE',
      scrolledToSafeBand,
      safeBand,
      targetRect: currentRect,
      fivePointResult,
      polygonResult: null,
      obstacles: [],
      requiresDismissalLadder: true,
      reason: 'All 5 sample points failed hit-test and target is unreachable in viewport.',
    };
  }

  // Step 4: Sutherland-Hodgman Polygon Subtraction & Centroid Verification (up to 2 refinement passes)
  let polygonResult = subtractObstaclesFromRect(
    currentRect,
    obstacles.map((o) => o.rect),
    geomOptions
  );

  for (let refine = 0; refine < 2; refine++) {
    if (polygonResult.status === 'EXPOSED_CLICKABLE' && polygonResult.centroid) {
      const centroidHit = await hitTestPoint(
        page,
        polygonResult.centroid,
        selectorOrHint,
        { frame: options.frame, targetRect: currentRect }
      );

      if (centroidHit.hitsTarget) {
        return {
          status: 'SHIFTED_CENTROID',
          canClick: true,
          clickPoint: polygonResult.centroid,
          strategy: 'POLYGON_CENTROID',
          scrolledToSafeBand,
          safeBand,
          targetRect: currentRect,
          fivePointResult,
          polygonResult,
          obstacles,
          requiresDismissalLadder: false,
          reason: `Partial occlusion handled via Sutherland-Hodgman centroid (${Math.round(polygonResult.centroid.x)}, ${Math.round(polygonResult.centroid.y)}); ${polygonResult.reason}`,
        };
      }

      // If centroid hit a newly discovered obstacle, subtract it too and re-evaluate once
      if (centroidHit.occludedBy) {
        const beforeLen = obstacles.length;
        obstacles = deduplicateObstacles([...obstacles, centroidHit.occludedBy]);
        if (obstacles.length > beforeLen) {
          polygonResult = subtractObstaclesFromRect(
            currentRect,
            obstacles.map((o) => o.rect),
            geomOptions
          );
          continue;
        }
      }

      // Centroid hit-test failed without a new obstacle -> fallback to verified exposed corner from 5-point
      if (fivePointResult.selectedPoint) {
        return {
          status: fivePointResult.centerExposed ? 'CLEAR' : 'SHIFTED_CORNER',
          canClick: true,
          clickPoint: {
            x: fivePointResult.selectedPoint.x,
            y: fivePointResult.selectedPoint.y,
          },
          strategy: fivePointResult.centerExposed ? 'CENTER' : 'SAFE_CORNER',
          scrolledToSafeBand,
          safeBand,
          targetRect: currentRect,
          fivePointResult,
          polygonResult,
          obstacles,
          requiresDismissalLadder: false,
          reason: `Centroid verification blocked; falling back to verified 5-point safe coordinate (${fivePointResult.selectedPoint.source}).`,
        };
      }
      break;
    }
    break;
  }

  // Handle tiny elements (< 24x24 original size) whose center is genuinely exposed
  const isTinyElement = currentRect.width < minW || currentRect.height < minH;
  if (isTinyElement && fivePointResult.centerExposed) {
    const center = fivePointResult.samples[0];
    return {
      status: 'CLEAR',
      canClick: true,
      clickPoint: { x: center.x, y: center.y },
      strategy: 'CENTER',
      scrolledToSafeBand,
      safeBand,
      targetRect: currentRect,
      fivePointResult,
      polygonResult,
      obstacles,
      requiresDismissalLadder: false,
      reason: 'Compact target (<24px) has an unobstructed center point.',
    };
  }

  if (polygonResult.status === 'CLEAR') {
    if (fivePointResult.selectedPoint) {
      return {
        status: fivePointResult.centerExposed ? 'CLEAR' : 'SHIFTED_CORNER',
        canClick: true,
        clickPoint: {
          x: fivePointResult.selectedPoint.x,
          y: fivePointResult.selectedPoint.y,
        },
        strategy: fivePointResult.centerExposed ? 'CENTER' : 'SAFE_CORNER',
        scrolledToSafeBand,
        safeBand,
        targetRect: currentRect,
        fivePointResult,
        polygonResult,
        obstacles,
        requiresDismissalLadder: false,
        reason: `Selected verified 5-point safe coordinate (${fivePointResult.selectedPoint.source}).`,
      };
    }
  }

  const finalStatus: SafeClickStatus =
    polygonResult.status === 'FULLY_OCCLUDED'
      ? 'FULLY_OCCLUDED'
      : 'INSUFFICIENT_EXPOSED_AREA';

  return {
    status: finalStatus,
    canClick: false,
    clickPoint: null,
    strategy: 'NONE',
    scrolledToSafeBand,
    safeBand,
    targetRect: currentRect,
    fivePointResult,
    polygonResult,
    obstacles,
    requiresDismissalLadder: true,
    reason: `${finalStatus}: ${polygonResult.reason} Obstacles: ${obstacles.map((o) => o.descriptor).join(', ')}.`,
  };
}

/**
 * Executes a 100% genuine physical click (`isTrusted: true`) via Playwright's
 * CDP mouse input pipeline after resolving a safe click point through the
 * Safe Viewport Band, 5-Point Hit-Tester, and Sutherland-Hodgman Centroid engine.
 * NEVER uses JS synthetic `element.click()` bypass.
 */
export async function executeTrustedSafeClick(
  page: Page,
  rect: Rect | null,
  selectorOrHint?: Locator | string | DOMCandidate,
  options: ResolveSafeClickPointOptions = {}
): Promise<TrustedClickResult> {
  const resolution = await resolveSafeClickPoint(page, rect, selectorOrHint, options);

  if (!resolution.canClick || !resolution.clickPoint) {
    return {
      clicked: false,
      clickPoint: null,
      resolution,
    };
  }

  await page.mouse.move(resolution.clickPoint.x, resolution.clickPoint.y);
  await page.mouse.click(resolution.clickPoint.x, resolution.clickPoint.y);

  return {
    clicked: true,
    clickPoint: resolution.clickPoint,
    resolution,
  };
}
