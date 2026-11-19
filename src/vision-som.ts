import type { Page } from 'playwright';
import { AtomicAction, DOMCandidate, XAIDecision } from './types';
import {
  AskGeminiVisionSoMOptions,
  LLMBridge,
  VisionSoMProvider,
  VisionSoMResult,
} from './llm-bridge';
import {
  ANTONYM_BARRIER_MATRIX,
  ANTYNOM_VIOLATION,
  checkAntonymConflict,
  computeDamerauSimilarity,
  getTokens,
  matchFuzzyCandidateText,
  normalizeClean,
  removeVietnameseDiacritics,
} from './element-resolver';

/**
 * Bảng màu độ tương phản cao dành cho Set-of-Marks badges [1], [2], [3]...
 */
export const SOM_BADGE_PALETTE: readonly string[] = [
  '#E53935', // Đỏ tươi
  '#1E88E5', // Xanh dương
  '#2E7D32', // Xanh lá đậm
  '#EF6C00', // Cam đậm
  '#7B1FA2', // Tím
  '#00838F', // Xanh ngọc đậm
  '#C2185B', // Hồng đậm
  '#283593', // Chàm
  '#558B2F', // Xanh rêu
  '#D84315', // Đỏ cam
];

/**
 * Ngưỡng định tuyến chuẩn Prompt 14 (Tiered 3-Level Routing Pipeline):
 * - L1 (0ms Fast-Path): top1 >= 95%, delta >= 30%, không bị Antonym Barrier chặn -> $0, < 2ms
 * - L2 (<5ms Typo & Antonym Healing): top1 >= 85%, delta >= 20%, không bị Antonym Barrier chặn -> $0, < 8ms
 * - L3 (Vision SoM Fallback): Canvas/WebGL, nameless icon fail L1/L2, hoặc vùng tranh chấp (delta < 20% / top1 < 85%)
 */
export const TIER_THRESHOLDS = {
  L1_MIN_SCORE: 0.95,
  L1_MIN_DELTA: 0.30,
  L2_MIN_SCORE: 0.85,
  L2_MIN_DELTA: 0.20,
  L1_TARGET_LATENCY_MS: 2,
  L2_TARGET_LATENCY_MS: 8,
  L3_ESTIMATED_COST_USD: 0.00025,
} as const;

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export type SoMMarkSource = 'DOM_CANDIDATE' | 'CANVAS_GRID' | 'CANVAS_REGION';

export interface SoMMark {
  /** Mã số hiển thị trên ảnh: [1], [2], [3]... (bắt đầu từ 1) */
  id: number;
  /** Bounding Box hình học gốc (đơn vị CSS viewport pixel - bất biến, không ảo giác) */
  rect: BoundingBox;
  /** Tâm hình học gốc của Bounding Box */
  center: Point2D;
  /** Tọa độ tâm badge đã vẽ trên canvas (đã kẹp biên viewport nếu gần mép) */
  badgeCenter: Point2D;
  /** Mã màu hex tương phản cao của badge */
  color: string;
  /** Nguồn gốc của mark */
  source: SoMMarkSource;
  /** Nhãn mô tả phục vụ XAI Audit Trail */
  label: string;
  /** DOMCandidate gốc nếu xuất phát từ DOM */
  candidate?: DOMCandidate;
  /** Selector của thẻ <canvas> nếu xuất phát từ lưới Canvas/WebGL */
  canvasSelector?: string;
}

export interface CanvasSurfaceInfo {
  selectorPath: string;
  elemId?: string;
  ariaLabel?: string;
  rect: BoundingBox;
  childElementCount: number;
  isWebGLHint: boolean;
}

export interface SurfaceInspectionResult {
  hasCanvasOrWebGL: boolean;
  canvasSurfaces: CanvasSurfaceInfo[];
  interactiveDomCount: number;
  isCanvasOnlySurface: boolean;
}

export interface CanvasRegionSpec {
  label?: string;
  rect: BoundingBox;
}

export interface CanvasGridOptions {
  rows?: number;
  cols?: number;
  canvasSelector?: string;
  customRegions?: CanvasRegionSpec[];
  startId?: number;
}

export interface SoMGenerationOptions {
  /** Số lượng badge tối đa (mặc định 50) */
  maxMarks?: number;
  /** Vị trí vẽ badge trên Bounding Box (mặc định 'center' theo đặc tả Prompt 14) */
  badgePlacement?: 'center' | 'top-left';
  /** Cỡ chữ badge (mặc định 14px) */
  fontSize?: number;
  /** Tự động tạo lưới SoM trên <canvas>/WebGL khi không có DOM candidate (mặc định true) */
  includeCanvasGrid?: boolean;
  /** Số hàng lưới SoM cho Canvas/WebGL (mặc định 3) */
  canvasGridRows?: number;
  /** Số cột lưới SoM cho Canvas/WebGL (mặc định 3) */
  canvasGridCols?: number;
  /** Danh sách vùng tùy chỉnh trên Canvas/WebGL (ưu tiên thay cho chia lưới đều nếu cung cấp) */
  customCanvasRegions?: CanvasRegionSpec[];
  /** Có bao gồm candidate nằm ngoài viewport hay không (mặc định false) */
  includeOffscreen?: boolean;
}

export interface SoMOverlayResult {
  /** Ảnh chụp viewport gốc (PNG Buffer) */
  rawScreenshotBuffer: Buffer;
  /** Ảnh PNG đã vẽ các badge [1], [2], [3]... bằng canvas nội bộ (không mutate target DOM) */
  annotatedScreenshotBuffer: Buffer;
  /** Chuỗi base64 PNG sẵn sàng gửi cho Gemini Multimodal inlineData */
  annotatedImageBase64: string;
  /** Danh sách toàn bộ SoM marks theo thứ tự ID */
  marks: SoMMark[];
  /** Bản đồ tra cứu trực tiếp O(1): markId -> SoMMark (chứa BoundingBox hình học gốc) */
  markMap: Map<number, SoMMark>;
  /** Bản đồ dạng object thuần: markId -> SoMMark */
  indexById: Record<number, SoMMark>;
  /** Kích thước viewport & kích thước pixel thực tế của PNG */
  viewport: {
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
  };
  /** Có sử dụng lưới/vùng SoM cho Canvas/WebGL hay không */
  usedCanvasGrid: boolean;
  /** Thời gian vẽ overlay (ms) */
  renderTimeMs: number;
}

export interface MarkLookupResult {
  valid: boolean;
  mark: SoMMark | null;
  candidate: DOMCandidate | null;
  boundingBox: BoundingBox | null;
  clickPoint: Point2D | null;
  rejectedHallucination: boolean;
  reason: string;
}

export type ResolutionTier = 'L1' | 'L2' | 'L3';

export type RoutingTriggerReason =
  | 'L1_DOM_HEURISTIC_FAST_PATH'
  | 'L2_TYPO_ANTONYM_HEALING'
  | 'ANTONYM_BARRIER_BLOCKED'
  | 'CANVAS_OR_WEBGL_SURFACE'
  | 'NAMELESS_ICON_LOW_CONFIDENCE'
  | 'AMBIGUOUS_DISPUTE_ZONE'
  | 'BELOW_CONFIDENCE_THRESHOLD'
  | 'NO_DOM_CANDIDATES';

export interface TierRoutingContext {
  /** Điểm ứng viên Top 1 (hỗ trợ cả thang 0..1 lẫn thang 0..100) */
  top1Score?: number;
  /** Điểm ứng viên Top 2 (hỗ trợ cả thang 0..1 lẫn thang 0..100) */
  top2Score?: number;
  /** Chênh lệch Top1 - Top2 (hỗ trợ cả thang 0..1 lẫn thang 0..100; tự tính nếu thiếu) */
  marginDelta?: number;
  /** Top 1 có được chữa lành chính tả qua Damerau-Levenshtein (distance >= 1) hay không */
  isTypoHealed?: boolean;
  /** Khoảng cách Damerau-Levenshtein nếu có */
  damerauDistance?: number;
  /** Có bị Hàng rào từ trái nghĩa (Antonym Barrier) chặn hay không */
  antonymBlocked?: boolean;
  /** Bề mặt mục tiêu là <canvas> hoặc WebGL (0 phần tử DOM con tương tác) */
  isCanvasOrWebGL?: boolean;
  /** Ứng viên mục tiêu là nút icon thuần túy không có text/nhãn trợ năng */
  isNamelessIcon?: boolean;
  /** Số lượng ứng viên DOM hợp lệ (sau khi lọc Antonym) */
  candidateCount?: number;
  /** Danh sách ứng viên DOM (tùy chọn, dùng để tự suy luận nameless icon / canvas) */
  candidates?: DOMCandidate[];
}

export interface TierRoutingDecision {
  tier: ResolutionTier;
  triggerReason: RoutingTriggerReason;
  requiresVisionSoM: boolean;
  antonymBlocked: boolean;
  normalizedTop1Score: number;
  normalizedTop2Score: number;
  normalizedMarginDelta: number;
  isCanvasOrWebGL: boolean;
  isNamelessIcon: boolean;
  estimatedCostUsd: number;
  reasoning: string;
}

export interface RoutingTelemetry {
  tier: ResolutionTier;
  triggerReason: RoutingTriggerReason;
  latencyMs: number;
  estimatedCostUsd: number;
  apiCalled: boolean;
  top1ScoreNormalized: number;
  top2ScoreNormalized: number;
  marginDeltaNormalized: number;
  isCanvasOrWebGL: boolean;
  isNamelessIcon: boolean;
  antonymBlocked: boolean;
  damerauDistance?: number;
  damerauSimilarity?: number;
  somMarkId?: number | null;
  somMarkCount?: number;
  resolvedBox?: BoundingBox | null;
  clickPoint?: Point2D | null;
  rejectedHallucination?: boolean;
  provider?: string;
  reasoning: string;
}

export interface TieredExecutionContext {
  /** AtomicAction hoặc thông tin hành động */
  action?: AtomicAction;
  actionType?: string;
  targetHint?: string;
  /** Danh sách ứng viên DOM hiện tại */
  candidates?: DOMCandidate[];
  /** Playwright Page (dùng khi kích hoạt L3 Vision SoM hoặc quét Canvas/WebGL) */
  page?: Page;
  /** Overlay SoM đã tạo sẵn (tùy chọn, tránh chụp lại màn hình) */
  somOverlay?: SoMOverlayResult;
  /** Tùy chọn sinh SoM overlay */
  somOptions?: SoMGenerationOptions;
  /** Provider Multimodal tùy chỉnh (inject cho test offline $0) */
  visionProvider?: VisionSoMProvider;
  /** Tùy chọn nâng cao truyền vào askGeminiVisionSoM */
  visionOptions?: AskGeminiVisionSoMOptions;

  // --- Các trường Pre-Scored tùy chọn (hỗ trợ tích hợp Stage 2 từ element-resolver & test ranh giới ngưỡng) ---
  top1Score?: number;
  top2Score?: number;
  marginDelta?: number;
  top1Candidate?: DOMCandidate | null;
  isTypoHealed?: boolean;
  damerauDistance?: number;
  damerauSimilarity?: number;
  antonymBlocked?: boolean;
  antonymReason?: string;
  isCanvasOrWebGL?: boolean;
  isNamelessIcon?: boolean;
}

export interface TieredResolutionResult {
  resolved: boolean;
  tier: ResolutionTier;
  triggerReason: RoutingTriggerReason;
  candidate: DOMCandidate | null;
  resolvedBox: BoundingBox | null;
  clickPoint: Point2D | null;
  somMarkId: number | null;
  somMark: SoMMark | null;
  somOverlay?: SoMOverlayResult;
  visionResult?: VisionSoMResult;
  apiCalled: boolean;
  rejectedHallucination: boolean;
  antonymBlocked: boolean;
  latencyMs: number;
  estimatedCostUsd: number;
  flag?: string;
  reasoning: string;
  telemetry: RoutingTelemetry;
}

/**
 * Kiểm tra chữ ký byte đầu của tệp PNG hợp lệ (89 50 4E 47 0D 0A 1A 0A).
 */
export function isValidPngBuffer(buf: Buffer | null | undefined): boolean {
  if (!buf || buf.length < 24) return false;
  return (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

/**
 * Đọc kích thước (width, height) trực tiếp từ header IHDR của PNG Buffer.
 */
export function readPngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (!isValidPngBuffer(buf)) return null;
  // IHDR chunk name nằm ở bytes 12..15
  const chunkType = buf.subarray(12, 16).toString('ascii');
  if (chunkType !== 'IHDR') return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * Nhận diện ứng viên là nút Icon thuần túy không có văn bản hay nhãn trợ năng.
 */
export function isNamelessIconCandidate(candidate: DOMCandidate): boolean {
  if (!candidate) return false;
  const hasText = Boolean((candidate.text || '').trim());
  const hasLabel = Boolean(
    (candidate.ariaLabel || '').trim() ||
    (candidate.placeholder || '').trim() ||
    (candidate.nearLabel || '').trim() ||
    (candidate.value || '').trim()
  );
  if (hasText || hasLabel) return false;

  const tag = (candidate.tag || '').toLowerCase();
  const role = (candidate.role || '').toLowerCase();
  const classes = (candidate.fingerprint?.stableClasses || []).join(' ').toLowerCase();
  const selector = (candidate.selectorPath || '').toLowerCase();

  return (
    tag === 'button' ||
    tag === 'a' ||
    tag === 'svg' ||
    role === 'button' ||
    classes.includes('icon') ||
    selector.includes('svg') ||
    selector.includes('icon')
  );
}

/**
 * Quét bề mặt trang Playwright để phát hiện phần tử <canvas> / WebGL có 0 phần tử DOM con tương tác.
 * Hoàn toàn read-only (0 DOM mutations, không khai báo hàm nội bộ để tránh lỗi __name của esbuild).
 */
export async function detectCanvasWebGLSurfaces(page: Page): Promise<SurfaceInspectionResult> {
  return page.evaluate(() => {
    const vpW = window.innerWidth || 1280;
    const vpH = window.innerHeight || 720;
    const canvases = Array.from(document.querySelectorAll('canvas'));
    const canvasSurfaces: Array<{
      selectorPath: string;
      elemId?: string;
      ariaLabel?: string;
      rect: { x: number; y: number; width: number; height: number };
      childElementCount: number;
      isWebGLHint: boolean;
    }> = [];

    for (let i = 0; i < canvases.length; i++) {
      const c = canvases[i];
      const style = window.getComputedStyle(c);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        continue;
      }
      const r = c.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) continue;
      if (r.right <= 0 || r.bottom <= 0 || r.left >= vpW || r.top >= vpH) continue;

      const interactiveChildren = c.querySelectorAll(
        'button, a, input, select, textarea, [role="button"], [role="link"]'
      ).length;

      const id = c.id || undefined;
      const ariaLabel = c.getAttribute('aria-label') || undefined;
      const meta = `${c.id} ${c.className} ${c.getAttribute('data-engine') || ''} ${c.getAttribute('data-context') || ''} ${ariaLabel || ''}`.toLowerCase();
      const isWebGLHint =
        meta.includes('webgl') ||
        meta.includes('three') ||
        meta.includes('gl') ||
        meta.includes('3d') ||
        meta.includes('babylon') ||
        meta.includes('pixi');

      const selectorPath = id ? `canvas#${id}` : `canvas:nth-of-type(${i + 1})`;
      canvasSurfaces.push({
        selectorPath,
        elemId: id,
        ariaLabel,
        rect: {
          x: Math.round(r.x * 100) / 100,
          y: Math.round(r.y * 100) / 100,
          width: Math.round(r.width * 100) / 100,
          height: Math.round(r.height * 100) / 100,
        },
        childElementCount: interactiveChildren,
        isWebGLHint,
      });
    }

    const interactiveNodes = document.querySelectorAll(
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="textbox"]'
    );
    let interactiveDomCount = 0;
    for (let i = 0; i < interactiveNodes.length; i++) {
      const el = interactiveNodes[i] as HTMLElement;
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < vpW && rect.top < vpH) {
        interactiveDomCount++;
      }
    }

    const hasCanvasOrWebGL = canvasSurfaces.some((cs) => cs.childElementCount === 0);
    return {
      hasCanvasOrWebGL,
      canvasSurfaces,
      interactiveDomCount,
      isCanvasOnlySurface: hasCanvasOrWebGL && interactiveDomCount === 0,
    };
  });
}

/**
 * Xây dựng các vùng/lưới Set-of-Marks (SoM) phủ lên Bounding Box của thẻ <canvas> / WebGL
 * khi không có phần tử DOM con để Vision AI có thể chọn chính xác vùng tọa độ cần thao tác.
 */
export function buildCanvasGridMarks(
  canvasRect: BoundingBox,
  options: CanvasGridOptions = {}
): SoMMark[] {
  const startId = options.startId ?? 1;
  const canvasSelector = options.canvasSelector || 'canvas';
  const marks: SoMMark[] = [];

  if (options.customRegions && options.customRegions.length > 0) {
    let nextId = startId;
    for (let i = 0; i < options.customRegions.length; i++) {
      const region = options.customRegions[i];
      if (region.rect.width <= 0 || region.rect.height <= 0) continue;
      const rect: BoundingBox = {
        x: Math.round(region.rect.x * 100) / 100,
        y: Math.round(region.rect.y * 100) / 100,
        width: Math.round(region.rect.width * 100) / 100,
        height: Math.round(region.rect.height * 100) / 100,
      };
      const center: Point2D = {
        x: Math.round((rect.x + rect.width / 2) * 100) / 100,
        y: Math.round((rect.y + rect.height / 2) * 100) / 100,
      };
      marks.push({
        id: nextId,
        rect,
        center,
        badgeCenter: { ...center },
        color: SOM_BADGE_PALETTE[(nextId - 1) % SOM_BADGE_PALETTE.length],
        source: 'CANVAS_REGION',
        label: region.label || `Canvas Region ${i + 1}`,
        canvasSelector,
      });
      nextId++;
    }
    return marks;
  }

  const rows = Math.max(1, Math.min(8, options.rows ?? 3));
  const cols = Math.max(1, Math.min(8, options.cols ?? 3));
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return marks;

  const cellW = canvasRect.width / cols;
  const cellH = canvasRect.height / rows;
  let nextId = startId;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rect: BoundingBox = {
        x: Math.round((canvasRect.x + c * cellW) * 100) / 100,
        y: Math.round((canvasRect.y + r * cellH) * 100) / 100,
        width: Math.round(cellW * 100) / 100,
        height: Math.round(cellH * 100) / 100,
      };
      const center: Point2D = {
        x: Math.round((rect.x + rect.width / 2) * 100) / 100,
        y: Math.round((rect.y + rect.height / 2) * 100) / 100,
      };
      marks.push({
        id: nextId,
        rect,
        center,
        badgeCenter: { ...center },
        color: SOM_BADGE_PALETTE[(nextId - 1) % SOM_BADGE_PALETTE.length],
        source: 'CANVAS_GRID',
        label: `Canvas Grid R${r + 1}C${c + 1}`,
        canvasSelector,
      });
      nextId++;
    }
  }

  return marks;
}

/**
 * Set-of-Marks (SoM) Visual Indexing Engine (Prompt 14):
 * 1. Chụp ảnh viewport hiện tại bằng Playwright (`page.screenshot()`).
 * 2. Vẽ các badge số màu sắc độ tương phản cao `[1]`, `[2]`, `[3]`... lên chính giữa Bounding Box
 *    của từng ứng viên tương tác bằng HTML5 `<canvas>` nội bộ tách biệt (detached canvas)
 *    -> TUYỆT ĐỐI KHÔNG mutate DOM trang đích và không để lại bất kỳ rác HTML nào.
 * 3. Khi giao diện là `<canvas>` / WebGL có 0 DOM con: tự động sinh lưới/vùng SoM trên bề mặt `<canvas>`.
 * 4. Trả về ảnh PNG đã gắn nhãn + bản đồ `markId -> SoMMark` giữ nguyên Bounding Box hình học gốc.
 */
export async function generateSetOfMarks(
  page: Page,
  candidates: DOMCandidate[],
  options: SoMGenerationOptions = {}
): Promise<SoMOverlayResult> {
  const t0 = performance.now();
  const maxMarks = options.maxMarks ?? 50;
  const badgePlacement = options.badgePlacement ?? 'center';
  const fontSize = options.fontSize ?? 14;
  const includeCanvasGrid = options.includeCanvasGrid !== false;
  const includeOffscreen = options.includeOffscreen ?? false;

  const viewportSize = page.viewportSize() || { width: 1280, height: 720 };

  // Phân tách ứng viên DOM thường và thẻ <canvas> (không bao giờ âm thầm loại bỏ <canvas> trong tập hỗn hợp)
  const nonCanvasDomCandidates: DOMCandidate[] = [];
  const explicitCanvasCandidates: DOMCandidate[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c || !c.rect) continue;
    if (c.rect.width <= 0 || c.rect.height <= 0) continue;
    if (!includeOffscreen) {
      const inView =
        c.rect.x + c.rect.width > 0 &&
        c.rect.y + c.rect.height > 0 &&
        c.rect.x < viewportSize.width &&
        c.rect.y < viewportSize.height;
      if (!inView) continue;
    }
    if (includeCanvasGrid && c.tag.toLowerCase() === 'canvas') {
      explicitCanvasCandidates.push(c);
      continue;
    }
    nonCanvasDomCandidates.push(c);
  }

  const hadCanvasCandidate = explicitCanvasCandidates.length > 0;
  const marks: SoMMark[] = [];
  let usedCanvasGrid = false;

  for (let i = 0; i < Math.min(nonCanvasDomCandidates.length, maxMarks); i++) {
    const cand = nonCanvasDomCandidates[i];
    const id = marks.length + 1;
    // Bảo toàn tuyệt đối tọa độ hình học gốc (không làm tròn làm lệch sub-pixel DOM rect)
    const rect: BoundingBox = {
      x: cand.rect.x,
      y: cand.rect.y,
      width: cand.rect.width,
      height: cand.rect.height,
    };
    const center: Point2D = {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
    const label =
      (cand.text || cand.ariaLabel || cand.placeholder || cand.nearLabel || cand.elemId || `<${cand.tag}>`).trim();

    marks.push({
      id,
      rect,
      center,
      badgeCenter: { ...center },
      color: SOM_BADGE_PALETTE[(id - 1) % SOM_BADGE_PALETTE.length],
      source: 'DOM_CANDIDATE',
      label,
      candidate: cand,
    });
  }

  // Sinh lưới/vùng SoM cho Canvas/WebGL khi:
  // (a) Không có DOM candidate tương tác (canvas-only), HOẶC
  // (b) Danh sách ứng viên hỗn hợp có chứa <canvas> tường minh (hadCanvasCandidate), HOẶC
  // (c) Caller cung cấp customCanvasRegions
  const shouldGenerateCanvasGrid =
    includeCanvasGrid &&
    (marks.length === 0 ||
      hadCanvasCandidate ||
      Boolean(options.customCanvasRegions && options.customCanvasRegions.length > 0));

  if (shouldGenerateCanvasGrid && marks.length < maxMarks) {
    let canvasTargets: Array<{ rect: BoundingBox; selectorPath: string }> = [];

    if (hadCanvasCandidate) {
      canvasTargets = explicitCanvasCandidates.map((c) => ({
        rect: {
          x: c.rect.x,
          y: c.rect.y,
          width: c.rect.width,
          height: c.rect.height,
        },
        selectorPath: c.selectorPath || (c.elemId ? `canvas#${c.elemId}` : 'canvas'),
      }));
    } else {
      const inspection = await detectCanvasWebGLSurfaces(page);
      canvasTargets = inspection.canvasSurfaces.map((s) => ({
        rect: s.rect,
        selectorPath: s.selectorPath,
      }));
    }

    for (const surface of canvasTargets) {
      if (marks.length >= maxMarks) break;
      const remaining = maxMarks - marks.length;
      const gridMarks = buildCanvasGridMarks(surface.rect, {
        rows: options.canvasGridRows ?? 3,
        cols: options.canvasGridCols ?? 3,
        canvasSelector: surface.selectorPath,
        customRegions: options.customCanvasRegions,
        startId: marks.length + 1,
      }).slice(0, remaining);
      marks.push(...gridMarks);
      if (gridMarks.length > 0) {
        usedCanvasGrid = true;
      }
    }
  }

  // 1. Chụp ảnh viewport gốc từ Playwright
  const rawScreenshotBuffer = await page.screenshot({ type: 'png', fullPage: false });
  const rawBase64 = rawScreenshotBuffer.toString('base64');

  // 2. Vẽ các badge [1], [2], [3]... trên HTML5 <canvas> nội bộ tách biệt (KHÔNG gắn vào DOM)
  const renderPayload = {
    rawBase64,
    marks: marks.map((m) => ({
      id: m.id,
      x: m.rect.x,
      y: m.rect.y,
      width: m.rect.width,
      height: m.rect.height,
      color: m.color,
    })),
    badgePlacement,
    fontSize,
  };

  const rendered = await page.evaluate(async (payload) => {
    const binaryStr = atob(payload.rawBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);

    const imgW = bitmap.width;
    const imgH = bitmap.height;
    const vpW = window.innerWidth || imgW;
    const vpH = window.innerHeight || imgH;
    const scaleX = vpW > 0 ? imgW / vpW : 1;
    const scaleY = vpH > 0 ? imgH / vpH : 1;

    // Detached HTML5 <canvas>: hoàn toàn nằm trong bộ nhớ, KHÔNG bao giờ appendChild vào document!
    const canvas = document.createElement('canvas');
    canvas.width = imgW;
    canvas.height = imgH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      throw new Error('Không thể khởi tạo CanvasRenderingContext2D nội bộ cho Set-of-Marks');
    }

    // Vẽ ảnh chụp màn hình gốc
    ctx.drawImage(bitmap, 0, 0, imgW, imgH);
    bitmap.close();

    const scaledFontSize = Math.max(12, Math.round(payload.fontSize * Math.min(scaleX, scaleY)));
    ctx.font = `bold ${scaledFontSize}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const badgeCenters: Array<{ id: number; x: number; y: number }> = [];

    for (let i = 0; i < payload.marks.length; i++) {
      const m = payload.marks[i];
      const rx = m.x * scaleX;
      const ry = m.y * scaleY;
      const rw = m.width * scaleX;
      const rh = m.height * scaleY;

      ctx.save();

      // Khung viền Bounding Box có halo trắng tương phản cao
      ctx.lineWidth = Math.max(2, Math.round(2 * scaleX));
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.strokeRect(rx - 1, ry - 1, rw + 2, rh + 2);
      ctx.strokeStyle = m.color;
      ctx.strokeRect(rx, ry, rw, rh);

      // Tính kích thước nhãn [1], [2], [3]...
      const labelText = `[${m.id}]`;
      const textWidth = ctx.measureText(labelText).width;
      const padX = Math.max(6, Math.round(6 * scaleX));
      const padY = Math.max(4, Math.round(4 * scaleY));
      const badgeW = Math.max(Math.round(30 * scaleX), Math.ceil(textWidth + padX * 2));
      const badgeH = Math.max(Math.round(22 * scaleY), Math.ceil(scaledFontSize + padY * 2));

      let cx = payload.badgePlacement === 'top-left' ? rx + badgeW / 2 : rx + rw / 2;
      let cy = payload.badgePlacement === 'top-left' ? ry + badgeH / 2 : ry + rh / 2;

      cx = Math.max(badgeW / 2 + 1, Math.min(imgW - badgeW / 2 - 1, cx));
      cy = Math.max(badgeH / 2 + 1, Math.min(imgH - badgeH / 2 - 1, cy));

      const bx = Math.round(cx - badgeW / 2);
      const by = Math.round(cy - badgeH / 2);
      const radius = Math.min(6, Math.floor(badgeH / 3));

      // Vẽ hộp badge bo tròn nền màu đậm
      ctx.beginPath();
      ctx.moveTo(bx + radius, by);
      ctx.lineTo(bx + badgeW - radius, by);
      ctx.quadraticCurveTo(bx + badgeW, by, bx + badgeW, by + radius);
      ctx.lineTo(bx + badgeW, by + badgeH - radius);
      ctx.quadraticCurveTo(bx + badgeW, by + badgeH, bx + badgeW - radius, by + badgeH);
      ctx.lineTo(bx + radius, by + badgeH);
      ctx.quadraticCurveTo(bx, by + badgeH, bx, by + badgeH - radius);
      ctx.lineTo(bx, by + radius);
      ctx.quadraticCurveTo(bx, by, bx + radius, by);
      ctx.closePath();

      ctx.fillStyle = m.color;
      ctx.fill();

      // Viền trắng nổi bật chống chìm màu nền
      ctx.lineWidth = Math.max(2, Math.round(2 * scaleX));
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();

      // Vẽ chữ trắng đậm chính giữa badge
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(labelText, cx, cy + 0.5);

      ctx.restore();

      badgeCenters.push({
        id: m.id,
        x: Math.round((cx / scaleX) * 100) / 100,
        y: Math.round((cy / scaleY) * 100) / 100,
      });
    }

    const dataUrl = canvas.toDataURL('image/png');
    const annotatedBase64 = dataUrl.replace(/^data:image\/png;base64,/, '');

    return {
      annotatedBase64,
      viewportWidth: vpW,
      viewportHeight: vpH,
      imageWidth: imgW,
      imageHeight: imgH,
      badgeCenters,
    };
  }, renderPayload);

  // Cập nhật tọa độ badgeCenter thực tế trong khi bảo toàn 100% rect & center gốc
  const badgeCenterById = new Map<number, Point2D>();
  for (const bc of rendered.badgeCenters) {
    badgeCenterById.set(bc.id, { x: bc.x, y: bc.y });
  }

  const markMap = new Map<number, SoMMark>();
  const indexById: Record<number, SoMMark> = {};
  for (const mark of marks) {
    const actualBadgeCenter = badgeCenterById.get(mark.id);
    if (actualBadgeCenter) {
      mark.badgeCenter = actualBadgeCenter;
    }
    markMap.set(mark.id, mark);
    indexById[mark.id] = mark;
  }

  const annotatedScreenshotBuffer = Buffer.from(rendered.annotatedBase64, 'base64');
  const renderTimeMs = Math.round((performance.now() - t0) * 1000) / 1000;

  return {
    rawScreenshotBuffer,
    annotatedScreenshotBuffer,
    annotatedImageBase64: rendered.annotatedBase64,
    marks,
    markMap,
    indexById,
    viewport: {
      width: rendered.viewportWidth,
      height: rendered.viewportHeight,
      imageWidth: rendered.imageWidth,
      imageHeight: rendered.imageHeight,
    },
    usedCanvasGrid,
    renderTimeMs,
  };
}

/**
 * Tra cứu ngược từ Mark ID số nguyên AI trả về sang Bounding Box hình học gốc.
 * Anti-Hallucination Guard: từ chối mọi ID ngoài phạm vi, không nguyên, âm, hoặc không tồn tại.
 */
export function resolveMarkIdToBoundingBox(
  somOverlay: SoMOverlayResult,
  markId: number | null | undefined
): MarkLookupResult {
  if (markId === null || markId === undefined) {
    return {
      valid: false,
      mark: null,
      candidate: null,
      boundingBox: null,
      clickPoint: null,
      rejectedHallucination: false,
      reason: 'Không có Mark ID được chọn từ Vision SoM',
    };
  }

  if (typeof markId !== 'number' || !Number.isInteger(markId) || markId <= 0) {
    return {
      valid: false,
      mark: null,
      candidate: null,
      boundingBox: null,
      clickPoint: null,
      rejectedHallucination: true,
      reason: `[ANTI-HALLUCINATION] Mark ID không phải số nguyên dương hợp lệ (${String(markId)})`,
    };
  }

  const mark = somOverlay.markMap.get(markId);
  if (!mark) {
    return {
      valid: false,
      mark: null,
      candidate: null,
      boundingBox: null,
      clickPoint: null,
      rejectedHallucination: true,
      reason: `[ANTI-HALLUCINATION] Mark ID [${markId}] không tồn tại trong bản đồ SoM (phạm vi hợp lệ: 1..${somOverlay.marks.length})`,
    };
  }

  return {
    valid: true,
    mark,
    candidate: mark.candidate ?? null,
    boundingBox: { ...mark.rect },
    clickPoint: { ...mark.center },
    rejectedHallucination: false,
    reason: `Ánh xạ trực tiếp Mark [${mark.id}] -> BoundingBox(${mark.rect.x}, ${mark.rect.y}, ${mark.rect.width}x${mark.rect.height})`,
  };
}

/**
 * Chuẩn hóa điểm/delta về thang [0.0, 1.0] đồng nhất (hỗ trợ cả đầu vào 0..1 và 0..100).
 */
function normalizeTierRates(
  top1Raw?: number,
  top2Raw?: number,
  deltaRaw?: number
): { top1: number; top2: number; delta: number } {
  const samples = [top1Raw, top2Raw, deltaRaw].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v)
  );
  const isPercentageScale = samples.some((v) => v > 1);
  const divisor = isPercentageScale ? 100 : 1;

  const clamp01 = (val: number): number => {
    const normalized = val / divisor;
    const clamped = Math.max(0, Math.min(1, normalized));
    return Math.round(clamped * 10000) / 10000;
  };

  const top1 = top1Raw !== undefined && Number.isFinite(top1Raw) ? clamp01(top1Raw) : 0;
  const top2 = top2Raw !== undefined && Number.isFinite(top2Raw) ? clamp01(top2Raw) : 0;

  let delta: number;
  if (deltaRaw !== undefined && Number.isFinite(deltaRaw)) {
    delta = clamp01(deltaRaw);
  } else {
    delta = Math.round(Math.max(0, top1 - top2) * 10000) / 10000;
  }

  return { top1, top2, delta };
}

/**
 * Bộ định tuyến 3 tầng chuẩn Prompt 14 (Tiered 3-Level Routing Pipeline):
 * - Level L1 (0ms Fast-Path): DOM Heuristic Fast-Path khi top1 >= 95% AND delta >= 30% AND không bị Antonym Barrier chặn -> $0, < 2ms.
 * - Level L2 (<5ms Typo & Antonym Healing): Damerau-Levenshtein Typo Healing & Antonym Barrier khi L1 không kích hoạt nhưng top1 >= 85% AND delta >= 20% -> $0, < 8ms.
 * - Level L3 (Vision SoM Fallback): CHỈ kích hoạt khi thỏa 1 trong 3 điều kiện nghiêm ngặt:
 *   (a) Bề mặt mục tiêu là <canvas> hoặc WebGL (0 DOM con), HOẶC
 *   (b) Nút icon thuần túy không có text và L1/L2 không đạt ngưỡng tin cậy, HOẶC
 *   (c) Vùng mờ tranh chấp (delta < 20% hoặc top1 < 85%).
 */
export function routeResolutionTier(context: TierRoutingContext): TierRoutingDecision {
  const { top1, top2, delta } = normalizeTierRates(
    context.top1Score,
    context.top2Score,
    context.marginDelta
  );

  const candidates = context.candidates ?? [];
  const candidateCount = context.candidateCount ?? candidates.length;

  const inferredCanvas =
    context.isCanvasOrWebGL === true ||
    (candidates.length > 0 && candidates.every((c) => c.tag.toLowerCase() === 'canvas'));

  const inferredNamelessIcon =
    context.isNamelessIcon === true ||
    (candidates.length > 0 && candidates.every((c) => isNamelessIconCandidate(c)));

  const antonymBlocked = context.antonymBlocked === true;
  const isTypoHealed =
    context.isTypoHealed === true ||
    (typeof context.damerauDistance === 'number' && context.damerauDistance > 0);

  // Điều kiện L3 (a): Bề mặt <canvas> / WebGL không có DOM con tương tác
  if (inferredCanvas) {
    return {
      tier: 'L3',
      triggerReason: 'CANVAS_OR_WEBGL_SURFACE',
      requiresVisionSoM: true,
      antonymBlocked: false,
      normalizedTop1Score: top1,
      normalizedTop2Score: top2,
      normalizedMarginDelta: delta,
      isCanvasOrWebGL: true,
      isNamelessIcon: inferredNamelessIcon,
      estimatedCostUsd: TIER_THRESHOLDS.L3_ESTIMATED_COST_USD,
      reasoning:
        'Bề mặt mục tiêu là <canvas>/WebGL (0 phần tử DOM con) -> Định tuyến thẳng tầng L3 Vision SoM.',
    };
  }

  // Bảo vệ Antonym Barrier (L2 Guardrail): Không bao giờ cho qua L1 hoặc gọi Vision API vào bẫy đối lập
  if (antonymBlocked) {
    return {
      tier: 'L2',
      triggerReason: 'ANTONYM_BARRIER_BLOCKED',
      requiresVisionSoM: false,
      antonymBlocked: true,
      normalizedTop1Score: top1,
      normalizedTop2Score: top2,
      normalizedMarginDelta: delta,
      isCanvasOrWebGL: false,
      isNamelessIcon: inferredNamelessIcon,
      estimatedCostUsd: 0,
      reasoning:
        'Hàng rào từ trái nghĩa (Antonym Barrier) tại tầng L2 đã phủ quyết mục tiêu đối lập ($0, không gọi Vision API).',
    };
  }

  // Không có DOM candidate nào (khi có danh sách ứng viên được cung cấp)
  if (context.candidates !== undefined && candidateCount === 0 && top1 === 0) {
    return {
      tier: 'L3',
      triggerReason: 'NO_DOM_CANDIDATES',
      requiresVisionSoM: true,
      antonymBlocked: false,
      normalizedTop1Score: top1,
      normalizedTop2Score: top2,
      normalizedMarginDelta: delta,
      isCanvasOrWebGL: false,
      isNamelessIcon: inferredNamelessIcon,
      estimatedCostUsd: TIER_THRESHOLDS.L3_ESTIMATED_COST_USD,
      reasoning:
        'Không có ứng viên DOM tương tác phù hợp -> Kích hoạt tầng L3 Vision SoM Fallback.',
    };
  }

  // Tầng L1 (0ms Fast-Path): DOM Heuristic điểm >= 95% VÀ Delta >= 30% VÀ không phải ca chữa lỗi chính tả
  if (
    !isTypoHealed &&
    top1 >= TIER_THRESHOLDS.L1_MIN_SCORE &&
    delta >= TIER_THRESHOLDS.L1_MIN_DELTA
  ) {
    return {
      tier: 'L1',
      triggerReason: 'L1_DOM_HEURISTIC_FAST_PATH',
      requiresVisionSoM: false,
      antonymBlocked: false,
      normalizedTop1Score: top1,
      normalizedTop2Score: top2,
      normalizedMarginDelta: delta,
      isCanvasOrWebGL: false,
      isNamelessIcon: inferredNamelessIcon,
      estimatedCostUsd: 0,
      reasoning: `Tầng L1 Fast-Path: Top1 ${(top1 * 100).toFixed(1)}% >= 95% và Delta ${(delta * 100).toFixed(1)}% >= 30% ($0, < 2ms).`,
    };
  }

  // Tầng L2 (<5ms Typo & Antonym Healing): Đạt ngưỡng an toàn >= 85% VÀ Delta >= 20%
  if (
    top1 >= TIER_THRESHOLDS.L2_MIN_SCORE &&
    delta >= TIER_THRESHOLDS.L2_MIN_DELTA
  ) {
    return {
      tier: 'L2',
      triggerReason: 'L2_TYPO_ANTONYM_HEALING',
      requiresVisionSoM: false,
      antonymBlocked: false,
      normalizedTop1Score: top1,
      normalizedTop2Score: top2,
      normalizedMarginDelta: delta,
      isCanvasOrWebGL: false,
      isNamelessIcon: inferredNamelessIcon,
      estimatedCostUsd: 0,
      reasoning: isTypoHealed
        ? `Tầng L2 Typo Healing: Chữa lành Damerau-Levenshtein đạt ${(top1 * 100).toFixed(1)}% >= 85% và Delta ${(delta * 100).toFixed(1)}% >= 20% ($0, < 8ms).`
        : `Tầng L2 Heuristic & Antonym Safe-Path: Top1 ${(top1 * 100).toFixed(1)}% >= 85% và Delta ${(delta * 100).toFixed(1)}% >= 20% ($0, < 8ms).`,
    };
  }

  // Tầng L3 (Vision SoM Fallback) - Điều kiện (b): Nút icon thuần túy không có text và L1/L2 không đạt ngưỡng
  if (inferredNamelessIcon) {
    return {
      tier: 'L3',
      triggerReason: 'NAMELESS_ICON_LOW_CONFIDENCE',
      requiresVisionSoM: true,
      antonymBlocked: false,
      normalizedTop1Score: top1,
      normalizedTop2Score: top2,
      normalizedMarginDelta: delta,
      isCanvasOrWebGL: false,
      isNamelessIcon: true,
      estimatedCostUsd: TIER_THRESHOLDS.L3_ESTIMATED_COST_USD,
      reasoning: `Tầng L3 Vision SoM: Nút icon không nhãn (nameless icon) không đạt ngưỡng L1/L2 (Top1 ${(top1 * 100).toFixed(1)}%, Delta ${(delta * 100).toFixed(1)}%).`,
    };
  }

  // Tầng L3 (Vision SoM Fallback) - Điều kiện (c): Vùng mờ tranh chấp (Delta < 20% hoặc Top1 < 85%)
  const isAmbiguousDelta = delta < TIER_THRESHOLDS.L2_MIN_DELTA;
  return {
    tier: 'L3',
    triggerReason: isAmbiguousDelta ? 'AMBIGUOUS_DISPUTE_ZONE' : 'BELOW_CONFIDENCE_THRESHOLD',
    requiresVisionSoM: true,
    antonymBlocked: false,
    normalizedTop1Score: top1,
    normalizedTop2Score: top2,
    normalizedMarginDelta: delta,
    isCanvasOrWebGL: false,
    isNamelessIcon: false,
    estimatedCostUsd: TIER_THRESHOLDS.L3_ESTIMATED_COST_USD,
    reasoning: isAmbiguousDelta
      ? `Tầng L3 Vision SoM: Vùng mờ tranh chấp Delta ${(delta * 100).toFixed(1)}% < 20% (Top1 ${(top1 * 100).toFixed(1)}%, Top2 ${(top2 * 100).toFixed(1)}%).`
      : `Tầng L3 Vision SoM: Độ tự tin Top1 ${(top1 * 100).toFixed(1)}% < 85% không đạt ngưỡng an toàn L1/L2.`,
  };
}

export interface FastTierScoreItem {
  candidate: DOMCandidate;
  score: number;
  isTypoHealed: boolean;
  damerauDistance?: number;
  damerauSimilarity?: number;
  hasAntonymViolation: boolean;
  antonymReason?: string;
}

export interface FastTierScoreSummary {
  validSorted: FastTierScoreItem[];
  top1: FastTierScoreItem | null;
  top2: FastTierScoreItem | null;
  top1Score: number;
  top2Score: number;
  marginDelta: number;
  allAntonymBlocked: boolean;
  anyAntonymBlocked: boolean;
  antonymReason?: string;
  allNamelessIcons: boolean;
}

interface IndexedAntonymKeyword {
  raw: string;
  norm: string;
  noAcc: string;
}

interface IndexedAntonymPair {
  category: string;
  groupA: IndexedAntonymKeyword[];
  groupB: IndexedAntonymKeyword[];
}

const INDEXED_ANTONYM_PAIRS: IndexedAntonymPair[] = ANTONYM_BARRIER_MATRIX.map((pair) => ({
  category: pair.category,
  groupA: pair.groupA.map((raw) => {
    const norm = normalizeClean(raw);
    return { raw, norm, noAcc: removeVietnameseDiacritics(norm) };
  }),
  groupB: pair.groupB.map((raw) => {
    const norm = normalizeClean(raw);
    return { raw, norm, noAcc: removeVietnameseDiacritics(norm) };
  }),
}));

function isWordCharCode(code: number): boolean {
  return (
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    (code >= 0x00c0 && code <= 0x1ef9)
  );
}

function containsWholePhraseFast(text: string, phrase: string): boolean {
  if (!text || !phrase) return false;
  if (text === phrase) return true;
  let pos = text.indexOf(phrase);
  while (pos !== -1) {
    const beforeOk = pos === 0 || !isWordCharCode(text.charCodeAt(pos - 1));
    const end = pos + phrase.length;
    const afterOk = end === text.length || !isWordCharCode(text.charCodeAt(end));
    if (beforeOk && afterOk) return true;
    pos = text.indexOf(phrase, pos + 1);
  }
  return false;
}

function matchGroupFast(
  norm: string,
  noAcc: string,
  group: IndexedAntonymKeyword[],
  allowFuzzy: boolean
): { matches: boolean; keyword?: string; distance?: number } {
  if (!norm) return { matches: false };

  for (let i = 0; i < group.length; i++) {
    const kw = group[i];
    if (containsWholePhraseFast(norm, kw.norm) || containsWholePhraseFast(noAcc, kw.noAcc)) {
      return { matches: true, keyword: kw.raw, distance: 0 };
    }
  }

  if (allowFuzzy) {
    for (let i = 0; i < group.length; i++) {
      const kw = group[i];
      if (norm.length > kw.norm.length + 2) continue;
      if (Math.abs(norm.length - kw.norm.length) > 2 && !kw.norm.includes(' ')) continue;
      const fuzzy = matchFuzzyCandidateText(norm, kw.norm);
      if (fuzzy.isAcceptable) {
        return { matches: true, keyword: kw.raw, distance: fuzzy.distance };
      }
    }
  }

  return { matches: false };
}

interface MatchedTargetPole {
  category: string;
  targetKeyword?: string;
  sameGroup: IndexedAntonymKeyword[];
  oppositeGroup: IndexedAntonymKeyword[];
}

function resolveTargetAntonymPolesFast(
  targetNorm: string,
  targetNoAcc: string,
  allowFuzzy: boolean
): MatchedTargetPole[] {
  if (!targetNorm) return [];
  const poles: MatchedTargetPole[] = [];

  for (let i = 0; i < INDEXED_ANTONYM_PAIRS.length; i++) {
    const pair = INDEXED_ANTONYM_PAIRS[i];
    const inA = matchGroupFast(targetNorm, targetNoAcc, pair.groupA, allowFuzzy);
    const inB = matchGroupFast(targetNorm, targetNoAcc, pair.groupB, allowFuzzy);
    if (!inA.matches && !inB.matches) continue;

    if (inA.matches && inB.matches) {
      const dA = inA.distance ?? 999;
      const dB = inB.distance ?? 999;
      if (dA < dB) {
        poles.push({
          category: pair.category,
          targetKeyword: inA.keyword,
          sameGroup: pair.groupA,
          oppositeGroup: pair.groupB,
        });
      } else if (dB < dA) {
        poles.push({
          category: pair.category,
          targetKeyword: inB.keyword,
          sameGroup: pair.groupB,
          oppositeGroup: pair.groupA,
        });
      }
    } else if (inA.matches) {
      poles.push({
        category: pair.category,
        targetKeyword: inA.keyword,
        sameGroup: pair.groupA,
        oppositeGroup: pair.groupB,
      });
    } else {
      poles.push({
        category: pair.category,
        targetKeyword: inB.keyword,
        sameGroup: pair.groupB,
        oppositeGroup: pair.groupA,
      });
    }
  }

  return poles;
}

function checkCandidateAgainstTargetPolesFast(
  targetHint: string,
  targetPoles: MatchedTargetPole[],
  cand: DOMCandidate
): { hasConflict: boolean; reason?: string } {
  if (targetPoles.length === 0) return { hasConflict: false };

  const fields = [cand.text, cand.ariaLabel, cand.value, cand.nearLabel, cand.name, cand.elemId];
  for (let p = 0; p < targetPoles.length; p++) {
    const pole = targetPoles[p];
    for (let f = 0; f < fields.length; f++) {
      const raw = fields[f];
      if (!raw) continue;
      const norm = normalizeClean(raw);
      const noAcc = removeVietnameseDiacritics(norm);
      if (matchGroupFast(norm, noAcc, pole.sameGroup, false).matches) continue;
      const opp = matchGroupFast(norm, noAcc, pole.oppositeGroup, false);
      if (opp.matches) {
        return {
          hasConflict: true,
          reason: `[ANTYNOM_VIOLATION] Xung đột từ trái nghĩa (${pole.category}): Target "${targetHint}" (${pole.targetKeyword}) đối lập với ứng viên "${raw}" (${opp.keyword}).`,
        };
      }
    }
  }

  return { hasConflict: false };
}

/**
 * Chấm điểm nhanh đồng bộ 2 pha chuẩn kiến trúc tầng L1 -> L2:
 * - Pha 1 (L1 Fast-Path < 1ms): Exact/Semantic DOM + Exact Antonym Barrier (0 Damerau DP, 0 RegExp).
 *   Nếu đạt Top1 >= 95% & Delta >= 30% -> thoát ngay lập tức!
 * - Pha 2 (L2 Typo & Antonym Healing < 5ms): Chỉ kích hoạt khi Pha 1 không đạt L1 -> chạy Fuzzy Antonym Barrier
 *   + Damerau-Levenshtein Typo Healing.
 */
export function scoreCandidatesForTieredRouting(
  targetHint: string,
  candidates: DOMCandidate[],
  actionType: string = 'CLICK'
): FastTierScoreSummary {
  const targetNorm = normalizeClean(targetHint);
  const targetNoAcc = removeVietnameseDiacritics(targetNorm);
  const targetTokens = getTokens(targetNorm);

  // --- PHA 1 (L1 FAST-PATH): Exact Antonym Barrier + DOM Exact/Semantic Heuristic ---
  const exactPoles = resolveTargetAntonymPolesFast(targetNorm, targetNoAcc, false);
  const pass1Items: Array<{
    candidate: DOMCandidate;
    score: number;
    hasAntonymViolation: boolean;
    antonymReason?: string;
    textNorm: string;
    ariaNorm: string;
    placeholderNorm: string;
    nearLabelNorm: string;
    valueNorm: string;
  }> = [];

  let anyAntonymBlocked = false;
  let antonymReason: string | undefined;

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    if (cand.tag.toLowerCase() === 'canvas') continue;

    if (exactPoles.length > 0) {
      const antonym = checkCandidateAgainstTargetPolesFast(targetHint, exactPoles, cand);
      if (antonym.hasConflict) {
        anyAntonymBlocked = true;
        antonymReason = antonym.reason;
        pass1Items.push({
          candidate: cand,
          score: 0,
          hasAntonymViolation: true,
          antonymReason: antonym.reason,
          textNorm: '',
          ariaNorm: '',
          placeholderNorm: '',
          nearLabelNorm: '',
          valueNorm: '',
        });
        continue;
      }
    }

    let score = 0;
    const textNorm = normalizeClean(cand.text);
    const textNoAcc = removeVietnameseDiacritics(textNorm);
    const ariaNorm = normalizeClean(cand.ariaLabel);
    const ariaNoAcc = removeVietnameseDiacritics(ariaNorm);
    const placeholderNorm = normalizeClean(cand.placeholder);
    const placeholderNoAcc = removeVietnameseDiacritics(placeholderNorm);
    const nearLabelNorm = normalizeClean(cand.nearLabel);
    const nearLabelNoAcc = removeVietnameseDiacritics(nearLabelNorm);
    const valueNorm = normalizeClean(cand.value);
    const valueNoAcc = removeVietnameseDiacritics(valueNorm);
    const nameNorm = normalizeClean(cand.name);
    const nameNoAcc = removeVietnameseDiacritics(nameNorm);
    const idNorm = normalizeClean(cand.elemId);
    const idNoAcc = removeVietnameseDiacritics(idNorm);

    if (targetNorm) {
      const hasNoAccTarget = Boolean(targetNoAcc);
      if (
        textNorm === targetNorm ||
        (hasNoAccTarget && textNoAcc === targetNoAcc) ||
        valueNorm === targetNorm ||
        (hasNoAccTarget && valueNoAcc === targetNoAcc)
      ) {
        score = 100;
      } else if (
        ariaNorm === targetNorm ||
        (hasNoAccTarget && ariaNoAcc === targetNoAcc) ||
        placeholderNorm === targetNorm ||
        (hasNoAccTarget && placeholderNoAcc === targetNoAcc) ||
        nearLabelNorm === targetNorm ||
        (hasNoAccTarget && nearLabelNoAcc === targetNoAcc)
      ) {
        score = 96;
      } else if (
        nameNorm === targetNorm ||
        (hasNoAccTarget && nameNoAcc === targetNoAcc) ||
        idNorm === targetNorm ||
        (hasNoAccTarget && idNoAcc === targetNoAcc)
      ) {
        score = 92;
      } else if (
        (textNorm && textNorm.includes(targetNorm)) ||
        (hasNoAccTarget && textNoAcc && textNoAcc.includes(targetNoAcc))
      ) {
        score = 82;
      } else if (
        (ariaNorm && ariaNorm.includes(targetNorm)) ||
        (hasNoAccTarget && ariaNoAcc && ariaNoAcc.includes(targetNoAcc)) ||
        (placeholderNorm && placeholderNorm.includes(targetNorm)) ||
        (hasNoAccTarget && placeholderNoAcc && placeholderNoAcc.includes(targetNoAcc)) ||
        (nearLabelNorm && nearLabelNorm.includes(targetNorm)) ||
        (hasNoAccTarget && nearLabelNoAcc && nearLabelNoAcc.includes(targetNoAcc)) ||
        (valueNorm && valueNorm.includes(targetNorm)) ||
        (hasNoAccTarget && valueNoAcc && valueNoAcc.includes(targetNoAcc))
      ) {
        score = 80;
      }

      if (score < 95 && targetTokens.length > 0) {
        const targetTokensNoAcc = getTokens(targetNoAcc);
        const jaccardSources = [
          { raw: textNorm, noAcc: textNoAcc },
          { raw: ariaNorm || placeholderNorm || nearLabelNorm, noAcc: ariaNoAcc || placeholderNoAcc || nearLabelNoAcc },
        ];
        for (let s = 0; s < jaccardSources.length; s++) {
          const src = jaccardSources[s];
          if (!src.raw) continue;
          const cTokens = getTokens(src.raw);
          if (cTokens.length > 0) {
            const union = new Set([...targetTokens, ...cTokens]);
            let hits = 0;
            for (const tk of targetTokens) {
              if (cTokens.includes(tk)) hits++;
            }
            const jaccard = Math.round((hits / union.size) * 100);
            if (jaccard > score) score = jaccard;
          }
          if (src.noAcc && targetTokensNoAcc.length > 0) {
            const cTokensNoAcc = getTokens(src.noAcc);
            if (cTokensNoAcc.length > 0) {
              const unionNoAcc = new Set([...targetTokensNoAcc, ...cTokensNoAcc]);
              let hitsNoAcc = 0;
              for (const tk of targetTokensNoAcc) {
                if (cTokensNoAcc.includes(tk)) hitsNoAcc++;
              }
              const jaccardNoAcc = Math.round((hitsNoAcc / unionNoAcc.size) * 100);
              if (jaccardNoAcc > score) score = jaccardNoAcc;
            }
          }
        }
      }

      if (score > 0 && (actionType === 'CLICK' || actionType === 'HOVER')) {
        if (/^h[1-6]$/i.test(cand.tag)) {
          score = Math.max(0, score - 25);
        }
      }
    }

    pass1Items.push({
      candidate: cand,
      score: Math.min(100, Math.max(0, score)),
      hasAntonymViolation: false,
      textNorm,
      ariaNorm,
      placeholderNorm,
      nearLabelNorm,
      valueNorm,
    });
  }

  const pass1AllAntonymBlocked =
    pass1Items.length > 0 && pass1Items.every((item) => item.hasAntonymViolation);

  const pass1ValidSorted: FastTierScoreItem[] = pass1Items
    .filter((item) => !item.hasAntonymViolation)
    .map((item) => ({
      candidate: item.candidate,
      score: item.score,
      isTypoHealed: false,
      hasAntonymViolation: false,
    }))
    .sort((a, b) => b.score - a.score);

  const p1Top1 = pass1ValidSorted[0] ?? null;
  const p1Top2 = pass1ValidSorted[1] ?? null;
  const p1Top1Score = p1Top1 ? p1Top1.score : 0;
  const p1Top2Score = p1Top2 ? p1Top2.score : 0;
  const p1Delta = Math.max(0, p1Top1Score - p1Top2Score);

  // Thoát sớm ở Pha 1 (L1 Fast-Path hoặc Antonym Hard Block) -> KHÔNG chạy Damerau-Levenshtein!
  if (
    pass1AllAntonymBlocked ||
    (p1Top1 && p1Top1Score >= 95 && p1Delta >= 30) ||
    !targetNorm ||
    targetNorm.length < 2
  ) {
    const allNamelessIcons =
      pass1Items.length > 0 &&
      pass1ValidSorted.length > 0 &&
      pass1ValidSorted.every((s) => isNamelessIconCandidate(s.candidate));
    return {
      validSorted: pass1ValidSorted,
      top1: p1Top1,
      top2: p1Top2,
      top1Score: p1Top1Score,
      top2Score: p1Top2Score,
      marginDelta: p1Delta,
      allAntonymBlocked: pass1AllAntonymBlocked,
      anyAntonymBlocked,
      antonymReason,
      allNamelessIcons,
    };
  }

  // --- PHA 2 (L2 TYPO & ANTONYM HEALING): Fuzzy Antonym Barrier + Damerau-Levenshtein ---
  const fuzzyPoles = resolveTargetAntonymPolesFast(targetNorm, targetNoAcc, true);
  const scored: FastTierScoreItem[] = [];

  for (let i = 0; i < pass1Items.length; i++) {
    const item = pass1Items[i];
    if (item.hasAntonymViolation) {
      scored.push({
        candidate: item.candidate,
        score: 0,
        isTypoHealed: false,
        hasAntonymViolation: true,
        antonymReason: item.antonymReason,
      });
      continue;
    }

    if (fuzzyPoles.length > 0) {
      const antonym = checkCandidateAgainstTargetPolesFast(targetHint, fuzzyPoles, item.candidate);
      if (antonym.hasConflict) {
        anyAntonymBlocked = true;
        antonymReason = antonym.reason;
        scored.push({
          candidate: item.candidate,
          score: 0,
          isTypoHealed: false,
          hasAntonymViolation: true,
          antonymReason: antonym.reason,
        });
        continue;
      }
    }

    let score = item.score;
    let isTypoHealed = false;
    let damerauDistance: number | undefined;
    let damerauSimilarity: number | undefined;

    if (score < 95) {
      const fields = [
        { val: item.textNorm, weight: 1.0 },
        { val: item.ariaNorm, weight: 0.96 },
        { val: item.placeholderNorm, weight: 0.96 },
        { val: item.nearLabelNorm, weight: 0.95 },
        { val: item.valueNorm, weight: 0.95 },
      ].filter((f) => Boolean(f.val));

      for (const field of fields) {
        let fuzzy = computeDamerauSimilarity(targetNorm, field.val);
        if (!fuzzy.isAcceptable && field.val.includes(' ')) {
          const sub = matchFuzzyCandidateText(targetNorm, field.val);
          if (sub.isAcceptable) fuzzy = sub;
        }

        if (fuzzy.isAcceptable && fuzzy.distance >= 1) {
          let fuzzyScore: number;
          if (fuzzy.similarity >= 0.75) {
            fuzzyScore = Math.round(fuzzy.similarity * 100 * field.weight);
            if (fuzzy.distance === 1 && fuzzy.similarity >= 0.8) {
              // Hoán vị / sai 1 ký tự độ tương đồng cao (chuẩn Mục 6.1 QUY_CHUAN_AI_RESOLVER.md)
              fuzzyScore = Math.max(fuzzyScore, Math.round(92 * field.weight));
            } else if (fuzzy.distance === 1) {
              fuzzyScore = Math.max(fuzzyScore, Math.round(86 * field.weight));
            }
          } else {
            // Sai khác >= 2 ký tự dưới ngưỡng Sim 0.75 (VD: "sign ni" vs "sign up"): chiết khấu điểm tránh nhiễu biên Delta
            fuzzyScore = Math.round(fuzzy.similarity * 85 * field.weight);
          }
          if (fuzzyScore > score) {
            score = fuzzyScore;
            isTypoHealed = fuzzy.similarity >= 0.75;
            damerauDistance = fuzzy.distance;
            damerauSimilarity = fuzzy.similarity;
          }
        }
      }

      if (score > 0 && (actionType === 'CLICK' || actionType === 'HOVER')) {
        if (/^h[1-6]$/i.test(item.candidate.tag)) {
          score = Math.max(0, score - 25);
        }
      }
    }

    scored.push({
      candidate: item.candidate,
      score: Math.min(100, Math.max(0, score)),
      isTypoHealed,
      damerauDistance,
      damerauSimilarity,
      hasAntonymViolation: false,
    });
  }

  const allAntonymBlocked =
    scored.length > 0 && scored.every((item) => item.hasAntonymViolation);

  const validSorted = scored
    .filter((item) => !item.hasAntonymViolation)
    .sort((a, b) => b.score - a.score);

  const top1 = validSorted[0] ?? null;
  const top2 = validSorted[1] ?? null;
  const top1Score = top1 ? top1.score : 0;
  const top2Score = top2 ? top2.score : 0;
  const marginDelta = Math.max(0, top1Score - top2Score);

  const allNamelessIcons =
    scored.length > 0 && validSorted.length > 0 && validSorted.every((s) => isNamelessIconCandidate(s.candidate));

  return {
    validSorted,
    top1,
    top2,
    top1Score,
    top2Score,
    marginDelta,
    allAntonymBlocked,
    anyAntonymBlocked,
    antonymReason,
    allNamelessIcons,
  };
}

/**
 * Pipeline thực thi định tuyến 3 tầng đầy đủ (L1 -> L2 -> L3 Vision SoM):
 * - Tầng L1 / L2: Xử lý đồng bộ thuần CPU trong < 2ms / < 8ms, chi phí $0, apiCalled = false.
 * - Tầng L3: Chụp màn hình + vẽ Set-of-Marks badges trên canvas tách biệt -> gọi Gemini Multimodal Vision SoM
 *   (hoặc provider mock offline) -> xác thực nghiêm ngặt numeric Mark ID -> ánh xạ trực tiếp sang
 *   Bounding Box hình học gốc (0% pixel-coordinate hallucination).
 */
export async function executeTieredResolution(
  context: TieredExecutionContext
): Promise<TieredResolutionResult> {
  const t0 = performance.now();
  const actionType = context.action?.type || context.actionType || 'CLICK';
  const targetHint = context.action?.targetHint || context.targetHint || context.action?.subInstruction || '';
  const candidates = context.candidates ?? [];

  const elapsedMs = () => Math.round((performance.now() - t0) * 1000) / 1000;

  const hasPreScored =
    context.top1Score !== undefined ||
    context.marginDelta !== undefined ||
    context.antonymBlocked === true;

  let top1Score: number;
  let top2Score: number | undefined;
  let marginDelta: number | undefined;
  let top1Candidate: DOMCandidate | null = context.top1Candidate ?? null;
  let isTypoHealed = context.isTypoHealed ?? false;
  let damerauDistance = context.damerauDistance;
  let damerauSimilarity = context.damerauSimilarity;
  let antonymBlocked = context.antonymBlocked ?? false;
  let antonymReason = context.antonymReason;
  let isNamelessIcon = context.isNamelessIcon ?? false;
  let isCanvasOrWebGL = context.isCanvasOrWebGL ?? false;
  let eligibleDomCandidates: DOMCandidate[] = candidates;

  if (!isCanvasOrWebGL && candidates.length > 0 && candidates.every((c) => c.tag.toLowerCase() === 'canvas')) {
    isCanvasOrWebGL = true;
  }

  if (hasPreScored) {
    top1Score = context.top1Score ?? 0;
    top2Score = context.top2Score;
    marginDelta = context.marginDelta;
    if (!top1Candidate && candidates.length > 0 && !isCanvasOrWebGL) {
      top1Candidate = candidates[0];
    }
    if (!isNamelessIcon && candidates.length > 0 && candidates.every((c) => isNamelessIconCandidate(c))) {
      isNamelessIcon = true;
    }
  } else {
    const summary = scoreCandidatesForTieredRouting(targetHint, candidates, actionType);
    top1Score = summary.top1Score;
    top2Score = summary.top2Score;
    marginDelta = summary.marginDelta;
    top1Candidate = summary.top1?.candidate ?? null;
    isTypoHealed = summary.top1?.isTypoHealed ?? false;
    damerauDistance = summary.top1?.damerauDistance;
    damerauSimilarity = summary.top1?.damerauSimilarity;
    antonymBlocked = summary.allAntonymBlocked;
    antonymReason = summary.antonymReason;
    isNamelessIcon = isNamelessIcon || summary.allNamelessIcons;
    eligibleDomCandidates = summary.validSorted.map((s) => s.candidate);
  }

  // Bước 1: Định tuyến nhanh bằng dữ liệu sẵn có (0ms IPC để bảo toàn < 2ms L1 và < 8ms L2)
  let route = routeResolutionTier({
    top1Score,
    top2Score,
    marginDelta,
    isTypoHealed,
    damerauDistance,
    antonymBlocked,
    isCanvasOrWebGL,
    isNamelessIcon,
    candidateCount: eligibleDomCandidates.length,
    candidates: hasPreScored ? undefined : eligibleDomCandidates,
  });

  // --- TẦNG L1 HOẶC L2 (KHÔNG GỌI VISION API, CHI PHÍ $0) ---
  if (route.tier === 'L1' || route.tier === 'L2') {
    if (route.antonymBlocked) {
      const lat = elapsedMs();
      const reason = antonymReason || route.reasoning;
      const telemetry: RoutingTelemetry = {
        tier: 'L2',
        triggerReason: 'ANTONYM_BARRIER_BLOCKED',
        latencyMs: lat,
        estimatedCostUsd: 0,
        apiCalled: false,
        top1ScoreNormalized: route.normalizedTop1Score,
        top2ScoreNormalized: route.normalizedTop2Score,
        marginDeltaNormalized: route.normalizedMarginDelta,
        isCanvasOrWebGL: false,
        isNamelessIcon: route.isNamelessIcon,
        antonymBlocked: true,
        damerauDistance,
        damerauSimilarity,
        somMarkId: null,
        resolvedBox: null,
        clickPoint: null,
        rejectedHallucination: false,
        reasoning: reason,
      };
      return {
        resolved: false,
        tier: 'L2',
        triggerReason: 'ANTONYM_BARRIER_BLOCKED',
        candidate: null,
        resolvedBox: null,
        clickPoint: null,
        somMarkId: null,
        somMark: null,
        apiCalled: false,
        rejectedHallucination: false,
        antonymBlocked: true,
        latencyMs: lat,
        estimatedCostUsd: 0,
        flag: ANTYNOM_VIOLATION,
        reasoning: reason,
        telemetry,
      };
    }

    const resolvedBox: BoundingBox | null = top1Candidate ? { ...top1Candidate.rect } : null;
    const clickPoint: Point2D | null = resolvedBox
      ? {
          x: Math.round((resolvedBox.x + resolvedBox.width / 2) * 100) / 100,
          y: Math.round((resolvedBox.y + resolvedBox.height / 2) * 100) / 100,
        }
      : null;

    const lat = elapsedMs();
    const telemetry: RoutingTelemetry = {
      tier: route.tier,
      triggerReason: route.triggerReason,
      latencyMs: lat,
      estimatedCostUsd: 0,
      apiCalled: false,
      top1ScoreNormalized: route.normalizedTop1Score,
      top2ScoreNormalized: route.normalizedTop2Score,
      marginDeltaNormalized: route.normalizedMarginDelta,
      isCanvasOrWebGL: false,
      isNamelessIcon: route.isNamelessIcon,
      antonymBlocked: false,
      damerauDistance,
      damerauSimilarity,
      somMarkId: null,
      resolvedBox,
      clickPoint,
      rejectedHallucination: false,
      reasoning: route.reasoning,
    };

    return {
      resolved: Boolean(top1Candidate || hasPreScored),
      tier: route.tier,
      triggerReason: route.triggerReason,
      candidate: top1Candidate,
      resolvedBox,
      clickPoint,
      somMarkId: null,
      somMark: null,
      apiCalled: false,
      rejectedHallucination: false,
      antonymBlocked: false,
      latencyMs: lat,
      estimatedCostUsd: 0,
      reasoning: route.reasoning,
      telemetry,
    };
  }

  // --- TẦNG L3: VISION SET-OF-MARKS (SoM) FALLBACK ---
  // Tự động kiểm tra bề mặt Canvas/WebGL nếu chưa biết và đang có Playwright page
  if (!isCanvasOrWebGL && context.page && eligibleDomCandidates.length === 0) {
    const surface = await detectCanvasWebGLSurfaces(context.page);
    if (surface.hasCanvasOrWebGL) {
      isCanvasOrWebGL = true;
      route = routeResolutionTier({
        top1Score,
        top2Score,
        marginDelta,
        isTypoHealed,
        damerauDistance,
        antonymBlocked: false,
        isCanvasOrWebGL: true,
        isNamelessIcon,
        candidateCount: 0,
      });
    }
  }

  let somOverlay: SoMOverlayResult | undefined = context.somOverlay;
  if (!somOverlay && context.page) {
    somOverlay = await generateSetOfMarks(
      context.page,
      eligibleDomCandidates,
      {
        ...context.somOptions,
        includeCanvasGrid: context.somOptions?.includeCanvasGrid ?? true,
      }
    );
    if (somOverlay.usedCanvasGrid && !isCanvasOrWebGL) {
      isCanvasOrWebGL = true;
      route = routeResolutionTier({
        top1Score,
        top2Score,
        marginDelta,
        isTypoHealed,
        damerauDistance,
        antonymBlocked: false,
        isCanvasOrWebGL: true,
        isNamelessIcon,
        candidateCount: eligibleDomCandidates.length,
      });
    }
  }

  if (!somOverlay || somOverlay.marks.length === 0) {
    const lat = elapsedMs();
    const reason = !somOverlay
      ? 'Tầng L3 Vision SoM được kích hoạt nhưng thiếu Playwright Page hoặc ảnh SoM Overlay.'
      : 'Tầng L3 Vision SoM không tìm thấy ứng viên DOM hay bề mặt Canvas nào để gắn nhãn.';
    const telemetry: RoutingTelemetry = {
      tier: 'L3',
      triggerReason: route.triggerReason,
      latencyMs: lat,
      estimatedCostUsd: 0,
      apiCalled: false,
      top1ScoreNormalized: route.normalizedTop1Score,
      top2ScoreNormalized: route.normalizedTop2Score,
      marginDeltaNormalized: route.normalizedMarginDelta,
      isCanvasOrWebGL,
      isNamelessIcon: route.isNamelessIcon,
      antonymBlocked: false,
      somMarkId: null,
      somMarkCount: somOverlay?.marks.length ?? 0,
      resolvedBox: null,
      clickPoint: null,
      rejectedHallucination: false,
      provider: 'none',
      reasoning: reason,
    };
    return {
      resolved: false,
      tier: 'L3',
      triggerReason: route.triggerReason,
      candidate: null,
      resolvedBox: null,
      clickPoint: null,
      somMarkId: null,
      somMark: null,
      somOverlay,
      apiCalled: false,
      rejectedHallucination: false,
      antonymBlocked: false,
      latencyMs: lat,
      estimatedCostUsd: 0,
      reasoning: reason,
      telemetry,
    };
  }

  // Gọi Gemini Multimodal Vision SoM (hoặc mock provider) -> Chỉ nhận numeric Mark ID
  const validMarkIds = somOverlay.marks.map((m) => m.id);
  const visionResult = await LLMBridge.askGeminiVisionSoM(
    somOverlay.annotatedImageBase64,
    actionType,
    targetHint,
    somOverlay.marks.length,
    {
      ...context.visionOptions,
      provider: context.visionProvider ?? context.visionOptions?.provider,
      validMarkIds,
    }
  );

  const lookup = resolveMarkIdToBoundingBox(somOverlay, visionResult.id);
  const rejectedHallucination =
    Boolean(visionResult.rejectedHallucination) || lookup.rejectedHallucination;
  const estimatedCostUsd = visionResult.apiCalled ? TIER_THRESHOLDS.L3_ESTIMATED_COST_USD : 0;

  if (!visionResult.valid || !lookup.valid || !lookup.mark || !lookup.boundingBox) {
    const lat = elapsedMs();
    const reason = visionResult.rejectedHallucination
      ? visionResult.reason
      : lookup.rejectedHallucination
        ? lookup.reason
        : visionResult.reason || lookup.reason;
    const telemetry: RoutingTelemetry = {
      tier: 'L3',
      triggerReason: route.triggerReason,
      latencyMs: lat,
      estimatedCostUsd,
      apiCalled: visionResult.apiCalled,
      top1ScoreNormalized: route.normalizedTop1Score,
      top2ScoreNormalized: route.normalizedTop2Score,
      marginDeltaNormalized: route.normalizedMarginDelta,
      isCanvasOrWebGL,
      isNamelessIcon: route.isNamelessIcon,
      antonymBlocked: false,
      somMarkId: null,
      somMarkCount: somOverlay.marks.length,
      resolvedBox: null,
      clickPoint: null,
      rejectedHallucination,
      provider: visionResult.provider,
      reasoning: reason,
    };
    return {
      resolved: false,
      tier: 'L3',
      triggerReason: route.triggerReason,
      candidate: null,
      resolvedBox: null,
      clickPoint: null,
      somMarkId: null,
      somMark: null,
      somOverlay,
      visionResult,
      apiCalled: visionResult.apiCalled,
      rejectedHallucination,
      antonymBlocked: false,
      latencyMs: lat,
      estimatedCostUsd,
      flag: rejectedHallucination ? 'SOM_HALLUCINATION_REJECTED' : undefined,
      reasoning: reason,
      telemetry,
    };
  }

  // Lớp bảo vệ kép Antonym Barrier sau khi Vision SoM trả về Mark ID cho DOM Candidate
  if (lookup.candidate && targetHint) {
    const postVisionAntonym = checkAntonymConflict(targetHint, lookup.candidate);
    if (postVisionAntonym.hasConflict) {
      const lat = elapsedMs();
      const reason = `[CRITIC VETO - L3 Vision SoM] ${postVisionAntonym.reason}`;
      const telemetry: RoutingTelemetry = {
        tier: 'L3',
        triggerReason: route.triggerReason,
        latencyMs: lat,
        estimatedCostUsd,
        apiCalled: visionResult.apiCalled,
        top1ScoreNormalized: route.normalizedTop1Score,
        top2ScoreNormalized: route.normalizedTop2Score,
        marginDeltaNormalized: route.normalizedMarginDelta,
        isCanvasOrWebGL,
        isNamelessIcon: route.isNamelessIcon,
        antonymBlocked: true,
        somMarkId: lookup.mark.id,
        somMarkCount: somOverlay.marks.length,
        resolvedBox: null,
        clickPoint: null,
        rejectedHallucination: false,
        provider: visionResult.provider,
        reasoning: reason,
      };
      return {
        resolved: false,
        tier: 'L3',
        triggerReason: route.triggerReason,
        candidate: null,
        resolvedBox: null,
        clickPoint: null,
        somMarkId: lookup.mark.id,
        somMark: lookup.mark,
        somOverlay,
        visionResult,
        apiCalled: visionResult.apiCalled,
        rejectedHallucination: false,
        antonymBlocked: true,
        latencyMs: lat,
        estimatedCostUsd,
        flag: ANTYNOM_VIOLATION,
        reasoning: reason,
        telemetry,
      };
    }
  }

  const lat = elapsedMs();
  const finalReason = `[L3 Vision SoM -> Mark #${lookup.mark.id}] ${visionResult.reason} | ${lookup.reason}`;
  const telemetry: RoutingTelemetry = {
    tier: 'L3',
    triggerReason: route.triggerReason,
    latencyMs: lat,
    estimatedCostUsd,
    apiCalled: visionResult.apiCalled,
    top1ScoreNormalized: route.normalizedTop1Score,
    top2ScoreNormalized: route.normalizedTop2Score,
    marginDeltaNormalized: route.normalizedMarginDelta,
    isCanvasOrWebGL,
    isNamelessIcon: route.isNamelessIcon,
    antonymBlocked: false,
    somMarkId: lookup.mark.id,
    somMarkCount: somOverlay.marks.length,
    resolvedBox: lookup.boundingBox,
    clickPoint: lookup.clickPoint,
    rejectedHallucination: false,
    provider: visionResult.provider,
    reasoning: finalReason,
  };

  return {
    resolved: true,
    tier: 'L3',
    triggerReason: route.triggerReason,
    candidate: lookup.candidate,
    resolvedBox: lookup.boundingBox,
    clickPoint: lookup.clickPoint,
    somMarkId: lookup.mark.id,
    somMark: lookup.mark,
    somOverlay,
    visionResult,
    apiCalled: visionResult.apiCalled,
    rejectedHallucination: false,
    antonymBlocked: false,
    latencyMs: lat,
    estimatedCostUsd,
    reasoning: finalReason,
    telemetry,
  };
}

/**
 * Chuyển đổi kết quả định tuyến 3 tầng sang cấu trúc XAIDecision chuẩn phục vụ XAI Audit Trail (Stage 2).
 */
export function toXAIDecisionFromTieredResult(result: TieredResolutionResult): XAIDecision {
  const chosenLabel = result.candidate
    ? `<${result.candidate.tag}>${result.candidate.elemId ? '#' + result.candidate.elemId : ''}${result.candidate.text ? ' "' + result.candidate.text + '"' : ''}`
    : result.somMark
      ? `SoM[${result.somMark.id}] ${result.somMark.label} (${result.somMark.source})`
      : undefined;

  const matchSource =
    result.tier === 'L1'
      ? 'L1_DOM_FAST_PATH'
      : result.tier === 'L2'
        ? result.telemetry.damerauDistance
          ? 'L2_FUZZY_HEALED'
          : 'L2_SEMANTIC_SAFE'
        : 'L3_VISION_SOM';

  return {
    chosenElement: chosenLabel,
    healedIntent:
      result.tier === 'L2' && result.telemetry.damerauDistance
        ? result.candidate?.text || result.candidate?.ariaLabel || result.candidate?.placeholder
        : undefined,
    damerauDistance: result.telemetry.damerauDistance,
    confidence:
      result.tier === 'L3'
        ? result.resolved
          ? 0.9
          : 0
        : result.telemetry.top1ScoreNormalized,
    deltaMargin: result.telemetry.marginDeltaNormalized,
    criticVerdict: result.resolved ? 'APPROVED' : 'REJECTED',
    reasoning: `${result.reasoning} [Tier=${result.tier}, Trigger=${result.triggerReason}, Latency=${result.latencyMs}ms, Cost=$${result.estimatedCostUsd}]`,
    matchSource,
    flag: result.flag,
  };
}
