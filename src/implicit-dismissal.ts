import { Page } from 'playwright';
import { DOMCandidate } from './types';

// ============================================================================
// TRỤ CỘT 18: HANGING INTERACTIVE OVERLAYS & IMPLICIT DISMISSAL PROTOCOL
// (W3C Light Dismiss API + 4-Tier Safe Dismissal Ladder + Antonym Guardrail)
// ============================================================================

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export type OverlayKind = 'dropdown' | 'popover' | 'modal';

export type DismissalTier =
  | 'NONE'
  | 'TIER_1_ESCAPE'
  | 'TIER_2_RETOGGLE_TRIGGER'
  | 'TIER_3_SAFE_NEUTRAL_CLICK'
  | 'TIER_4A_MODAL_CLOSE_BUTTON'
  | 'TIER_4B_MODAL_ESCAPE'
  | 'TIER_4C_MODAL_SAFE_CANCEL_BUTTON'
  | 'TIER_4D_MODAL_BACKDROP_CLICK';

export interface ActiveOverlayInfo {
  /** Định danh tạm thời gắn qua data-autotest-overlay-id trên phần tử container */
  overlayId: string;
  /** Phân loại lớp phủ: dropdown, popover hoặc modal */
  kind: OverlayKind;
  /** Selector đã khớp đầu tiên */
  matchedSelector: string;
  /** Selector định danh chính xác phần tử container ngoài cùng */
  containerSelector: string;
  /** Selector định danh phần tử nội dung (dialog box / menu list) */
  contentSelector: string;
  tag: string;
  role?: string;
  elemId?: string;
  ariaLabel?: string;
  ariaModal: boolean;
  isNativeDialog: boolean;
  isPopoverOpen: boolean;
  hasBackdrop: boolean;
  /** Bounding box hình học của hộp nội dung (dropdown panel hoặc modal card, KHÔNG phải fullscreen backdrop) */
  rect: Rect;
  /** Bounding box của lớp nền mờ bao ngoài (nếu có) */
  backdropRect?: Rect;
  zIndex: number;
  isTopLayer: boolean;
  detectedAt: number;
  /** Thông tin nút trigger đã mở overlay này (nếu xác định được) */
  triggerSelector?: string;
  triggerRect?: Rect;
}

export interface TriggerRecord {
  selector?: string;
  elemId?: string;
  rect?: Rect;
  text?: string;
  timestamp: number;
}

export interface NextTargetInfo {
  selector?: string;
  elemId?: string;
  rect?: Rect;
  point?: Point;
  candidate?: DOMCandidate;
  targetHint?: string;
  actionType?: string;
}

export interface ContextBoundaryCrossingResult {
  crossed: boolean;
  activeOverlays: ActiveOverlayInfo[];
  topOverlay: ActiveOverlayInfo | null;
  crossedOverlays: ActiveOverlayInfo[];
  targetInsideTopOverlay: boolean;
  checkMethod: 'DOM_SUBTREE' | 'GEOMETRY_RECT' | 'GEOMETRY_POINT' | 'NONE';
  reason: string;
}

export interface ForbiddenRectInfo {
  rect: Rect;
  category: 'interactive' | 'overlay' | 'sticky' | 'modal' | 'ad' | 'iframe';
  label?: string;
}

export interface SafeNeutralPointOptions {
  paddingPx?: number;
  edgeMarginPx?: number;
  gridStepPx?: number;
  extraForbiddenRects?: Rect[];
}

export interface SafeNeutralPointResult {
  found: boolean;
  point: Point | null;
  clearancePx: number;
  hitElementTag?: string;
  hitElementId?: string;
  hitElementClasses?: string[];
  forbiddenRectCount: number;
  viewport: ViewportSize;
  reason: string;
}

export interface ModalButtonDescriptor {
  text?: string;
  ariaLabel?: string;
  title?: string;
  id?: string;
  className?: string;
  type?: string;
  role?: string;
}

export interface DismissalAttemptLog {
  tier: DismissalTier;
  overlayId: string;
  overlayKind: OverlayKind;
  succeeded: boolean;
  detail: string;
  clickedPoint?: Point;
  clickedLabel?: string;
  blockedButtons?: string[];
  durationMs: number;
}

export interface DismissalOptions {
  nextTarget?: NextTargetInfo;
  trigger?: TriggerRecord;
  tracker?: ActiveOverlayTracker;
  quiescenceWaitMs?: number;
  maxOverlaysToDismiss?: number;
  onlyIfCrossed?: boolean;
  neutralClickOptions?: SafeNeutralPointOptions;
}

export interface DismissalResult {
  needed: boolean;
  dismissed: boolean;
  dismissedCount: number;
  tierUsed: DismissalTier;
  tiersUsed: DismissalTier[];
  attempts: DismissalAttemptLog[];
  blockedByGuardrail: boolean;
  blockedButtons: string[];
  remainingOverlays: ActiveOverlayInfo[];
  crossing?: ContextBoundaryCrossingResult;
  durationMs: number;
  summary: string;
}

// ============================================================================
// SELECTOR REGISTRIES (Dropdowns, Popovers, Modals, Close Buttons)
// ============================================================================

export const DROPDOWN_OVERLAY_SELECTORS: string[] = [
  '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
  '.ant-dropdown:not(.ant-dropdown-hidden)',
  '.MuiAutocomplete-popper',
  '.MuiMenu-paper',
  '.MuiMenu-root',
  '.select__menu',
  'div[class*="select__menu"]',
  '.select2-dropdown',
  '.select2-container--open .select2-dropdown',
  '.dropdown-menu.show',
  '.dropdown-menu[data-open="true"]',
  '.custom-select-menu.open',
  '.custom-select-menu',
  '[data-overlay-type="dropdown"]',
  '[role="listbox"]:not([aria-hidden="true"])',
  '[role="menu"]:not([aria-hidden="true"])',
];

export const POPOVER_OVERLAY_SELECTORS: string[] = [
  '[popover]:popover-open',
  '.MuiPopover-root',
  '.ant-popover:not(.ant-popover-hidden)',
  '[data-radix-popper-content-wrapper]',
  '[data-floating-ui-portal]',
  '[data-overlay-type="popover"]',
];

export const MODAL_OVERLAY_SELECTORS: string[] = [
  'dialog[open]',
  '[role="dialog"]:not([aria-hidden="true"])',
  '[role="alertdialog"]:not([aria-hidden="true"])',
  '[aria-modal="true"]:not([aria-hidden="true"])',
  '.ant-modal-root',
  '.ant-modal-wrap',
  '.ant-modal',
  '.MuiDialog-root',
  '.MuiModal-root',
  '.el-dialog__wrapper',
  '.el-dialog',
  '.modal.show',
  '.modal.open',
  '.modal.is-open',
  '.modal',
  '[data-overlay-type="modal"]',
  '[data-modal="true"]',
];

export const MODAL_CLOSE_BUTTON_SELECTORS: string[] = [
  '[aria-label="Close" i]',
  '[aria-label="Đóng" i]',
  '[aria-label="Dong" i]',
  '[aria-label*="close" i]',
  '[aria-label*="đóng" i]',
  '[title="Close" i]',
  '[title="Đóng" i]',
  '.ant-modal-close',
  '.modal-close',
  '.btn-close',
  '.close',
  '.el-dialog__headerbtn',
  '[data-dismiss="modal"]',
  '[data-bs-dismiss="modal"]',
  '[data-testid*="modal-close" i]',
  '[data-testid*="dialog-close" i]',
  '[class*="modal-close" i]',
  '[class*="dialog-close" i]',
];

// ============================================================================
// STRICT ANTONYM BARRIER GUARDRAIL (TIER 4 MODAL DISMISSAL PROTECTION)
// ============================================================================

export function stripVietnameseDiacritics(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export function normalizeModalLabel(str: string | undefined): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Các mẫu văn bản mang tính khẳng định / lưu dữ liệu / phá hủy / thực thi nghiệp vụ.
 * NGHIÊM CẤM tuyệt đối click vào các nút khớp mẫu này khi tự động đóng modal.
 */
export const FORBIDDEN_MODAL_DISMISS_PATTERNS: RegExp[] = [
  // Vietnamese affirmative / persistence / destructive (accent-aware + accent-free word-bounded)
  /(?:^|[\s,.;:!?()\[\]\/&+-])(?:lưu|luu)(?:$|[\s,.;:!?()\[\]\/&+-])/i,
  /(?:^|[\s,.;:!?()\[\]\/&+-])(?:xác\s*nhận|xac\s*nhan)(?:$|[\s,.;:!?()\[\]\/&+-])/i,
  /(?:^|[\s,.;:!?()\[\]\/&+-])(?:gửi|gui)(?:$|[\s,.;:!?()\[\]\/&+-])/i,
  /(?<!không\s)(?<!khong\s)(?:^|[\s,.;:!?()\[\]\/&+-])(?:đồng\s*ý|dong\s*y)(?:$|[\s,.;:!?()\[\]\/&+-])/i,
  /(?:^|[\s,.;:!?()\[\]\/&+-])(?:xóa|xoá|xoa)(?:$|[\s,.;:!?()\[\]\/&+-])/i,
  /(?:^|[\s,.;:!?()\[\]\/&+-])(?:tiếp\s*tục|tiep\s*tuc)(?:$|[\s,.;:!?()\[\]\/&+-])/i,
  /(?:^|[\s,.;:!?()\[\]\/&+-])(?:chấp\s*nhận|chap\s*nhan)(?:$|[\s,.;:!?()\[\]\/&+-])/i,
  /(?:^|[\s,.;:!?()\[\]\/&+-])(?:áp\s*dụng|ap\s*dung)(?:$|[\s,.;:!?()\[\]\/&+-])/i,
  /(?:^|[\s,.;:!?()\[\]\/&+-])(?:hoàn\s*tất|hoan\s*tat|hoàn\s*thành|hoan\s*thanh)(?:$|[\s,.;:!?()\[\]\/&+-])/i,
  /(?:^|[\s,.;:!?()\[\]\/&+-])(?:cập\s*nhật|cap\s*nhat)(?:$|[\s,.;:!?()\[\]\/&+-])/i,
  /(?:^|[\s,.;:!?()\[\]\/&+-])(?:thanh\s*toán|thanh\s*toan|đặt\s*hàng|dat\s*hang|mua\s*ngay)(?:$|[\s,.;:!?()\[\]\/&+-])/i,
  /(?:^|[\s,.;:!?()\[\]\/&+-])(?:phê\s*duyệt|phe\s*duyet|duyệt|duyet)(?:$|[\s,.;:!?()\[\]\/&+-])/i,
  /(?:^|[\s,.;:!?()\[\]\/&+-])(?:tạo\s*mới|tao\s*moi|thêm\s*mới|them\s*moi)(?:$|[\s,.;:!?()\[\]\/&+-])/i,
  /^(?:có|vâng|được)[!.]*$/i,

  // English affirmative / persistence / destructive
  /\b(?:save|confirm|ok|okay|submit|send|apply|accept|approve|agree|delete|remove|destroy|erase|continue|proceed|next|finish|complete|done|yes|allow|grant|create|update|publish|checkout|purchase|pay|buy|subscribe)\b/i,
];

/**
 * Các mẫu văn bản an toàn cho phép dùng để thoát/đóng modal mà không gây tác dụng phụ.
 */
export const SAFE_MODAL_DISMISS_PATTERNS: RegExp[] = [
  /^[✕×✖✗⨯x]$/i,
  /(?:^|[\s,.;:!?()\[\]\/-])(?:hủy\s*bỏ|huy\s*bo|hủy|huy)(?:$|[\s,.;:!?()\[\]\/-])/i,
  /(?:^|[\s,.;:!?()\[\]\/-])(?:bỏ\s*qua|bo\s*qua)(?:$|[\s,.;:!?()\[\]\/-])/i,
  /(?:^|[\s,.;:!?()\[\]\/-])(?:đóng\s*lại|đóng|dong\s*lai)(?:$|[\s,.;:!?()\[\]\/-])/i,
  /^dong$/i,
  /(?:^|[\s,.;:!?()\[\]\/-])(?:không\s*đồng\s*ý|khong\s*dong\s*y|không|khong)(?:$|[\s,.;:!?()\[\]\/-])/i,
  /(?:^|[\s,.;:!?()\[\]\/-])(?:để\s*sau|de\s*sau|thoát|thoat|quay\s*lại|quay\s*lai|trở\s*lại|tro\s*lai)(?:$|[\s,.;:!?()\[\]\/-])/i,
  /\b(?:cancel|close|dismiss|no|no thanks|not now|skip|later|back|abort|nevermind|disagree|decline)\b/i,
];

function extractButtonLabels(input: string | ModalButtonDescriptor): {
  rawCombined: string;
  strippedCombined: string;
  primaryText: string;
  descriptor: ModalButtonDescriptor;
} {
  if (typeof input === 'string') {
    const raw = normalizeModalLabel(input);
    return {
      rawCombined: raw,
      strippedCombined: stripVietnameseDiacritics(raw),
      primaryText: raw,
      descriptor: { text: input },
    };
  }
  const parts = [input.text, input.ariaLabel, input.title]
    .map((p) => normalizeModalLabel(p))
    .filter((p) => p.length > 0);
  const rawCombined = parts.join(' ').trim();
  const primaryText = normalizeModalLabel(input.text || input.ariaLabel || input.title);
  return {
    rawCombined,
    strippedCombined: stripVietnameseDiacritics(rawCombined),
    primaryText,
    descriptor: input,
  };
}

/**
 * Antonym Barrier Guardrail cho Tier 4 Modal Dismissal:
 * Trả về `true` nếu nút mang ý nghĩa khẳng định / lưu / xác nhận / gửi / xóa / tiếp tục
 * -> NGHIÊM CẤM tuyệt đối không được click để thoát modal!
 */
export function isForbiddenModalDismissButton(input: string | ModalButtonDescriptor): boolean {
  const { rawCombined, strippedCombined, primaryText, descriptor } = extractButtonLabels(input);

  // Kiểm tra trường hợp phủ định rõ ràng trước (VD: "Không đồng ý" không nên bị nhận nhầm là "Đồng ý")
  // Dùng biên dấu câu/khoảng trắng thay vì \b vì ký tự tiếng Việt có dấu (như 'ý') nằm ngoài tập \w ASCII
  const normalizedWithoutNegatedAgree = rawCombined
    .replace(
      /(?:^|[\s,.;:!?()\[\]\/&+-])(?:không\s+đồng\s+ý|khong\s+dong\s+y|disagree)(?:$|[\s,.;:!?()\[\]\/&+-])/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
  const strippedWithoutNegatedAgree = strippedCombined
    .replace(
      /(?:^|[\s,.;:!?()\[\]\/&+-])(?:khong\s+dong\s+y|disagree)(?:$|[\s,.;:!?()\[\]\/&+-])/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();

  if (rawCombined.length > 0) {
    for (const pattern of FORBIDDEN_MODAL_DISMISS_PATTERNS) {
      if (pattern.test(normalizedWithoutNegatedAgree)) {
        return true;
      }
      // Tránh kiểm tra regex nhạy dấu tiếng Việt trên chuỗi mất dấu nếu pattern chỉ dành cho chữ có dấu như "có"
      if (pattern.source !== '^(?:có|vâng|được)[!.]*$' && pattern.test(strippedWithoutNegatedAgree)) {
        return true;
      }
    }
  }

  // Nếu không có nhãn văn bản nhưng mang thuộc tính submit / confirm / save rõ ràng trên id/class/type
  if (!primaryText) {
    const typeLower = (descriptor.type || '').toLowerCase();
    if (typeLower === 'submit') {
      return true;
    }
    const meta = `${descriptor.id || ''} ${descriptor.className || ''}`.toLowerCase();
    if (/\b(?:btn-save|btn-submit|btn-confirm|btn-ok|btn-delete|btn-apply|btn-accept|submit-btn|confirm-btn|save-btn|delete-btn)\b/i.test(meta)) {
      return true;
    }
  }

  return false;
}

/**
 * Kiểm tra xem một nút có thuộc danh sách lối thoát an toàn của modal hay không.
 * Luôn chạy qua Antonym Barrier Guardrail trước: nếu bị cấm -> trả về `false` ngay lập tức.
 */
export function isSafeModalDismissButton(input: string | ModalButtonDescriptor): boolean {
  if (isForbiddenModalDismissButton(input)) {
    return false;
  }

  const { rawCombined, strippedCombined } = extractButtonLabels(input);
  if (!rawCombined) {
    return false;
  }

  for (const pattern of SAFE_MODAL_DISMISS_PATTERNS) {
    if (pattern.test(rawCombined) || pattern.test(strippedCombined)) {
      return true;
    }
  }

  return false;
}

export function classifyModalButton(
  input: string | ModalButtonDescriptor
): 'FORBIDDEN' | 'SAFE_DISMISS' | 'NEUTRAL' {
  if (isForbiddenModalDismissButton(input)) return 'FORBIDDEN';
  if (isSafeModalDismissButton(input)) return 'SAFE_DISMISS';
  return 'NEUTRAL';
}

// ============================================================================
// PURE GEOMETRY ENGINE: SAFE NEUTRAL CLICK COORDINATE CALCULATION (TIER 3)
// ============================================================================

export function rectContainsPoint(rect: Rect, point: Point, padding = 0): boolean {
  return (
    point.x >= rect.x - padding &&
    point.x <= rect.x + rect.width + padding &&
    point.y >= rect.y - padding &&
    point.y <= rect.y + rect.height + padding
  );
}

export function distancePointToRect(point: Point, rect: Rect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.sqrt(dx * dx + dy * dy);
}

function deduplicateSortedCoords(coords: number[], minDelta = 1.5, maxCount = 64): number[] {
  if (coords.length === 0) return [];
  const sorted = [...coords].sort((a, b) => a - b);
  const deduped: number[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - deduped[deduped.length - 1] >= minDelta) {
      deduped.push(sorted[i]);
    }
  }
  if (deduped.length <= maxCount) {
    return deduped;
  }
  // Giữ đầu, cuối và lấy mẫu đều nếu số mốc tọa độ quá lớn
  const sampled: number[] = [deduped[0]];
  const step = (deduped.length - 1) / (maxCount - 1);
  for (let i = 1; i < maxCount - 1; i++) {
    sampled.push(deduped[Math.round(i * step)]);
  }
  sampled.push(deduped[deduped.length - 1]);
  return sampled;
}

export interface RankedNeutralCandidate {
  point: Point;
  clearancePx: number;
}

/**
 * Thuật toán hình học 2 pha tìm danh sách các tọa độ trống an toàn P_neutral được xếp hạng
 * theo khoảng cách thoáng lớn nhất (Clearance Distance) tính đến mọi vùng cấm và mép viewport.
 * Kết hợp:
 * - Phân rã khoảng trống chính xác theo biên hình chữ nhật (Interval Gap Midpoints) để không bỏ sót khe hẹp.
 * - Quét lưới đều (Adaptive Grid) để chọn điểm chính giữa vùng thoáng lớn.
 */
export function computeSafeNeutralPointCandidates(
  viewport: ViewportSize,
  forbiddenRects: Rect[],
  options: SafeNeutralPointOptions = {}
): RankedNeutralCandidate[] {
  const vw = Math.max(0, viewport.width);
  const vh = Math.max(0, viewport.height);
  if (vw < 4 || vh < 4) return [];

  const allForbidden = [...forbiddenRects, ...(options.extraForbiddenRects || [])].filter(
    (r) => r.width > 0 && r.height > 0 && r.x < vw && r.y < vh && r.x + r.width > 0 && r.y + r.height > 0
  );

  const initialPad = options.paddingPx ?? 6;
  const initialEdge = options.edgeMarginPx ?? 6;
  const gridStep = Math.max(8, options.gridStepPx ?? 24);

  const passes: Array<{ pad: number; edge: number }> = [
    { pad: initialPad, edge: initialEdge },
  ];
  if (initialPad > 1 || initialEdge > 2) {
    passes.push({ pad: 1, edge: 2 });
  }
  if (initialPad > 0 || initialEdge > 1) {
    passes.push({ pad: 0.5, edge: 1 });
  }

  for (const pass of passes) {
    const minX = pass.edge;
    const maxX = vw - pass.edge;
    const minY = pass.edge;
    const maxY = vh - pass.edge;
    if (maxX <= minX || maxY <= minY) continue;

    // 1. Thu thập các mốc biên X, Y của vùng cấm để tạo midpoint cho mọi khe hở
    const rawXs: number[] = [minX, maxX];
    const rawYs: number[] = [minY, maxY];

    for (const r of allForbidden) {
      const lx = Math.max(minX, Math.min(maxX, r.x - pass.pad));
      const rx = Math.max(minX, Math.min(maxX, r.x + r.width + pass.pad));
      const ty = Math.max(minY, Math.min(maxY, r.y - pass.pad));
      const by = Math.max(minY, Math.min(maxY, r.y + r.height + pass.pad));
      rawXs.push(lx, rx);
      rawYs.push(ty, by);
    }

    const xs = deduplicateSortedCoords(rawXs, 1.5, 56);
    const ys = deduplicateSortedCoords(rawYs, 1.5, 56);

    const midXs: number[] = [];
    for (let i = 0; i < xs.length - 1; i++) {
      if (xs[i + 1] - xs[i] >= 1) {
        midXs.push((xs[i] + xs[i + 1]) / 2);
      }
    }
    const midYs: number[] = [];
    for (let i = 0; i < ys.length - 1; i++) {
      if (ys[i + 1] - ys[i] >= 1) {
        midYs.push((ys[i] + ys[i + 1]) / 2);
      }
    }

    const samplePoints: Point[] = [];
    const seenKeys = new Set<string>();
    const addSample = (x: number, y: number) => {
      const rx = Math.round(x);
      const ry = Math.round(y);
      if (rx < minX || rx > maxX || ry < minY || ry > maxY) return;
      const key = `${rx},${ry}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        samplePoints.push({ x: rx, y: ry });
      }
    };

    // Chiến lược A: Midpoints từ phân rã biên hình học
    for (const mx of midXs) {
      for (const my of midYs) {
        addSample(mx, my);
      }
    }

    // Chiến lược B: Lưới đều trên toàn viewport
    for (let x = minX + Math.floor(gridStep / 2); x <= maxX; x += gridStep) {
      for (let y = minY + Math.floor(gridStep / 2); y <= maxY; y += gridStep) {
        addSample(x, y);
      }
    }

    // Lọc bỏ các điểm nằm trong bất kỳ forbidden rect nào và tính clearance distance
    const valid: RankedNeutralCandidate[] = [];
    for (const pt of samplePoints) {
      let insideForbidden = false;
      let minClearance = Math.min(pt.x, vw - pt.x, pt.y, vh - pt.y);

      for (const rect of allForbidden) {
        if (rectContainsPoint(rect, pt, pass.pad)) {
          insideForbidden = true;
          break;
        }
        const d = distancePointToRect(pt, rect);
        if (d < minClearance) {
          minClearance = d;
        }
      }

      if (!insideForbidden) {
        valid.push({
          point: pt,
          clearancePx: Math.round(minClearance * 100) / 100,
        });
      }
    }

    if (valid.length > 0) {
      valid.sort((a, b) => b.clearancePx - a.clearancePx);
      // Trả về tối đa 25 điểm đại diện tách nhau hợp lý để hit-test nhanh
      const diversified: RankedNeutralCandidate[] = [];
      for (const cand of valid) {
        if (diversified.length >= 25) break;
        const tooClose = diversified.some(
          (picked) =>
            Math.hypot(picked.point.x - cand.point.x, picked.point.y - cand.point.y) < 12
        );
        if (!tooClose || diversified.length < 5) {
          diversified.push(cand);
        }
      }
      return diversified;
    }
  }

  return [];
}

/**
 * Hàm hình học thuần túy tính tọa độ Safe Neutral Click P_neutral từ danh sách vùng cấm.
 * Đảm bảo P_neutral nằm nghiêm ngặt bên ngoài toàn bộ bounding box cấm.
 */
export function computeSafeNeutralPointFromGeometry(
  viewport: ViewportSize,
  forbiddenRects: Rect[],
  options: SafeNeutralPointOptions = {}
): SafeNeutralPointResult {
  const candidates = computeSafeNeutralPointCandidates(viewport, forbiddenRects, options);
  if (candidates.length === 0) {
    return {
      found: false,
      point: null,
      clearancePx: 0,
      forbiddenRectCount: forbiddenRects.length,
      viewport,
      reason: 'Không tìm thấy tọa độ trống an toàn nào ngoài vùng cấm trên viewport',
    };
  }

  const best = candidates[0];
  return {
    found: true,
    point: best.point,
    clearancePx: best.clearancePx,
    forbiddenRectCount: forbiddenRects.length,
    viewport,
    reason: `Tìm thấy tọa độ trống an toàn (${best.point.x}, ${best.point.y}) với khoảng thoáng ${best.clearancePx}px`,
  };
}

// ============================================================================
// BROWSER HELPERS & OVERLAY DETECTION ENGINE
// ============================================================================

async function ensureEsbuildNameHelper(page: Page): Promise<void> {
  await page
    .evaluate(
      'var __name = globalThis.__name = window.__name = globalThis.__name || function(fn) { return fn; };'
    )
    .catch(() => {});
}

async function waitMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Quét toàn bộ các lớp phủ tương tác đang hiển thị vật lý trên trang (Dropdown, Popover, Modal/Dialog).
 * Tự động lọc bỏ phần tử ẩn, gộp wrapper-dialog trùng lặp và sắp xếp theo thứ tự lớp phủ (topOverlay ở cuối mảng).
 */
export async function detectActiveOverlays(page: Page): Promise<ActiveOverlayInfo[]> {
  if (page.isClosed()) return [];
  await ensureEsbuildNameHelper(page);

  const rawOverlays = await page
    .evaluate(
      ({ dropdownSels, popoverSels, modalSels }) => {
        const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
        const vh = window.innerHeight || document.documentElement.clientHeight || 720;

        const w = window as any;
        if (typeof w.__autotestOverlaySeq !== 'number') {
          w.__autotestOverlaySeq = 1;
        }

        function isVisibleElement(el: Element): { visible: boolean; rect: DOMRect } {
          const rect = el.getBoundingClientRect();
          if (rect.width <= 4 || rect.height <= 4) {
            return { visible: false, rect };
          }
          if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= vw || rect.top >= vh) {
            return { visible: false, rect };
          }
          if (el.getAttribute('aria-hidden') === 'true') {
            return { visible: false, rect };
          }
          const style = window.getComputedStyle(el);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            parseFloat(style.opacity || '1') <= 0.01
          ) {
            return { visible: false, rect };
          }

          let ancestor = el.parentElement;
          while (ancestor && ancestor !== document.documentElement) {
            const aStyle = window.getComputedStyle(ancestor);
            if (aStyle.display === 'none' || parseFloat(aStyle.opacity || '1') <= 0.01) {
              return { visible: false, rect };
            }
            ancestor = ancestor.parentElement;
          }
          return { visible: true, rect };
        }

        function computeEffectiveZIndex(el: Element): number {
          let cur: Element | null = el;
          let maxZ = 0;
          while (cur && cur !== document.documentElement) {
            const st = window.getComputedStyle(cur);
            if (st.position !== 'static') {
              const parsed = parseInt(st.zIndex || '0', 10);
              if (!isNaN(parsed) && parsed > maxZ) {
                maxZ = parsed;
              }
            }
            cur = cur.parentElement;
          }
          return maxZ;
        }

        function isTopLayerElement(el: Element): boolean {
          try {
            if (el.matches('dialog:modal')) return true;
          } catch {}
          try {
            if (el.matches('[popover]:popover-open')) return true;
          } catch {}
          return false;
        }

        function ensureOverlayId(el: Element): string {
          let oid = el.getAttribute('data-autotest-overlay-id');
          if (!oid) {
            oid = `ov-${w.__autotestOverlaySeq++}`;
            el.setAttribute('data-autotest-overlay-id', oid);
          }
          return oid;
        }

        function buildStableSelector(el: Element): string {
          const oid = el.getAttribute('data-autotest-overlay-id');
          if (oid) return `[data-autotest-overlay-id="${oid}"]`;
          if (el.id) return `#${CSS.escape(el.id)}`;
          return el.tagName.toLowerCase();
        }

        type RawMatch = {
          el: Element;
          kind: 'dropdown' | 'popover' | 'modal';
          matchedSelector: string;
          rect: DOMRect;
          isNativeDialog: boolean;
          isPopoverOpen: boolean;
        };

        const seenElements = new Map<Element, RawMatch>();

        function collect(selectors: string[], kind: 'dropdown' | 'popover' | 'modal') {
          for (const sel of selectors) {
            let nodes: NodeListOf<Element>;
            try {
              nodes = document.querySelectorAll(sel);
            } catch {
              continue;
            }
            for (const el of Array.from(nodes)) {
              // Bỏ qua thanh điều hướng <nav> tĩnh không phải dropdown nổi
              if (
                kind === 'dropdown' &&
                el.tagName.toLowerCase() === 'nav' &&
                window.getComputedStyle(el).position === 'static'
              ) {
                continue;
              }

              const vis = isVisibleElement(el);
              if (!vis.visible) continue;

              const isNativeDialog = el.tagName.toLowerCase() === 'dialog' && el.hasAttribute('open');
              let isPopoverOpen = false;
              try {
                isPopoverOpen = el.matches('[popover]:popover-open');
              } catch {}

              // Nếu phần tử vừa có .MuiPopover-root vừa có .MuiModal-root, giữ phân loại popover/dropdown
              const existing = seenElements.get(el);
              if (!existing) {
                seenElements.set(el, {
                  el,
                  kind,
                  matchedSelector: sel,
                  rect: vis.rect,
                  isNativeDialog,
                  isPopoverOpen,
                });
              }
            }
          }
        }

        // Thứ tự ưu tiên phân loại: Popover/Dropdown trước Modal để .MuiPopover-root.MuiModal-root không bị nhầm thành Modal
        collect(dropdownSels, 'dropdown');
        collect(popoverSels, 'popover');
        collect(modalSels, 'modal');

        // Chuẩn hóa: Nếu phần tử là .MuiModal-root nhưng không có dialog và chứa listbox/menu/popover-paper -> đổi thành popover/dropdown
        for (const match of seenElements.values()) {
          if (match.kind === 'modal') {
            const cls = (match.el.className || '').toString();
            const hasDialogRole =
              match.el.getAttribute('role') === 'dialog' ||
              match.el.getAttribute('role') === 'alertdialog' ||
              match.el.getAttribute('aria-modal') === 'true' ||
              match.isNativeDialog ||
              cls.includes('MuiDialog') ||
              cls.includes('ant-modal') ||
              cls.includes('el-dialog') ||
              /\bmodal\b/i.test(cls);

            if (!hasDialogRole) {
              if (match.el.querySelector('[role="listbox"], [role="menu"]')) {
                match.kind = 'dropdown';
              } else if (match.el.querySelector('.MuiPopover-paper')) {
                match.kind = 'popover';
              }
            }
          }
        }

        const matches = Array.from(seenElements.values());

        // Gộp các phần tử cha-con cùng thuộc một đơn vị overlay duy nhất:
        // VD: .modal (backdrop wrapper) -> .modal-dialog[role="dialog"]
        //     .ant-modal-root -> .ant-modal-wrap -> .ant-modal
        //     .MuiPopover-root -> .MuiMenu-paper -> [role="menu"]
        // Nhưng GIỮ RIÊNG nếu một dropdown mở BÊN TRONG một modal thực sự!
        const collapsed: Array<{
          containerEl: Element;
          contentEl: Element;
          kind: 'dropdown' | 'popover' | 'modal';
          matchedSelector: string;
          isNativeDialog: boolean;
          isPopoverOpen: boolean;
        }> = [];

        const consumed = new Set<Element>();

        for (const m of matches) {
          if (consumed.has(m.el)) continue;

          // Tìm xem có phần tử con nào cùng bản chất nằm trong m.el không
          const descendants = matches.filter((other) => other.el !== m.el && m.el.contains(other.el));
          const ancestors = matches.filter((other) => other.el !== m.el && other.el.contains(m.el));

          // Nếu m.el nằm bên trong một wrapper cùng loại (vd modal-dialog nằm trong .modal, hoặc listbox nằm trong .ant-select-dropdown)
          const sameUnitAncestor = ancestors.find((anc) => {
            if (anc.kind === m.kind) return true;
            if (anc.kind === 'popover' && m.kind === 'dropdown') return true;
            if (anc.kind === 'dropdown' && m.kind === 'popover') return true;
            return false;
          });
          if (sameUnitAncestor) {
            continue; // Sẽ được xử lý cùng ancestor
          }

          // Chọn contentEl là phần tử con trực quan nhất cùng nhóm
          const sameUnitDescendants = descendants.filter((desc) => {
            if (desc.kind === m.kind) return true;
            if (m.kind === 'popover' && desc.kind === 'dropdown') return true;
            if (m.kind === 'dropdown' && desc.kind === 'popover') return true;
            return false;
          });

          let containerEl = m.el;
          let contentEl = m.el;
          let finalKind = m.kind;
          let finalSelector = m.matchedSelector;
          let isNativeDialog = m.isNativeDialog;
          let isPopoverOpen = m.isPopoverOpen;

          if (sameUnitDescendants.length > 0) {
            // Ưu tiên descendant có kích thước nhỏ hơn (hộp dialog/menu thực thay vì wrapper toàn màn hình)
            sameUnitDescendants.sort((a, b) => {
              const areaA = a.rect.width * a.rect.height;
              const areaB = b.rect.width * b.rect.height;
              return areaA - areaB;
            });
            const innermost = sameUnitDescendants[0];
            contentEl = innermost.el;
            if (innermost.kind === 'dropdown' && finalKind === 'popover') {
              finalKind = 'dropdown';
            }
            isNativeDialog = isNativeDialog || innermost.isNativeDialog;
            isPopoverOpen = isPopoverOpen || innermost.isPopoverOpen;
            sameUnitDescendants.forEach((d) => consumed.add(d.el));
          } else if (finalKind === 'modal') {
            // Nếu container là wrapper toàn màn hình (vd .modal.show) mà hộp thoại con là .modal-dialog / .modal-content / .ant-modal-content
            const cRect = containerEl.getBoundingClientRect();
            const isFullscreenWrapper = cRect.width >= vw * 0.85 && cRect.height >= vh * 0.85;
            if (isFullscreenWrapper) {
              const innerBox = containerEl.querySelector(
                '.modal-content, .modal-dialog, .ant-modal-content, .ant-modal, .MuiDialog-paper, .el-dialog, [role="document"]'
              );
              if (innerBox) {
                const iVis = isVisibleElement(innerBox);
                if (iVis.visible && iVis.rect.width < cRect.width * 0.95) {
                  contentEl = innerBox;
                }
              }
            }
          } else if (finalKind === 'popover') {
            const cRect = containerEl.getBoundingClientRect();
            if (cRect.width >= vw * 0.85 && cRect.height >= vh * 0.85) {
              const innerPaper = containerEl.querySelector(
                '.MuiPopover-paper, .MuiPaper-root, .ant-popover-inner, [role="listbox"], [role="menu"]'
              );
              if (innerPaper) {
                const iVis = isVisibleElement(innerPaper);
                if (iVis.visible) {
                  contentEl = innerPaper;
                }
              }
            }
          }

          consumed.add(m.el);
          collapsed.push({
            containerEl,
            contentEl,
            kind: finalKind,
            matchedSelector: finalSelector,
            isNativeDialog,
            isPopoverOpen,
          });
        }

        // Tạo metadata cho từng overlay đã gộp
        function inferTriggerForOverlay(overlayEl: Element): {
          triggerSelector?: string;
          triggerRect?: { x: number; y: number; width: number; height: number };
        } {
          const id = overlayEl.id;
          let triggerEl: Element | null = null;
          if (id) {
            triggerEl =
              document.querySelector(`[aria-controls="${CSS.escape(id)}"]`) ||
              document.querySelector(`[aria-owns="${CSS.escape(id)}"]`) ||
              document.querySelector(`[popovertarget="${CSS.escape(id)}"]`);
          }
          if (!triggerEl) {
            const expanded = Array.from(
              document.querySelectorAll('[aria-expanded="true"]')
            ).filter((cand) => !overlayEl.contains(cand) && isVisibleElement(cand).visible);
            if (expanded.length === 1) {
              triggerEl = expanded[0];
            } else if (expanded.length > 1) {
              const oRect = overlayEl.getBoundingClientRect();
              expanded.sort((a, b) => {
                const ra = a.getBoundingClientRect();
                const rb = b.getBoundingClientRect();
                const da = Math.hypot(ra.left - oRect.left, ra.bottom - oRect.top);
                const db = Math.hypot(rb.left - oRect.left, rb.bottom - oRect.top);
                return da - db;
              });
              triggerEl = expanded[0];
            }
          }
          if (!triggerEl) return {};
          const vis = isVisibleElement(triggerEl);
          if (!vis.visible) return {};

          let tid = triggerEl.getAttribute('data-autotest-trigger-id');
          if (!tid) {
            tid = `trig-${w.__autotestOverlaySeq++}`;
            triggerEl.setAttribute('data-autotest-trigger-id', tid);
          }
          return {
            triggerSelector: triggerEl.id
              ? `#${CSS.escape(triggerEl.id)}`
              : `[data-autotest-trigger-id="${tid}"]`,
            triggerRect: {
              x: Math.round(vis.rect.x),
              y: Math.round(vis.rect.y),
              width: Math.round(vis.rect.width),
              height: Math.round(vis.rect.height),
            },
          };
        }

        const results = collapsed.map((item) => {
          const overlayId = ensureOverlayId(item.containerEl);
          const contentOid = `${overlayId}-content`;
          item.contentEl.setAttribute('data-autotest-overlay-content-id', contentOid);

          const contentRect = item.contentEl.getBoundingClientRect();
          const containerRect = item.containerEl.getBoundingClientRect();

          let hasBackdrop = false;
          let backdropRect: { x: number; y: number; width: number; height: number } | undefined = undefined;

          if (item.kind === 'modal') {
            if (item.isNativeDialog) {
              hasBackdrop = true;
              backdropRect = { x: 0, y: 0, width: vw, height: vh };
            } else if (
              containerRect.width > contentRect.width + 20 ||
              containerRect.height > contentRect.height + 20
            ) {
              hasBackdrop = true;
              backdropRect = {
                x: Math.round(containerRect.x),
                y: Math.round(containerRect.y),
                width: Math.round(containerRect.width),
                height: Math.round(containerRect.height),
              };
            } else {
              // Kiểm tra các phần tử backdrop anh em trên trang
              const siblingBackdrop = document.querySelector(
                '.modal-backdrop, .ant-modal-mask, .MuiBackdrop-root, [class*="modal-backdrop" i], [class*="dialog-backdrop" i], [data-modal-backdrop]'
              );
              if (siblingBackdrop) {
                const bVis = isVisibleElement(siblingBackdrop);
                if (bVis.visible) {
                  hasBackdrop = true;
                  backdropRect = {
                    x: Math.round(bVis.rect.x),
                    y: Math.round(bVis.rect.y),
                    width: Math.round(bVis.rect.width),
                    height: Math.round(bVis.rect.height),
                  };
                }
              }
            }
          }

          const triggerInfo =
            item.kind !== 'modal' ? inferTriggerForOverlay(item.containerEl) : {};

          const zIndex = Math.max(
            computeEffectiveZIndex(item.containerEl),
            computeEffectiveZIndex(item.contentEl)
          );
          const isTopLayer = isTopLayerElement(item.containerEl) || isTopLayerElement(item.contentEl);

          return {
            _el: item.containerEl,
            overlayId,
            kind: item.kind,
            matchedSelector: item.matchedSelector,
            containerSelector: buildStableSelector(item.containerEl),
            contentSelector: `[data-autotest-overlay-content-id="${contentOid}"]`,
            tag: item.contentEl.tagName.toLowerCase(),
            role:
              item.contentEl.getAttribute('role') ||
              item.containerEl.getAttribute('role') ||
              undefined,
            elemId: item.contentEl.id || item.containerEl.id || undefined,
            ariaLabel:
              item.contentEl.getAttribute('aria-label') ||
              item.containerEl.getAttribute('aria-label') ||
              undefined,
            ariaModal:
              item.contentEl.getAttribute('aria-modal') === 'true' ||
              item.containerEl.getAttribute('aria-modal') === 'true',
            isNativeDialog: item.isNativeDialog,
            isPopoverOpen: item.isPopoverOpen,
            hasBackdrop,
            rect: {
              x: Math.round(contentRect.x),
              y: Math.round(contentRect.y),
              width: Math.round(contentRect.width),
              height: Math.round(contentRect.height),
            },
            backdropRect,
            zIndex,
            isTopLayer,
            detectedAt: Date.now(),
            triggerSelector: triggerInfo.triggerSelector,
            triggerRect: triggerInfo.triggerRect,
          };
        });

        // Sắp xếp theo thứ tự lớp phủ tăng dần (Topmost overlay nằm ở cuối mảng)
        results.sort((a, b) => {
          if (a.isTopLayer !== b.isTopLayer) return a.isTopLayer ? 1 : -1;
          if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
          // Nếu một overlay nằm bên trong overlay khác (VD: dropdown bên trong modal), overlay con ở trên
          if (a._el.contains(b._el)) return -1;
          if (b._el.contains(a._el)) return 1;
          const pos = a._el.compareDocumentPosition(b._el);
          if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
          if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
          return 0;
        });

        return results.map(({ _el, ...rest }) => rest);
      },
      {
        dropdownSels: DROPDOWN_OVERLAY_SELECTORS,
        popoverSels: POPOVER_OVERLAY_SELECTORS,
        modalSels: MODAL_OVERLAY_SELECTORS,
      }
    )
    .catch(() => []);

  return rawOverlays;
}

// ============================================================================
// CONTEXT-BOUNDARY CROSSING DETECTION
// ============================================================================

/**
 * Kiểm tra xem phần tử mục tiêu tiếp theo E_next có nằm NGOÀI subtree / phạm vi của lớp phủ đang mở hay không.
 * - Ưu tiên 1 (Chính xác tuyệt đối): Kiểm tra quan hệ cây DOM `overlayEl.contains(targetEl)` (xử lý đúng kể cả khi dropdown đè lên input bên dưới).
 * - Ưu tiên 2 (Hình học): Kiểm tra `rect` hoặc `point` có nằm ngoài `overlay.rect` hay không.
 */
export async function detectContextBoundaryCrossing(
  page: Page,
  nextTargetInfo: NextTargetInfo,
  options: { preDetectedOverlays?: ActiveOverlayInfo[] } = {}
): Promise<ContextBoundaryCrossingResult> {
  const activeOverlays =
    options.preDetectedOverlays !== undefined
      ? options.preDetectedOverlays
      : await detectActiveOverlays(page);

  if (activeOverlays.length === 0) {
    return {
      crossed: false,
      activeOverlays: [],
      topOverlay: null,
      crossedOverlays: [],
      targetInsideTopOverlay: false,
      checkMethod: 'NONE',
      reason: 'Không có lớp phủ tương tác nào đang mở trên trang',
    };
  }

  const topOverlay = activeOverlays[activeOverlays.length - 1];
  const targetSelector = nextTargetInfo.selector || nextTargetInfo.candidate?.selectorPath;
  const targetElemId = nextTargetInfo.elemId || nextTargetInfo.candidate?.elemId;
  const targetRect = nextTargetInfo.rect || nextTargetInfo.candidate?.rect;
  const targetPoint = nextTargetInfo.point;

  // Ưu tiên 1: Kiểm tra DOM Subtree Containment trực tiếp trong trang
  if (targetSelector || targetElemId) {
    await ensureEsbuildNameHelper(page);
    const domCheck = await page
      .evaluate(
        ({ overlays, sel, elemId }) => {
          let targetEl: Element | null = null;
          if (sel) {
            try {
              targetEl = document.querySelector(sel);
            } catch {
              targetEl = null;
            }
          }
          if (!targetEl && elemId) {
            targetEl = document.getElementById(elemId);
          }
          if (!targetEl) {
            return { foundTarget: false, insideMap: {} as Record<string, boolean> };
          }

          const insideMap: Record<string, boolean> = {};
          for (const ov of overlays) {
            const contentEl = document.querySelector(ov.contentSelector);
            const containerEl = document.querySelector(ov.containerSelector);
            // Với modal, dùng hộp thoại nội dung (contentEl) để phân biệt trang cha / backdrop với nội dung trong modal
            const scopeEl = ov.kind === 'modal' ? contentEl || containerEl : containerEl || contentEl;
            let isInside = false;
            if (scopeEl) {
              isInside = scopeEl === targetEl || scopeEl.contains(targetEl);
            }
            insideMap[ov.overlayId] = isInside;
          }

          return { foundTarget: true, insideMap };
        },
        { overlays: activeOverlays, sel: targetSelector, elemId: targetElemId }
      )
      .catch(() => ({ foundTarget: false, insideMap: {} as Record<string, boolean> }));

    if (domCheck.foundTarget) {
      const crossedOverlays = activeOverlays.filter((ov) => !domCheck.insideMap[ov.overlayId]);
      const targetInsideTopOverlay = Boolean(domCheck.insideMap[topOverlay.overlayId]);
      const crossed = !targetInsideTopOverlay;

      return {
        crossed,
        activeOverlays,
        topOverlay,
        crossedOverlays,
        targetInsideTopOverlay,
        checkMethod: 'DOM_SUBTREE',
        reason: crossed
          ? `Phát hiện vượt ranh giới ngữ cảnh (Context-Boundary Crossing): Mục tiêu "${targetSelector || targetElemId}" nằm NGOÀI subtree của lớp phủ ${topOverlay.kind} (${topOverlay.matchedSelector})`
          : `Mục tiêu "${targetSelector || targetElemId}" nằm BÊN TRONG lớp phủ ${topOverlay.kind} đang mở -> giữ nguyên trạng thái overlay`,
      };
    }
  }

  // Ưu tiên 2: Kiểm tra hình học theo Point hoặc Rect
  const evalPoint: Point | null =
    targetPoint ||
    (targetRect
      ? { x: targetRect.x + targetRect.width / 2, y: targetRect.y + targetRect.height / 2 }
      : null);

  if (evalPoint) {
    const checkMethod: 'GEOMETRY_RECT' | 'GEOMETRY_POINT' = targetPoint
      ? 'GEOMETRY_POINT'
      : 'GEOMETRY_RECT';

    const crossedOverlays = activeOverlays.filter(
      (ov) => !rectContainsPoint(ov.rect, evalPoint, 1)
    );
    const targetInsideTopOverlay = rectContainsPoint(topOverlay.rect, evalPoint, 1);
    const crossed = !targetInsideTopOverlay;

    return {
      crossed,
      activeOverlays,
      topOverlay,
      crossedOverlays,
      targetInsideTopOverlay,
      checkMethod,
      reason: crossed
        ? `Phát hiện vượt ranh giới ngữ cảnh theo tọa độ (${Math.round(evalPoint.x)}, ${Math.round(evalPoint.y)}): nằm ngoài phạm vi lớp phủ ${topOverlay.kind}`
        : `Tọa độ (${Math.round(evalPoint.x)}, ${Math.round(evalPoint.y)}) nằm trong phạm vi lớp phủ ${topOverlay.kind}`,
    };
  }

  // Nếu không cung cấp selector/rect/point nào -> không thể khẳng định đã vượt ranh giới
  return {
    crossed: false,
    activeOverlays,
    topOverlay,
    crossedOverlays: [],
    targetInsideTopOverlay: false,
    checkMethod: 'NONE',
    reason: 'Không đủ thông tin mục tiêu E_next để đánh giá Context-Boundary Crossing',
  };
}

// ============================================================================
// SAFE NEUTRAL CLICK CALCULATION ON LIVE DOM (TIER 3)
// ============================================================================

/**
 * Thu thập toàn bộ Bounding Box cấm (phần tử tương tác, floating portal, sticky header/footer,
 * modal, ad banner, iframe) và tính toán tọa độ trống an toàn P_neutral trên <body>,
 * đồng thời xác thực hit-test trực tiếp qua document.elementFromPoint(x, y).
 */
export async function calculateSafeNeutralPoint(
  page: Page,
  options: SafeNeutralPointOptions = {}
): Promise<SafeNeutralPointResult> {
  if (page.isClosed()) {
    return {
      found: false,
      point: null,
      clearancePx: 0,
      forbiddenRectCount: 0,
      viewport: { width: 0, height: 0 },
      reason: 'Trang đã đóng',
    };
  }

  await ensureEsbuildNameHelper(page);

  // Bước 1: Trích xuất viewport và toàn bộ các vùng cấm trên DOM
  const scene = await page
    .evaluate(
      ({ overlaySels }) => {
        const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
        const vh = window.innerHeight || document.documentElement.clientHeight || 720;

        const interactiveSel = [
          'a',
          'button',
          'input',
          'select',
          'textarea',
          'label',
          'summary',
          'details',
          'option',
          'audio[controls]',
          'video[controls]',
          '[role="button"]',
          '[role="link"]',
          '[role="checkbox"]',
          '[role="radio"]',
          '[role="switch"]',
          '[role="tab"]',
          '[role="menuitem"]',
          '[role="option"]',
          '[role="combobox"]',
          '[role="textbox"]',
          '[role="searchbox"]',
          '[role="slider"]',
          '[role="spinbutton"]',
          '[role="treeitem"]',
          '[tabindex]:not([tabindex="-1"])',
          '[onclick]',
          '[contenteditable="true"]',
        ].join(', ');

        const adAndIframeSel = [
          'iframe',
          'embed',
          'object',
          'ins.adsbygoogle',
          '[data-ad]',
          '[data-ad-slot]',
          '[data-testid*="ad" i]',
          '[id*="ad-banner" i]',
          '[id*="ad_banner" i]',
          '[id*="advert" i]',
          '[id*="ads-" i]',
          '[id*="-ads" i]',
          '[class*="ad-banner" i]',
          '[class*="ad_banner" i]',
          '[class*="ad-slot" i]',
          '[class*="ad-box" i]',
          '[class*="advert" i]',
          '[class*="sponsor" i]',
          '[class*="promo-banner" i]',
          '[class*="cookie-banner" i]',
          '[class*="sticky-bar" i]',
          '[class*="floating-bar" i]',
        ].join(', ');

        const stickyStructuralSel = 'header, footer, nav, [role="banner"], [role="navigation"], [role="contentinfo"], [role="toolbar"], [role="tooltip"]';

        const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
        const seen = new Set<Element>();

        function pushIfVisible(el: Element, allowFullscreen = false) {
          if (seen.has(el)) return;
          if (el === document.body || el === document.documentElement) return;
          const st = window.getComputedStyle(el);
          if (
            st.display === 'none' ||
            st.visibility === 'hidden' ||
            parseFloat(st.opacity || '1') <= 0.01
          ) {
            return;
          }
          const r = el.getBoundingClientRect();
          if (r.width <= 1 || r.height <= 1) return;
          if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return;

          // Không đưa wrapper toàn màn hình không tương tác (vd #root hoặc overlay backdrop pointer-events:none) vào vùng cấm
          if (!allowFullscreen && r.width >= vw * 0.92 && r.height >= vh * 0.92) {
            return;
          }

          seen.add(el);
          const x = Math.max(0, r.left);
          const y = Math.max(0, r.top);
          const right = Math.min(vw, r.right);
          const bottom = Math.min(vh, r.bottom);
          if (right - x > 0 && bottom - y > 0) {
            rects.push({ x, y, width: right - x, height: bottom - y });
          }
        }

        // 1. Phần tử tương tác
        document.querySelectorAll(interactiveSel).forEach((el) => pushIfVisible(el, false));

        // 2. Quảng cáo & Iframes
        document.querySelectorAll(adAndIframeSel).forEach((el) => pushIfVisible(el, false));

        // 3. Header / Footer / Nav / Tooltip
        document.querySelectorAll(stickyStructuralSel).forEach((el) => pushIfVisible(el, false));

        // 4. Các overlay / portal / modal đang mở
        for (const sel of overlaySels) {
          try {
            document.querySelectorAll(sel).forEach((el) => pushIfVisible(el, false));
          } catch {}
        }

        // 5. Quét mọi phần tử có position: fixed / sticky hoặc cursor: pointer
        const allEls = document.querySelectorAll('body *');
        for (const el of Array.from(allEls)) {
          if (seen.has(el)) continue;
          const st = window.getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') <= 0.01) {
            continue;
          }
          if (st.position === 'fixed' || st.position === 'sticky') {
            if (st.pointerEvents !== 'none') {
              pushIfVisible(el, false);
            }
          } else if (st.cursor === 'pointer') {
            pushIfVisible(el, false);
          }
        }

        return {
          viewport: { width: vw, height: vh },
          rects,
        };
      },
      {
        overlaySels: [
          ...DROPDOWN_OVERLAY_SELECTORS,
          ...POPOVER_OVERLAY_SELECTORS,
          ...MODAL_OVERLAY_SELECTORS,
        ],
      }
    )
    .catch(() => ({ viewport: { width: 1280, height: 720 }, rects: [] }));

  // Bước 2: Chạy thuật toán hình học tìm danh sách ứng viên có clearance lớn nhất
  const rankedCandidates = computeSafeNeutralPointCandidates(
    scene.viewport,
    scene.rects,
    options
  );

  if (rankedCandidates.length === 0) {
    return {
      found: false,
      point: null,
      clearancePx: 0,
      forbiddenRectCount: scene.rects.length,
      viewport: scene.viewport,
      reason: 'Không tìm thấy điểm trống hình học nào ngoài các vùng cấm trên trang',
    };
  }

  // Bước 3: Xác thực vật lý bằng document.elementFromPoint(x, y)
  const verified = await page
    .evaluate(
      ({ candidates, overlaySels }) => {
        const interactiveCheckSel = [
          'a',
          'button',
          'input',
          'select',
          'textarea',
          'label',
          'summary',
          '[role="button"]',
          '[role="link"]',
          '[role="checkbox"]',
          '[role="radio"]',
          '[role="switch"]',
          '[role="tab"]',
          '[role="menuitem"]',
          '[role="option"]',
          '[role="combobox"]',
          '[role="textbox"]',
          '[tabindex]:not([tabindex="-1"])',
          '[onclick]',
          '[contenteditable="true"]',
          'iframe',
        ].join(', ');

        const adCheckSel = [
          'ins.adsbygoogle',
          '[data-ad]',
          '[data-ad-slot]',
          '[data-testid*="ad" i]',
          '[id*="ad-banner" i]',
          '[id*="advert" i]',
          '[class*="ad-banner" i]',
          '[class*="ad-slot" i]',
          '[class*="advert" i]',
          '[class*="promo-banner" i]',
          '[class*="cookie-banner" i]',
        ].join(', ');

        function isElementUnsafe(el: Element | null): boolean {
          if (!el) return false;
          if (el === document.body || el === document.documentElement) return false;
          if (el.closest(interactiveCheckSel)) return true;
          if (el.closest(adCheckSel)) return true;
          if (el.closest('header, footer, nav, [role="banner"], [role="navigation"], [role="contentinfo"]')) {
            return true;
          }

          for (const sel of overlaySels) {
            try {
              if (el.closest(sel)) return true;
            } catch {}
          }

          let cur: Element | null = el;
          while (cur && cur !== document.body && cur !== document.documentElement) {
            const st = window.getComputedStyle(cur);
            if (st.position === 'fixed' || st.position === 'sticky' || st.cursor === 'pointer') {
              const r = cur.getBoundingClientRect();
              const vw = window.innerWidth || 1280;
              const vh = window.innerHeight || 720;
              if (!(r.width >= vw * 0.92 && r.height >= vh * 0.92)) {
                return true;
              }
            }
            cur = cur.parentElement;
          }
          return false;
        }

        for (const cand of candidates) {
          const hit = document.elementFromPoint(cand.point.x, cand.point.y);
          if (!isElementUnsafe(hit)) {
            return {
              found: true,
              point: cand.point,
              clearancePx: cand.clearancePx,
              hitElementTag: hit ? hit.tagName.toLowerCase() : 'document',
              hitElementId: hit?.id || undefined,
              hitElementClasses: hit ? Array.from(hit.classList) : [],
            };
          }
        }
        return { found: false };
      },
      {
        candidates: rankedCandidates,
        overlaySels: [
          ...DROPDOWN_OVERLAY_SELECTORS,
          ...POPOVER_OVERLAY_SELECTORS,
          ...MODAL_OVERLAY_SELECTORS,
        ],
      }
    )
    .catch(() => ({ found: false } as any));

  if (verified.found && verified.point) {
    return {
      found: true,
      point: verified.point,
      clearancePx: verified.clearancePx,
      hitElementTag: verified.hitElementTag,
      hitElementId: verified.hitElementId,
      hitElementClasses: verified.hitElementClasses,
      forbiddenRectCount: scene.rects.length,
      viewport: scene.viewport,
      reason: `Xác thực tọa độ Safe Neutral Click (${verified.point.x}, ${verified.point.y}) trên <${verified.hitElementTag}> (clearance ${verified.clearancePx}px)`,
    };
  }

  return {
    found: false,
    point: null,
    clearancePx: 0,
    forbiddenRectCount: scene.rects.length,
    viewport: scene.viewport,
    reason: 'Tất cả tọa độ ứng viên đều bị phần tử tương tác/lớp phủ/quảng cáo chặn khi hit-test',
  };
}

// ============================================================================
// ACTIVE OVERLAY TRACKER
// ============================================================================

/**
 * Bộ theo dõi ngăn xếp lớp phủ đang mở (ActiveOverlayTracker)
 * và ánh xạ tự động nút Trigger đã mở từng dropdown/popover để phục vụ Tier 2 Re-Toggle.
 */
export class ActiveOverlayTracker {
  private stack: ActiveOverlayInfo[] = [];
  private overlayTriggerMap = new Map<string, TriggerRecord>();
  private lastTrigger: TriggerRecord | null = null;

  public recordTrigger(trigger: TriggerRecord): void {
    this.lastTrigger = { ...trigger, timestamp: trigger.timestamp || Date.now() };
  }

  public recordCandidateTrigger(candidate: DOMCandidate): void {
    this.recordTrigger({
      selector: candidate.selectorPath,
      elemId: candidate.elemId,
      rect: candidate.rect,
      text: candidate.text || candidate.ariaLabel || candidate.nearLabel,
      timestamp: Date.now(),
    });
  }

  public associateTrigger(overlayId: string, trigger: TriggerRecord): void {
    this.overlayTriggerMap.set(overlayId, trigger);
  }

  public getTriggerForOverlay(overlayId: string): TriggerRecord | undefined {
    const mapped = this.overlayTriggerMap.get(overlayId);
    if (mapped) return mapped;
    const ov = this.stack.find((item) => item.overlayId === overlayId);
    if (ov && (ov.triggerSelector || ov.triggerRect)) {
      return {
        selector: ov.triggerSelector,
        rect: ov.triggerRect,
        timestamp: ov.detectedAt,
      };
    }
    return this.lastTrigger || undefined;
  }

  public getLastTrigger(): TriggerRecord | null {
    return this.lastTrigger;
  }

  /**
   * Đồng bộ lại ngăn xếp lớp phủ thực tế từ DOM hiện tại và tự động liên kết
   * overlay mới xuất hiện với trigger vừa được tương tác gần nhất.
   */
  public async sync(page: Page): Promise<ActiveOverlayInfo[]> {
    const previousIds = new Set(this.stack.map((o) => o.overlayId));
    const current = await detectActiveOverlays(page);
    const currentIds = new Set(current.map((o) => o.overlayId));

    // Dọn mapping của những overlay đã đóng
    for (const id of Array.from(this.overlayTriggerMap.keys())) {
      if (!currentIds.has(id)) {
        this.overlayTriggerMap.delete(id);
      }
    }

    // Gắn trigger gần nhất cho dropdown/popover mới xuất hiện (trong vòng 15 giây)
    const now = Date.now();
    for (const ov of current) {
      if (!previousIds.has(ov.overlayId) && ov.kind !== 'modal') {
        if (ov.triggerSelector || ov.triggerRect) {
          this.overlayTriggerMap.set(ov.overlayId, {
            selector: ov.triggerSelector,
            rect: ov.triggerRect,
            timestamp: now,
          });
        } else if (this.lastTrigger && now - this.lastTrigger.timestamp <= 15000) {
          this.overlayTriggerMap.set(ov.overlayId, this.lastTrigger);
          ov.triggerSelector = this.lastTrigger.selector;
          ov.triggerRect = this.lastTrigger.rect;
        }
      } else if (this.overlayTriggerMap.has(ov.overlayId)) {
        const stored = this.overlayTriggerMap.get(ov.overlayId)!;
        if (!ov.triggerSelector && stored.selector) ov.triggerSelector = stored.selector;
        if (!ov.triggerRect && stored.rect) ov.triggerRect = stored.rect;
      }
    }

    this.stack = current;
    return [...this.stack];
  }

  public getStack(): ActiveOverlayInfo[] {
    return [...this.stack];
  }

  public getTopOverlay(): ActiveOverlayInfo | null {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
  }

  public removeOverlay(overlayId: string): void {
    this.stack = this.stack.filter((o) => o.overlayId !== overlayId);
    this.overlayTriggerMap.delete(overlayId);
  }

  public clear(): void {
    this.stack = [];
    this.overlayTriggerMap.clear();
    this.lastTrigger = null;
  }
}

// ============================================================================
// 4-TIER DISMISSAL EXECUTION PRIMITIVES
// ============================================================================

async function isOverlayDismissed(
  page: Page,
  targetOverlay: ActiveOverlayInfo
): Promise<{ closed: boolean; remainingOverlays: ActiveOverlayInfo[] }> {
  const current = await detectActiveOverlays(page);
  const stillPresent = current.some((ov) => {
    if (ov.overlayId === targetOverlay.overlayId) return true;
    // Fallback nhận diện trường hợp React re-render làm mất data-autotest-overlay-id
    if (
      ov.kind === targetOverlay.kind &&
      ov.matchedSelector === targetOverlay.matchedSelector &&
      ov.elemId &&
      targetOverlay.elemId &&
      ov.elemId === targetOverlay.elemId
    ) {
      return true;
    }
    return false;
  });
  return { closed: !stillPresent, remainingOverlays: current };
}

/**
 * Tìm điểm click vật lý không bị che khuất trên phần tử Trigger cho Tier 2 Re-Toggle.
 */
async function resolveClickableTriggerPoint(
  page: Page,
  overlay: ActiveOverlayInfo,
  explicitTrigger?: TriggerRecord
): Promise<{ found: boolean; point?: Point; label?: string }> {
  await ensureEsbuildNameHelper(page);

  const selectorCandidates = [
    explicitTrigger?.selector,
    explicitTrigger?.elemId ? `#${explicitTrigger.elemId}` : undefined,
    overlay.triggerSelector,
  ].filter((s): s is string => Boolean(s));

  const res = await page
    .evaluate(
      ({ ovContainerSel, selectors, fallbackRect }) => {
        const vw = window.innerWidth || 1280;
        const vh = window.innerHeight || 720;
        const overlayEl = document.querySelector(ovContainerSel);

        function pickUnobscuredPoint(el: Element): { x: number; y: number } | null {
          const r = el.getBoundingClientRect();
          if (r.width <= 2 || r.height <= 2) return null;
          const insetX = Math.min(5, r.width / 4);
          const insetY = Math.min(5, r.height / 4);
          const pts = [
            { x: r.left + r.width / 2, y: r.top + r.height / 2 },
            { x: r.left + insetX, y: r.top + insetY },
            { x: r.right - insetX, y: r.top + insetY },
            { x: r.left + insetX, y: r.bottom - insetY },
            { x: r.right - insetX, y: r.bottom - insetY },
          ];
          for (const p of pts) {
            if (p.x < 1 || p.x >= vw - 1 || p.y < 1 || p.y >= vh - 1) continue;
            const hit = document.elementFromPoint(p.x, p.y);
            if (!hit) continue;
            if (overlayEl && (overlayEl === hit || overlayEl.contains(hit))) continue;
            if (el === hit || el.contains(hit) || hit.contains(el)) {
              return { x: Math.round(p.x), y: Math.round(p.y) };
            }
          }
          return null;
        }

        // 1. Thử tìm theo các selector trigger đã lưu / suy luận
        for (const sel of selectors) {
          let el: Element | null = null;
          try {
            el = document.querySelector(sel);
          } catch {
            el = null;
          }
          if (!el) continue;
          if (overlayEl && overlayEl.contains(el)) continue;
          const pt = pickUnobscuredPoint(el);
          if (pt) {
            return {
              found: true,
              point: pt,
              label: ((el as HTMLElement).innerText || el.getAttribute('aria-label') || sel).trim().slice(0, 80),
            };
          }
        }

        // 2. Fallback: Tìm trigger đang ở trạng thái mở trên DOM (aria-expanded="true", .ant-select-open, .select__control)
        const heuristicTriggers = Array.from(
          document.querySelectorAll(
            '[aria-expanded="true"], .ant-select-open .ant-select-selector, .select2-container--open .select2-selection, .dropdown.show .dropdown-toggle, [role="combobox"], .select__control, .custom-select-trigger'
          )
        ).filter((el) => !(overlayEl && overlayEl.contains(el)));

        if (heuristicTriggers.length > 0 && overlayEl) {
          const oRect = overlayEl.getBoundingClientRect();
          heuristicTriggers.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            const da = Math.hypot(ra.left - oRect.left, ra.bottom - oRect.top);
            const db = Math.hypot(rb.left - oRect.left, rb.bottom - oRect.top);
            return da - db;
          });
          for (const trig of heuristicTriggers) {
            const pt = pickUnobscuredPoint(trig);
            if (pt) {
              return {
                found: true,
                point: pt,
                label: ((trig as HTMLElement).innerText || trig.getAttribute('aria-label') || trig.tagName).trim().slice(0, 80),
              };
            }
          }
        }

        // 3. Fallback cuối cùng: dùng tọa độ rect trigger đã ghi nhận nếu điểm đó không thuộc overlay
        if (fallbackRect && fallbackRect.width > 2 && fallbackRect.height > 2) {
          const cx = Math.round(fallbackRect.x + fallbackRect.width / 2);
          const cy = Math.round(fallbackRect.y + fallbackRect.height / 2);
          const hit = document.elementFromPoint(cx, cy);
          if (hit && !(overlayEl && (overlayEl === hit || overlayEl.contains(hit)))) {
            return { found: true, point: { x: cx, y: cy }, label: 'recorded-trigger-rect' };
          }
        }

        return { found: false };
      },
      {
        ovContainerSel: overlay.containerSelector,
        selectors: selectorCandidates,
        fallbackRect: explicitTrigger?.rect || overlay.triggerRect || null,
      }
    )
    .catch(() => ({ found: false } as { found: boolean; point?: Point; label?: string }));

  return res;
}

/**
 * Quét các nút đóng góc trên (Tier 4a) và các nút hành động trong Modal (Tier 4c),
 * luôn gắn kèm metadata đầy đủ để chạy qua STRICT Antonym Barrier Guardrail ở tầng Node.
 */
async function inspectModalButtons(
  page: Page,
  overlay: ActiveOverlayInfo
): Promise<{
  closeButtons: Array<ModalButtonDescriptor & { point: Point; priority: number }>;
  actionButtons: Array<ModalButtonDescriptor & { point: Point }>;
}> {
  await ensureEsbuildNameHelper(page);

  return page
    .evaluate(
      ({ containerSel, contentSel, closeSelectors }) => {
        const vw = window.innerWidth || 1280;
        const vh = window.innerHeight || 720;
        const scope =
          document.querySelector(contentSel) || document.querySelector(containerSel);
        if (!scope) return { closeButtons: [], actionButtons: [] };

        const scopeRect = scope.getBoundingClientRect();

        function isClickableVisible(el: Element): { ok: boolean; point?: { x: number; y: number } } {
          const h = el as HTMLElement;
          if ((h as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') {
            return { ok: false };
          }
          const st = window.getComputedStyle(el);
          if (
            st.display === 'none' ||
            st.visibility === 'hidden' ||
            parseFloat(st.opacity || '1') <= 0.01 ||
            st.pointerEvents === 'none'
          ) {
            return { ok: false };
          }
          const r = el.getBoundingClientRect();
          if (r.width <= 4 || r.height <= 4) return { ok: false };
          const insetX = Math.min(4, r.width / 4);
          const insetY = Math.min(4, r.height / 4);
          const samplePts = [
            { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) },
            { x: Math.round(r.left + insetX), y: Math.round(r.top + insetY) },
            { x: Math.round(r.right - insetX), y: Math.round(r.top + insetY) },
            { x: Math.round(r.left + insetX), y: Math.round(r.bottom - insetY) },
            { x: Math.round(r.right - insetX), y: Math.round(r.bottom - insetY) },
          ];
          for (const pt of samplePts) {
            if (pt.x < 1 || pt.x >= vw - 1 || pt.y < 1 || pt.y >= vh - 1) continue;
            const hit = document.elementFromPoint(pt.x, pt.y);
            if (hit && (el === hit || el.contains(hit) || hit.contains(el))) {
              return { ok: true, point: pt };
            }
          }
          return { ok: false };
        }

        function describe(el: Element) {
          const h = el as HTMLElement;
          return {
            text: (h.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(),
            ariaLabel: el.getAttribute('aria-label') || undefined,
            title: el.getAttribute('title') || undefined,
            id: el.id || undefined,
            className: typeof el.className === 'string' ? el.className : undefined,
            type: el.getAttribute('type') || undefined,
            role: el.getAttribute('role') || undefined,
          };
        }

        const closeButtons: Array<ModalButtonDescriptor & { point: { x: number; y: number }; priority: number }> = [];
        const closeSeen = new Set<Element>();

        // 1. Nút đóng khớp trực tiếp với bộ selector chuẩn
        for (const sel of closeSelectors) {
          let nodes: NodeListOf<Element>;
          try {
            nodes = scope.querySelectorAll(sel);
          } catch {
            continue;
          }
          for (const el of Array.from(nodes)) {
            if (closeSeen.has(el)) continue;
            const vis = isClickableVisible(el);
            if (!vis.ok || !vis.point) continue;
            closeSeen.add(el);
            const r = el.getBoundingClientRect();
            const isTopRegion = r.top <= scopeRect.top + Math.max(80, scopeRect.height * 0.35);
            closeButtons.push({
              ...describe(el),
              point: vis.point,
              priority: isTopRegion ? 100 : 70,
            });
          }
        }

        // 2. Quét toàn bộ nút bấm trong modal
        const actionButtons: Array<ModalButtonDescriptor & { point: { x: number; y: number } }> = [];
        const interactiveNodes = scope.querySelectorAll(
          'button, [role="button"], a, input[type="button"], input[type="submit"], input[type="reset"]'
        );

        for (const el of Array.from(interactiveNodes)) {
          const vis = isClickableVisible(el);
          if (!vis.ok || !vis.point) continue;
          const desc = describe(el);

          // Nhận diện nút icon ✕ / × / x ở góc trên modal kể cả khi không có class/aria-label
          const rawText = (desc.text || '').trim();
          const r = el.getBoundingClientRect();
          const isTopCornerIcon =
            /^[✕×✖✗⨯x]$/i.test(rawText) &&
            r.top <= scopeRect.top + Math.max(80, scopeRect.height * 0.35);

          if (isTopCornerIcon && !closeSeen.has(el)) {
            closeSeen.add(el);
            closeButtons.push({ ...desc, point: vis.point, priority: 95 });
          }

          actionButtons.push({ ...desc, point: vis.point });
        }

        closeButtons.sort((a, b) => b.priority - a.priority);
        return { closeButtons, actionButtons };
      },
      {
        containerSel: overlay.containerSelector,
        contentSel: overlay.contentSelector,
        closeSelectors: MODAL_CLOSE_BUTTON_SELECTORS,
      }
    )
    .catch(() => ({ closeButtons: [], actionButtons: [] }));
}

/**
 * Tìm tọa độ click an toàn trên lớp nền mờ (Mask / Backdrop) bên ngoài hộp thoại Modal (Tier 4d).
 * Bảo đảm không bao giờ click trúng nút tương tác trên trang cha.
 */
async function resolveModalBackdropPoint(
  page: Page,
  overlay: ActiveOverlayInfo
): Promise<{ found: boolean; point?: Point; hitTag?: string }> {
  await ensureEsbuildNameHelper(page);

  return page
    .evaluate(
      ({ containerSel, contentSel, dialogRect }) => {
        const vw = window.innerWidth || 1280;
        const vh = window.innerHeight || 720;
        const containerEl = document.querySelector(containerSel);
        const contentEl = document.querySelector(contentSel);
        const liveRect = contentEl ? contentEl.getBoundingClientRect() : dialogRect;

        const interactiveSel =
          'a, button, input, select, textarea, label, [role="button"], [role="link"], [onclick], [tabindex]:not([tabindex="-1"])';
        const backdropSel =
          '.modal-backdrop, .ant-modal-mask, .ant-modal-wrap, .MuiBackdrop-root, .MuiModal-root, .el-dialog__wrapper, [class*="backdrop" i], [class*="mask" i], [class*="overlay" i], [data-modal-backdrop]';

        const pad = 8;
        const candidates: Array<{ x: number; y: number }> = [
          // Giữa dải trái / phải / trên / dưới bên ngoài hộp modal
          { x: Math.max(10, Math.round(liveRect.left / 2)), y: Math.round(liveRect.top + liveRect.height / 2) },
          {
            x: Math.min(vw - 10, Math.round((liveRect.right + vw) / 2)),
            y: Math.round(liveRect.top + liveRect.height / 2),
          },
          { x: Math.round(liveRect.left + liveRect.width / 2), y: Math.max(10, Math.round(liveRect.top / 2)) },
          {
            x: Math.round(liveRect.left + liveRect.width / 2),
            y: Math.min(vh - 10, Math.round((liveRect.bottom + vh) / 2)),
          },
          // 4 góc màn hình
          { x: 12, y: 12 },
          { x: vw - 12, y: 12 },
          { x: 12, y: vh - 12 },
          { x: vw - 12, y: vh - 12 },
        ];

        const outsideCandidates = candidates.filter((p) => {
          if (p.x < 2 || p.x >= vw - 2 || p.y < 2 || p.y >= vh - 2) return false;
          const insideDialog =
            p.x >= liveRect.left - pad &&
            p.x <= liveRect.right + pad &&
            p.y >= liveRect.top - pad &&
            p.y <= liveRect.bottom + pad;
          return !insideDialog;
        });

        let fallbackNeutral: { x: number; y: number; tag: string } | null = null;

        for (const pt of outsideCandidates) {
          const hit = document.elementFromPoint(pt.x, pt.y);
          if (!hit) continue;

          // Tuyệt đối không click vào bên trong hộp modal (ngoại trừ chính thẻ <dialog> khi click vùng ::backdrop)
          const isNativeDialogSelf =
            hit.tagName.toLowerCase() === 'dialog' && (hit === containerEl || hit === contentEl);
          if (contentEl && !isNativeDialogSelf && (hit === contentEl || contentEl.contains(hit))) {
            continue;
          }

          // Tuyệt đối không click vào phần tử tương tác trên trang cha
          if (!isNativeDialogSelf && hit.closest(interactiveSel)) {
            continue;
          }

          const isBackdropHit =
            isNativeDialogSelf ||
            hit === containerEl ||
            (containerEl ? containerEl.contains(hit) : false) ||
            Boolean(hit.closest(backdropSel));

          if (isBackdropHit) {
            return { found: true, point: pt, hitTag: hit.tagName.toLowerCase() };
          }

          if (!fallbackNeutral) {
            fallbackNeutral = { x: pt.x, y: pt.y, tag: hit.tagName.toLowerCase() };
          }
        }

        if (fallbackNeutral) {
          return {
            found: true,
            point: { x: fallbackNeutral.x, y: fallbackNeutral.y },
            hitTag: fallbackNeutral.tag,
          };
        }

        return { found: false };
      },
      {
        containerSel: overlay.containerSelector,
        contentSel: overlay.contentSelector,
        dialogRect: {
          left: overlay.rect.x,
          top: overlay.rect.y,
          right: overlay.rect.x + overlay.rect.width,
          bottom: overlay.rect.y + overlay.rect.height,
          width: overlay.rect.width,
          height: overlay.rect.height,
        },
      }
    )
    .catch(() => ({ found: false } as { found: boolean; point?: Point; hitTag?: string }));
}

/**
 * Thực thi thang 3 cấp cho Dropdown / Popover:
 * - Cấp 1: W3C Light Dismiss & Auto-Escape (`page.keyboard.press('Escape')` + 150ms quiescence)
 * - Cấp 2: Re-Toggle Trigger (click lại container trigger ban đầu)
 * - Cấp 3: Safe Neutral Click (`calculateSafeNeutralPoint` + `page.mouse.click(x, y)`)
 */
async function dismissDropdownOrPopover(
  page: Page,
  overlay: ActiveOverlayInfo,
  options: {
    quiescenceWaitMs: number;
    trigger?: TriggerRecord;
    tracker?: ActiveOverlayTracker;
    neutralClickOptions?: SafeNeutralPointOptions;
  }
): Promise<{
  dismissed: boolean;
  tierUsed: DismissalTier;
  attempts: DismissalAttemptLog[];
  remainingOverlays: ActiveOverlayInfo[];
}> {
  const attempts: DismissalAttemptLog[] = [];
  const waitDuration = options.quiescenceWaitMs;

  // --- TIER 1: W3C Light Dismiss & Auto-Escape ---
  const t1Start = Date.now();
  await page.keyboard.press('Escape').catch(() => {});
  await waitMs(waitDuration);
  const t1Check = await isOverlayDismissed(page, overlay);
  attempts.push({
    tier: 'TIER_1_ESCAPE',
    overlayId: overlay.overlayId,
    overlayKind: overlay.kind,
    succeeded: t1Check.closed,
    detail: t1Check.closed
      ? `Tier 1 (Escape) đã đóng thành công ${overlay.kind} (${overlay.matchedSelector})`
      : `Tier 1 (Escape) bị ${overlay.kind} bỏ qua -> chuyển sang Tier 2`,
    durationMs: Date.now() - t1Start,
  });
  if (t1Check.closed) {
    options.tracker?.removeOverlay(overlay.overlayId);
    return {
      dismissed: true,
      tierUsed: 'TIER_1_ESCAPE',
      attempts,
      remainingOverlays: t1Check.remainingOverlays,
    };
  }

  // --- TIER 2: Re-Toggle Trigger ---
  const t2Start = Date.now();
  const triggerRecord =
    options.trigger || options.tracker?.getTriggerForOverlay(overlay.overlayId);
  const triggerTarget = await resolveClickableTriggerPoint(page, overlay, triggerRecord);

  if (triggerTarget.found && triggerTarget.point) {
    await page.mouse.click(triggerTarget.point.x, triggerTarget.point.y).catch(() => {});
    await waitMs(waitDuration);
    const t2Check = await isOverlayDismissed(page, overlay);
    attempts.push({
      tier: 'TIER_2_RETOGGLE_TRIGGER',
      overlayId: overlay.overlayId,
      overlayKind: overlay.kind,
      succeeded: t2Check.closed,
      clickedPoint: triggerTarget.point,
      clickedLabel: triggerTarget.label,
      detail: t2Check.closed
        ? `Tier 2 (Re-Toggle Trigger "${triggerTarget.label || ''}") đã đóng thành công ${overlay.kind}`
        : `Tier 2 (Re-Toggle Trigger) không đóng được ${overlay.kind} -> chuyển sang Tier 3`,
      durationMs: Date.now() - t2Start,
    });
    if (t2Check.closed) {
      options.tracker?.removeOverlay(overlay.overlayId);
      return {
        dismissed: true,
        tierUsed: 'TIER_2_RETOGGLE_TRIGGER',
        attempts,
        remainingOverlays: t2Check.remainingOverlays,
      };
    }
  } else {
    attempts.push({
      tier: 'TIER_2_RETOGGLE_TRIGGER',
      overlayId: overlay.overlayId,
      overlayKind: overlay.kind,
      succeeded: false,
      detail: 'Tier 2 bỏ qua: Không tìm thấy nút Trigger khả dụng để toggle -> chuyển sang Tier 3',
      durationMs: Date.now() - t2Start,
    });
  }

  // --- TIER 3: Safe Neutral Click Calculation ---
  const t3Start = Date.now();
  const neutralRes = await calculateSafeNeutralPoint(page, options.neutralClickOptions);
  if (neutralRes.found && neutralRes.point) {
    await page.mouse.click(neutralRes.point.x, neutralRes.point.y).catch(() => {});
    await waitMs(waitDuration);
    const t3Check = await isOverlayDismissed(page, overlay);
    attempts.push({
      tier: 'TIER_3_SAFE_NEUTRAL_CLICK',
      overlayId: overlay.overlayId,
      overlayKind: overlay.kind,
      succeeded: t3Check.closed,
      clickedPoint: neutralRes.point,
      detail: t3Check.closed
        ? `Tier 3 (Safe Neutral Click tại (${neutralRes.point.x}, ${neutralRes.point.y}) trên <${neutralRes.hitElementTag}>) đã đóng thành công ${overlay.kind}`
        : `Tier 3 (Safe Neutral Click tại (${neutralRes.point.x}, ${neutralRes.point.y})) không đóng được ${overlay.kind}`,
      durationMs: Date.now() - t3Start,
    });
    if (t3Check.closed) {
      options.tracker?.removeOverlay(overlay.overlayId);
      return {
        dismissed: true,
        tierUsed: 'TIER_3_SAFE_NEUTRAL_CLICK',
        attempts,
        remainingOverlays: t3Check.remainingOverlays,
      };
    }
    return {
      dismissed: false,
      tierUsed: 'NONE',
      attempts,
      remainingOverlays: t3Check.remainingOverlays,
    };
  }

  attempts.push({
    tier: 'TIER_3_SAFE_NEUTRAL_CLICK',
    overlayId: overlay.overlayId,
    overlayKind: overlay.kind,
    succeeded: false,
    detail: `Tier 3 thất bại: ${neutralRes.reason}`,
    durationMs: Date.now() - t3Start,
  });

  const remaining = await detectActiveOverlays(page);
  return {
    dismissed: false,
    tierUsed: 'NONE',
    attempts,
    remainingOverlays: remaining,
  };
}

/**
 * Thực thi thang 4 bước an toàn cho Modal/Dialog (Tier 4) kèm STRICT Antonym Barrier Guardrail:
 * (a) Nút đóng góc trên ([aria-label="Close"], [aria-label="Đóng"], ✕/×, .close, .ant-modal-close, .modal-close)
 * (b) Phím Escape
 * (c) Nút hủy/đóng an toàn ("Hủy", "Hủy bỏ", "Cancel", "Bỏ qua", "Đóng", "Close", "Dismiss", "Không")
 *     — NGHIÊM CẤM click nút khẳng định/phá hủy ("Lưu", "Save", "Xác nhận", "Confirm", "OK", "Submit", "Gửi", "Đồng ý", "Xóa", "Delete", "Tiếp tục", "Apply", "Accept")
 * (d) Click lớp nền mờ (Mask/Backdrop) ngoài hộp thoại modal
 */
async function dismissModalSafely(
  page: Page,
  overlay: ActiveOverlayInfo,
  options: {
    quiescenceWaitMs: number;
    tracker?: ActiveOverlayTracker;
  }
): Promise<{
  dismissed: boolean;
  tierUsed: DismissalTier;
  attempts: DismissalAttemptLog[];
  blockedButtons: string[];
  remainingOverlays: ActiveOverlayInfo[];
}> {
  const attempts: DismissalAttemptLog[] = [];
  const blockedButtons: string[] = [];
  const waitDuration = options.quiescenceWaitMs;

  const inspected = await inspectModalButtons(page, overlay);

  // --- TIER 4a: Top-corner close button ---
  const t4aStart = Date.now();
  const safeCloseBtns = inspected.closeButtons.filter((btn) => {
    if (isForbiddenModalDismissButton(btn)) {
      const lbl = btn.text || btn.ariaLabel || btn.title || 'unknown';
      if (!blockedButtons.includes(lbl)) blockedButtons.push(lbl);
      return false;
    }
    return true;
  });

  if (safeCloseBtns.length > 0) {
    const chosen = safeCloseBtns[0];
    const lbl = chosen.ariaLabel || chosen.text || chosen.title || 'Close';
    await page.mouse.click(chosen.point.x, chosen.point.y).catch(() => {});
    await waitMs(waitDuration);
    const check = await isOverlayDismissed(page, overlay);
    attempts.push({
      tier: 'TIER_4A_MODAL_CLOSE_BUTTON',
      overlayId: overlay.overlayId,
      overlayKind: 'modal',
      succeeded: check.closed,
      clickedPoint: chosen.point,
      clickedLabel: lbl,
      detail: check.closed
        ? `Tier 4a (Nút đóng góc trên "${lbl}") đã đóng modal an toàn`
        : `Tier 4a (Nút đóng góc trên "${lbl}") không đóng được modal -> chuyển sang Tier 4b`,
      durationMs: Date.now() - t4aStart,
    });
    if (check.closed) {
      options.tracker?.removeOverlay(overlay.overlayId);
      return {
        dismissed: true,
        tierUsed: 'TIER_4A_MODAL_CLOSE_BUTTON',
        attempts,
        blockedButtons,
        remainingOverlays: check.remainingOverlays,
      };
    }
  } else {
    attempts.push({
      tier: 'TIER_4A_MODAL_CLOSE_BUTTON',
      overlayId: overlay.overlayId,
      overlayKind: 'modal',
      succeeded: false,
      detail: 'Tier 4a bỏ qua: Không tìm thấy nút đóng góc trên an toàn -> chuyển sang Tier 4b',
      durationMs: Date.now() - t4aStart,
    });
  }

  // --- TIER 4b: Escape key ---
  const t4bStart = Date.now();
  await page.keyboard.press('Escape').catch(() => {});
  await waitMs(waitDuration);
  const t4bCheck = await isOverlayDismissed(page, overlay);
  attempts.push({
    tier: 'TIER_4B_MODAL_ESCAPE',
    overlayId: overlay.overlayId,
    overlayKind: 'modal',
    succeeded: t4bCheck.closed,
    detail: t4bCheck.closed
      ? 'Tier 4b (Phím Escape) đã đóng modal an toàn'
      : 'Tier 4b (Phím Escape) bị modal bỏ qua -> chuyển sang Tier 4c',
    durationMs: Date.now() - t4bStart,
  });
  if (t4bCheck.closed) {
    options.tracker?.removeOverlay(overlay.overlayId);
    return {
      dismissed: true,
      tierUsed: 'TIER_4B_MODAL_ESCAPE',
      attempts,
      blockedButtons,
      remainingOverlays: t4bCheck.remainingOverlays,
    };
  }

  // --- TIER 4c: Safe dismiss/cancel buttons (STRICT Antonym Guardrail) ---
  const t4cStart = Date.now();
  const freshInspected = await inspectModalButtons(page, overlay);
  const safeCancelCandidates: Array<ModalButtonDescriptor & { point: Point; rank: number }> = [];

  for (const btn of freshInspected.actionButtons) {
    const lbl = btn.text || btn.ariaLabel || btn.title || '';
    if (isForbiddenModalDismissButton(btn)) {
      if (lbl && !blockedButtons.includes(lbl)) {
        blockedButtons.push(lbl);
      }
      continue;
    }
    if (isSafeModalDismissButton(btn)) {
      const norm = normalizeModalLabel(lbl);
      const stripped = stripVietnameseDiacritics(norm);
      const isExactPrimary = [
        'hủy',
        'huy',
        'hủy bỏ',
        'huy bo',
        'cancel',
        'bỏ qua',
        'bo qua',
        'đóng',
        'dong',
        'close',
        'dismiss',
        'không',
        'khong',
        'no',
      ].includes(stripped);
      safeCancelCandidates.push({
        ...btn,
        rank: isExactPrimary ? 100 : 60,
      });
    }
  }

  safeCancelCandidates.sort((a, b) => b.rank - a.rank);

  if (safeCancelCandidates.length > 0) {
    const chosen = safeCancelCandidates[0];
    const lbl = chosen.text || chosen.ariaLabel || chosen.title || 'Cancel';
    await page.mouse.click(chosen.point.x, chosen.point.y).catch(() => {});
    await waitMs(waitDuration);
    const t4cCheck = await isOverlayDismissed(page, overlay);
    attempts.push({
      tier: 'TIER_4C_MODAL_SAFE_CANCEL_BUTTON',
      overlayId: overlay.overlayId,
      overlayKind: 'modal',
      succeeded: t4cCheck.closed,
      clickedPoint: chosen.point,
      clickedLabel: lbl,
      blockedButtons: [...blockedButtons],
      detail: t4cCheck.closed
        ? `Tier 4c (Nút hủy/đóng an toàn "${lbl}") đã đóng modal an toàn (Guardrail đã chặn: [${blockedButtons.join(', ')}])`
        : `Tier 4c (Nút hủy/đóng an toàn "${lbl}") không đóng được modal -> chuyển sang Tier 4d`,
      durationMs: Date.now() - t4cStart,
    });
    if (t4cCheck.closed) {
      options.tracker?.removeOverlay(overlay.overlayId);
      return {
        dismissed: true,
        tierUsed: 'TIER_4C_MODAL_SAFE_CANCEL_BUTTON',
        attempts,
        blockedButtons,
        remainingOverlays: t4cCheck.remainingOverlays,
      };
    }
  } else {
    attempts.push({
      tier: 'TIER_4C_MODAL_SAFE_CANCEL_BUTTON',
      overlayId: overlay.overlayId,
      overlayKind: 'modal',
      succeeded: false,
      blockedButtons: [...blockedButtons],
      detail:
        blockedButtons.length > 0
          ? `Tier 4c không có nút hủy an toàn (Antonym Guardrail đã chặn tuyệt đối: [${blockedButtons.join(', ')}]) -> chuyển sang Tier 4d`
          : 'Tier 4c không tìm thấy nút hủy/đóng an toàn -> chuyển sang Tier 4d',
      durationMs: Date.now() - t4cStart,
    });
  }

  // --- TIER 4d: Mask / Backdrop click outside dialog box ---
  const t4dStart = Date.now();
  const backdropTarget = await resolveModalBackdropPoint(page, overlay);
  if (backdropTarget.found && backdropTarget.point) {
    await page.mouse.click(backdropTarget.point.x, backdropTarget.point.y).catch(() => {});
    await waitMs(waitDuration);
    const t4dCheck = await isOverlayDismissed(page, overlay);
    attempts.push({
      tier: 'TIER_4D_MODAL_BACKDROP_CLICK',
      overlayId: overlay.overlayId,
      overlayKind: 'modal',
      succeeded: t4dCheck.closed,
      clickedPoint: backdropTarget.point,
      detail: t4dCheck.closed
        ? `Tier 4d (Mask/Backdrop click tại (${backdropTarget.point.x}, ${backdropTarget.point.y})) đã đóng modal an toàn`
        : `Tier 4d (Mask/Backdrop click tại (${backdropTarget.point.x}, ${backdropTarget.point.y})) không đóng được modal (maskClosable=false)`,
      durationMs: Date.now() - t4dStart,
    });
    if (t4dCheck.closed) {
      options.tracker?.removeOverlay(overlay.overlayId);
      return {
        dismissed: true,
        tierUsed: 'TIER_4D_MODAL_BACKDROP_CLICK',
        attempts,
        blockedButtons,
        remainingOverlays: t4dCheck.remainingOverlays,
      };
    }
    return {
      dismissed: false,
      tierUsed: 'NONE',
      attempts,
      blockedButtons,
      remainingOverlays: t4dCheck.remainingOverlays,
    };
  }

  attempts.push({
    tier: 'TIER_4D_MODAL_BACKDROP_CLICK',
    overlayId: overlay.overlayId,
    overlayKind: 'modal',
    succeeded: false,
    detail: 'Tier 4d thất bại: Không tìm thấy tọa độ lớp nền mờ (backdrop) an toàn bên ngoài hộp modal',
    durationMs: Date.now() - t4dStart,
  });

  const remaining = await detectActiveOverlays(page);
  return {
    dismissed: false,
    tierUsed: 'NONE',
    attempts,
    blockedButtons,
    remainingOverlays: remaining,
  };
}

// ============================================================================
// PUBLIC ORCHESTRATION ENTRYPOINT: dismissHangingOverlays
// ============================================================================

/**
 * Giải phóng các lớp phủ tương tác treo (Dropdown, Popover, Modal/Dialog) theo giao thức 4 cấp:
 * - Nếu cung cấp `nextTarget` và `onlyIfCrossed = true`: chỉ giải phóng khi phát hiện Context-Boundary Crossing,
 *   và dừng ngay khi mục tiêu E_next không còn bị chặn bởi overlay phía trên.
 * - Bảo toàn 100% giá trị đã chọn trong multi-select checkbox dropdown và tuyệt đối tuân thủ Antonym Guardrail cho modal.
 */
export async function dismissHangingOverlays(
  page: Page,
  options: DismissalOptions = {}
): Promise<DismissalResult> {
  const startTime = Date.now();
  const quiescenceWaitMs = options.quiescenceWaitMs ?? 150;
  const maxOverlays = options.maxOverlaysToDismiss ?? 5;

  let activeOverlays = options.tracker
    ? await options.tracker.sync(page)
    : await detectActiveOverlays(page);

  let initialCrossing: ContextBoundaryCrossingResult | undefined = undefined;

  if (options.nextTarget) {
    initialCrossing = await detectContextBoundaryCrossing(page, options.nextTarget, {
      preDetectedOverlays: activeOverlays,
    });

    if (options.onlyIfCrossed && !initialCrossing.crossed) {
      return {
        needed: false,
        dismissed: false,
        dismissedCount: 0,
        tierUsed: 'NONE',
        tiersUsed: [],
        attempts: [],
        blockedByGuardrail: false,
        blockedButtons: [],
        remainingOverlays: activeOverlays,
        crossing: initialCrossing,
        durationMs: Date.now() - startTime,
        summary: initialCrossing.reason,
      };
    }
  }

  if (activeOverlays.length === 0) {
    return {
      needed: false,
      dismissed: false,
      dismissedCount: 0,
      tierUsed: 'NONE',
      tiersUsed: [],
      attempts: [],
      blockedByGuardrail: false,
      blockedButtons: [],
      remainingOverlays: [],
      crossing: initialCrossing,
      durationMs: Date.now() - startTime,
      summary: 'Không có lớp phủ treo nào cần giải phóng',
    };
  }

  const allAttempts: DismissalAttemptLog[] = [];
  const tiersUsed: DismissalTier[] = [];
  const allBlockedButtons: string[] = [];
  let dismissedCount = 0;

  for (let round = 0; round < maxOverlays; round++) {
    let targetToDismiss: ActiveOverlayInfo | null = null;

    if (options.nextTarget) {
      const crossing = await detectContextBoundaryCrossing(page, options.nextTarget, {
        preDetectedOverlays: activeOverlays,
      });
      if (!crossing.crossed || crossing.crossedOverlays.length === 0) {
        break; // Mục tiêu đã hoàn toàn nằm trong ngữ cảnh hợp lệ (hoặc không còn overlay chặn)
      }
      // Ưu tiên dọn lớp phủ nằm trên cùng trong danh sách crossedOverlays
      targetToDismiss = crossing.crossedOverlays[crossing.crossedOverlays.length - 1];
    } else {
      if (activeOverlays.length === 0) break;
      targetToDismiss = activeOverlays[activeOverlays.length - 1];
    }

    if (!targetToDismiss) break;

    if (targetToDismiss.kind === 'modal') {
      const modalRes = await dismissModalSafely(page, targetToDismiss, {
        quiescenceWaitMs,
        tracker: options.tracker,
      });
      allAttempts.push(...modalRes.attempts);
      for (const b of modalRes.blockedButtons) {
        if (!allBlockedButtons.includes(b)) allBlockedButtons.push(b);
      }
      activeOverlays = modalRes.remainingOverlays;

      if (modalRes.dismissed) {
        dismissedCount++;
        tiersUsed.push(modalRes.tierUsed);
      } else {
        // Không thể đóng modal trên cùng một cách an toàn -> dừng ngay, tuyệt đối không bấm ẩu
        break;
      }
    } else {
      const ddRes = await dismissDropdownOrPopover(page, targetToDismiss, {
        quiescenceWaitMs,
        trigger: options.trigger,
        tracker: options.tracker,
        neutralClickOptions: options.neutralClickOptions,
      });
      allAttempts.push(...ddRes.attempts);
      activeOverlays = ddRes.remainingOverlays;

      if (ddRes.dismissed) {
        dismissedCount++;
        tiersUsed.push(ddRes.tierUsed);
      } else {
        break;
      }
    }
  }

  // Đánh giá kết quả cuối cùng
  let finalDismissed = dismissedCount > 0;
  if (options.nextTarget) {
    const finalCheck = await detectContextBoundaryCrossing(page, options.nextTarget, {
      preDetectedOverlays: activeOverlays,
    });
    finalDismissed = dismissedCount > 0 && !finalCheck.crossed;
  } else {
    finalDismissed = dismissedCount > 0 && activeOverlays.length === 0;
  }

  const tierUsed: DismissalTier = tiersUsed.length > 0 ? tiersUsed[tiersUsed.length - 1] : 'NONE';
  const blockedByGuardrail = allBlockedButtons.length > 0;

  return {
    needed: true,
    dismissed: finalDismissed,
    dismissedCount,
    tierUsed,
    tiersUsed,
    attempts: allAttempts,
    blockedByGuardrail,
    blockedButtons: allBlockedButtons,
    remainingOverlays: activeOverlays,
    crossing: initialCrossing,
    durationMs: Date.now() - startTime,
    summary: finalDismissed
      ? `[IMPLICIT DISMISSAL] Đã tự động giải phóng ${dismissedCount} lớp phủ treo (${tiersUsed.join(' -> ')})`
      : blockedByGuardrail
        ? `[IMPLICIT DISMISSAL ABORTED] Không thể đóng lớp phủ an toàn; Antonym Guardrail đã chặn: [${allBlockedButtons.join(', ')}]`
        : `[IMPLICIT DISMISSAL INCOMPLETE] Còn ${activeOverlays.length} lớp phủ chưa đóng được`,
  };
}

// ============================================================================
// IMPLICIT DISMISSAL MANAGER (STATEFUL ORCHESTRATOR FOR STAGE 2 RUNNER WIRING)
// ============================================================================

export interface ImplicitDismissalManagerOptions {
  quiescenceWaitMs?: number;
  maxOverlaysToDismiss?: number;
  neutralClickOptions?: SafeNeutralPointOptions;
}

export class ImplicitDismissalManager {
  private page: Page;
  public readonly tracker: ActiveOverlayTracker;
  private options: ImplicitDismissalManagerOptions;
  private history: DismissalResult[] = [];

  constructor(page: Page, options: ImplicitDismissalManagerOptions = {}) {
    this.page = page;
    this.tracker = new ActiveOverlayTracker();
    this.options = options;
  }

  public updatePage(newPage: Page): void {
    this.page = newPage;
    this.tracker.clear();
  }

  public recordTrigger(trigger: TriggerRecord): void {
    this.tracker.recordTrigger(trigger);
  }

  public recordCandidateInteraction(candidate: DOMCandidate): void {
    this.tracker.recordCandidateTrigger(candidate);
  }

  public async syncActiveOverlays(): Promise<ActiveOverlayInfo[]> {
    return this.tracker.sync(this.page);
  }

  public async detectActiveOverlays(): Promise<ActiveOverlayInfo[]> {
    return detectActiveOverlays(this.page);
  }

  public async detectContextBoundaryCrossing(
    nextTargetInfo: NextTargetInfo
  ): Promise<ContextBoundaryCrossingResult> {
    const active = await this.tracker.sync(this.page);
    return detectContextBoundaryCrossing(this.page, nextTargetInfo, {
      preDetectedOverlays: active,
    });
  }

  /**
   * Hook chính gọi trước mỗi thao tác tương tác trên E_next trong Runner:
   * - Nếu E_next nằm trong overlay đang mở -> KHÔNG làm gì (giữ nguyên dropdown/modal).
   * - Nếu E_next vượt ranh giới ngữ cảnh (Context-Boundary Crossing) -> Tự động chạy Implicit Dismissal.
   */
  public async ensureDismissedBeforeAction(
    nextTargetInfo: NextTargetInfo,
    overrideOptions: Partial<DismissalOptions> = {}
  ): Promise<DismissalResult> {
    const result = await dismissHangingOverlays(this.page, {
      quiescenceWaitMs: this.options.quiescenceWaitMs,
      maxOverlaysToDismiss: this.options.maxOverlaysToDismiss,
      neutralClickOptions: this.options.neutralClickOptions,
      ...overrideOptions,
      nextTarget: nextTargetInfo,
      tracker: this.tracker,
      onlyIfCrossed: true,
    });

    if (result.needed) {
      this.history.push(result);
    }
    return result;
  }

  /**
   * Giải phóng chủ động tất cả các lớp phủ đang treo trên trang hiện tại.
   */
  public async dismissAll(
    overrideOptions: Partial<DismissalOptions> = {}
  ): Promise<DismissalResult> {
    const result = await dismissHangingOverlays(this.page, {
      quiescenceWaitMs: this.options.quiescenceWaitMs,
      maxOverlaysToDismiss: this.options.maxOverlaysToDismiss,
      neutralClickOptions: this.options.neutralClickOptions,
      ...overrideOptions,
      tracker: this.tracker,
      onlyIfCrossed: false,
    });

    if (result.needed) {
      this.history.push(result);
    }
    return result;
  }

  public getDismissalHistory(): DismissalResult[] {
    return [...this.history];
  }

  public clearHistory(): void {
    this.history = [];
  }
}

const pageDismissalManagerMap = new WeakMap<Page, ImplicitDismissalManager>();

export function getOrCreateImplicitDismissalManager(
  page: Page,
  options?: ImplicitDismissalManagerOptions
): ImplicitDismissalManager {
  let manager =
    pageDismissalManagerMap.get(page) || ((page as any).__implicitDismissalManager as ImplicitDismissalManager | undefined);
  if (!manager) {
    manager = new ImplicitDismissalManager(page, options);
    pageDismissalManagerMap.set(page, manager);
    (page as any).__implicitDismissalManager = manager;
  }
  return manager;
}
