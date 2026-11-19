import { Page } from 'playwright';

/**
 * TRỤ CỘT 16: NAMELESS SVG ICON TOPOLOGY & SPATIAL BOUNDARY RESOLUTION
 * Chuẩn tham chiếu: Google SVG Path Fingerprinting & Microsoft Boundary Proximity
 *
 * Khả năng cốt lõi:
 * 1. Vector Path Geometry Normalizer:
 *    - Phân tích đầy đủ lệnh SVG path (M/m, L/l, H/h, V/v, C/c, S/s, Q/q, T/t, A/a, Z/z)
 *      và hình học cơ bản (<line>, <rect>, <circle>, <ellipse>, <polyline>, <polygon>).
 *    - Chuẩn hóa toàn bộ tọa độ về không gian quy chuẩn [0, 24] x [0, 24] độc lập viewBox.
 * 2. Structural Signature Bank (Phân loại hình học thuần túy, không so khớp chuỗi thô):
 *    - Hamburger Menu, Chevron-Left/Right/Fold/Collapse, Sidebar Layout Column,
 *      Close (X), Search (Magnifying Glass), Settings (Gear).
 *    - Sinh nhãn ngữ nghĩa ảo song ngữ Việt-Anh (virtualLabel).
 * 3. Spatial Boundary Proximity Topology:
 *    - Đo khoảng cách biên tới Sidebar (<aside>, nav, [role="navigation"], .sidebar, .ant-layout-sider).
 *    - <= 25px hoặc góc trên-trái (x < 80px && y < 80px) -> Context: "Sidebar Boundary Control".
 * 4. ARIA State Dynamic Mapping:
 *    - Khai thác aria-expanded ("true"/"false") và aria-controls để phân định thu gọn vs mở rộng.
 * 5. Synthetic Hover Tooltip Trap:
 *    - Kích hoạt hover giả lập để thu hoạch [role="tooltip"], aria-describedby, title, data-tooltip, data-tip, .sr-only.
 * 6. Công thức 4 trọng số & Safety Margin:
 *    - Score_SVG = 0.4 * S_vector + 0.3 * S_spatial + 0.2 * S_aria_state + 0.1 * S_tooltip
 *    - Yêu cầu Score >= 0.85 (85%) VÀ Delta_margin >= 0.20 (20%) mới cho phép tự động click an toàn.
 */

// ============================================================================
// CONSTANTS & DATA CONTRACTS
// ============================================================================

export const SVG_CANONICAL_SIZE = 24;
export const SVG_SIDEBAR_PROXIMITY_PX = 25;
export const SVG_TOP_LEFT_THRESHOLD_PX = 80;
export const SVG_AUTO_CLICK_MIN_SCORE = 0.85;
export const SVG_AUTO_CLICK_MIN_MARGIN = 0.20;

export const SVG_SCORE_WEIGHTS = {
  vector: 0.4,
  spatial: 0.3,
  aria: 0.2,
  tooltip: 0.1,
} as const;

export const SIDEBAR_CONTAINER_SELECTORS: string[] = [
  'aside',
  'nav',
  '[role="navigation"]',
  '.sidebar',
  '.ant-layout-sider',
  '[class*="sidebar"]',
  '[class*="sider"]',
  '[data-sidebar]',
];

export type SvgIconFamily =
  | 'hamburger'
  | 'chevron_left'
  | 'chevron_right'
  | 'sidebar_layout'
  | 'close'
  | 'search'
  | 'settings'
  | 'unknown';

export type SvgIntentCategory =
  | 'collapse'
  | 'expand'
  | 'menu_open'
  | 'search'
  | 'close'
  | 'settings'
  | 'unknown';

export interface Point2D {
  x: number;
  y: number;
}

export interface BoundingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GeometryBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export interface SvgPrimitiveInput {
  tag: 'path' | 'line' | 'rect' | 'circle' | 'ellipse' | 'polyline' | 'polygon';
  d?: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rx?: number;
  ry?: number;
  cx?: number;
  cy?: number;
  r?: number;
  points?: string;
  transform?: string;
  fill?: string;
  stroke?: string;
}

export interface SvgRawGeometry {
  viewBox?: string | [number, number, number, number];
  width?: number;
  height?: number;
  primitives: SvgPrimitiveInput[];
}

export interface NormalizedSegment {
  p1: Point2D;
  p2: Point2D;
  length: number;
  angleDeg: number; // Undirected [0, 180)
  directedAngleDeg: number; // (-180, 180]
  kind: 'line' | 'curve' | 'arc';
}

export interface NormalizedSubpath {
  points: Point2D[];
  vertices: Point2D[];
  segments: NormalizedSegment[];
  closed: boolean;
  sourceTag: SvgPrimitiveInput['tag'];
  bbox: GeometryBBox;
  perimeter: number;
  area: number;
  circularity: number;
  isCircular: boolean;
  circleRadius?: number;
  isRectangular: boolean;
  hasCurves: boolean;
  hasArcs: boolean;
  isHorizontalBar: boolean;
  isVerticalBar: boolean;
  isDiagonalBar: boolean;
  diagonalAngleDeg?: number;
  diagonalEndpoints?: [Point2D, Point2D];
}

export interface NormalizedSvgGeometry {
  canonicalSize: number;
  sourceViewBox: [number, number, number, number] | null;
  subpaths: NormalizedSubpath[];
  overallBBox: GeometryBBox;
  totalPoints: number;
}

export interface SvgSignatureMatch {
  family: SvgIconFamily;
  confidence: number; // [0, 1] geometric match confidence
  virtualLabel: string;
  aliases: string[];
  subDirection?: 'left' | 'right' | 'toggle';
  features: {
    subpathCount: number;
    horizontalBarCount: number;
    verticalBarCount: number;
    diagonalBarCount: number;
    circleCount: number;
    rectCount: number;
    chevronDirection?: 'left' | 'right';
    chevronCount?: number;
    gearTeethCount?: number;
  };
  reasoning: string;
}

export interface SidebarContainerInfo {
  tag: string;
  id?: string;
  role?: string;
  className?: string;
  rect: BoundingRect;
  isVerticalSidebar?: boolean;
}

export interface SpatialBoundaryResult {
  distanceToSidebarEdge: number; // px, Infinity if no sidebar
  isNearSidebarBoundary: boolean; // <= 25px
  isTopLeftCorner: boolean; // x < 80 && y < 80
  contextTag: string; // e.g. "Sidebar Boundary Control"
  spatialScore: number; // S_spatial in [0, 1]
  nearestSidebar?: SidebarContainerInfo;
  reasoning: string;
}

export interface AriaStateInfo {
  ariaExpanded?: 'true' | 'false' | string | null;
  ariaControls?: string | null;
  ariaControlsTargetsSidebar?: boolean;
  ariaHasPopup?: string | null;
  ariaLabel?: string | null;
  ariaDescribedBy?: string | null;
  ariaPressed?: string | null;
}

export interface AriaStateEvaluation {
  S_aria_state: number; // [0, 1]
  observed: boolean;
  polarity: 'collapse' | 'expand' | 'neutral';
  disambiguatedAction?: 'collapse' | 'expand';
  controlsSidebar: boolean;
  conflict: boolean;
  virtualLabelBoost: string[];
  reasoning: string;
}

export interface HoverTooltipProbeResult {
  found: boolean;
  tooltipText: string;
  source:
    | 'role-tooltip'
    | 'aria-describedby'
    | 'title'
    | 'data-tooltip'
    | 'data-tip'
    | 'sr-only'
    | 'none';
  score: number; // S_tooltip in [0, 1]
}

export interface SvgTopologyScoreBreakdown {
  score: number; // Calibrated 4-weight score in [0, 1]
  rawWeightedScore: number; // Raw 4-weight score (0 for unobserved optional signals)
  weights: {
    vector: number;
    spatial: number;
    aria: number;
    tooltip: number;
  };
  components: {
    S_vector: number;
    S_spatial: number;
    S_aria_state: number;
    S_tooltip: number;
  };
  rawComponents: {
    S_vector: number;
    S_spatial: number;
    S_aria_state: number;
    S_tooltip: number;
    ariaObserved: boolean;
    tooltipObserved: boolean;
  };
  meetsThreshold: boolean; // score >= 0.85
  reasoning: string;
}

export interface SvgIconCandidateInput {
  candidateId: number;
  selector: string;
  tag: string;
  elemId?: string;
  rect: BoundingRect;
  svg: SvgRawGeometry | string;
  sidebars?: SidebarContainerInfo[];
  aria?: AriaStateInfo;
  tooltip?: HoverTooltipProbeResult;
  nearSearchInput?: boolean;
  insideDialog?: boolean;
  insideHeader?: boolean;
  viewport?: { width: number; height: number };
}

export interface ScoredSvgCandidate {
  candidateId: number;
  selector: string;
  tag: string;
  elemId?: string;
  rect: BoundingRect;
  signature: SvgSignatureMatch;
  spatial: SpatialBoundaryResult;
  aria: AriaStateEvaluation;
  tooltip?: HoverTooltipProbeResult;
  scoreBreakdown: SvgTopologyScoreBreakdown;
  virtualLabel: string;
  context: string;
}

export interface SvgResolutionResult {
  status: 'RESOLVED' | 'AMBIGUOUS_MARGIN' | 'LOW_CONFIDENCE' | 'NO_CANDIDATES';
  safeToClick: boolean;
  selectedCandidate: ScoredSvgCandidate | null;
  topScore: number;
  secondScore: number;
  deltaMargin: number;
  virtualLabel: string;
  context: string;
  vectorFamily: SvgIconFamily;
  candidates: ScoredSvgCandidate[];
  reasoning: string;
}

// ============================================================================
// SEMANTIC ALIAS BANK (VIETNAMESE + ENGLISH)
// ============================================================================

export const SVG_SEMANTIC_ALIAS_BANK: Record<
  SvgIconFamily,
  { virtualLabel: string; aliases: string[] }
> = {
  hamburger: {
    virtualLabel: 'menu mở menu điều hướng hamburger navigation sidebar drawer',
    aliases: [
      'menu',
      'mở menu',
      'mo menu',
      'điều hướng',
      'dieu huong',
      'hamburger',
      'navigation',
      'nav',
      'danh mục',
      'danh muc',
      'open menu',
      'toggle menu',
      'sidebar',
    ],
  },
  chevron_left: {
    virtualLabel: 'thu gọn đóng sidebar menu collapse fold ẩn thanh bên chevron left',
    aliases: [
      'thu gọn',
      'thu gon',
      'thu gọn menu',
      'thu gon menu',
      'thu gọn sidebar',
      'thu gon sidebar',
      'đóng sidebar',
      'dong sidebar',
      'đóng menu',
      'dong menu',
      'ẩn sidebar',
      'an sidebar',
      'ẩn menu',
      'an menu',
      'collapse',
      'fold',
      'collapse sidebar',
      'collapse menu',
      'chevron left',
      'back',
      'quay lại',
    ],
  },
  chevron_right: {
    virtualLabel: 'mở rộng mở sidebar menu expand unfold hiện thanh bên chevron right',
    aliases: [
      'mở rộng',
      'mo rong',
      'mở rộng sidebar',
      'mo rong sidebar',
      'mở rộng menu',
      'mo rong menu',
      'mở sidebar',
      'mo sidebar',
      'mở menu',
      'mo menu',
      'hiện sidebar',
      'hien sidebar',
      'expand',
      'unfold',
      'expand sidebar',
      'expand menu',
      'open sidebar',
      'chevron right',
    ],
  },
  sidebar_layout: {
    virtualLabel: 'thu gọn đóng mở rộng sidebar thanh bên menu điều hướng panel layout collapse toggle',
    aliases: [
      'thu gọn',
      'thu gon',
      'thu gọn menu',
      'thu gọn sidebar',
      'đóng sidebar',
      'dong sidebar',
      'đóng menu',
      'mở rộng sidebar',
      'mở sidebar',
      'mở menu',
      'sidebar',
      'thanh bên',
      'thanh ben',
      'panel',
      'layout',
      'collapse',
      'expand',
      'toggle sidebar',
      'fold',
    ],
  },
  close: {
    virtualLabel: 'đóng close thoát tắt x dismiss modal popup dialog',
    aliases: [
      'đóng',
      'dong',
      'close',
      'thoát',
      'thoat',
      'tắt',
      'tat',
      'x',
      'dismiss',
      'đóng popup',
      'đóng modal',
      'đóng hộp thoại',
      'tắt thông báo',
      'close modal',
      'close dialog',
    ],
  },
  search: {
    virtualLabel: 'tìm kiếm search kính lúp tra cứu find lookup magnifying glass',
    aliases: [
      'tìm kiếm',
      'tim kiem',
      'tìm',
      'tim',
      'search',
      'kính lúp',
      'kinh lup',
      'tra cứu',
      'tra cuu',
      'find',
      'lookup',
      'magnifying glass',
      'query',
    ],
  },
  settings: {
    virtualLabel: 'cài đặt settings thiết lập cấu hình tùy chọn gear cog preferences',
    aliases: [
      'cài đặt',
      'cai dat',
      'settings',
      'setting',
      'thiết lập',
      'thiet lap',
      'cấu hình',
      'cau hinh',
      'tùy chọn',
      'tuy chon',
      'gear',
      'cog',
      'bánh răng',
      'banh rang',
      'preferences',
      'config',
      'options',
    ],
  },
  unknown: {
    virtualLabel: '',
    aliases: [],
  },
};

// ============================================================================
// LIGHTWEIGHT TEXT NORMALIZATION (SELF-CONTAINED, ZERO CIRCULAR DEPS)
// ============================================================================

function stripVietnameseDiacritics(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function normalizeQueryText(str: string | undefined | null): string {
  if (!str) return '';
  return str.toLowerCase().replace(/["'“”‘’]/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripActionVerbs(normText: string): string {
  return normText
    .replace(/^(bấm|bam|nhấn|nhan|click|tap|chọn|chon|ấn|an)\s+/i, '')
    .replace(/^(vào|vao|nút|nut|button|btn|icon|biểu tượng|bieu tuong)\s+/i, '')
    .replace(/^(nút|nut|button|icon|biểu tượng|bieu tuong)\s+/i, '')
    .trim();
}

function computeSimpleSimilarity(a: string, b: string): number {
  const s1 = stripVietnameseDiacritics(normalizeQueryText(a));
  const s2 = stripVietnameseDiacritics(normalizeQueryText(b));
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.includes(s2) || s2.includes(s1)) {
    const ratio = Math.min(s1.length, s2.length) / Math.max(s1.length, s2.length);
    return Math.max(0.85, 0.75 + 0.25 * ratio);
  }
  const t1 = s1.split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  const t2 = s2.split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  if (t1.length === 0 || t2.length === 0) return 0;
  let shared = 0;
  for (const w of t1) {
    if (t2.includes(w)) shared++;
  }
  if (shared === 0) return 0;
  const overlapMax = shared / Math.min(t1.length, t2.length);
  const jaccard = shared / new Set([...t1, ...t2]).size;
  return Math.min(1, 0.5 * overlapMax + 0.5 * jaccard);
}

/**
 * Phân loại ý định người dùng từ câu lệnh tiếng Việt / tiếng Anh
 */
export function inferSvgTargetIntent(targetHint: string): {
  intent: SvgIntentCategory;
  cleanedHint: string;
  mentionsSidebarOrMenu: boolean;
} {
  const raw = normalizeQueryText(targetHint);
  const cleaned = stripActionVerbs(raw);
  const noAcc = stripVietnameseDiacritics(cleaned);

  const mentionsSidebarOrMenu =
    /\b(sidebar|sider|menu|thanh ben|dieu huong|navigation|nav|drawer|panel|cot trai|left panel)\b/.test(
      noAcc
    );

  // 1. Search (Tìm kiếm / Kính lúp)
  if (/\b(tim kiem|search|kinh lup|tra cuu|find|lookup|magnifying)\b/.test(noAcc)) {
    return { intent: 'search', cleanedHint: cleaned, mentionsSidebarOrMenu };
  }

  // 2. Settings (Cài đặt / Thiết lập / Bánh răng)
  if (
    /\b(cai dat|settings?|thiet lap|cau hinh|tuy chon|preferences?|config|gear|cog|banh rang)\b/.test(
      noAcc
    )
  ) {
    return { intent: 'settings', cleanedHint: cleaned, mentionsSidebarOrMenu };
  }

  // 3. Collapse / Fold Sidebar or Menu ("Thu gọn menu", "Đóng sidebar", "Ẩn menu")
  if (
    /\b(thu gon|collapse|fold|an sidebar|an menu|hide sidebar|hide menu|thu nho)\b/.test(noAcc) ||
    (/\b(dong|close|an|hide)\b/.test(noAcc) && mentionsSidebarOrMenu)
  ) {
    return { intent: 'collapse', cleanedHint: cleaned, mentionsSidebarOrMenu: true };
  }

  // 4. Expand / Unfold Sidebar ("Mở rộng sidebar", "Mở rộng menu", "Mở sidebar", "Expand")
  if (
    /\b(mo rong|expand|unfold|hien sidebar|show sidebar|open sidebar|mo sidebar)\b/.test(noAcc)
  ) {
    return { intent: 'expand', cleanedHint: cleaned, mentionsSidebarOrMenu: true };
  }

  // 5. Open Menu / Hamburger ("Mở menu", "Hamburger", "Menu", "Điều hướng")
  if (
    /\b(hamburger|mo menu|open menu|toggle menu|dieu huong|navigation)\b/.test(noAcc) ||
    noAcc === 'menu' ||
    noAcc === 'sidebar' ||
    /\b(menu)\b/.test(noAcc)
  ) {
    return { intent: 'menu_open', cleanedHint: cleaned, mentionsSidebarOrMenu: true };
  }

  // 6. Close (Đóng / Close / Tắt / Thoát / X — không gắn sidebar)
  if (/\b(dong|close|thoat|tat|dismiss|cancel|huy)\b/.test(noAcc) || noAcc === 'x') {
    return { intent: 'close', cleanedHint: cleaned, mentionsSidebarOrMenu };
  }

  return { intent: 'unknown', cleanedHint: cleaned, mentionsSidebarOrMenu };
}

// ============================================================================
// 1. VECTOR PATH PARSER, TRANSFORM MATRIX & [0, 24] x [0, 24] NORMALIZER
// ============================================================================

type AffineMatrix = [number, number, number, number, number, number]; // [a, b, c, d, e, f]

const IDENTITY_MATRIX: AffineMatrix = [1, 0, 0, 1, 0, 0];

function multiplyMatrix(m1: AffineMatrix, m2: AffineMatrix): AffineMatrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyMatrix(m: AffineMatrix, p: Point2D): Point2D {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}

function parseSvgTransform(transformStr?: string): AffineMatrix {
  if (!transformStr || !transformStr.trim()) return IDENTITY_MATRIX;
  let mat: AffineMatrix = [...IDENTITY_MATRIX];
  const regex = /([a-z]+)\s*\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(transformStr)) !== null) {
    const fn = match[1].toLowerCase();
    const nums = (match[2].match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) || []).map(Number);
    if (fn === 'translate' && nums.length >= 1) {
      const tx = nums[0];
      const ty = nums[1] ?? 0;
      mat = multiplyMatrix(mat, [1, 0, 0, 1, tx, ty]);
    } else if (fn === 'scale' && nums.length >= 1) {
      const sx = nums[0];
      const sy = nums[1] ?? sx;
      mat = multiplyMatrix(mat, [sx, 0, 0, sy, 0, 0]);
    } else if (fn === 'rotate' && nums.length >= 1) {
      const rad = (nums[0] * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      if (nums.length >= 3) {
        const cx = nums[1];
        const cy = nums[2];
        mat = multiplyMatrix(mat, [1, 0, 0, 1, cx, cy]);
        mat = multiplyMatrix(mat, [cos, sin, -sin, cos, 0, 0]);
        mat = multiplyMatrix(mat, [1, 0, 0, 1, -cx, -cy]);
      } else {
        mat = multiplyMatrix(mat, [cos, sin, -sin, cos, 0, 0]);
      }
    } else if (fn === 'matrix' && nums.length >= 6) {
      mat = multiplyMatrix(mat, [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]]);
    }
  }
  return mat;
}

interface RawSubpath {
  points: Point2D[];
  vertices: Point2D[];
  closed: boolean;
  sourceTag: SvgPrimitiveInput['tag'];
  hasCurves: boolean;
  hasArcs: boolean;
}

/**
 * Sample elliptical arc per W3C SVG 1.1 Implementation Notes F.6.5/F.6.6
 */
function sampleEllipticalArc(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  largeArcFlag: number,
  sweepFlag: number,
  x2: number,
  y2: number
): Point2D[] {
  if (Math.hypot(x2 - x1, y2 - y1) < 1e-6) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx < 1e-6 || ry < 1e-6) return [{ x: x2, y: y2 }];

  const phi = (phiDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  // Step 1: Compute (x1', y1')
  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  // Ensure radii are large enough
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  // Step 2: Compute (cx', cy')
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;
  const num = Math.max(0, rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2);
  const den = rx2 * y1p2 + ry2 * x1p2;
  const coef = (largeArcFlag === sweepFlag ? -1 : 1) * Math.sqrt(den > 1e-12 ? num / den : 0);
  const cxp = (coef * (rx * y1p)) / ry;
  const cyp = (coef * -(ry * x1p)) / rx;

  // Step 3: Compute (cx, cy)
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  // Step 4: Compute theta1 and dtheta
  const vecAngle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const cosVal = Math.max(-1, Math.min(1, len > 1e-12 ? dot / len : 1));
    const sign = ux * vy - uy * vx < 0 ? -1 : 1;
    return sign * Math.acos(cosVal);
  };

  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;

  const theta1 = vecAngle(1, 0, ux, uy);
  let dtheta = vecAngle(ux, uy, vx, vy);
  if (sweepFlag === 0 && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweepFlag === 1 && dtheta < 0) dtheta += 2 * Math.PI;

  const steps = Math.max(8, Math.ceil(Math.abs(dtheta) / (Math.PI / 12)));
  const pts: Point2D[] = [];
  for (let i = 1; i <= steps; i++) {
    const angle = theta1 + (dtheta * i) / steps;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    pts.push({
      x: cx + cosPhi * rx * cosA - sinPhi * ry * sinA,
      y: cy + sinPhi * rx * cosA + cosPhi * ry * sinA,
    });
  }
  return pts;
}

/**
 * Phân tích đầy đủ chuỗi thuộc tính `d` trong thẻ `<path>`
 * Hỗ trợ tất cả lệnh: M/m, L/l, H/h, V/v, C/c, S/s, Q/q, T/t, A/a, Z/z
 * (bao gồm định dạng nén không dấu cách như Material Icons / Heroicons).
 */
export function parseSvgPathData(d: string): RawSubpath[] {
  const subpaths: RawSubpath[] = [];
  if (!d || !d.trim()) return subpaths;

  let i = 0;
  const len = d.length;

  const skipSeparators = (): void => {
    while (i < len && (d[i] === ' ' || d[i] === '\t' || d[i] === '\n' || d[i] === '\r' || d[i] === ',')) {
      i++;
    }
  };

  const readNumber = (): number | null => {
    skipSeparators();
    if (i >= len) return null;
    const start = i;
    if (d[i] === '+' || d[i] === '-') i++;
    let hasDigit = false;
    while (i < len && d[i] >= '0' && d[i] <= '9') {
      hasDigit = true;
      i++;
    }
    if (i < len && d[i] === '.') {
      i++;
      while (i < len && d[i] >= '0' && d[i] <= '9') {
        hasDigit = true;
        i++;
      }
    }
    if (!hasDigit) {
      i = start;
      return null;
    }
    if (i < len && (d[i] === 'e' || d[i] === 'E')) {
      const expStart = i;
      i++;
      if (i < len && (d[i] === '+' || d[i] === '-')) i++;
      let expDigits = false;
      while (i < len && d[i] >= '0' && d[i] <= '9') {
        expDigits = true;
        i++;
      }
      if (!expDigits) i = expStart;
    }
    const val = parseFloat(d.slice(start, i));
    return Number.isFinite(val) ? val : null;
  };

  const readArcFlag = (): number | null => {
    skipSeparators();
    if (i < len && (d[i] === '0' || d[i] === '1')) {
      const flag = d[i] === '1' ? 1 : 0;
      i++;
      return flag;
    }
    return null;
  };

  const isCommandChar = (ch: string): boolean => /[MmLlHhVvCcSsQqTtAaZz]/.test(ch);

  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;
  let lastCmd = '';
  let lastCubicCtrl: Point2D | null = null;
  let lastQuadCtrl: Point2D | null = null;
  let current: RawSubpath | null = null;

  const commitCurrent = (): void => {
    if (current && current.points.length >= 2) {
      subpaths.push(current);
    }
    current = null;
  };

  const ensureSubpath = (): RawSubpath => {
    if (!current) {
      current = {
        points: [{ x: curX, y: curY }],
        vertices: [{ x: curX, y: curY }],
        closed: false,
        sourceTag: 'path',
        hasCurves: false,
        hasArcs: false,
      };
    }
    return current;
  };

  const addPoint = (x: number, y: number, isVertex: boolean): void => {
    const sp = ensureSubpath();
    const last = sp.points[sp.points.length - 1];
    if (!last || Math.hypot(x - last.x, y - last.y) > 1e-5) {
      sp.points.push({ x, y });
    }
    if (isVertex) {
      const lastV = sp.vertices[sp.vertices.length - 1];
      if (!lastV || Math.hypot(x - lastV.x, y - lastV.y) > 1e-5) {
        sp.vertices.push({ x, y });
      }
    }
  };

  let activeCmd = '';
  while (i < len) {
    skipSeparators();
    if (i >= len) break;

    if (isCommandChar(d[i])) {
      activeCmd = d[i];
      i++;
    } else if (!activeCmd) {
      i++;
      continue;
    }

    const cmd = activeCmd;
    const isRel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();

    if (upper === 'Z') {
      if (current) {
        const sp: RawSubpath = current;
        if (Math.hypot(startX - curX, startY - curY) > 1e-5) {
          sp.points.push({ x: startX, y: startY });
        }
        sp.closed = true;
        commitCurrent();
      }
      curX = startX;
      curY = startY;
      lastCubicCtrl = null;
      lastQuadCtrl = null;
      lastCmd = cmd;
      activeCmd = '';
      continue;
    }

    if (upper === 'M') {
      const x = readNumber();
      const y = readNumber();
      if (x === null || y === null) {
        activeCmd = '';
        continue;
      }
      commitCurrent();
      curX = isRel ? curX + x : x;
      curY = isRel ? curY + y : y;
      startX = curX;
      startY = curY;
      current = {
        points: [{ x: curX, y: curY }],
        vertices: [{ x: curX, y: curY }],
        closed: false,
        sourceTag: 'path',
        hasCurves: false,
        hasArcs: false,
      };
      lastCubicCtrl = null;
      lastQuadCtrl = null;
      lastCmd = cmd;
      // Subsequent coordinate pairs after M/m are implicit L/l
      activeCmd = isRel ? 'l' : 'L';
      continue;
    }

    if (upper === 'L') {
      const x = readNumber();
      const y = readNumber();
      if (x === null || y === null) {
        activeCmd = '';
        continue;
      }
      curX = isRel ? curX + x : x;
      curY = isRel ? curY + y : y;
      addPoint(curX, curY, true);
      lastCubicCtrl = null;
      lastQuadCtrl = null;
      lastCmd = cmd;
      continue;
    }

    if (upper === 'H') {
      const x = readNumber();
      if (x === null) {
        activeCmd = '';
        continue;
      }
      curX = isRel ? curX + x : x;
      addPoint(curX, curY, true);
      lastCubicCtrl = null;
      lastQuadCtrl = null;
      lastCmd = cmd;
      continue;
    }

    if (upper === 'V') {
      const y = readNumber();
      if (y === null) {
        activeCmd = '';
        continue;
      }
      curY = isRel ? curY + y : y;
      addPoint(curX, curY, true);
      lastCubicCtrl = null;
      lastQuadCtrl = null;
      lastCmd = cmd;
      continue;
    }

    if (upper === 'C') {
      const x1 = readNumber();
      const y1 = readNumber();
      const x2 = readNumber();
      const y2 = readNumber();
      const x = readNumber();
      const y = readNumber();
      if (x1 === null || y1 === null || x2 === null || y2 === null || x === null || y === null) {
        activeCmd = '';
        continue;
      }
      const p0x = curX;
      const p0y = curY;
      const c1x = isRel ? curX + x1 : x1;
      const c1y = isRel ? curY + y1 : y1;
      const c2x = isRel ? curX + x2 : x2;
      const c2y = isRel ? curY + y2 : y2;
      const ex = isRel ? curX + x : x;
      const ey = isRel ? curY + y : y;

      const sp = ensureSubpath();
      sp.hasCurves = true;
      const steps = 8;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const mt = 1 - t;
        const px =
          mt * mt * mt * p0x + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * ex;
        const py =
          mt * mt * mt * p0y + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * ey;
        addPoint(px, py, s === steps);
      }
      curX = ex;
      curY = ey;
      lastCubicCtrl = { x: c2x, y: c2y };
      lastQuadCtrl = null;
      lastCmd = cmd;
      continue;
    }

    if (upper === 'S') {
      const x2 = readNumber();
      const y2 = readNumber();
      const x = readNumber();
      const y = readNumber();
      if (x2 === null || y2 === null || x === null || y === null) {
        activeCmd = '';
        continue;
      }
      const p0x = curX;
      const p0y = curY;
      const prevWasCubic = /[CcSs]/.test(lastCmd);
      const c1x: number = prevWasCubic && lastCubicCtrl ? 2 * curX - lastCubicCtrl.x : curX;
      const c1y: number = prevWasCubic && lastCubicCtrl ? 2 * curY - lastCubicCtrl.y : curY;
      const c2x = isRel ? curX + x2 : x2;
      const c2y = isRel ? curY + y2 : y2;
      const ex = isRel ? curX + x : x;
      const ey = isRel ? curY + y : y;

      const sp = ensureSubpath();
      sp.hasCurves = true;
      const steps = 8;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const mt = 1 - t;
        const px =
          mt * mt * mt * p0x + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * ex;
        const py =
          mt * mt * mt * p0y + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * ey;
        addPoint(px, py, s === steps);
      }
      curX = ex;
      curY = ey;
      lastCubicCtrl = { x: c2x, y: c2y };
      lastQuadCtrl = null;
      lastCmd = cmd;
      continue;
    }

    if (upper === 'Q') {
      const x1 = readNumber();
      const y1 = readNumber();
      const x = readNumber();
      const y = readNumber();
      if (x1 === null || y1 === null || x === null || y === null) {
        activeCmd = '';
        continue;
      }
      const p0x = curX;
      const p0y = curY;
      const cx = isRel ? curX + x1 : x1;
      const cy = isRel ? curY + y1 : y1;
      const ex = isRel ? curX + x : x;
      const ey = isRel ? curY + y : y;

      const sp = ensureSubpath();
      sp.hasCurves = true;
      const steps = 8;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const mt = 1 - t;
        const px = mt * mt * p0x + 2 * mt * t * cx + t * t * ex;
        const py = mt * mt * p0y + 2 * mt * t * cy + t * t * ey;
        addPoint(px, py, s === steps);
      }
      curX = ex;
      curY = ey;
      lastQuadCtrl = { x: cx, y: cy };
      lastCubicCtrl = null;
      lastCmd = cmd;
      continue;
    }

    if (upper === 'T') {
      const x = readNumber();
      const y = readNumber();
      if (x === null || y === null) {
        activeCmd = '';
        continue;
      }
      const p0x = curX;
      const p0y = curY;
      const prevWasQuad = /[QqTt]/.test(lastCmd);
      const cx: number = prevWasQuad && lastQuadCtrl ? 2 * curX - lastQuadCtrl.x : curX;
      const cy: number = prevWasQuad && lastQuadCtrl ? 2 * curY - lastQuadCtrl.y : curY;
      const ex = isRel ? curX + x : x;
      const ey = isRel ? curY + y : y;

      const sp = ensureSubpath();
      sp.hasCurves = true;
      const steps = 8;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const mt = 1 - t;
        const px = mt * mt * p0x + 2 * mt * t * cx + t * t * ex;
        const py = mt * mt * p0y + 2 * mt * t * cy + t * t * ey;
        addPoint(px, py, s === steps);
      }
      curX = ex;
      curY = ey;
      lastQuadCtrl = { x: cx, y: cy };
      lastCubicCtrl = null;
      lastCmd = cmd;
      continue;
    }

    if (upper === 'A') {
      const rx = readNumber();
      const ry = readNumber();
      const rot = readNumber();
      const largeArc = readArcFlag();
      const sweep = readArcFlag();
      const x = readNumber();
      const y = readNumber();
      if (
        rx === null ||
        ry === null ||
        rot === null ||
        largeArc === null ||
        sweep === null ||
        x === null ||
        y === null
      ) {
        activeCmd = '';
        continue;
      }
      const ex = isRel ? curX + x : x;
      const ey = isRel ? curY + y : y;
      const sp = ensureSubpath();
      sp.hasArcs = true;
      sp.hasCurves = true;
      const arcPts = sampleEllipticalArc(curX, curY, rx, ry, rot, largeArc, sweep, ex, ey);
      for (let k = 0; k < arcPts.length; k++) {
        addPoint(arcPts[k].x, arcPts[k].y, k === arcPts.length - 1);
      }
      curX = ex;
      curY = ey;
      lastCubicCtrl = null;
      lastQuadCtrl = null;
      lastCmd = cmd;
      continue;
    }

    activeCmd = '';
  }

  commitCurrent();
  return subpaths;
}

function parsePointsList(pointsStr: string): Point2D[] {
  const nums = (pointsStr.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) || []).map(Number);
  const pts: Point2D[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push({ x: nums[i], y: nums[i + 1] });
  }
  return pts;
}

function parsePrimitiveToRawSubpaths(prim: SvgPrimitiveInput): RawSubpath[] {
  const mat = parseSvgTransform(prim.transform);
  const xform = (pts: Point2D[]): Point2D[] => pts.map((p) => applyMatrix(mat, p));

  if (prim.tag === 'path' && prim.d) {
    const raw = parseSvgPathData(prim.d);
    return raw.map((sp) => ({
      ...sp,
      points: xform(sp.points),
      vertices: xform(sp.vertices),
    }));
  }

  if (prim.tag === 'line') {
    const p1 = { x: prim.x1 ?? 0, y: prim.y1 ?? 0 };
    const p2 = { x: prim.x2 ?? 0, y: prim.y2 ?? 0 };
    const pts = xform([p1, p2]);
    return [
      {
        points: pts,
        vertices: pts,
        closed: false,
        sourceTag: 'line',
        hasCurves: false,
        hasArcs: false,
      },
    ];
  }

  if (prim.tag === 'rect') {
    const x = prim.x ?? 0;
    const y = prim.y ?? 0;
    const w = prim.width ?? 0;
    const h = prim.height ?? 0;
    if (w <= 0 || h <= 0) return [];
    const corners: Point2D[] = [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
      { x, y },
    ];
    const pts = xform(corners);
    return [
      {
        points: pts,
        vertices: pts.slice(0, 4),
        closed: true,
        sourceTag: 'rect',
        hasCurves: (prim.rx ?? 0) > 0 || (prim.ry ?? 0) > 0,
        hasArcs: false,
      },
    ];
  }

  if (prim.tag === 'circle' || prim.tag === 'ellipse') {
    const cx = prim.cx ?? 0;
    const cy = prim.cy ?? 0;
    const rx = prim.tag === 'circle' ? prim.r ?? 0 : prim.rx ?? prim.r ?? 0;
    const ry = prim.tag === 'circle' ? prim.r ?? 0 : prim.ry ?? prim.r ?? 0;
    if (rx <= 0 || ry <= 0) return [];
    const steps = 32;
    const pts: Point2D[] = [];
    for (let s = 0; s <= steps; s++) {
      const a = (s / steps) * Math.PI * 2;
      pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
    const tPts = xform(pts);
    return [
      {
        points: tPts,
        vertices: tPts.slice(0, steps),
        closed: true,
        sourceTag: prim.tag,
        hasCurves: true,
        hasArcs: true,
      },
    ];
  }

  if (prim.tag === 'polyline' || prim.tag === 'polygon') {
    const pts = parsePointsList(prim.points || '');
    if (pts.length < 2) return [];
    const closed = prim.tag === 'polygon';
    const fullPts = closed ? [...pts, pts[0]] : pts;
    const tPts = xform(fullPts);
    return [
      {
        points: tPts,
        vertices: xform(pts),
        closed,
        sourceTag: prim.tag,
        hasCurves: false,
        hasArcs: false,
      },
    ];
  }

  return [];
}

/**
 * Phân tích markup `<svg>...</svg>` thành cấu trúc SvgRawGeometry (chạy thuần Node.js không cần DOM).
 */
export function parseSvgMarkup(svgMarkup: string): SvgRawGeometry {
  const attrVal = (tagAttrs: string, name: string): string | undefined => {
    const rx = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
    const m = rx.exec(tagAttrs);
    return m ? (m[1] ?? m[2]) : undefined;
  };
  const numVal = (tagAttrs: string, name: string): number | undefined => {
    const v = attrVal(tagAttrs, name);
    if (v === undefined) return undefined;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const svgOpen = /<svg\b([^>]*)>/i.exec(svgMarkup);
  const svgAttrs = svgOpen ? svgOpen[1] : '';
  const viewBox = attrVal(svgAttrs, 'viewBox');
  const width = numVal(svgAttrs, 'width');
  const height = numVal(svgAttrs, 'height');
  const svgFill = attrVal(svgAttrs, 'fill');
  const svgStroke = attrVal(svgAttrs, 'stroke');

  const primitives: SvgPrimitiveInput[] = [];
  // Track nested <g> transform, fill, and stroke inheritance stacks
  const transformStack: string[] = [];
  const fillStack: (string | undefined)[] = [svgFill];
  const strokeStack: (string | undefined)[] = [svgStroke];
  const tokenRegex = /<(\/?)(g|path|line|rect|circle|ellipse|polyline|polygon)\b([^>]*?)(\/?)>/gi;
  let m: RegExpExecArray | null;

  const inheritedVal = (stack: (string | undefined)[]): string | undefined => {
    for (let idx = stack.length - 1; idx >= 0; idx--) {
      if (stack[idx] !== undefined) return stack[idx];
    }
    return undefined;
  };

  while ((m = tokenRegex.exec(svgMarkup)) !== null) {
    const isClose = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    const isSelfClosing = m[4] === '/';

    if (tag === 'g') {
      if (isClose) {
        transformStack.pop();
        if (fillStack.length > 1) fillStack.pop();
        if (strokeStack.length > 1) strokeStack.pop();
      } else if (!isSelfClosing) {
        transformStack.push(attrVal(attrs, 'transform') || '');
        fillStack.push(attrVal(attrs, 'fill'));
        strokeStack.push(attrVal(attrs, 'stroke'));
      }
      continue;
    }

    if (isClose) continue;

    const ownTransform = attrVal(attrs, 'transform') || '';
    const combinedTransform = [...transformStack, ownTransform].filter(Boolean).join(' ').trim() || undefined;
    const fill = attrVal(attrs, 'fill') ?? inheritedVal(fillStack);
    const stroke = attrVal(attrs, 'stroke') ?? inheritedVal(strokeStack);

    if (tag === 'path') {
      const d = attrVal(attrs, 'd');
      if (d) primitives.push({ tag: 'path', d, transform: combinedTransform, fill, stroke });
    } else if (tag === 'line') {
      primitives.push({
        tag: 'line',
        x1: numVal(attrs, 'x1') ?? 0,
        y1: numVal(attrs, 'y1') ?? 0,
        x2: numVal(attrs, 'x2') ?? 0,
        y2: numVal(attrs, 'y2') ?? 0,
        transform: combinedTransform,
        fill,
        stroke,
      });
    } else if (tag === 'rect') {
      primitives.push({
        tag: 'rect',
        x: numVal(attrs, 'x') ?? 0,
        y: numVal(attrs, 'y') ?? 0,
        width: numVal(attrs, 'width') ?? 0,
        height: numVal(attrs, 'height') ?? 0,
        rx: numVal(attrs, 'rx'),
        ry: numVal(attrs, 'ry'),
        transform: combinedTransform,
        fill,
        stroke,
      });
    } else if (tag === 'circle') {
      primitives.push({
        tag: 'circle',
        cx: numVal(attrs, 'cx') ?? 0,
        cy: numVal(attrs, 'cy') ?? 0,
        r: numVal(attrs, 'r') ?? 0,
        transform: combinedTransform,
        fill,
        stroke,
      });
    } else if (tag === 'ellipse') {
      primitives.push({
        tag: 'ellipse',
        cx: numVal(attrs, 'cx') ?? 0,
        cy: numVal(attrs, 'cy') ?? 0,
        rx: numVal(attrs, 'rx') ?? 0,
        ry: numVal(attrs, 'ry') ?? 0,
        transform: combinedTransform,
        fill,
        stroke,
      });
    } else if (tag === 'polyline' || tag === 'polygon') {
      const points = attrVal(attrs, 'points');
      if (points) {
        primitives.push({
          tag,
          points,
          transform: combinedTransform,
          fill,
          stroke,
        });
      }
    }
  }

  return { viewBox, width, height, primitives };
}

function parseViewBoxTuple(
  viewBox?: string | [number, number, number, number]
): [number, number, number, number] | null {
  if (!viewBox) return null;
  if (Array.isArray(viewBox)) {
    if (viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) return viewBox;
    return null;
  }
  const nums = (viewBox.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) || []).map(Number);
  if (nums.length >= 4 && nums[2] > 0 && nums[3] > 0) {
    return [nums[0], nums[1], nums[2], nums[3]];
  }
  return null;
}

function computePointsBBox(points: Point2D[]): GeometryBBox {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, cx: 0, cy: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

function computeShoelaceArea(points: Point2D[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(sum) / 2;
}

function resamplePolyline(points: Point2D[], sampleCount: number): Point2D[] {
  if (points.length < 2 || sampleCount <= 1) return points;
  const cumLen: number[] = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    cumLen.push(total);
  }
  if (total < 1e-6) return [points[0]];

  const out: Point2D[] = [];
  let segIdx = 0;
  for (let k = 0; k < sampleCount; k++) {
    const targetDist = (k / sampleCount) * total;
    while (segIdx < cumLen.length - 2 && cumLen[segIdx + 1] < targetDist) {
      segIdx++;
    }
    const segStart = cumLen[segIdx];
    const segEnd = cumLen[segIdx + 1];
    const t = segEnd > segStart ? (targetDist - segStart) / (segEnd - segStart) : 0;
    const p1 = points[segIdx];
    const p2 = points[segIdx + 1];
    out.push({ x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) });
  }
  return out;
}

function buildNormalizedSubpath(
  raw: RawSubpath,
  transformPt: (p: Point2D) => Point2D
): NormalizedSubpath {
  const points = raw.points.map(transformPt);
  const vertices = raw.vertices.map(transformPt);
  const bbox = computePointsBBox(points);

  // Check implicit closure (first point == last point within tolerance)
  const closed =
    raw.closed ||
    (points.length >= 4 &&
      Math.hypot(
        points[0].x - points[points.length - 1].x,
        points[0].y - points[points.length - 1].y
      ) < 0.35);

  const segments: NormalizedSegment[] = [];
  let perimeter = 0;
  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1];
    const p2 = points[i];
    const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (length < 1e-5) continue;
    perimeter += length;
    const directedRad = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const directedAngleDeg = (directedRad * 180) / Math.PI;
    let angleDeg = directedAngleDeg % 180;
    if (angleDeg < 0) angleDeg += 180;
    segments.push({
      p1,
      p2,
      length,
      angleDeg,
      directedAngleDeg,
      kind: raw.hasArcs ? 'arc' : raw.hasCurves ? 'curve' : 'line',
    });
  }

  const area = closed ? computeShoelaceArea(points) : 0;
  const circularity = closed && perimeter > 1e-4 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;

  // Evaluate circularity via uniform perimeter resampling around bbox center
  let isCircular = false;
  let circleRadius: number | undefined;
  if (closed && bbox.width >= 2.0 && bbox.height >= 2.0) {
    const aspect = Math.min(bbox.width, bbox.height) / Math.max(bbox.width, bbox.height);
    if (raw.sourceTag === 'circle' && aspect >= 0.85) {
      isCircular = true;
      circleRadius = (bbox.width + bbox.height) / 4;
    } else if (aspect >= 0.80 && circularity >= 0.87) {
      const sampled = resamplePolyline(points, 36);
      const radii = sampled.map((p) => Math.hypot(p.x - bbox.cx, p.y - bbox.cy));
      const meanR = radii.reduce((a, b) => a + b, 0) / Math.max(1, radii.length);
      const variance =
        radii.reduce((acc, r) => acc + (r - meanR) * (r - meanR), 0) / Math.max(1, radii.length);
      const cv = meanR > 1e-4 ? Math.sqrt(variance) / meanR : 1;
      if (cv <= 0.085) {
        isCircular = true;
        circleRadius = meanR;
      }
    }
  }

  // Evaluate rectangularity (supports <rect> AND rounded-rect <path>)
  let isRectangular = false;
  if (closed && !isCircular && bbox.width >= 1.0 && bbox.height >= 1.0) {
    const bboxArea = bbox.width * bbox.height;
    const fillRatio = bboxArea > 1e-4 ? area / bboxArea : 0;
    if (raw.sourceTag === 'rect') {
      isRectangular = true;
    } else if (fillRatio >= 0.82 && fillRatio <= 1.05) {
      // Verify majority of perimeter lies along the 4 axis-aligned bounding edges
      const tol = Math.max(0.4, Math.min(bbox.width, bbox.height) * 0.08);
      let edgeLen = 0;
      for (const seg of segments) {
        const mx = (seg.p1.x + seg.p2.x) / 2;
        const my = (seg.p1.y + seg.p2.y) / 2;
        const onVerticalEdge =
          (Math.abs(mx - bbox.minX) <= tol || Math.abs(mx - bbox.maxX) <= tol) &&
          (Math.abs(seg.angleDeg - 90) <= 12);
        const onHorizontalEdge =
          (Math.abs(my - bbox.minY) <= tol || Math.abs(my - bbox.maxY) <= tol) &&
          (seg.angleDeg <= 12 || seg.angleDeg >= 168);
        if (onVerticalEdge || onHorizontalEdge) {
          edgeLen += seg.length;
        }
      }
      if (perimeter > 1e-4 && edgeLen / perimeter >= 0.55) {
        isRectangular = true;
      }
    }
  }

  // Horizontal bar detection (open horizontal segment OR thin closed horizontal bar/pill)
  let isHorizontalBar = false;
  if (!closed && bbox.width >= 3.5 && bbox.height <= Math.max(1.2, bbox.width * 0.14)) {
    isHorizontalBar = true;
  } else if (
    closed &&
    !isCircular &&
    bbox.width >= 4.0 &&
    bbox.height <= 3.8 &&
    bbox.width / Math.max(bbox.height, 0.1) >= 2.8
  ) {
    isHorizontalBar = true;
  }

  // Vertical bar detection (open vertical segment OR thin closed vertical bar/pill)
  let isVerticalBar = false;
  if (!closed && bbox.height >= 3.5 && bbox.width <= Math.max(1.2, bbox.height * 0.14)) {
    isVerticalBar = true;
  } else if (
    closed &&
    !isCircular &&
    bbox.height >= 4.0 &&
    bbox.width <= 3.8 &&
    bbox.height / Math.max(bbox.width, 0.1) >= 2.8
  ) {
    isVerticalBar = true;
  }

  // Diagonal bar detection (single diagonal line or thin rotated rectangle)
  let isDiagonalBar = false;
  let diagonalAngleDeg: number | undefined;
  let diagonalEndpoints: [Point2D, Point2D] | undefined;

  if (!closed && segments.length >= 1) {
    const pStart = points[0];
    const pEnd = points[points.length - 1];
    const chordLen = Math.hypot(pEnd.x - pStart.x, pEnd.y - pStart.y);
    // Nearly straight single diagonal line (not a V-chevron!)
    if (chordLen >= 3.0 && perimeter / Math.max(chordLen, 1e-4) <= 1.08) {
      let ang = (Math.atan2(pEnd.y - pStart.y, pEnd.x - pStart.x) * 180) / Math.PI;
      ang = ((ang % 180) + 180) % 180;
      if ((ang >= 18 && ang <= 72) || (ang >= 108 && ang <= 162)) {
        isDiagonalBar = true;
        diagonalAngleDeg = ang;
        diagonalEndpoints = [pStart, pEnd];
      }
    }
  } else if (closed && !isCircular && !isHorizontalBar && !isVerticalBar && points.length >= 4) {
    // Check for thin filled diagonal bar (e.g., filled magnifying glass handle or X stroke)
    // Find farthest pair of points -> major axis
    let maxDist = 0;
    let fp1 = points[0];
    let fp2 = points[0];
    for (let a = 0; a < points.length; a++) {
      for (let b = a + 1; b < points.length; b++) {
        const d = Math.hypot(points[b].x - points[a].x, points[b].y - points[a].y);
        if (d > maxDist) {
          maxDist = d;
          fp1 = points[a];
          fp2 = points[b];
        }
      }
    }
    if (maxDist >= 3.5) {
      const ux = (fp2.x - fp1.x) / maxDist;
      const uy = (fp2.y - fp1.y) / maxDist;
      let maxPerp = 0;
      for (const p of points) {
        const perp = Math.abs((p.x - fp1.x) * -uy + (p.y - fp1.y) * ux);
        if (perp > maxPerp) maxPerp = perp;
      }
      const thickness = maxPerp * 2;
      if (thickness <= 3.5 && maxDist / Math.max(thickness, 0.1) >= 2.2) {
        let ang = (Math.atan2(fp2.y - fp1.y, fp2.x - fp1.x) * 180) / Math.PI;
        ang = ((ang % 180) + 180) % 180;
        if ((ang >= 18 && ang <= 72) || (ang >= 108 && ang <= 162)) {
          isDiagonalBar = true;
          diagonalAngleDeg = ang;
          diagonalEndpoints = [fp1, fp2];
        }
      }
    }
  }

  return {
    points,
    vertices,
    segments,
    closed,
    sourceTag: raw.sourceTag,
    bbox,
    perimeter,
    area,
    circularity,
    isCircular,
    circleRadius,
    isRectangular,
    hasCurves: raw.hasCurves,
    hasArcs: raw.hasArcs,
    isHorizontalBar,
    isVerticalBar,
    isDiagonalBar,
    diagonalAngleDeg,
    diagonalEndpoints,
  };
}

function isInvisibleSvgPrimitive(prim: SvgPrimitiveInput): boolean {
  const fill = (prim.fill || '').trim().toLowerCase();
  const stroke = (prim.stroke || '').trim().toLowerCase();
  const noFill = fill === 'none' || fill === 'transparent' || fill === 'rgba(0, 0, 0, 0)';
  const noStroke = stroke === 'none' || stroke === 'transparent' || stroke === 'rgba(0, 0, 0, 0)';
  return noFill && noStroke;
}

/**
 * Chuẩn hóa toàn bộ hình học SVG về khung quy chuẩn [0, 24] x [0, 24] độc lập viewBox.
 * Hỗ trợ: viewBox 16x16, 24x24, 32x32, 0 0 1024 1024, viewBox có offset âm/dương, hoặc thiếu viewBox.
 * Tự động loại bỏ các thẻ spacer vô hình (fill="none" stroke="none" như Tabler/Material Icons).
 */
export function normalizeSvgGeometry(input: SvgRawGeometry | string): NormalizedSvgGeometry {
  const rawGeom: SvgRawGeometry = typeof input === 'string' ? parseSvgMarkup(input) : input;
  const rawSubpaths: RawSubpath[] = [];

  for (const prim of rawGeom.primitives) {
    if (isInvisibleSvgPrimitive(prim)) continue;
    rawSubpaths.push(...parsePrimitiveToRawSubpaths(prim));
  }

  const allRawPoints: Point2D[] = [];
  for (const sp of rawSubpaths) {
    for (const p of sp.points) allRawPoints.push(p);
  }

  const vb = parseViewBoxTuple(rawGeom.viewBox);
  const rawBBox = computePointsBBox(allRawPoints);

  let transformPt: (p: Point2D) => Point2D;

  if (vb) {
    const [vbX, vbY, vbW, vbH] = vb;
    const scale = SVG_CANONICAL_SIZE / Math.max(vbW, vbH);
    const offsetX = (SVG_CANONICAL_SIZE - vbW * scale) / 2;
    const offsetY = (SVG_CANONICAL_SIZE - vbH * scale) / 2;
    transformPt = (p: Point2D): Point2D => ({
      x: Math.round(((p.x - vbX) * scale + offsetX) * 10000) / 10000,
      y: Math.round(((p.y - vbY) * scale + offsetY) * 10000) / 10000,
    });
  } else if (
    rawGeom.width &&
    rawGeom.height &&
    rawGeom.width > 0 &&
    rawGeom.height > 0 &&
    rawBBox.minX >= -rawGeom.width * 0.15 &&
    rawBBox.minY >= -rawGeom.height * 0.15 &&
    rawBBox.maxX <= rawGeom.width * 1.15 &&
    rawBBox.maxY <= rawGeom.height * 1.15
  ) {
    const w = rawGeom.width;
    const h = rawGeom.height;
    const scale = SVG_CANONICAL_SIZE / Math.max(w, h);
    const offsetX = (SVG_CANONICAL_SIZE - w * scale) / 2;
    const offsetY = (SVG_CANONICAL_SIZE - h * scale) / 2;
    transformPt = (p: Point2D): Point2D => ({
      x: Math.round((p.x * scale + offsetX) * 10000) / 10000,
      y: Math.round((p.y * scale + offsetY) * 10000) / 10000,
    });
  } else {
    // Missing viewBox & mismatched/missing width/height -> normalize tight bbox into [2, 22] x [2, 22]
    const span = Math.max(rawBBox.width, rawBBox.height, 1e-4);
    const usable = SVG_CANONICAL_SIZE - 4; // 20
    const scale = usable / span;
    const offsetX = (SVG_CANONICAL_SIZE - rawBBox.width * scale) / 2;
    const offsetY = (SVG_CANONICAL_SIZE - rawBBox.height * scale) / 2;
    transformPt = (p: Point2D): Point2D => ({
      x: Math.round(((p.x - rawBBox.minX) * scale + offsetX) * 10000) / 10000,
      y: Math.round(((p.y - rawBBox.minY) * scale + offsetY) * 10000) / 10000,
    });
  }

  const normalizedSubpaths = rawSubpaths.map((sp) => buildNormalizedSubpath(sp, transformPt));
  const allNormPoints: Point2D[] = [];
  for (const sp of normalizedSubpaths) {
    for (const p of sp.points) allNormPoints.push(p);
  }

  return {
    canonicalSize: SVG_CANONICAL_SIZE,
    sourceViewBox: vb,
    subpaths: normalizedSubpaths,
    overallBBox: computePointsBBox(allNormPoints),
    totalPoints: allNormPoints.length,
  };
}

// ============================================================================
// 2. STRUCTURAL SIGNATURE BANK (GEOMETRIC ICON CLASSIFIER)
// ============================================================================

function segmentsIntersectRatio(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D
): { intersects: boolean; t: number; u: number; point?: Point2D } {
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const dbx = b2.x - b1.x;
  const dby = b2.y - b1.y;
  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) < 1e-6) return { intersects: false, t: -1, u: -1 };
  const t = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / denom;
  const u = ((b1.x - a1.x) * day - (b1.y - a1.y) * dax) / denom;
  const intersects = t >= 0.15 && t <= 0.85 && u >= 0.15 && u <= 0.85;
  return {
    intersects,
    t,
    u,
    point: { x: a1.x + t * dax, y: a1.y + t * day },
  };
}

function detectChevronDirection(sp: NormalizedSubpath): 'left' | 'right' | null {
  if (sp.isCircular || sp.isHorizontalBar || sp.isVerticalBar || sp.isDiagonalBar) return null;
  if (sp.bbox.width < 2.0 || sp.bbox.height < 3.5) return null;

  // Case A: Open V-shape chevron (2 diagonal strokes meeting at an apex vertex)
  if (!sp.closed) {
    const start = sp.points[0];
    const end = sp.points[sp.points.length - 1];
    // Find vertex farthest from the line connecting start and end
    const chordDx = end.x - start.x;
    const chordDy = end.y - start.y;
    const chordLen = Math.hypot(chordDx, chordDy);
    if (chordLen < 3.0) return null;

    // Endpoints of a left/right chevron are roughly vertically aligned
    if (Math.abs(chordDx) > Math.max(2.5, sp.bbox.height * 0.3)) return null;

    let apex = sp.points[0];
    let maxPerp = 0;
    for (const p of sp.points) {
      const perp =
        Math.abs((p.x - start.x) * chordDy - (p.y - start.y) * chordDx) / chordLen;
      if (perp > maxPerp) {
        maxPerp = perp;
        apex = p;
      }
    }

    if (maxPerp < 1.8) return null;
    const midY = (start.y + end.y) / 2;
    const midX = (start.x + end.x) / 2;
    // Apex should be vertically centered between the two endpoints
    if (Math.abs(apex.y - midY) > sp.bbox.height * 0.28) return null;

    // Verify 2 arms roughly equal length and straight-ish
    const len1 = Math.hypot(apex.x - start.x, apex.y - start.y);
    const len2 = Math.hypot(end.x - apex.x, end.y - apex.y);
    if (len1 < 2.0 || len2 < 2.0) return null;
    if (Math.min(len1, len2) / Math.max(len1, len2) < 0.65) return null;
    if (sp.perimeter > (len1 + len2) * 1.3) return null;

    if (apex.x < midX - 1.5) return 'left';
    if (apex.x > midX + 1.5) return 'right';
    return null;
  }

  // Case B: Closed filled V-chevron or solid directional triangle (e.g. Material ChevronLeft / Ant Design Fold)
  if (sp.closed && !sp.isRectangular) {
    const { minX, maxX, minY, maxY, width, height, cy } = sp.bbox;
    if (height < 4.0 || width < 2.2) return null;
    if (width > height * 1.35) return null;
    const areaRatio = sp.area / Math.max(width * height, 1e-4);
    if (areaRatio > 0.68 || areaRatio < 0.12) return null;

    const leftTol = minX + width * 0.22;
    const rightTol = maxX - width * 0.22;
    const leftPts = sp.points.filter((p) => p.x <= leftTol);
    const rightPts = sp.points.filter((p) => p.x >= rightTol);
    if (leftPts.length === 0 || rightPts.length === 0) return null;

    const leftYMin = Math.min(...leftPts.map((p) => p.y));
    const leftYMax = Math.max(...leftPts.map((p) => p.y));
    const leftYSpan = leftYMax - leftYMin;
    const leftYMid = (leftYMin + leftYMax) / 2;

    const rightYMin = Math.min(...rightPts.map((p) => p.y));
    const rightYMax = Math.max(...rightPts.map((p) => p.y));
    const rightYSpan = rightYMax - rightYMin;
    const rightYMid = (rightYMin + rightYMax) / 2;

    // Left-pointing: sharp centered tip on left, wide top+bottom spread on right
    if (
      leftYSpan <= height * 0.35 &&
      Math.abs(leftYMid - cy) <= height * 0.22 &&
      rightYSpan >= height * 0.55
    ) {
      return 'left';
    }
    // Right-pointing: sharp centered tip on right, wide top+bottom spread on left
    if (
      rightYSpan <= height * 0.35 &&
      Math.abs(rightYMid - cy) <= height * 0.22 &&
      leftYSpan >= height * 0.55
    ) {
      return 'right';
    }
  }

  return null;
}

function detectFilledCloseX(sp: NormalizedSubpath): boolean {
  if (!sp.closed || sp.isCircular || sp.isRectangular) return false;
  const { minX, maxX, minY, maxY, width, height, cx, cy } = sp.bbox;
  if (width < 6.0 || height < 6.0) return false;
  const aspect = Math.min(width, height) / Math.max(width, height);
  if (aspect < 0.78) return false;

  const areaRatio = sp.area / (width * height);
  if (areaRatio < 0.14 || areaRatio > 0.56) return false;

  const diag = Math.hypot(width, height);
  const cornerTol = diag * 0.2;
  const corners: Point2D[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: minX, y: maxY },
    { x: maxX, y: maxY },
  ];
  const minDistTo = (target: Point2D): number => {
    let best = Infinity;
    for (const p of sp.points) {
      const d = Math.hypot(p.x - target.x, p.y - target.y);
      if (d < best) best = d;
    }
    return best;
  };

  // All 4 corners must be occupied
  if (!corners.every((c) => minDistTo(c) <= cornerTol)) return false;

  // All 4 outer edge midpoints must be EMPTY (distinguishes X from square/circle/plus)
  const edgeMidpoints: Point2D[] = [
    { x: cx, y: minY },
    { x: cx, y: maxY },
    { x: minX, y: cy },
    { x: maxX, y: cy },
  ];
  const emptyTol = Math.min(width, height) * 0.16;
  if (!edgeMidpoints.every((m) => minDistTo(m) >= emptyTol)) return false;

  return true;
}

function countRadialGearTeeth(
  outerSp: NormalizedSubpath,
  cx: number,
  cy: number
): { teethCount: number; amplitudeRatio: number; quadrantsCovered: number } {
  const BINS = 72;
  const maxRByBin = new Array<number>(BINS).fill(-1);
  const sampled = resamplePolyline(outerSp.points, 216);

  for (const p of sampled) {
    let ang = Math.atan2(p.y - cy, p.x - cx); // [-pi, pi]
    if (ang < 0) ang += Math.PI * 2;
    const bin = Math.min(BINS - 1, Math.floor((ang / (Math.PI * 2)) * BINS));
    const r = Math.hypot(p.x - cx, p.y - cy);
    if (r > maxRByBin[bin]) maxRByBin[bin] = r;
  }

  // Fill any empty bins by circular nearest interpolation
  const filled = [...maxRByBin];
  for (let i = 0; i < BINS; i++) {
    if (filled[i] < 0) {
      let left = i;
      let right = i;
      for (let step = 1; step < BINS; step++) {
        if (filled[(i - step + BINS) % BINS] >= 0 && left === i) left = (i - step + BINS) % BINS;
        if (filled[(i + step) % BINS] >= 0 && right === i) right = (i + step) % BINS;
        if (left !== i && right !== i) break;
      }
      if (left !== i && right !== i) filled[i] = (filled[left] + filled[right]) / 2;
      else if (left !== i) filled[i] = filled[left];
      else if (right !== i) filled[i] = filled[right];
      else filled[i] = 0;
    }
  }

  // 1-pass circular smoothing
  const smooth = new Array<number>(BINS);
  for (let i = 0; i < BINS; i++) {
    smooth[i] =
      0.25 * filled[(i - 1 + BINS) % BINS] + 0.5 * filled[i] + 0.25 * filled[(i + 1) % BINS];
  }

  const rMin = Math.min(...smooth);
  const rMax = Math.max(...smooth);
  if (rMax < 1e-4) return { teethCount: 0, amplitudeRatio: 0, quadrantsCovered: 0 };

  const amp = rMax - rMin;
  const amplitudeRatio = amp / rMax;
  if (amplitudeRatio < 0.08) return { teethCount: 0, amplitudeRatio, quadrantsCovered: 0 };

  const highThresh = rMin + amp * 0.62;
  const lowThresh = rMin + amp * 0.40;

  // Find a starting bin below lowThresh so circular wrap-around counts cleanly
  const startBin = smooth.findIndex((v) => v <= lowThresh);
  if (startBin < 0) return { teethCount: 0, amplitudeRatio, quadrantsCovered: 0 };

  let inPeak = false;
  let peakBestBin = startBin;
  let peakBestVal = -1;
  const peakBins: number[] = [];

  for (let offset = 0; offset < BINS; offset++) {
    const idx = (startBin + offset) % BINS;
    const v = smooth[idx];
    if (!inPeak && v >= highThresh) {
      inPeak = true;
      peakBestBin = idx;
      peakBestVal = v;
    } else if (inPeak) {
      if (v > peakBestVal) {
        peakBestVal = v;
        peakBestBin = idx;
      }
      if (v <= lowThresh) {
        inPeak = false;
        peakBins.push(peakBestBin);
      }
    }
  }
  if (inPeak) peakBins.push(peakBestBin);

  const quadrants = new Set<number>();
  for (const b of peakBins) {
    quadrants.add(Math.floor((b / BINS) * 4));
  }

  return {
    teethCount: peakBins.length,
    amplitudeRatio,
    quadrantsCovered: quadrants.size,
  };
}

/**
 * Phân loại họ biểu tượng SVG thuần hình học bằng Structural Signature Bank.
 * Không dựa vào chuỗi cứng `d="..."` mà dựa vào đặc trưng topo hình học trong [0, 24] x [0, 24].
 */
export function classifySvgSignature(
  input: NormalizedSvgGeometry | SvgRawGeometry | string
): SvgSignatureMatch {
  const geom: NormalizedSvgGeometry =
    typeof input === 'object' && 'subpaths' in input
      ? input
      : normalizeSvgGeometry(input);

  const sps = geom.subpaths;
  const horizontalBars = sps.filter((s) => s.isHorizontalBar);
  const verticalBars = sps.filter((s) => s.isVerticalBar);
  const diagonalBars = sps.filter((s) => s.isDiagonalBar);
  const circles = sps.filter((s) => s.isCircular);
  const rects = sps.filter((s) => s.isRectangular && !s.isHorizontalBar && !s.isVerticalBar);

  const chevrons: { sp: NormalizedSubpath; dir: 'left' | 'right' }[] = [];
  for (const sp of sps) {
    const dir = detectChevronDirection(sp);
    if (dir) chevrons.push({ sp, dir });
  }

  const baseFeatures: SvgSignatureMatch['features'] = {
    subpathCount: sps.length,
    horizontalBarCount: horizontalBars.length,
    verticalBarCount: verticalBars.length,
    diagonalBarCount: diagonalBars.length,
    circleCount: circles.length,
    rectCount: rects.length,
    chevronCount: chevrons.length,
    chevronDirection: chevrons[0]?.dir,
  };

  const makeMatch = (
    family: SvgIconFamily,
    confidence: number,
    reasoning: string,
    extra?: { subDirection?: 'left' | 'right' | 'toggle'; gearTeethCount?: number }
  ): SvgSignatureMatch => {
    const bank = SVG_SEMANTIC_ALIAS_BANK[family];
    return {
      family,
      confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 1000) / 1000,
      virtualLabel: bank.virtualLabel,
      aliases: [...bank.aliases],
      subDirection: extra?.subDirection,
      features: {
        ...baseFeatures,
        gearTeethCount: extra?.gearTeethCount,
      },
      reasoning,
    };
  };

  if (sps.length === 0) {
    return makeMatch('unknown', 0, 'SVG rỗng, không có hình học vẽ.');
  }

  // --------------------------------------------------------------------------
  // 1. SIDEBAR LAYOUT COLUMN ICON (Outer rectangle + vertical inner divider/panel)
  // --------------------------------------------------------------------------
  const outerRects = rects.filter((r) => r.bbox.width >= 10 && r.bbox.height >= 8);
  if (outerRects.length >= 1) {
    const outer = outerRects.sort((a, b) => b.area - a.area)[0];
    const ob = outer.bbox;
    const outerAspect = ob.width / Math.max(ob.height, 0.1);

    if (outerAspect >= 0.65 && outerAspect <= 1.85) {
      // Check for internal vertical divider line/bar
      const innerVerticalDivider = verticalBars.find((vb) => {
        const relX = (vb.bbox.cx - ob.minX) / ob.width;
        const yOverlap =
          Math.min(vb.bbox.maxY, ob.maxY) - Math.max(vb.bbox.minY, ob.minY);
        return (
          relX >= 0.14 &&
          relX <= 0.86 &&
          yOverlap >= ob.height * 0.58 &&
          vb.bbox.minX >= ob.minX - 0.5 &&
          vb.bbox.maxX <= ob.maxX + 0.5
        );
      });

      // Or inner sidebar column rectangle on left/right side
      const innerSidePanel = rects.find((ir) => {
        if (ir === outer) return false;
        const insideX = ir.bbox.minX >= ob.minX - 0.5 && ir.bbox.maxX <= ob.maxX + 0.5;
        const insideY = ir.bbox.minY >= ob.minY - 0.5 && ir.bbox.maxY <= ob.maxY + 0.5;
        const widthRatio = ir.bbox.width / ob.width;
        const heightRatio = ir.bbox.height / ob.height;
        const onSide =
          ir.bbox.cx < ob.minX + ob.width * 0.45 || ir.bbox.cx > ob.maxX - ob.width * 0.45;
        return insideX && insideY && widthRatio <= 0.48 && heightRatio >= 0.58 && onSide;
      });

      if (innerVerticalDivider || innerSidePanel) {
        const innerChevron = chevrons.find(
          (c) =>
            c.sp.bbox.cx >= ob.minX &&
            c.sp.bbox.cx <= ob.maxX &&
            c.sp.bbox.cy >= ob.minY &&
            c.sp.bbox.cy <= ob.maxY
        );
        const subDir: 'left' | 'right' | 'toggle' = innerChevron
          ? innerChevron.dir
          : 'toggle';
        return makeMatch(
          'sidebar_layout',
          innerChevron ? 1.0 : 0.98,
          `Nhận diện khung chữ nhật ngoài (${ob.width.toFixed(1)}x${ob.height.toFixed(1)}) chia cột dọc Sidebar nội bộ${innerChevron ? ` kèm mũi tên ${innerChevron.dir}` : ''}.`,
          { subDirection: subDir }
        );
      }
    }
  }

  // Also detect two side-by-side rectangles (narrow left sidebar + wider main pane)
  if (rects.length === 2 && sps.length <= 5) {
    const sortedByX = [...rects].sort((a, b) => a.bbox.minX - b.bbox.minX);
    const leftR = sortedByX[0];
    const rightR = sortedByX[1];
    const hDiff = Math.abs(leftR.bbox.height - rightR.bbox.height);
    const gap = rightR.bbox.minX - leftR.bbox.maxX;
    if (
      leftR.bbox.height >= 10 &&
      hDiff <= 3.0 &&
      gap >= -1.0 &&
      gap <= 3.5 &&
      leftR.bbox.width < rightR.bbox.width * 0.85
    ) {
      return makeMatch(
        'sidebar_layout',
        0.95,
        'Nhận diện bố cục 2 khung cột đứng cạnh nhau (Sidebar trái hẹp + nội dung phải rộng).',
        { subDirection: 'toggle' }
      );
    }
  }

  // --------------------------------------------------------------------------
  // 2. HAMBURGER MENU (3 parallel horizontal bars) & MENU-FOLD (bars + chevron)
  // --------------------------------------------------------------------------
  if (horizontalBars.length === 3 && sps.length === 3) {
    const sorted = [...horizontalBars].sort((a, b) => a.bbox.cy - b.bbox.cy);
    const [b1, b2, b3] = sorted;
    const dy1 = b2.bbox.cy - b1.bbox.cy;
    const dy2 = b3.bbox.cy - b2.bbox.cy;
    const totalY = b3.bbox.cy - b1.bbox.cy;
    const spacingDiff = totalY > 0 ? Math.abs(dy1 - dy2) / totalY : 1;

    const minWidth = Math.min(b1.bbox.width, b2.bbox.width, b3.bbox.width);
    const maxWidth = Math.max(b1.bbox.width, b2.bbox.width, b3.bbox.width);
    const xOverlapMin = Math.max(b1.bbox.minX, b2.bbox.minX, b3.bbox.minX);
    const xOverlapMax = Math.min(b1.bbox.maxX, b2.bbox.maxX, b3.bbox.maxX);
    const overlapRatio = maxWidth > 0 ? (xOverlapMax - xOverlapMin) / maxWidth : 0;

    if (totalY >= 5.0 && dy1 >= 2.0 && dy2 >= 2.0 && spacingDiff <= 0.25 && minWidth >= 6.0 && overlapRatio >= 0.5) {
      const symmetryBonus = spacingDiff <= 0.08 && overlapRatio >= 0.85 ? 1.0 : 0.96;
      return makeMatch(
        'hamburger',
        symmetryBonus,
        `Nhận diện 3 thanh ngang song song xếp đều theo trục Y (y=${b1.bbox.cy.toFixed(1)}, ${b2.bbox.cy.toFixed(1)}, ${b3.bbox.cy.toFixed(1)}).`
      );
    }
  }

  // Menu-fold / Menu-unfold: horizontal bars + left/right chevron/triangle
  if (horizontalBars.length >= 2 && horizontalBars.length <= 4 && chevrons.length >= 1) {
    const dir = chevrons[0].dir;
    return makeMatch(
      dir === 'left' ? 'chevron_left' : 'chevron_right',
      0.96,
      `Nhận diện biểu tượng Menu Fold/Unfold (${horizontalBars.length} thanh ngang + mũi tên hướng ${dir}).`,
      { subDirection: dir }
    );
  }

  // --------------------------------------------------------------------------
  // 3. CLOSE (X / ✕): Two crossing diagonal lines OR filled X polygon
  // --------------------------------------------------------------------------
  if (diagonalBars.length >= 2 && sps.length <= 3) {
    // Allow either pure 2 diagonal bars or 2 diagonal bars inside 1 enclosing circle
    const onlyAllowedShapes = sps.every((s) => s.isDiagonalBar || s.isCircular);
    if (onlyAllowedShapes) {
      for (let a = 0; a < diagonalBars.length; a++) {
        for (let b = a + 1; b < diagonalBars.length; b++) {
          const d1 = diagonalBars[a];
          const d2 = diagonalBars[b];
          if (!d1.diagonalEndpoints || !d2.diagonalEndpoints) continue;
          const ang1 = d1.diagonalAngleDeg ?? 0;
          const ang2 = d2.diagonalAngleDeg ?? 0;
          let angDiff = Math.abs(ang1 - ang2);
          if (angDiff > 90) angDiff = 180 - angDiff;

          const len1 = Math.hypot(
            d1.diagonalEndpoints[1].x - d1.diagonalEndpoints[0].x,
            d1.diagonalEndpoints[1].y - d1.diagonalEndpoints[0].y
          );
          const len2 = Math.hypot(
            d2.diagonalEndpoints[1].x - d2.diagonalEndpoints[0].x,
            d2.diagonalEndpoints[1].y - d2.diagonalEndpoints[0].y
          );
          const lenRatio = Math.min(len1, len2) / Math.max(len1, len2, 1e-4);

          const hit = segmentsIntersectRatio(
            d1.diagonalEndpoints[0],
            d1.diagonalEndpoints[1],
            d2.diagonalEndpoints[0],
            d2.diagonalEndpoints[1]
          );

          if (hit.intersects && angDiff >= 60 && lenRatio >= 0.72) {
            return makeMatch(
              'close',
              circles.length === 0 ? 1.0 : 0.95,
              `Nhận diện 2 đoạn chéo giao nhau tạo dấu X (góc giao ${angDiff.toFixed(1)}°, tỷ lệ độ dài ${lenRatio.toFixed(2)}).`
            );
          }
        }
      }
    }
  }

  // Filled X polygon (Material Close icon)
  if (sps.length === 1 && detectFilledCloseX(sps[0])) {
    return makeMatch(
      'close',
      0.97,
      'Nhận diện đa giác đóng đối xứng 4 góc dạng dấu nhân X (filled Close icon).'
    );
  }

  // --------------------------------------------------------------------------
  // 4. SEARCH (Magnifying Glass): Circle/loop + diagonal handle stem
  // --------------------------------------------------------------------------
  if (circles.length >= 1 && sps.length <= 3) {
    // 4a. Circle + separate diagonal handle bar (Lucide, Feather, Heroicons)
    for (const circle of circles) {
      const r = circle.circleRadius ?? Math.max(circle.bbox.width, circle.bbox.height) / 2;
      if (r < 2.2) continue;
      for (const bar of diagonalBars) {
        if (!bar.diagonalEndpoints) continue;
        const [e1, e2] = bar.diagonalEndpoints;
        const dist1 = Math.hypot(e1.x - circle.bbox.cx, e1.y - circle.bbox.cy);
        const dist2 = Math.hypot(e2.x - circle.bbox.cx, e2.y - circle.bbox.cy);
        const innerDist = Math.min(dist1, dist2);
        const outerDist = Math.max(dist1, dist2);
        const handleLen = Math.hypot(e2.x - e1.x, e2.y - e1.y);

        // Handle attaches near rim and extends outward diagonally
        if (
          innerDist >= r * 0.65 &&
          innerDist <= r * 1.45 &&
          outerDist >= r * 1.35 &&
          handleLen >= r * 0.30
        ) {
          return makeMatch(
            'search',
            1.0,
            `Nhận diện vòng tròn kính lúp (r=${r.toFixed(1)}) kết hợp tay cầm chéo (dài ${handleLen.toFixed(1)}, vươn tới ${(outerDist / r).toFixed(2)}r).`
          );
        }
      }
    }

    // 4b. Filled magnifying glass (inner circular hole offset from overall center + outer silhouette with single handle)
    if (sps.length === 2 && circles.length === 1) {
      const innerCircle = circles[0];
      const outerSp = sps.find((s) => s !== innerCircle);
      const rIn = innerCircle.circleRadius ?? innerCircle.bbox.width / 2;
      if (outerSp && outerSp.closed && rIn >= 2.2) {
        const ccx = innerCircle.bbox.cx;
        const ccy = innerCircle.bbox.cy;
        const centerOffset = Math.hypot(ccx - geom.overallBBox.cx, ccy - geom.overallBBox.cy);
        const radii = outerSp.points.map((p) => Math.hypot(p.x - ccx, p.y - ccy));
        const maxR = Math.max(...radii);
        const sortedR = [...radii].sort((a, b) => a - b);
        const medianR = sortedR[Math.floor(sortedR.length * 0.5)] || rIn;

        // Protruding points form a single diagonal handle in 1-2 adjacent octants
        const handlePts = outerSp.points.filter(
          (p) => Math.hypot(p.x - ccx, p.y - ccy) > medianR * 1.35
        );
        const handleRatio = handlePts.length / Math.max(1, outerSp.points.length);
        // Ensure handle points are directionally concentrated (not 360-degree gear teeth)
        let angularSpread = Math.PI * 2;
        if (handlePts.length >= 2) {
          const angles = handlePts.map((p) => Math.atan2(p.y - ccy, p.x - ccx));
          const meanCos = angles.reduce((s, a) => s + Math.cos(a), 0) / angles.length;
          const meanSin = angles.reduce((s, a) => s + Math.sin(a), 0) / angles.length;
          const resultantLen = Math.hypot(meanCos, meanSin); // ~1.0 when tightly directional
          angularSpread = resultantLen;
        }

        if (
          centerOffset >= 0.8 &&
          maxR >= rIn * 1.9 &&
          medianR >= rIn * 1.1 &&
          handleRatio > 0.03 &&
          handleRatio < 0.45 &&
          angularSpread >= 0.82
        ) {
          return makeMatch(
            'search',
            0.97,
            `Nhận diện kính lúp dạng fill (lỗ tròn lệch tâm r=${rIn.toFixed(1)}, tay cầm nhô một hướng tới ${(maxR / rIn).toFixed(2)}r).`
          );
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // 5. SETTINGS (Gear / Cog): Concentric circle + periodic radial teeth
  // --------------------------------------------------------------------------
  if (circles.length >= 1) {
    // 5a. Concentric inner circle + outer toothed contour (Lucide, Material, Heroicons, Ant Design)
    for (const innerCircle of circles) {
      const rIn = innerCircle.circleRadius ?? innerCircle.bbox.width / 2;
      if (rIn < 1.2 || rIn > 7.5) continue;

      const outerToothed = sps.find((s) => {
        if (s === innerCircle || !s.closed || s.isCircular || s.isRectangular) return false;
        const distCenters = Math.hypot(
          s.bbox.cx - innerCircle.bbox.cx,
          s.bbox.cy - innerCircle.bbox.cy
        );
        const outerAspect =
          Math.min(s.bbox.width, s.bbox.height) / Math.max(s.bbox.width, s.bbox.height, 0.1);
        return (
          distCenters <= 2.2 &&
          outerAspect >= 0.78 &&
          s.bbox.width >= rIn * 2.6 &&
          s.bbox.height >= rIn * 2.6
        );
      });

      if (outerToothed) {
        const gearStats = countRadialGearTeeth(
          outerToothed,
          innerCircle.bbox.cx,
          innerCircle.bbox.cy
        );
        if (
          gearStats.teethCount >= 5 &&
          gearStats.teethCount <= 16 &&
          gearStats.quadrantsCovered >= 4 &&
          gearStats.amplitudeRatio >= 0.09
        ) {
          return makeMatch(
            'settings',
            0.98,
            `Nhận diện bánh răng đồng tâm (lỗ tròn r=${rIn.toFixed(1)} + ${gearStats.teethCount} răng hướng tâm đều quanh 4 góc phần tư).`,
            { gearTeethCount: gearStats.teethCount }
          );
        }
      }
    }

    // 5b. Concentric circle(s) + >= 6 radial tooth strokes/bars
    const mainCircle = [...circles].sort((a, b) => (a.circleRadius ?? 0) - (b.circleRadius ?? 0))[0];
    const radialSpokes = sps.filter((s) => {
      if (s.isCircular) return false;
      const p1 = s.points[0];
      const p2 = s.points[s.points.length - 1];
      const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (len < 1.0 || len > 7.0) return false;
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      const vx = mx - mainCircle.bbox.cx;
      const vy = my - mainCircle.bbox.cy;
      const vLen = Math.hypot(vx, vy);
      if (vLen < 2.0) return false;
      const dx = (p2.x - p1.x) / len;
      const dy = (p2.y - p1.y) / len;
      // Radial alignment: |dot(unit(v), unit(d))| >= 0.85
      const align = Math.abs((vx / vLen) * dx + (vy / vLen) * dy);
      return align >= 0.85;
    });

    if (radialSpokes.length >= 6) {
      return makeMatch(
        'settings',
        0.95,
        `Nhận diện bánh răng cấu tạo từ vòng tròn tâm + ${radialSpokes.length} răng hướng tâm.`,
        { gearTeethCount: radialSpokes.length }
      );
    }
  }

  // --------------------------------------------------------------------------
  // 6. CHEVRON-LEFT / CHEVRON-RIGHT / DOUBLE CHEVRON / ARROW-TO-LINE COLLAPSE
  // --------------------------------------------------------------------------
  if (chevrons.length >= 1) {
    const leftChevrons = chevrons.filter((c) => c.dir === 'left');
    const rightChevrons = chevrons.filter((c) => c.dir === 'right');

    // Pure single or double chevron, or chevron + vertical boundary bar (|<) or horizontal shaft (<-)
    const allowedExtras = sps.every(
      (s) =>
        chevrons.some((c) => c.sp === s) ||
        s.isVerticalBar ||
        s.isHorizontalBar
    );

    if (allowedExtras) {
      if (leftChevrons.length > 0 && rightChevrons.length === 0) {
        const conf = leftChevrons.length >= 2 || verticalBars.length >= 1 ? 1.0 : 0.98;
        return makeMatch(
          'chevron_left',
          conf,
          `Nhận diện ${leftChevrons.length} mũi tên Chevron hướng TRÁI${verticalBars.length ? ' kèm thanh biên dọc' : ''}${horizontalBars.length ? ' kèm trục ngang' : ''}.`,
          { subDirection: 'left' }
        );
      }
      if (rightChevrons.length > 0 && leftChevrons.length === 0) {
        const conf = rightChevrons.length >= 2 || verticalBars.length >= 1 ? 1.0 : 0.98;
        return makeMatch(
          'chevron_right',
          conf,
          `Nhận diện ${rightChevrons.length} mũi tên Chevron hướng PHẢI${verticalBars.length ? ' kèm thanh biên dọc' : ''}${horizontalBars.length ? ' kèm trục ngang' : ''}.`,
          { subDirection: 'right' }
        );
      }
    }
  }

  return makeMatch(
    'unknown',
    0,
    `Chưa khớp mẫu hình học chuẩn (${sps.length} subpath, ${horizontalBars.length} ngang, ${verticalBars.length} dọc, ${circles.length} tròn).`
  );
}

// ============================================================================
// 3. SPATIAL BOUNDARY PROXIMITY TOPOLOGY
// ============================================================================

function computeRectEdgeDistance(btn: BoundingRect, container: BoundingRect): number {
  const bLeft = btn.x;
  const bRight = btn.x + btn.width;
  const bTop = btn.y;
  const bBottom = btn.y + btn.height;

  const sLeft = container.x;
  const sRight = container.x + container.width;
  const sTop = container.y;
  const sBottom = container.y + container.height;

  const dyVert = Math.max(0, bTop - sBottom, sTop - bBottom);
  const dxToRight =
    bLeft <= sRight && bRight >= sRight
      ? 0
      : Math.min(Math.abs(bLeft - sRight), Math.abs(bRight - sRight));
  const distRightEdge = Math.hypot(dxToRight, dyVert);

  const dxToLeft =
    bLeft <= sLeft && bRight >= sLeft
      ? 0
      : Math.min(Math.abs(bLeft - sLeft), Math.abs(bRight - sLeft));
  const distLeftEdge = Math.hypot(dxToLeft, dyVert);

  const dxHoriz = Math.max(0, bLeft - sRight, sLeft - bRight);
  const dyToTop =
    bTop <= sTop && bBottom >= sTop
      ? 0
      : Math.min(Math.abs(bTop - sTop), Math.abs(bBottom - sTop));
  const distTopEdge = Math.hypot(dxHoriz, dyToTop);

  const dyToBottom =
    bTop <= sBottom && bBottom >= sBottom
      ? 0
      : Math.min(Math.abs(bTop - sBottom), Math.abs(bBottom - sBottom));
  const distBottomEdge = Math.hypot(dxHoriz, dyToBottom);

  return (
    Math.round(Math.min(distRightEdge, distLeftEdge, distTopEdge, distBottomEdge) * 100) / 100
  );
}

function isSidebarShapedContainer(s: SidebarContainerInfo): boolean {
  if (s.isVerticalSidebar !== undefined) return s.isVerticalSidebar;
  const tag = s.tag.toLowerCase();
  const cls = (s.className || '').toLowerCase();
  const id = (s.id || '').toLowerCase();

  if (
    tag === 'aside' ||
    /\b(sidebar|sider|ant-layout-sider|left-nav|side-nav|drawer)\b/.test(`${cls} ${id}`)
  ) {
    return true;
  }
  // Distinguish vertical <nav>/[role="navigation"] from wide horizontal top header bar
  const { width, height } = s.rect;
  if (height >= width || (width <= 420 && height >= 160)) {
    return true;
  }
  return false;
}

/**
 * Tính khoảng cách hình học giữa button SVG và biên tiếp giáp Sidebar.
 * Nếu khoảng cách <= 25px HOẶC nút nằm ở góc trên-trái (x < 80px && y < 80px):
 * -> Gắn Context "Sidebar Boundary Control" và chấm điểm S_spatial trong [0, 1].
 */
export function evaluateSpatialBoundary(
  buttonRect: BoundingRect,
  sidebars: SidebarContainerInfo[] = [],
  options?: {
    intent?: SvgIntentCategory;
    viewport?: { width: number; height: number };
    nearSearchInput?: boolean;
    insideDialog?: boolean;
    insideHeader?: boolean;
  }
): SpatialBoundaryResult {
  const intent = options?.intent ?? 'unknown';
  const isTopLeftCorner =
    buttonRect.x < SVG_TOP_LEFT_THRESHOLD_PX && buttonRect.y < SVG_TOP_LEFT_THRESHOLD_PX;

  const verticalSidebars = sidebars.filter(
    (s) => (s.rect.width > 0 || s.rect.height > 0) && isSidebarShapedContainer(s)
  );

  let minDist = Infinity;
  let nearestSidebar: SidebarContainerInfo | undefined;

  for (const sb of verticalSidebars) {
    const dist = computeRectEdgeDistance(buttonRect, sb.rect);
    if (dist < minDist) {
      minDist = dist;
      nearestSidebar = sb;
    }
  }

  const isNearSidebarBoundary = minDist <= SVG_SIDEBAR_PROXIMITY_PX;
  const isSidebarControl = isNearSidebarBoundary || isTopLeftCorner;

  // Determine spatial context tag & S_spatial based on intent + layout topology
  if (intent === 'search') {
    if (options?.nearSearchInput) {
      return {
        distanceToSidebarEdge: minDist,
        isNearSidebarBoundary,
        isTopLeftCorner,
        contextTag: 'Search Bar Control',
        spatialScore: 1.0,
        nearestSidebar,
        reasoning: 'Nút SVG kính lúp nằm liền kề ô nhập tìm kiếm (S_spatial = 1.0).',
      };
    }
    if (options?.insideHeader || buttonRect.y < 120) {
      return {
        distanceToSidebarEdge: minDist,
        isNearSidebarBoundary,
        isTopLeftCorner,
        contextTag: isSidebarControl ? 'Sidebar Boundary Control' : 'Header Action Control',
        spatialScore: 0.92,
        nearestSidebar,
        reasoning: 'Nút SVG kính lúp nằm tại thanh tiêu đề / điều hướng phía trên (S_spatial = 0.92).',
      };
    }
    return {
      distanceToSidebarEdge: minDist,
      isNearSidebarBoundary,
      isTopLeftCorner,
      contextTag: isSidebarControl ? 'Sidebar Boundary Control' : 'Page Action Control',
      spatialScore: 0.82,
      nearestSidebar,
      reasoning: 'Nút SVG kính lúp hiển thị rõ ràng trong khung nhìn (S_spatial = 0.82).',
    };
  }

  if (intent === 'close') {
    if (options?.insideDialog) {
      return {
        distanceToSidebarEdge: minDist,
        isNearSidebarBoundary,
        isTopLeftCorner,
        contextTag: 'Dialog Close Control',
        spatialScore: 1.0,
        nearestSidebar,
        reasoning: 'Nút SVG dấu X nằm trong hộp thoại / Modal / Drawer (S_spatial = 1.0).',
      };
    }
    if (isSidebarControl) {
      return {
        distanceToSidebarEdge: minDist,
        isNearSidebarBoundary,
        isTopLeftCorner,
        contextTag: 'Sidebar Boundary Control',
        spatialScore: 0.92,
        nearestSidebar,
        reasoning: `Nút SVG đóng nằm sát biên Sidebar (${Number.isFinite(minDist) ? `${minDist}px` : 'góc trên-trái'}).`,
      };
    }
    return {
      distanceToSidebarEdge: minDist,
      isNearSidebarBoundary,
      isTopLeftCorner,
      contextTag: 'Overlay/Page Close Control',
      spatialScore: 0.84,
      nearestSidebar,
      reasoning: 'Nút SVG dấu X hiển thị trên trang (S_spatial = 0.84).',
    };
  }

  if (intent === 'settings') {
    if (options?.insideHeader || buttonRect.y < 120 || isSidebarControl) {
      return {
        distanceToSidebarEdge: minDist,
        isNearSidebarBoundary,
        isTopLeftCorner,
        contextTag: isSidebarControl ? 'Sidebar Boundary Control' : 'Header Settings Control',
        spatialScore: 0.94,
        nearestSidebar,
        reasoning: 'Nút SVG bánh răng nằm tại khu vực Header / Sidebar (S_spatial = 0.94).',
      };
    }
    return {
      distanceToSidebarEdge: minDist,
      isNearSidebarBoundary,
      isTopLeftCorner,
      contextTag: 'Page Settings Control',
      spatialScore: 0.82,
      nearestSidebar,
      reasoning: 'Nút SVG bánh răng hiển thị trên trang (S_spatial = 0.82).',
    };
  }

  // Sidebar / Menu intents (collapse, expand, menu_open) or general evaluation
  if (isSidebarControl) {
    let score: number;
    let reason: string;
    if (isNearSidebarBoundary) {
      score = Math.round((1.0 - (minDist / SVG_SIDEBAR_PROXIMITY_PX) * 0.12) * 1000) / 1000;
      reason = `Nút SVG nằm sát biên Sidebar (khoảng cách = ${minDist}px <= ${SVG_SIDEBAR_PROXIMITY_PX}px) -> Context: "Sidebar Boundary Control".`;
    } else {
      const cornerDist = Math.hypot(Math.max(0, buttonRect.x), Math.max(0, buttonRect.y));
      score = Math.round(Math.max(0.88, 1.0 - (cornerDist / 114) * 0.12) * 1000) / 1000;
      reason = `Nút SVG nằm tại góc trên-trái (x=${buttonRect.x}px < 80px, y=${buttonRect.y}px < 80px) -> Context: "Sidebar Boundary Control".`;
    }
    return {
      distanceToSidebarEdge: minDist,
      isNearSidebarBoundary,
      isTopLeftCorner,
      contextTag: 'Sidebar Boundary Control',
      spatialScore: score,
      nearestSidebar,
      reasoning: reason,
    };
  }

  // Not at sidebar boundary
  if (intent === 'menu_open' && (options?.insideHeader || buttonRect.y < 100)) {
    return {
      distanceToSidebarEdge: minDist,
      isNearSidebarBoundary: false,
      isTopLeftCorner: false,
      contextTag: 'Header Navigation Control',
      spatialScore: 0.82,
      nearestSidebar,
      reasoning: 'Nút SVG điều hướng nằm trên thanh Header (S_spatial = 0.82).',
    };
  }

  const farScore = Number.isFinite(minDist)
    ? Math.round(Math.max(0.15, 0.45 * Math.exp(-minDist / 180)) * 1000) / 1000
    : 0.30;

  return {
    distanceToSidebarEdge: minDist,
    isNearSidebarBoundary: false,
    isTopLeftCorner: false,
    contextTag: options?.insideHeader ? 'Header Control' : 'Content Area Control',
    spatialScore: farScore,
    nearestSidebar,
    reasoning: `Nút SVG nằm ngoài vùng biên Sidebar (khoảng cách = ${Number.isFinite(minDist) ? `${minDist}px` : 'N/A'}, x=${buttonRect.x}, y=${buttonRect.y}).`,
  };
}

// ============================================================================
// 4. ARIA STATE DYNAMIC MAPPING
// ============================================================================

/**
 * Khai thác `aria-expanded` ("true"/"false") và `aria-controls` để khẳng định vai trò
 * và phân định rõ nút đang ở trạng thái thu gọn ("thu gọn"/"đóng") hay mở rộng ("mở rộng"/"mở").
 */
export function evaluateAriaState(
  aria: AriaStateInfo | undefined,
  targetHint: string
): AriaStateEvaluation {
  const { intent } = inferSvgTargetIntent(targetHint);
  const expanded =
    aria?.ariaExpanded === 'true'
      ? 'true'
      : aria?.ariaExpanded === 'false'
        ? 'false'
        : null;
  const controls = (aria?.ariaControls || '').trim();
  const controlsLooksLikeNav =
    aria?.ariaControlsTargetsSidebar === true ||
    /(sidebar|sider|nav|menu|drawer|panel|aside)/i.test(controls);
  const hasPopupMenu =
    aria?.ariaHasPopup === 'menu' || aria?.ariaHasPopup === 'true';

  const observed = expanded !== null || controlsLooksLikeNav || hasPopupMenu;

  if (!observed) {
    return {
      S_aria_state: 0,
      observed: false,
      polarity: 'neutral',
      controlsSidebar: false,
      conflict: false,
      virtualLabelBoost: [],
      reasoning: 'Không có thuộc tính ARIA trạng thái (aria-expanded / aria-controls).',
    };
  }

  // aria-expanded="true" -> container đang mở, bấm vào sẽ THU GỌN / ĐÓNG
  // aria-expanded="false" -> container đang đóng, bấm vào sẽ MỞ RỘNG / MỞ
  const polarity: 'collapse' | 'expand' | 'neutral' =
    expanded === 'true' ? 'collapse' : expanded === 'false' ? 'expand' : 'neutral';

  const disambiguatedAction: 'collapse' | 'expand' | undefined =
    polarity === 'collapse' ? 'collapse' : polarity === 'expand' ? 'expand' : undefined;

  const virtualLabelBoost =
    polarity === 'collapse'
      ? ['thu gọn', 'đóng', 'collapse', 'fold', 'sidebar', 'menu']
      : polarity === 'expand'
        ? ['mở rộng', 'mở', 'mở menu', 'expand', 'open', 'sidebar', 'menu']
        : controlsLooksLikeNav || hasPopupMenu
          ? ['sidebar', 'menu', 'điều hướng', 'navigation']
          : [];

  // Score against user intent
  if (intent === 'collapse') {
    if (polarity === 'collapse') {
      return {
        S_aria_state: controlsLooksLikeNav ? 1.0 : 0.92,
        observed: true,
        polarity,
        disambiguatedAction: 'collapse',
        controlsSidebar: controlsLooksLikeNav,
        conflict: false,
        virtualLabelBoost,
        reasoning: `aria-expanded="true"${controls ? ` + aria-controls="${controls}"` : ''} khớp chính xác hành động thu gọn/đóng.`,
      };
    }
    if (polarity === 'expand') {
      return {
        S_aria_state: 0.0,
        observed: true,
        polarity,
        disambiguatedAction: 'expand',
        controlsSidebar: controlsLooksLikeNav,
        conflict: true,
        virtualLabelBoost,
        reasoning: `Xung đột trạng thái ARIA: aria-expanded="false" (đang đóng, bấm sẽ mở) đối lập với yêu cầu thu gọn/đóng.`,
      };
    }
    if (controlsLooksLikeNav) {
      return {
        S_aria_state: 0.85,
        observed: true,
        polarity: 'neutral',
        controlsSidebar: true,
        conflict: false,
        virtualLabelBoost,
        reasoning: `aria-controls="${controls}" liên kết trực tiếp tới vùng Sidebar/Navigation.`,
      };
    }
  }

  if (intent === 'expand' || intent === 'menu_open') {
    if (polarity === 'expand') {
      return {
        S_aria_state: controlsLooksLikeNav ? 1.0 : 0.92,
        observed: true,
        polarity,
        disambiguatedAction: 'expand',
        controlsSidebar: controlsLooksLikeNav,
        conflict: false,
        virtualLabelBoost,
        reasoning: `aria-expanded="false"${controls ? ` + aria-controls="${controls}"` : ''} khớp chính xác hành động mở rộng/mở menu.`,
      };
    }
    if (polarity === 'collapse') {
      // For explicit "mở rộng" / "mở menu", aria-expanded="true" means it's already expanded
      return {
        S_aria_state: 0.0,
        observed: true,
        polarity,
        disambiguatedAction: 'collapse',
        controlsSidebar: controlsLooksLikeNav,
        conflict: true,
        virtualLabelBoost,
        reasoning: `Xung đột trạng thái ARIA: aria-expanded="true" (đang mở, bấm sẽ thu gọn) đối lập với yêu cầu mở/mở rộng.`,
      };
    }
    if (controlsLooksLikeNav || hasPopupMenu) {
      return {
        S_aria_state: 0.88,
        observed: true,
        polarity: 'neutral',
        controlsSidebar: controlsLooksLikeNav,
        conflict: false,
        virtualLabelBoost,
        reasoning: `ARIA xác nhận nút điều khiển menu/sidebar (${controls || aria?.ariaHasPopup}).`,
      };
    }
  }

  // Non-sidebar intents (search, close, settings) when button has sidebar ARIA controls
  if (
    (intent === 'search' || intent === 'settings') &&
    (controlsLooksLikeNav || expanded !== null)
  ) {
    return {
      S_aria_state: 0.0,
      observed: true,
      polarity,
      disambiguatedAction,
      controlsSidebar: controlsLooksLikeNav,
      conflict: false,
      virtualLabelBoost,
      reasoning: `ARIA điều hướng (${controls || `aria-expanded="${expanded}"`}) không thuộc mục tiêu ${intent}.`,
    };
  }

  return {
    S_aria_state: 0.5,
    observed: true,
    polarity,
    disambiguatedAction,
    controlsSidebar: controlsLooksLikeNav,
    conflict: false,
    virtualLabelBoost,
    reasoning: `Thuộc tính ARIA trung tính đối với mục tiêu "${targetHint}".`,
  };
}

// ============================================================================
// 5. SYNTHETIC HOVER TOOLTIP TRAP (PLAYWRIGHT)
// ============================================================================

export function scoreTooltipAgainstHint(tooltipText: string, targetHint?: string): number {
  const cleanTip = normalizeQueryText(tooltipText);
  if (!cleanTip) return 0;
  if (!targetHint || !targetHint.trim()) return 1.0;

  const { intent, cleanedHint } = inferSvgTargetIntent(targetHint);
  const directSim = computeSimpleSimilarity(cleanedHint, cleanTip);
  if (directSim >= 0.85) return Math.round(directSim * 1000) / 1000;

  // Check semantic intent match of the harvested tooltip
  const tipIntent = inferSvgTargetIntent(cleanTip).intent;
  if (intent !== 'unknown' && tipIntent === intent) {
    return Math.max(0.92, Math.round(directSim * 1000) / 1000);
  }
  if (
    (intent === 'collapse' && tipIntent === 'close') ||
    (intent === 'menu_open' && tipIntent === 'expand')
  ) {
    return Math.max(0.75, Math.round(directSim * 1000) / 1000);
  }

  return Math.round(directSim * 1000) / 1000;
}

/**
 * Kích hoạt hover giả lập (mouse.move + synthetic mouseenter) trên nút SVG rỗng nhãn,
 * đợi ngắn để tooltip xuất hiện và thu hoạch văn bản từ:
 * [role="tooltip"], aria-describedby target, title, data-tooltip, data-tip, .sr-only.
 */
export async function probeHoverTooltip(
  page: Page,
  rectOrSelector: string | BoundingRect,
  options?: {
    targetHint?: string;
    waitMs?: number;
    cleanupHover?: boolean;
  }
): Promise<HoverTooltipProbeResult> {
  const waitMs = options?.waitMs ?? 300;
  const cleanupHover = options?.cleanupHover ?? true;

  try {
    await page.evaluate(
      'var __name = globalThis.__name = window.__name = globalThis.__name || function(fn) { return fn; };'
    );
  } catch {
    // ignore
  }

  // 1. Resolve target rect & check immediate static attributes / .sr-only / existing tooltips
  const preProbe = await page.evaluate(
    (arg: { sel: string | null; rect: BoundingRect | null }) => {
      let el: Element | null = null;
      if (arg.sel) {
        el = document.querySelector(arg.sel);
      } else if (arg.rect) {
        const cx = arg.rect.x + arg.rect.width / 2;
        const cy = arg.rect.y + arg.rect.height / 2;
        el = document.elementFromPoint(cx, cy);
        if (el && el.closest) {
          const btn = el.closest('button, a, [role="button"], [tabindex="0"]');
          if (btn) el = btn;
        }
      }

      if (!el) {
        return { foundEl: false, cx: 0, cy: 0, staticText: '', staticSource: 'none' as const, beforeTooltips: [] as string[] };
      }

      const r = el.getBoundingClientRect();
      const cx = arg.rect ? arg.rect.x + arg.rect.width / 2 : r.left + r.width / 2;
      const cy = arg.rect ? arg.rect.y + arg.rect.height / 2 : r.top + r.height / 2;

      const clean = (s: string | null | undefined): string => (s || '').replace(/\s+/g, ' ').trim();

      // Snapshot already-visible tooltips so we prioritize newly revealed ones
      const tipNodes = Array.from(
        document.querySelectorAll(
          '[role="tooltip"], .tooltip, .ant-tooltip-inner, .MuiTooltip-tooltip, .tippy-content'
        )
      );
      const beforeTooltips: string[] = [];
      for (const n of tipNodes) {
        const st = window.getComputedStyle(n);
        const nr = n.getBoundingClientRect();
        if (
          st.display !== 'none' &&
          st.visibility !== 'hidden' &&
          parseFloat(st.opacity || '1') > 0 &&
          nr.width > 0 &&
          nr.height > 0
        ) {
          const txt = clean(n.textContent);
          if (txt) beforeTooltips.push(txt);
        }
      }

      // Check static tooltip attributes & .sr-only
      let staticText = '';
      let staticSource: 'title' | 'data-tooltip' | 'data-tip' | 'aria-describedby' | 'sr-only' | 'none' = 'none';

      const dataTooltip = clean(el.getAttribute('data-tooltip') || el.getAttribute('data-original-title'));
      const dataTip = clean(el.getAttribute('data-tip'));
      const titleAttr = clean(el.getAttribute('title'));

      if (dataTooltip) {
        staticText = dataTooltip;
        staticSource = 'data-tooltip';
      } else if (dataTip) {
        staticText = dataTip;
        staticSource = 'data-tip';
      } else if (titleAttr) {
        staticText = titleAttr;
        staticSource = 'title';
      } else {
        const descId = clean(el.getAttribute('aria-describedby'));
        if (descId) {
          const parts = descId
            .split(/\s+/)
            .map((id) => document.getElementById(id))
            .filter(Boolean)
            .map((n) => clean(n!.textContent))
            .filter(Boolean);
          if (parts.length > 0) {
            staticText = parts.join(' ');
            staticSource = 'aria-describedby';
          }
        }
      }

      if (!staticText) {
        const srEl = el.querySelector('.sr-only, .visually-hidden, .screen-reader-text');
        if (srEl && clean(srEl.textContent)) {
          staticText = clean(srEl.textContent);
          staticSource = 'sr-only';
        }
      }

      return { foundEl: true, cx, cy, staticText, staticSource, beforeTooltips };
    },
    {
      sel: typeof rectOrSelector === 'string' ? rectOrSelector : null,
      rect: typeof rectOrSelector === 'string' ? null : rectOrSelector,
    }
  );

  if (!preProbe.foundEl) {
    return { found: false, tooltipText: '', source: 'none', score: 0 };
  }

  // 2. Trigger physical mouse hover + synthetic mouseenter/mouseover on target
  try {
    await page.mouse.move(preProbe.cx, preProbe.cy);
  } catch {
    // ignore move errors if out of viewport
  }

  await page.evaluate(
    (arg: { sel: string | null; cx: number; cy: number }) => {
      let el: Element | null = arg.sel
        ? document.querySelector(arg.sel)
        : document.elementFromPoint(arg.cx, arg.cy);
      if (el && el.closest) {
        const btn = el.closest('button, a, [role="button"], [tabindex="0"]');
        if (btn) el = btn;
      }
      if (el) {
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true, clientX: arg.cx, clientY: arg.cy }));
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, clientX: arg.cx, clientY: arg.cy }));
        el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, cancelable: true, clientX: arg.cx, clientY: arg.cy }));
      }
    },
    {
      sel: typeof rectOrSelector === 'string' ? rectOrSelector : null,
      cx: preProbe.cx,
      cy: preProbe.cy,
    }
  );

  // 3. Poll briefly for dynamic [role="tooltip"] or aria-describedby reveal
  let dynamicText = '';
  let dynamicSource: HoverTooltipProbeResult['source'] = 'none';
  const deadline = Date.now() + waitMs;
  const pollInterval = 40;

  while (Date.now() <= deadline) {
    const check = await page.evaluate(
      (arg: { sel: string | null; cx: number; cy: number; before: string[] }) => {
        const clean = (s: string | null | undefined): string => (s || '').replace(/\s+/g, ' ').trim();
        let el: Element | null = arg.sel
          ? document.querySelector(arg.sel)
          : document.elementFromPoint(arg.cx, arg.cy);
        if (el && el.closest) {
          const btn = el.closest('button, a, [role="button"], [tabindex="0"]');
          if (btn) el = btn;
        }

        // Priority 1: Dynamic aria-describedby attached on hover
        if (el) {
          const descId = clean(el.getAttribute('aria-describedby'));
          if (descId) {
            const parts = descId
              .split(/\s+/)
              .map((id) => document.getElementById(id))
              .filter(Boolean)
              .map((n) => clean(n!.textContent))
              .filter(Boolean);
            if (parts.length > 0) {
              return { text: parts.join(' '), source: 'aria-describedby' as const };
            }
          }
        }

        // Priority 2: Visible [role="tooltip"] or framework tooltip popup
        const tipNodes = Array.from(
          document.querySelectorAll(
            '[role="tooltip"], .tooltip, .ant-tooltip-inner, .MuiTooltip-tooltip, .tippy-content, [data-tooltip-content]'
          )
        );
        let bestNearText = '';
        let bestDist = Infinity;

        for (const n of tipNodes) {
          const st = window.getComputedStyle(n);
          const nr = n.getBoundingClientRect();
          if (
            st.display === 'none' ||
            st.visibility === 'hidden' ||
            parseFloat(st.opacity || '1') === 0 ||
            nr.width <= 0 ||
            nr.height <= 0
          ) {
            continue;
          }
          const txt = clean(n.textContent);
          if (!txt) continue;

          // Prefer newly revealed tooltip not present before hover
          if (!arg.before.includes(txt)) {
            return { text: txt, source: 'role-tooltip' as const };
          }
          const ncx = nr.left + nr.width / 2;
          const ncy = nr.top + nr.height / 2;
          const dist = Math.hypot(ncx - arg.cx, ncy - arg.cy);
          if (dist < bestDist && dist < 240) {
            bestDist = dist;
            bestNearText = txt;
          }
        }

        if (bestNearText) {
          return { text: bestNearText, source: 'role-tooltip' as const };
        }

        return { text: '', source: 'none' as const };
      },
      {
        sel: typeof rectOrSelector === 'string' ? rectOrSelector : null,
        cx: preProbe.cx,
        cy: preProbe.cy,
        before: preProbe.beforeTooltips,
      }
    );

    if (check.text) {
      dynamicText = check.text;
      dynamicSource = check.source;
      break;
    }

    if (Date.now() + pollInterval > deadline) break;
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  // 4. Clean up hover state so tooltip doesn't occlude later actions
  if (cleanupHover) {
    try {
      await page.evaluate(
        (arg: { sel: string | null; cx: number; cy: number }) => {
          let el: Element | null = arg.sel
            ? document.querySelector(arg.sel)
            : document.elementFromPoint(arg.cx, arg.cy);
          if (el && el.closest) {
            const btn = el.closest('button, a, [role="button"], [tabindex="0"]');
            if (btn) el = btn;
          }
          if (el) {
            el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, cancelable: true }));
            el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true }));
          }
        },
        {
          sel: typeof rectOrSelector === 'string' ? rectOrSelector : null,
          cx: preProbe.cx,
          cy: preProbe.cy,
        }
      );
      await page.mouse.move(1, 1);
    } catch {
      // ignore cleanup error
    }
  }

  const finalText = dynamicText || preProbe.staticText;
  const finalSource: HoverTooltipProbeResult['source'] = dynamicText
    ? dynamicSource
    : preProbe.staticSource;

  if (!finalText) {
    return { found: false, tooltipText: '', source: 'none', score: 0 };
  }

  return {
    found: true,
    tooltipText: finalText,
    source: finalSource,
    score: scoreTooltipAgainstHint(finalText, options?.targetHint),
  };
}

// ============================================================================
// 6. 4-WEIGHT SCORING FORMULA & SAFETY MARGIN RESOLUTION ENGINE
// ============================================================================

/**
 * Chấm độ khớp giữa họ chữ ký hình học vector và ý định câu lệnh (S_vector trong [0, 1]).
 */
export function computeVectorIntentScore(
  signature: SvgSignatureMatch,
  targetHint: string,
  ariaEval?: AriaStateEvaluation
): number {
  if (signature.family === 'unknown' || signature.confidence <= 0) return 0;

  const { intent, cleanedHint } = inferSvgTargetIntent(targetHint);
  let affinity = 0;

  switch (intent) {
    case 'collapse': {
      if (signature.family === 'chevron_left') {
        affinity = 1.0;
      } else if (signature.family === 'sidebar_layout') {
        affinity = signature.subDirection === 'right' ? 0.55 : 1.0;
      } else if (signature.family === 'hamburger') {
        // Hamburger primarily means open/toggle menu; only strong for collapse if aria-expanded="true"
        affinity = ariaEval?.polarity === 'collapse' ? 0.90 : 0.55;
      } else if (signature.family === 'close') {
        // Plain X icon when user explicitly says "đóng sidebar" gets partial affinity unless near sidebar
        affinity = 0.55;
      } else if (signature.family === 'chevron_right') {
        affinity = ariaEval?.polarity === 'collapse' ? 0.85 : 0.15;
      } else {
        affinity = 0.0;
      }
      break;
    }

    case 'expand': {
      if (signature.family === 'chevron_right') {
        affinity = 1.0;
      } else if (signature.family === 'sidebar_layout') {
        affinity = signature.subDirection === 'left' ? 0.55 : 0.96;
      } else if (signature.family === 'hamburger') {
        affinity = ariaEval?.polarity === 'expand' ? 0.92 : 0.72;
      } else if (signature.family === 'chevron_left') {
        affinity = ariaEval?.polarity === 'expand' ? 0.85 : 0.15;
      } else {
        affinity = 0.0;
      }
      break;
    }

    case 'menu_open': {
      if (signature.family === 'hamburger') {
        affinity = 1.0;
      } else if (signature.family === 'sidebar_layout') {
        affinity = 0.82;
      } else if (signature.family === 'chevron_right') {
        affinity = ariaEval?.polarity === 'expand' ? 0.90 : 0.72;
      } else if (signature.family === 'chevron_left') {
        affinity = ariaEval?.polarity === 'expand' ? 0.80 : 0.25;
      } else {
        affinity = 0.0;
      }
      break;
    }

    case 'search': {
      affinity = signature.family === 'search' ? 1.0 : 0.0;
      break;
    }

    case 'close': {
      affinity = signature.family === 'close' ? 1.0 : 0.0;
      break;
    }

    case 'settings': {
      affinity = signature.family === 'settings' ? 1.0 : 0.0;
      break;
    }

    default: {
      // Fallback lexical similarity against generated virtualLabel & aliases
      let bestSim = 0;
      for (const alias of signature.aliases) {
        const sim = computeSimpleSimilarity(cleanedHint, alias);
        if (sim > bestSim) bestSim = sim;
      }
      affinity = bestSim;
      break;
    }
  }

  return Math.round(Math.min(1, Math.max(0, signature.confidence * affinity)) * 1000) / 1000;
}

/**
 * Công thức chấm điểm 4 trọng số (Trụ cột 16):
 *   Score_SVG = 0.4 * S_vector + 0.3 * S_spatial + 0.2 * S_aria_state + 0.1 * S_tooltip
 *
 * Hiệu chỉnh Missing-Modality (Hiệu chỉnh cảm biến tùy chọn vắng mặt):
 * - Trọng số chuẩn luôn giữ nguyên tuyệt đối: (0.4, 0.3, 0.2, 0.1).
 * - Khi thuộc tính ARIA (aria-expanded/aria-controls) hoặc Tooltip thực sự TỒN TẠI trên DOM
 *   (observed === true): dùng nguyên giá trị đo được (kể cả 0.0 khi xung đột trạng thái, kéo điểm tụt mạnh < 0.85!).
 * - Khi nút SVG là nút thuần túy 0-text, 0-ARIA, 0-tooltip (unobserved):
 *   thay vì phạt cứng thành 0 (sẽ giới hạn trần ở 0.70 không thể đạt 0.85),
 *   các kênh tùy chọn vắng mặt nhận prior suy diễn từ lõi hình học+không gian
 *   `prior = min(0.92, ((0.4*Sv + 0.3*Ss)/0.7) * 0.92)` CHỈ KHI có khớp vector rõ ràng (`Sv >= 0.55`).
 * - Nhờ hệ số chiết khấu 0.92:
 *   + Nút có ARIA/Tooltip xác nhận luôn đạt điểm cao hơn nút 0-ARIA/0-tooltip (tối đa 1.000 vs 0.976).
 *   + Nút 0-ARIA/0-tooltip đúng vector + đúng biên không gian đạt 0.89 - 0.97 >= 0.85.
 *   + Nút đúng vector nhưng sai vị trí (vd mũi tên `<` trong carousel giữa trang, Ss=0.30) chỉ đạt ~0.68 < 0.85.
 *   + Nút có ARIA xung đột trạng thái (aria-expanded="false" khi yêu cầu thu gọn) tụt xuống ~0.79 < 0.85.
 *   + Nút sai họ vector (Sv=0) không nhận prior -> điểm <= 0.30.
 */
export function computeSvgTopologyScore(params: {
  signature: SvgSignatureMatch;
  spatial: SpatialBoundaryResult;
  aria: AriaStateEvaluation;
  tooltip?: HoverTooltipProbeResult;
  targetHint: string;
}): SvgTopologyScoreBreakdown {
  const { signature, spatial, aria, tooltip, targetHint } = params;

  const rawVector = computeVectorIntentScore(signature, targetHint, aria);
  const rawSpatial = Math.round(Math.min(1, Math.max(0, spatial.spatialScore)) * 1000) / 1000;
  const rawAria = Math.round(Math.min(1, Math.max(0, aria.S_aria_state)) * 1000) / 1000;
  const tooltipObserved = Boolean(tooltip?.found && tooltip.tooltipText.trim().length > 0);
  const rawTooltip = tooltipObserved
    ? Math.round(
        Math.min(
          1,
          Math.max(
            0,
            tooltip!.score > 0 || !targetHint
              ? tooltip!.score
              : scoreTooltipAgainstHint(tooltip!.tooltipText, targetHint)
          )
        ) * 1000
      ) / 1000
    : 0;

  const rawWeightedScore =
    Math.round(
      (SVG_SCORE_WEIGHTS.vector * rawVector +
        SVG_SCORE_WEIGHTS.spatial * rawSpatial +
        SVG_SCORE_WEIGHTS.aria * rawAria +
        SVG_SCORE_WEIGHTS.tooltip * rawTooltip) *
        10000
    ) / 10000;

  // Missing-modality epistemic prior for unobserved optional signals (ARIA / Tooltip)
  const corePrior =
    (SVG_SCORE_WEIGHTS.vector * rawVector + SVG_SCORE_WEIGHTS.spatial * rawSpatial) /
    (SVG_SCORE_WEIGHTS.vector + SVG_SCORE_WEIGHTS.spatial);
  const unobservedPrior =
    rawVector >= 0.55 ? Math.round(Math.min(0.92, corePrior * 0.92) * 1000) / 1000 : 0;

  const effVector = rawVector;
  const effSpatial = rawSpatial;
  const effAria = aria.observed ? rawAria : unobservedPrior;
  const effTooltip = tooltipObserved ? rawTooltip : unobservedPrior;

  let calibratedScore =
    Math.round(
      (SVG_SCORE_WEIGHTS.vector * effVector +
        SVG_SCORE_WEIGHTS.spatial * effSpatial +
        SVG_SCORE_WEIGHTS.aria * effAria +
        SVG_SCORE_WEIGHTS.tooltip * effTooltip) *
        10000
    ) / 10000;

  // If explicit observed tooltip directly conflicts (e.g. tooltip says something completely unrelated
  // with strong text while matching another icon family), penalize gently so it doesn't click wrong icon
  if (tooltipObserved && rawTooltip === 0 && signature.family !== 'unknown') {
    const tipIntent = inferSvgTargetIntent(tooltip!.tooltipText).intent;
    const reqIntent = inferSvgTargetIntent(targetHint).intent;
    if (tipIntent !== 'unknown' && reqIntent !== 'unknown' && tipIntent !== reqIntent) {
      calibratedScore = Math.round(Math.max(0, calibratedScore - 0.25) * 10000) / 10000;
    }
  }

  const meetsThreshold = calibratedScore >= SVG_AUTO_CLICK_MIN_SCORE;

  const reasoning =
    `Score_SVG = 0.4*${effVector.toFixed(2)} + 0.3*${effSpatial.toFixed(2)} + 0.2*${effAria.toFixed(2)} + 0.1*${effTooltip.toFixed(2)} = ${(calibratedScore * 100).toFixed(1)}%` +
    ` (raw=${(rawWeightedScore * 100).toFixed(1)}%, family=${signature.family}, context="${spatial.contextTag}", ariaObs=${aria.observed}, tipObs=${tooltipObserved})`;

  return {
    score: calibratedScore,
    rawWeightedScore,
    weights: { ...SVG_SCORE_WEIGHTS },
    components: {
      S_vector: effVector,
      S_spatial: effSpatial,
      S_aria_state: effAria,
      S_tooltip: effTooltip,
    },
    rawComponents: {
      S_vector: rawVector,
      S_spatial: rawSpatial,
      S_aria_state: rawAria,
      S_tooltip: rawTooltip,
      ariaObserved: aria.observed,
      tooltipObserved,
    },
    meetsThreshold,
    reasoning,
  };
}

/**
 * Chấm điểm toàn bộ danh sách ứng viên SVG không nhãn và áp dụng cổng an toàn:
 * - Score_top1 >= 0.85 (85%)
 * - Delta_margin = Score_top1 - Score_top2 >= 0.20 (20%)
 */
export function resolveNamelessSvgCandidates(
  candidates: SvgIconCandidateInput[],
  targetHint: string
): SvgResolutionResult {
  if (!candidates || candidates.length === 0) {
    return {
      status: 'NO_CANDIDATES',
      safeToClick: false,
      selectedCandidate: null,
      topScore: 0,
      secondScore: 0,
      deltaMargin: 0,
      virtualLabel: '',
      context: '',
      vectorFamily: 'unknown',
      candidates: [],
      reasoning: 'Không có ứng viên nút SVG không nhãn nào trên trang.',
    };
  }

  const { intent } = inferSvgTargetIntent(targetHint);

  const scored: ScoredSvgCandidate[] = candidates.map((cand) => {
    const signature = classifySvgSignature(cand.svg);
    const spatial = evaluateSpatialBoundary(cand.rect, cand.sidebars || [], {
      intent,
      viewport: cand.viewport,
      nearSearchInput: cand.nearSearchInput,
      insideDialog: cand.insideDialog,
      insideHeader: cand.insideHeader,
    });
    const aria = evaluateAriaState(cand.aria, targetHint);

    // Re-score tooltip against targetHint if tooltip text was provided
    const tooltip: HoverTooltipProbeResult | undefined = cand.tooltip
      ? {
          ...cand.tooltip,
          score: cand.tooltip.found
            ? scoreTooltipAgainstHint(cand.tooltip.tooltipText, targetHint)
            : 0,
        }
      : undefined;

    const scoreBreakdown = computeSvgTopologyScore({
      signature,
      spatial,
      aria,
      tooltip,
      targetHint,
    });

    const labelParts = [
      signature.virtualLabel,
      ...aria.virtualLabelBoost,
      tooltip?.found ? tooltip.tooltipText : '',
    ].filter((s) => s && s.trim().length > 0);
    const virtualLabel = Array.from(new Set(labelParts.join(' ').split(/\s+/))).join(' ');

    return {
      candidateId: cand.candidateId,
      selector: cand.selector,
      tag: cand.tag,
      elemId: cand.elemId,
      rect: cand.rect,
      signature,
      spatial,
      aria,
      tooltip,
      scoreBreakdown,
      virtualLabel,
      context: spatial.contextTag,
    };
  });

  scored.sort((a, b) => b.scoreBreakdown.score - a.scoreBreakdown.score);

  const top1 = scored[0];
  const top2 = scored[1] || null;
  const topScore = top1 ? top1.scoreBreakdown.score : 0;
  const secondScore = top2 ? top2.scoreBreakdown.score : 0;
  const deltaMargin = Math.round(Math.max(0, topScore - secondScore) * 10000) / 10000;

  if (topScore < SVG_AUTO_CLICK_MIN_SCORE) {
    return {
      status: 'LOW_CONFIDENCE',
      safeToClick: false,
      selectedCandidate: null,
      topScore,
      secondScore,
      deltaMargin,
      virtualLabel: top1.virtualLabel,
      context: top1.context,
      vectorFamily: top1.signature.family,
      candidates: scored,
      reasoning: `Không đạt ngưỡng tin cậy tự động click: Top1 = ${(topScore * 100).toFixed(1)}% < 85% (${top1.scoreBreakdown.reasoning}).`,
    };
  }

  if (top2 && deltaMargin < SVG_AUTO_CLICK_MIN_MARGIN) {
    return {
      status: 'AMBIGUOUS_MARGIN',
      safeToClick: false,
      selectedCandidate: null,
      topScore,
      secondScore,
      deltaMargin,
      virtualLabel: top1.virtualLabel,
      context: top1.context,
      vectorFamily: top1.signature.family,
      candidates: scored,
      reasoning: `Vùng mờ tranh chấp (AMBIGUOUS_MARGIN): Top1 = ${(topScore * 100).toFixed(1)}%, Top2 = ${(secondScore * 100).toFixed(1)}%, Delta_margin = ${(deltaMargin * 100).toFixed(1)}% < 20% -> Cấm tự ý bấm mù.`,
    };
  }

  return {
    status: 'RESOLVED',
    safeToClick: true,
    selectedCandidate: top1,
    topScore,
    secondScore,
    deltaMargin,
    virtualLabel: top1.virtualLabel,
    context: top1.context,
    vectorFamily: top1.signature.family,
    candidates: scored,
    reasoning: `Định danh thành công nút SVG không nhãn "${top1.selector}" (family=${top1.signature.family}, Context="${top1.context}", Score=${(topScore * 100).toFixed(1)}% >= 85%, Delta_margin=${(deltaMargin * 100).toFixed(1)}% >= 20%).`,
  };
}

// ============================================================================
// 7. PLAYWRIGHT LIVE PAGE EXTRACTOR & END-TO-END RESOLVER
// ============================================================================

/**
 * Quét trực tiếp trang Playwright Chromium để thu thập toàn bộ nút SVG không nhãn,
 * hình học gốc SVG, biên Sidebar, ngữ cảnh tìm kiếm/dialog/header và trạng thái ARIA.
 */
export async function extractNamelessSvgCandidates(
  page: Page,
  options?: { includeLabeled?: boolean }
): Promise<SvgIconCandidateInput[]> {
  const includeLabeled = options?.includeLabeled ?? false;

  try {
    await page.evaluate(
      'var __name = globalThis.__name = window.__name = globalThis.__name || function(fn) { return fn; };'
    );
  } catch {
    // ignore
  }

  return page.evaluate(
    (arg: { includeLabeled: boolean; sidebarSelectors: string[] }) => {
      const clean = (s: string | null | undefined): string => (s || '').replace(/\s+/g, ' ').trim();
      const viewport = { width: window.innerWidth, height: window.innerHeight };

      // 1. Collect Sidebar containers
      const sidebarSet = new Set<Element>();
      for (const sel of arg.sidebarSelectors) {
        try {
          document.querySelectorAll(sel).forEach((el) => sidebarSet.add(el));
        } catch {
          // ignore
        }
      }

      const sidebars: SidebarContainerInfo[] = [];
      for (const el of sidebarSet) {
        const st = window.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.height < 40) continue;
        const tag = el.tagName.toLowerCase();
        const cls = clean(el.className?.toString());
        const id = el.id || undefined;
        const isVertical =
          tag === 'aside' ||
          /\b(sidebar|sider|ant-layout-sider|left-nav|side-nav|drawer)\b/i.test(`${cls} ${id || ''}`) ||
          r.height >= r.width ||
          (r.width <= 420 && r.height >= 160);

        sidebars.push({
          tag,
          id,
          role: el.getAttribute('role') || undefined,
          className: cls || undefined,
          rect: {
            x: Math.round(r.left),
            y: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height),
          },
          isVerticalSidebar: isVertical,
        });
      }

      // 2. Collect visible search inputs for spatial search adjacency
      const searchInputRects: BoundingRect[] = [];
      document.querySelectorAll('input').forEach((inp) => {
        const type = (inp.getAttribute('type') || 'text').toLowerCase();
        if (['hidden', 'button', 'submit', 'checkbox', 'radio'].includes(type)) return;
        const r = inp.getBoundingClientRect();
        if (r.width <= 10 || r.height <= 10) return;
        const meta = `${type} ${inp.placeholder || ''} ${inp.name || ''} ${inp.id || ''} ${inp.className || ''} ${inp.getAttribute('aria-label') || ''}`.toLowerCase();
        if (
          type === 'search' ||
          /(search|tim|tìm|query|keyword|filter|lookup)/i.test(meta) ||
          Boolean(inp.closest('[role="search"], .search, .search-bar, .search-box'))
        ) {
          searchInputRects.push({
            x: Math.round(r.left),
            y: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height),
          });
        }
      });

      // Clear old markers
      document
        .querySelectorAll('[data-svg-topo-id]')
        .forEach((el) => el.removeAttribute('data-svg-topo-id'));

      // 3. Scan interactive elements containing <svg>
      const interactiveNodes = Array.from(
        document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [onclick], [tabindex="0"], div, span')
      );

      const candidates: SvgIconCandidateInput[] = [];
      const seenSvgs = new Set<Element>();
      let nextId = 1;

      for (const node of interactiveNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const tag = node.tagName.toLowerCase();
        const role = node.getAttribute('role') || '';
        const st = window.getComputedStyle(node);

        if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') === 0) {
          continue;
        }

        const isExplicitInteractive =
          tag === 'button' ||
          tag === 'a' ||
          role === 'button' ||
          role === 'menuitem' ||
          node.hasAttribute('onclick') ||
          node.getAttribute('tabindex') === '0';

        // Skip non-semantic wrappers (div/span) nested inside an interactive control
        // (prevents inherited cursor:pointer in <button><span><svg/></span></button> from creating duplicates)
        if (
          !isExplicitInteractive &&
          node.parentElement?.closest('button, a, [role="button"], [role="menuitem"], [onclick], [tabindex="0"]')
        ) {
          continue;
        }

        const isInteractive =
          isExplicitInteractive ||
          (st.cursor === 'pointer' && node.children.length <= 2);

        if (!isInteractive) continue;

        // Skip outer wrappers that contain inner buttons/links/interactive triggers
        if (
          tag !== 'button' &&
          tag !== 'a' &&
          node.querySelector('button, a, [role="button"], [role="menuitem"], [onclick], [tabindex="0"]')
        ) {
          continue;
        }

        const svgEl = node.querySelector('svg');
        if (!svgEl || seenSvgs.has(svgEl)) continue;

        const r = node.getBoundingClientRect();
        if (r.width <= 2 || r.height <= 2) continue;

        // Compute visible text excluding .sr-only / .visually-hidden and SVG <title>/<desc>
        const clone = node.cloneNode(true) as HTMLElement;
        clone
          .querySelectorAll('svg, .sr-only, .visually-hidden, .screen-reader-text')
          .forEach((n) => n.remove());
        const visibleText = clean(clone.textContent);
        const ariaLabel = clean(node.getAttribute('aria-label'));

        if (!arg.includeLabeled && (visibleText.length > 0 || ariaLabel.length > 0)) {
          continue;
        }

        // Extract SVG primitives (filtering invisible spacer paths like Tabler/Material fill="none" stroke="none")
        const primitives: SvgPrimitiveInput[] = [];
        const shapeEls = Array.from(
          svgEl.querySelectorAll('path, line, rect, circle, ellipse, polyline, polygon')
        );

        for (const sEl of shapeEls) {
          const sTag = sEl.tagName.toLowerCase() as SvgPrimitiveInput['tag'];
          const sStyle = window.getComputedStyle(sEl);
          if (
            sStyle.display === 'none' ||
            sStyle.visibility === 'hidden' ||
            parseFloat(sStyle.opacity || '1') === 0
          ) {
            continue;
          }

          const compFill = (sStyle.fill || '').trim().toLowerCase();
          const compStroke = (sStyle.stroke || '').trim().toLowerCase();
          const strokeW = parseFloat(sStyle.strokeWidth || '1');
          const fillOp = parseFloat(sStyle.fillOpacity || '1');
          const strokeOp = parseFloat(sStyle.strokeOpacity || '1');
          const noFill =
            compFill === 'none' ||
            compFill === 'transparent' ||
            compFill === 'rgba(0, 0, 0, 0)' ||
            fillOp === 0;
          const noStroke =
            compStroke === 'none' ||
            compStroke === 'transparent' ||
            compStroke === 'rgba(0, 0, 0, 0)' ||
            strokeOp === 0 ||
            strokeW === 0;
          if (noFill && noStroke) continue;

          const fillAttr = sEl.getAttribute('fill') || undefined;
          const strokeAttr = sEl.getAttribute('stroke') || undefined;

          // Collect ancestor <g> transforms up to <svg>
          const transforms: string[] = [];
          let cur: Element | null = sEl;
          while (cur && cur !== svgEl) {
            const tr = cur.getAttribute('transform');
            if (tr) transforms.unshift(tr);
            cur = cur.parentElement;
          }
          const transform = transforms.join(' ').trim() || undefined;
          const numAttr = (attr: string): number | undefined => {
            const v = sEl.getAttribute(attr);
            if (v === null) return undefined;
            const n = parseFloat(v);
            return Number.isFinite(n) ? n : undefined;
          };

          if (sTag === 'path') {
            const d = sEl.getAttribute('d') || '';
            if (d) primitives.push({ tag: 'path', d, transform, fill: fillAttr, stroke: strokeAttr });
          } else if (sTag === 'line') {
            primitives.push({
              tag: 'line',
              x1: numAttr('x1') ?? 0,
              y1: numAttr('y1') ?? 0,
              x2: numAttr('x2') ?? 0,
              y2: numAttr('y2') ?? 0,
              transform,
              fill: fillAttr,
              stroke: strokeAttr,
            });
          } else if (sTag === 'rect') {
            primitives.push({
              tag: 'rect',
              x: numAttr('x') ?? 0,
              y: numAttr('y') ?? 0,
              width: numAttr('width') ?? 0,
              height: numAttr('height') ?? 0,
              rx: numAttr('rx'),
              ry: numAttr('ry'),
              transform,
              fill: fillAttr,
              stroke: strokeAttr,
            });
          } else if (sTag === 'circle') {
            primitives.push({
              tag: 'circle',
              cx: numAttr('cx') ?? 0,
              cy: numAttr('cy') ?? 0,
              r: numAttr('r') ?? 0,
              transform,
              fill: fillAttr,
              stroke: strokeAttr,
            });
          } else if (sTag === 'ellipse') {
            primitives.push({
              tag: 'ellipse',
              cx: numAttr('cx') ?? 0,
              cy: numAttr('cy') ?? 0,
              rx: numAttr('rx') ?? 0,
              ry: numAttr('ry') ?? 0,
              transform,
              fill: fillAttr,
              stroke: strokeAttr,
            });
          } else if (sTag === 'polyline' || sTag === 'polygon') {
            const pts = sEl.getAttribute('points') || '';
            if (pts) primitives.push({ tag: sTag, points: pts, transform, fill: fillAttr, stroke: strokeAttr });
          }
        }

        if (primitives.length === 0) continue;
        seenSvgs.add(svgEl);

        const cid = nextId++;
        node.setAttribute('data-svg-topo-id', String(cid));
        const selector = node.id ? `#${CSS.escape(node.id)}` : `[data-svg-topo-id="${cid}"]`;

        const svgViewBox = svgEl.getAttribute('viewBox') || undefined;
        const svgWAttr = svgEl.getAttribute('width');
        const svgHAttr = svgEl.getAttribute('height');
        const svgWidth = svgWAttr ? parseFloat(svgWAttr) : undefined;
        const svgHeight = svgHAttr ? parseFloat(svgHAttr) : undefined;

        const rect: BoundingRect = {
          x: Math.round(r.left),
          y: Math.round(r.top),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };

        // Check aria-controls target
        const ariaControls = node.getAttribute('aria-controls');
        let ariaControlsTargetsSidebar = false;
        if (ariaControls) {
          for (const tid of ariaControls.split(/\s+/)) {
            const targetEl = document.getElementById(tid);
            if (targetEl) {
              const tTag = targetEl.tagName.toLowerCase();
              const tRole = (targetEl.getAttribute('role') || '').toLowerCase();
              const tCls = (targetEl.className?.toString() || '').toLowerCase();
              if (
                tTag === 'aside' ||
                tTag === 'nav' ||
                tRole === 'navigation' ||
                tRole === 'menu' ||
                /(sidebar|sider|nav|menu|drawer)/i.test(`${tid} ${tCls}`)
              ) {
                ariaControlsTargetsSidebar = true;
              }
            }
          }
        }

        // Check proximity to search inputs
        let nearSearchInput = Boolean(
          node.closest('[role="search"], .search-bar, .search-box, .search-container')
        );
        if (!nearSearchInput) {
          for (const sr of searchInputRects) {
            const dx = Math.max(0, rect.x - (sr.x + sr.width), sr.x - (rect.x + rect.width));
            const dy = Math.max(0, rect.y - (sr.y + sr.height), sr.y - (rect.y + rect.height));
            if (Math.hypot(dx, dy) <= 65) {
              nearSearchInput = true;
              break;
            }
          }
        }

        const insideDialog = Boolean(
          node.closest('[role="dialog"], [role="alertdialog"], .modal, .ant-modal, .MuiDialog-root, .drawer')
        );
        const insideHeader = Boolean(
          node.closest('header, [role="banner"], .header, .navbar, .topbar, .ant-layout-header')
        );

        candidates.push({
          candidateId: cid,
          selector,
          tag,
          elemId: node.id || undefined,
          rect,
          svg: {
            viewBox: svgViewBox,
            width: Number.isFinite(svgWidth) ? svgWidth : undefined,
            height: Number.isFinite(svgHeight) ? svgHeight : undefined,
            primitives,
          },
          sidebars,
          aria: {
            ariaExpanded: node.getAttribute('aria-expanded'),
            ariaControls,
            ariaControlsTargetsSidebar,
            ariaHasPopup: node.getAttribute('aria-haspopup'),
            ariaLabel: ariaLabel || null,
            ariaDescribedBy: node.getAttribute('aria-describedby'),
            ariaPressed: node.getAttribute('aria-pressed'),
          },
          nearSearchInput,
          insideDialog,
          insideHeader,
          viewport,
        });
      }

      return candidates;
    },
    { includeLabeled, sidebarSelectors: SIDEBAR_CONTAINER_SELECTORS }
  );
}

/**
 * Luồng định danh End-to-End nút Icon SVG không nhãn trên trang Playwright thực:
 * 1. Quét toàn bộ nút SVG không nhãn + đường biên Sidebar + trạng thái ARIA.
 * 2. Chấm điểm 4 trọng số + kiểm tra biên an toàn (Score >= 85%, Delta_margin >= 20%).
 * 3. Nếu chưa rõ ràng (hoặc bật probeHoverTooltip): kích hoạt Synthetic Hover Tooltip Trap
 *    để thu hoạch tooltip ẩn rồi tái chấm điểm 4 trọng số.
 */
export async function resolveNamelessSvgOnPage(
  page: Page,
  targetHint: string,
  options?: {
    enableHoverTooltipProbe?: boolean;
    alwaysProbeTooltips?: boolean;
    hoverWaitMs?: number;
    includeLabeled?: boolean;
  }
): Promise<SvgResolutionResult> {
  const candidates = await extractNamelessSvgCandidates(page, {
    includeLabeled: options?.includeLabeled,
  });

  if (candidates.length === 0) {
    return resolveNamelessSvgCandidates([], targetHint);
  }

  let initialResult = resolveNamelessSvgCandidates(candidates, targetHint);

  const shouldProbe =
    options?.alwaysProbeTooltips === true ||
    (options?.enableHoverTooltipProbe !== false && !initialResult.safeToClick);

  if (shouldProbe) {
    const probedCandidates: SvgIconCandidateInput[] = [];
    for (const cand of candidates) {
      const tip = await probeHoverTooltip(page, cand.selector, {
        targetHint,
        waitMs: options?.hoverWaitMs ?? 250,
        cleanupHover: true,
      });
      probedCandidates.push({
        ...cand,
        tooltip: tip,
      });
    }
    initialResult = resolveNamelessSvgCandidates(probedCandidates, targetHint);
  }

  return initialResult;
}
