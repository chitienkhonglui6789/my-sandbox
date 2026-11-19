import { Locator, Page } from 'playwright';
import { AtomicAction, DOMCandidate } from './types';

// ============================================================================
// IEEE 29119 SEVERITY CLASSIFICATION & ADAPTIVE NOTIFICATION ORACLE (PILLAR 17)
// ============================================================================

export type NotificationSeverity = 'SUCCESS' | 'INFO' | 'WARNING' | 'ERROR';

export type NotificationVerdict =
  | 'SUCCESS_EVIDENCE'
  | 'IGNORED'
  | 'WARNING_LOGGED'
  | 'EXPECTED_PASS'
  | 'PRODUCT_DEFECT';

export type ToastEvasionStrategy =
  | 'NONE'
  | 'AUTO_DISMISS_CLOSE_BUTTON'
  | 'AUTO_DISMISS_ESCAPE'
  | 'SPATIAL_EVASION'
  | 'SMART_TTL_DRAIN'
  | 'POINTER_EVENTS_ISOLATION'
  | 'FAILED';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ParsedRgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface NotificationClassificationInput {
  text?: string;
  className?: string;
  role?: string;
  ariaLive?: string;
  dataType?: string;
  backgroundColor?: string;
  borderColor?: string;
  color?: string;
  iconClassName?: string;
  iconText?: string;
  httpStatusCode?: number;
}

export interface NotificationClassificationResult {
  severity: NotificationSeverity;
  confidence: number;
  reasons: string[];
  matchedSignals: {
    cssSignal?: NotificationSeverity;
    colorSignal?: NotificationSeverity;
    iconSignal?: NotificationSeverity;
    textSignal?: NotificationSeverity;
  };
}

export interface DetectedNotification {
  id: string;
  selector: string;
  tag: string;
  text: string;
  rawText: string;
  className: string;
  role?: string;
  ariaLive?: string;
  dataType?: string;
  severity: NotificationSeverity;
  classification: NotificationClassificationResult;
  rect: Rect;
  zIndex: number;
  position: string;
  pointerEvents: string;
  isFloating: boolean;
  hasCloseButton: boolean;
  closeButtonSelector?: string;
  closeButtonRect?: Rect;
  detectedAt: number;
}

export interface DetectNotificationsOptions {
  /** Include non-floating inline banners/alerts as well as floating toasts (default: true) */
  includeInlineAlerts?: boolean;
  /** Extra CSS selectors for custom app notifications */
  extraSelectors?: string[];
}

export interface NotificationStepContext {
  /** Active AtomicAction currently executing */
  action?: Partial<AtomicAction>;
  /** Upcoming AtomicActions in the same scenario (e.g. next step asserts expected error) */
  upcomingActions?: Partial<AtomicAction>[];
  /** Raw text of the current step */
  stepText?: string;
  /** Explicit expected error phrases for negative tests */
  expectedErrorTexts?: string[];
  /** Explicit flag marking a negative test scenario */
  isNegativeTest?: boolean;
  /** Current step number for logging */
  stepNumber?: number;
}

export interface NotificationEvaluationItem {
  notification: Pick<DetectedNotification, 'id' | 'text' | 'severity' | 'selector' | 'className'> &
    Partial<DetectedNotification>;
  verdict: NotificationVerdict;
  shouldFailScenario: boolean;
  reason: string;
  matchedExpectedPhrase?: string;
  warningEntry?: string;
  evidenceEntry?: string;
}

export interface NotificationOracleReport {
  overallVerdict: 'PASS' | 'EXPECTED_PASS' | 'PASS_WITH_WARNING' | 'PRODUCT_DEFECT';
  shouldFailScenario: boolean;
  hasExpectedErrorMatch: boolean;
  items: NotificationEvaluationItem[];
  successEvidences: string[];
  warningLogs: string[];
  ignoredInfos: string[];
  productDefects: string[];
  summary: string;
}

export interface ExposedSubRegionResult {
  totalArea: number;
  exposedArea: number;
  exposedRatio: number;
  bestSubRegion: Rect | null;
  safeClickPoint: { x: number; y: number } | null;
  meetsThreshold: boolean;
}

export interface ToastEvasionOptions {
  /** Minimum exposed area ratio for Tier 2 Spatial Evasion (default: 0.40 = 40%) */
  minExposedRatio?: number;
  /** Minimum exposed sub-region width in px for Tier 2 (default: 24) */
  minExposedWidth?: number;
  /** Minimum exposed sub-region height in px for Tier 2 (default: 24) */
  minExposedHeight?: number;
  /** Allow Escape key fallback in Tier 1 Auto-Dismiss (default: true) */
  enableEscapeDismiss?: boolean;
  /** Max wait time in ms for Tier 3 Smart TTL Drain (default: 3000ms) */
  ttlDrainTimeoutMs?: number;
  /** Polling interval in ms for Tier 3 Smart TTL Drain (default: 100ms) */
  ttlPollIntervalMs?: number;
  /** Allow Tier 4 Pointer-Events Isolation as last resort (default: true) */
  allowPointerEventsIsolation?: boolean;
  /** Optional CSS selector for target hit-test verification */
  targetSelector?: string;
  /** Extra notification selectors */
  extraNotificationSelectors?: string[];
}

export interface ToastEvasionResult {
  evaded: boolean;
  occludedInitially: boolean;
  tierUsed: 0 | 1 | 2 | 3 | 4;
  strategy: ToastEvasionStrategy;
  clickPoint: { x: number; y: number };
  targetRect: Rect;
  occludingToasts: DetectedNotification[];
  dismissedCount: number;
  exposedRatio?: number;
  exposedRegion?: Rect;
  drainedMs?: number;
  isolatedSelectors?: string[];
  /** Restore callback when tierUsed === 4 (Pointer-Events Isolation). Always call after clicking. */
  restore?: () => Promise<void>;
  logs: string[];
}

export interface PointerEventsIsolationHandle {
  token: string;
  isolatedCount: number;
  isolatedSelectors: string[];
  restore: () => Promise<void>;
}

export interface PointerEventsIsolationResult<T> {
  result: T;
  isolatedCount: number;
  restored: boolean;
}

export interface ClickWithEvasionResult {
  clicked: boolean;
  evasion: ToastEvasionResult;
  restoredPointerEvents: boolean;
}

export type TargetInput = Rect | Locator | string | Pick<DOMCandidate, 'rect' | 'selectorPath'>;

// ============================================================================
// SELECTOR CONSTANTS
// ============================================================================

export const NOTIFICATION_CONTAINER_SELECTORS: readonly string[] = [
  // Standard ARIA live / status / alert regions
  '[role="alert"]',
  '[role="status"]',
  '[aria-live="polite"]',
  '[aria-live="assertive"]',
  // Generic toast / snackbar / notification / banner classes
  '.toast',
  '.toast-success',
  '.toast-info',
  '.toast-warning',
  '.toast-warn',
  '.toast-error',
  '.toast-danger',
  '.snackbar',
  '.snackbar-success',
  '.snackbar-info',
  '.snackbar-warning',
  '.snackbar-error',
  '.notification',
  '.notification-banner',
  '.alert',
  '.alert-banner',
  '.flash-message',
  // Ant Design
  '.ant-message-notice',
  '.ant-notification-notice',
  '.ant-alert',
  // Material-UI & Notistack
  '.MuiAlert-root',
  '.MuiSnackbarContent-root',
  '.MuiSnackbar-root',
  '.SnackbarItem-contentRoot',
  // React-Toastify
  '.Toastify__toast',
  // Element UI / Element Plus
  '.el-message',
  '.el-notification',
  // Sonner / Radix / Data attributes
  '[data-sonner-toast]',
  '[data-radix-toast-viewport] > li',
  '[data-toast]',
  '[data-notification]',
];

export const TOAST_CLOSE_BUTTON_SELECTORS: readonly string[] = [
  '[aria-label="Close"]',
  '[aria-label="close"]',
  '[aria-label*="close" i]',
  '[aria-label*="đóng" i]',
  '.toast-close',
  '.ant-notification-notice-close',
  '.ant-alert-close-icon',
  '.Toastify__close-button',
  '.el-message__closeBtn',
  '.el-notification__closeBtn',
  '.btn-close',
  '.close',
  '[data-dismiss="toast"]',
  '[data-dismiss="alert"]',
  '[data-close]',
];

// ============================================================================
// COLOR PARSING & RGB -> HSL SEVERITY CLASSIFICATION
// ============================================================================

const NAMED_COLORS: Record<string, ParsedRgbaColor> = {
  green: { r: 0, g: 128, b: 0, a: 1 },
  lime: { r: 0, g: 255, b: 0, a: 1 },
  forestgreen: { r: 34, g: 139, b: 34, a: 1 },
  seagreen: { r: 46, g: 139, b: 87, a: 1 },
  mediumseagreen: { r: 60, g: 179, b: 113, a: 1 },
  emerald: { r: 16, g: 185, b: 129, a: 1 },
  blue: { r: 0, g: 0, b: 255, a: 1 },
  dodgerblue: { r: 30, g: 144, b: 255, a: 1 },
  deepskyblue: { r: 0, g: 191, b: 255, a: 1 },
  royalblue: { r: 65, g: 105, b: 225, a: 1 },
  steelblue: { r: 70, g: 130, b: 180, a: 1 },
  cyan: { r: 0, g: 255, b: 255, a: 1 },
  yellow: { r: 255, g: 255, b: 0, a: 1 },
  gold: { r: 255, g: 215, b: 0, a: 1 },
  orange: { r: 255, g: 165, b: 0, a: 1 },
  darkorange: { r: 255, g: 140, b: 0, a: 1 },
  amber: { r: 250, g: 173, b: 20, a: 1 },
  red: { r: 255, g: 0, b: 0, a: 1 },
  crimson: { r: 220, g: 20, b: 60, a: 1 },
  firebrick: { r: 178, g: 34, b: 34, a: 1 },
  darkred: { r: 139, g: 0, b: 0, a: 1 },
  tomato: { r: 255, g: 99, b: 71, a: 1 },
  orangered: { r: 255, g: 69, b: 0, a: 1 },
};

/**
 * Parse a CSS color string (#hex, rgb(), rgba(), or common named color) into RGBA components.
 */
export function parseCssColor(colorStr: string | undefined | null): ParsedRgbaColor | null {
  if (!colorStr) return null;
  const raw = colorStr.trim().toLowerCase();
  if (!raw || raw === 'transparent' || raw === 'none' || raw === 'inherit' || raw === 'initial') {
    return null;
  }

  if (NAMED_COLORS[raw]) {
    return { ...NAMED_COLORS[raw] };
  }

  // Hex formats: #rgb, #rgba, #rrggbb, #rrggbbaa
  if (raw.startsWith('#')) {
    const hex = raw.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
      if ([r, g, b].some((v) => Number.isNaN(v)) || Number.isNaN(a)) return null;
      return { r, g, b, a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if ([r, g, b].some((v) => Number.isNaN(v)) || Number.isNaN(a)) return null;
      return { r, g, b, a };
    }
    return null;
  }

  // rgb(r, g, b), rgba(r, g, b, a), rgb(r g b / a)
  const rgbMatch = raw.match(
    /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/
  );
  if (rgbMatch) {
    const r = Math.min(255, Math.max(0, Number(rgbMatch[1])));
    const g = Math.min(255, Math.max(0, Number(rgbMatch[2])));
    const b = Math.min(255, Math.max(0, Number(rgbMatch[3])));
    let a = 1;
    if (rgbMatch[4] !== undefined) {
      a = rgbMatch[4].endsWith('%')
        ? parseFloat(rgbMatch[4]) / 100
        : parseFloat(rgbMatch[4]);
    }
    if ([r, g, b, a].some((v) => Number.isNaN(v))) return null;
    return { r, g, b, a };
  }

  return null;
}

/**
 * Classify a CSS color string into an IEEE 29119 NotificationSeverity using HSL Hue/Saturation bands:
 * - SUCCESS: Greenish (#52c41a, #16a34a, #f6ffed, #edf7ed, ...) -> Hue (65, 168]
 * - INFO:    Bluish   (#1890ff, #2563eb, #e6f7ff, #e5f6fd, ...) -> Hue (168, 250]
 * - WARNING: Amber/Yellow (#faad14, #f59e0b, #fffbe6, #fff4e5)  -> Hue (18, 65]
 * - ERROR:   Reddish  (#ff4d4f, #dc2626, #fff2f0, #fdeded, ...) -> Hue >= 340 or <= 18
 * Neutral grays, white, black, and near-transparent colors return null.
 */
export function classifyColorToSeverity(colorStr: string | undefined | null): NotificationSeverity | null {
  const rgba = parseCssColor(colorStr);
  if (!rgba || rgba.a < 0.1) return null;

  const max255 = Math.max(rgba.r, rgba.g, rgba.b);
  const min255 = Math.min(rgba.r, rgba.g, rgba.b);
  const delta255 = max255 - min255;

  // Reject pure white, black, and near-achromatic grays
  if (delta255 < 10) return null;

  const r = rgba.r / 255;
  const g = rgba.g / 255;
  const b = rgba.b / 255;
  const max = max255 / 255;
  const min = min255 / 255;
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  // Reject very dark near-black or low-saturation neutral slate grays
  if (l < 0.08) return null;
  if (l <= 0.88 && s < 0.28) return null;
  if (l > 0.88 && s < 0.35) return null;

  let h = 0;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  } else if (max === g) {
    h = ((b - r) / d + 2) * 60;
  } else {
    h = ((r - g) / d + 4) * 60;
  }
  h = ((h % 360) + 360) % 360;

  if (h >= 340 || h <= 18) return 'ERROR';
  if (h > 18 && h <= 65) return 'WARNING';
  if (h > 65 && h <= 168) return 'SUCCESS';
  if (h > 168 && h <= 250) return 'INFO';

  return null;
}

// ============================================================================
// SIGNAL MATCHERS (CSS, ICON, TEXT)
// ============================================================================

const CSS_SEVERITY_PATTERNS: Array<{ severity: NotificationSeverity; regex: RegExp }> = [
  {
    severity: 'SUCCESS',
    regex:
      /(?:^|[\s_-])(success|succeeded|standardSuccess|filledSuccess|outlinedSuccess|colorSuccess|ok-toast|positive)(?:$|[\s_-])|(?:toast|message|notification|alert|snackbar|banner)[-_]+success\b/i,
  },
  {
    severity: 'ERROR',
    regex:
      /(?:^|[\s_-])(error|danger|standardError|filledError|outlinedError|colorError|critical|fatal|destructive|failed|failure)(?:$|[\s_-])|(?:toast|message|notification|alert|snackbar|banner)[-_]+(?:error|danger)\b/i,
  },
  {
    severity: 'WARNING',
    regex:
      /(?:^|[\s_-])(warning|warn|standardWarning|filledWarning|outlinedWarning|colorWarning|caution|amber)(?:$|[\s_-])|(?:toast|message|notification|alert|snackbar|banner)[-_]+(?:warning|warn)\b/i,
  },
  {
    severity: 'INFO',
    regex:
      /(?:^|[\s_-])(info|information|standardInfo|filledInfo|outlinedInfo|colorInfo|tip|hint)(?:$|[\s_-])|(?:toast|message|notification|alert|snackbar|banner)[-_]+info\b/i,
  },
];

const ICON_CLASS_PATTERNS: Array<{ severity: NotificationSeverity; regex: RegExp }> = [
  {
    severity: 'SUCCESS',
    regex: /check-circle|checkmark|icon-success|icon-check|fa-check|successoutlined|task-alt|done/i,
  },
  {
    severity: 'WARNING',
    regex:
      /exclamation-triangle|exclamation-circle|warning-circle|icon-warn|fa-exclamation|warningamber|reportproblem/i,
  },
  {
    severity: 'INFO',
    regex: /info-circle|icon-info|fa-info|infooutlined|lightbulb/i,
  },
  {
    severity: 'ERROR',
    regex: /close-circle|times-circle|error-circle|icon-error|fa-times-circle|erroroutline|cancel-circle/i,
  },
];

const SERVER_CRASH_OR_HTTP_ERROR_REGEX =
  /\b(?:http\s*)?(?:500|502|503|504)\b|internal\s+server\s+error|bad\s+gateway|service\s+unavailable|gateway\s+timeout|unhandled\s+(?:exception|error|rejection)|stack\s*trace|segmentation\s+fault|fatal\s+error|crash(?:ed)?|lỗi\s+máy\s+chủ|lỗi\s+hệ\s+thống\s+nghiêm\s+trọng/i;

const HTTP_4XX_ERROR_REGEX =
  /\b(?:http\s*)?(?:400|401|403|404|408|409|422|429)\b|unauthorized|forbidden|bad\s+request|not\s+found\b/i;

const TEXT_ERROR_REGEX =
  /(?:không\s+thành\s+công|chưa\s+thành\s+công|không\s+đúng|sai\s+mật\s+khẩu|mật\s+khẩu\s+sai|sai\s+tài\s+khoản|không\s+hợp\s+lệ|thất\s+bại|bị\s+từ\s+chối|không\s+thể\s+|không\s+tìm\s+thấy|đã\s+tồn\s+tại|hết\s+phiên|bị\s+khóa|có\s+lỗi\s+xảy\s+ra|lỗi\s+kết\s+nối|mất\s+kết\s+nối|lỗi\s*:|\blỗi\b|unsuccessful|not\s+successful|incorrect|invalid|wrong\s+password|failed|failure|something\s+went\s+wrong|access\s+denied|permission\s+denied|unable\s+to|cannot\s+|network\s+error|connection\s+refused|server\s+error|\berror\b)/i;

const TEXT_WARNING_REGEX =
  /(?:mật\s+khẩu\s+yếu|cảnh\s+báo|khuyến\s+cáo|khuyến\s+nghị|lưu\s+ý\s*:|chú\s+ý\s*:|sắp\s+hết\s+hạn|sắp\s+đầy|dung\s+lượng\s+sắp\s+hết|độ\s+bảo\s+mật\s+thấp|không\s+khuyến\s+khích|chưa\s+được\s+lưu|weak\s+password|warning|caution|deprecated|expiring\s+soon|low\s+storage|unsaved\s+changes|rate\s+limit|be\s+careful|attention\s*:)/i;

const TEXT_SUCCESS_REGEX =
  /(?:cập\s+nhật\s+thành\s+công|lưu\s+thành\s+công|đăng\s+nhập\s+thành\s+công|đăng\s+ký\s+thành\s+công|thanh\s+toán\s+thành\s+công|xóa\s+thành\s+công|tạo\s+thành\s+công|gửi\s+thành\s+công|thành\s+công|đã\s+lưu|đã\s+cập\s+nhật|đã\s+gửi|đã\s+tạo|đã\s+sao\s+chép|hoàn\s+tất|hoàn\s+thành|successfully|success\b|saved\b|updated\b|completed\b|submitted\b|copied\b|confirmed\b|well\s+done|changes\s+applied)/i;

const TEXT_INFO_REGEX =
  /(?:mẹo\s*:|gợi\s+ý\s*:|hướng\s+dẫn|bạn\s+có\s+biết|thông\s+tin\s*:|phiên\s+bản\s+mới|tính\s+năng\s+mới|\bmẹo\b|\btip\s*:|pro\s+tip|hint\s*:|did\s+you\s+know|info\s*:|\bfyi\b|new\s+feature|announcement|please\s+note)/i;

function normalizeTextForMatch(raw: string | undefined | null): string {
  return (raw || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function stripVietnameseDiacritics(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function detectCssSignal(
  className?: string,
  dataType?: string
): { severity: NotificationSeverity; reason: string } | null {
  const combined = `${dataType || ''} ${className || ''}`.trim();
  if (!combined) return null;

  for (const { severity, regex } of CSS_SEVERITY_PATTERNS) {
    const m = combined.match(regex);
    if (m) {
      return {
        severity,
        reason: `CSS/data attribute matched ${severity} ("${m[0].trim()}")`,
      };
    }
  }
  return null;
}

function detectIconSignal(
  iconClassName?: string,
  iconText?: string,
  text?: string
): { severity: NotificationSeverity; reason: string } | null {
  const iconCls = (iconClassName || '').trim();
  if (iconCls) {
    for (const { severity, regex } of ICON_CLASS_PATTERNS) {
      const m = iconCls.match(regex);
      if (m) {
        return { severity, reason: `Icon class matched ${severity} ("${m[0]}")` };
      }
    }
  }

  const symbolSource = `${iconText || ''} ${(text || '').slice(0, 8)}`.trim();
  if (/[✓✔☑✅]/.test(symbolSource)) {
    return { severity: 'SUCCESS', reason: 'Icon/symbol matched SUCCESS checkmark' };
  }
  if (/[⚠⚡]/.test(symbolSource)) {
    return { severity: 'WARNING', reason: 'Icon/symbol matched WARNING sign' };
  }
  if (/[ℹ💡]/.test(symbolSource)) {
    return { severity: 'INFO', reason: 'Icon/symbol matched INFO symbol' };
  }
  if (/[❌⛔🚫⊘]/.test(symbolSource)) {
    return { severity: 'ERROR', reason: 'Icon/symbol matched ERROR symbol' };
  }

  return null;
}

const NO_ERROR_GUARD_REGEX =
  /(?:không\s+có\s+lỗi|0\s+lỗi|no\s+errors?|0\s+errors?|error[- ]free)/i;

function detectTextSignal(
  text?: string,
  httpStatusCode?: number
): { severity: NotificationSeverity; weight: number; reason: string } | null {
  if (httpStatusCode !== undefined && httpStatusCode >= 400) {
    return {
      severity: 'ERROR',
      weight: 4.5,
      reason: `HTTP status code ${httpStatusCode} indicates ERROR`,
    };
  }

  const norm = normalizeTextForMatch(text);
  if (!norm) return null;

  // Check server crash / HTTP 5xx first (highest priority)
  const crashMatch = norm.match(SERVER_CRASH_OR_HTTP_ERROR_REGEX);
  if (crashMatch) {
    return {
      severity: 'ERROR',
      weight: 4.2,
      reason: `Text matched critical ERROR/HTTP 5xx ("${crashMatch[0]}")`,
    };
  }

  // Check explicit WARNING before general ERROR (so "Mật khẩu yếu" isn't confused)
  const warnMatch = norm.match(TEXT_WARNING_REGEX);
  if (warnMatch) {
    return {
      severity: 'WARNING',
      weight: 3.4,
      reason: `Text matched WARNING phrase ("${warnMatch[0]}")`,
    };
  }

  // Check negative/error phrases BEFORE positive success phrases
  // (e.g. "không thành công" contains "thành công" and MUST be classified as ERROR)
  if (!NO_ERROR_GUARD_REGEX.test(norm)) {
    const err4xxMatch = norm.match(HTTP_4XX_ERROR_REGEX);
    if (err4xxMatch) {
      return {
        severity: 'ERROR',
        weight: 3.6,
        reason: `Text matched HTTP 4xx ERROR ("${err4xxMatch[0]}")`,
      };
    }

    const errMatch = norm.match(TEXT_ERROR_REGEX);
    if (errMatch) {
      return {
        severity: 'ERROR',
        weight: 3.4,
        reason: `Text matched ERROR phrase ("${errMatch[0]}")`,
      };
    }
  }

  const successMatch = norm.match(TEXT_SUCCESS_REGEX);
  if (successMatch) {
    return {
      severity: 'SUCCESS',
      weight: 3.4,
      reason: `Text matched SUCCESS phrase ("${successMatch[0]}")`,
    };
  }

  const infoMatch = norm.match(TEXT_INFO_REGEX);
  if (infoMatch) {
    return {
      severity: 'INFO',
      weight: 3.0,
      reason: `Text matched INFO phrase ("${infoMatch[0]}")`,
    };
  }

  return null;
}

/**
 * IEEE 29119 4-Severity Classification Taxonomy:
 * Combines CSS classes / data attributes, computed RGB/Hex colors, icons/symbols,
 * HTTP codes, and Vietnamese/English semantic text to classify into:
 * SUCCESS | INFO | WARNING | ERROR.
 */
export function classifyNotificationSeverity(
  input: NotificationClassificationInput
): NotificationClassificationResult {
  const scores: Record<NotificationSeverity, number> = {
    SUCCESS: 0,
    INFO: 0,
    WARNING: 0,
    ERROR: 0,
  };
  const reasons: string[] = [];
  const matchedSignals: NotificationClassificationResult['matchedSignals'] = {};

  // 1. CSS class & data-* attribute signal
  const cssHit = detectCssSignal(input.className, input.dataType);
  if (cssHit) {
    scores[cssHit.severity] += 4.0;
    matchedSignals.cssSignal = cssHit.severity;
    reasons.push(cssHit.reason);
  }

  // 2. Color signal (backgroundColor -> borderColor -> text/icon color)
  const colorCandidates: Array<{ label: string; value?: string }> = [
    { label: 'backgroundColor', value: input.backgroundColor },
    { label: 'borderColor', value: input.borderColor },
    { label: 'color', value: input.color },
  ];
  for (const c of colorCandidates) {
    const colorSev = classifyColorToSeverity(c.value);
    if (colorSev) {
      scores[colorSev] += 3.0;
      matchedSignals.colorSignal = colorSev;
      reasons.push(`Color (${c.label}: ${c.value}) matched ${colorSev}`);
      break;
    }
  }

  // 3. Icon / symbol signal
  const iconHit = detectIconSignal(input.iconClassName, input.iconText, input.text);
  if (iconHit) {
    scores[iconHit.severity] += 2.5;
    matchedSignals.iconSignal = iconHit.severity;
    reasons.push(iconHit.reason);
  }

  // 4. Text / HTTP status signal
  const textHit = detectTextSignal(input.text, input.httpStatusCode);
  if (textHit) {
    scores[textHit.severity] += textHit.weight;
    matchedSignals.textSignal = textHit.severity;
    reasons.push(textHit.reason);
  }

  const totalScore = scores.SUCCESS + scores.INFO + scores.WARNING + scores.ERROR;

  // Fallback when no strong CSS/color/icon/text signal was found
  if (totalScore === 0) {
    const role = (input.role || '').toLowerCase();
    const ariaLive = (input.ariaLive || '').toLowerCase();
    if (role === 'alert' || ariaLive === 'assertive') {
      return {
        severity: 'ERROR',
        confidence: 0.55,
        reasons: ['Fallback: role="alert" or aria-live="assertive" without benign severity signals'],
        matchedSignals,
      };
    }
    return {
      severity: 'INFO',
      confidence: 0.5,
      reasons: ['Fallback: No severity indicators matched; defaulting to INFO'],
      matchedSignals,
    };
  }

  // Pick highest scoring severity (tie-break priority: ERROR > WARNING > SUCCESS > INFO)
  const priorityOrder: NotificationSeverity[] = ['ERROR', 'WARNING', 'SUCCESS', 'INFO'];
  let bestSeverity: NotificationSeverity = 'INFO';
  let bestScore = -1;
  for (const sev of priorityOrder) {
    if (scores[sev] > bestScore) {
      bestScore = scores[sev];
      bestSeverity = sev;
    }
  }

  // Compute normalized confidence (0.60 .. 0.99)
  const dominance = bestScore / totalScore;
  const strength = Math.min(1, bestScore / 7.0);
  const confidence = Number(Math.min(0.99, Math.max(0.55, 0.55 + 0.25 * dominance + 0.19 * strength)).toFixed(3));

  return {
    severity: bestSeverity,
    confidence,
    reasons,
    matchedSignals,
  };
}

// ============================================================================
// BROWSER HELPERS (__name GUARD + LIVE NOTIFICATION DETECTION)
// ============================================================================

async function ensureNameHelper(page: Page): Promise<void> {
  try {
    await page.evaluate(
      'var __name = globalThis.__name = window.__name = globalThis.__name || function(fn) { return fn; };'
    );
  } catch {
    // ignore if page is navigating or closed
  }
}

interface RawDomNotification {
  id: string;
  selector: string;
  tag: string;
  text: string;
  rawText: string;
  className: string;
  role?: string;
  ariaLive?: string;
  dataType?: string;
  backgroundColor: string;
  borderColor: string;
  color: string;
  iconClassName: string;
  iconText: string;
  rect: Rect;
  zIndex: number;
  position: string;
  pointerEvents: string;
  isFloating: boolean;
  hasCloseButton: boolean;
  closeButtonSelector?: string;
  closeButtonRect?: Rect;
}

/**
 * Scan the live Playwright page for visible toast, snackbar, notification, and banner elements,
 * stamping deterministic `data-autotest-notif-id` attributes and classifying each via IEEE 29119 taxonomy.
 */
export async function detectVisibleNotifications(
  page: Page,
  options: DetectNotificationsOptions = {}
): Promise<DetectedNotification[]> {
  await ensureNameHelper(page);

  const includeInlineAlerts = options.includeInlineAlerts !== false;
  const containerSelectors = [
    ...NOTIFICATION_CONTAINER_SELECTORS,
    ...(options.extraSelectors || []),
  ];
  const closeSelectors = [...TOAST_CLOSE_BUTTON_SELECTORS];

  const rawItems: RawDomNotification[] = await page
    .evaluate(
      ({ containerSels, closeSels, includeInline }) => {
        const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
        const vh = window.innerHeight || document.documentElement.clientHeight || 720;
        const excludedTags = new Set(['SCRIPT', 'STYLE', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'HTML', 'BODY', 'HEAD', 'SVG', 'PATH']);
        const subPartRegex =
          /(?:^|\s)(?:toast|notification|snackbar|alert|ant-message|ant-notification|MuiAlert)[-_](?:header|body|content|title|message|description|icon|close|action|progress|btn)(?:\s|$)/i;
        const closeTextRegex = /^(?:✕|✖|×|x|⨯|╳|close|đóng)$/i;

        // Gather unique candidate elements
        const seen = new Set<Element>();
        const candidates: HTMLElement[] = [];

        for (const sel of containerSels) {
          let nodes: NodeListOf<Element>;
          try {
            nodes = document.querySelectorAll(sel);
          } catch {
            continue;
          }
          for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i] as HTMLElement;
            if (seen.has(el)) continue;
            seen.add(el);

            if (excludedTags.has(el.tagName)) continue;
            if (el.id === 'autotest-status-banner' || el.hasAttribute('data-autotest-overlay')) continue;

            const style = window.getComputedStyle(el);
            if (
              style.display === 'none' ||
              style.visibility === 'hidden' ||
              parseFloat(style.opacity || '1') <= 0.05
            ) {
              continue;
            }

            const rect = el.getBoundingClientRect();
            if (rect.width <= 4 || rect.height <= 4) continue;
            // Must intersect viewport
            if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= vw || rect.top >= vh) continue;

            // Ignore full-page containers unless explicitly marked as toast/snackbar
            const clsStr = typeof el.className === 'string' ? el.className : '';
            if (
              rect.width > vw * 0.98 &&
              rect.height > vh * 0.75 &&
              !/toast|snackbar|notification/i.test(clsStr)
            ) {
              continue;
            }

            // Must have meaningful text or visible icon content
            const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            if (!txt && !el.querySelector('svg, img, i, [class*="icon" i]')) continue;

            candidates.push(el);
          }
        }

        // Deduplicate ancestor/descendant wrappers
        const filtered: HTMLElement[] = [];
        for (let i = 0; i < candidates.length; i++) {
          const el = candidates[i];
          const elCls = typeof el.className === 'string' ? el.className : '';

          // Count strictly contained candidate descendants
          const childMatches: HTMLElement[] = [];
          for (let j = 0; j < candidates.length; j++) {
            if (i !== j && el.contains(candidates[j])) {
              childMatches.push(candidates[j]);
            }
          }

          // Drop multi-toast stack wrappers (e.g. .toast-container holding 2+ toasts)
          if (childMatches.length >= 2) continue;

          // If wrapping a single child candidate (e.g. .MuiSnackbar-root wrapping .MuiAlert-root)
          if (childMatches.length === 1) {
            const inner = childMatches[0];
            const innerCls = typeof inner.className === 'string' ? inner.className : '';
            const innerIsSubPart = subPartRegex.test(innerCls);
            const outerText = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            const innerText = (inner.innerText || inner.textContent || '').replace(/\s+/g, ' ').trim();
            if (!innerIsSubPart && innerText.length >= outerText.length * 0.8) {
              // Check if outer has a close button outside inner
              let outerExtraClose = false;
              for (const cs of closeSels) {
                const cb = el.querySelector(cs);
                if (cb && !inner.contains(cb)) {
                  outerExtraClose = true;
                  break;
                }
              }
              if (!outerExtraClose) {
                continue; // Prefer the tighter inner notification node
              }
            }
          }

          // Drop inner sub-parts if an ancestor toast is already in candidates
          let hasAncestorToast = false;
          for (let j = 0; j < candidates.length; j++) {
            if (i !== j && candidates[j].contains(el)) {
              const parentCls = typeof candidates[j].className === 'string' ? candidates[j].className : '';
              if (subPartRegex.test(elCls) || /ant-message-notice|ant-notification-notice|Toastify__toast/i.test(parentCls)) {
                hasAncestorToast = true;
                break;
              }
            }
          }
          if (hasAncestorToast) continue;

          filtered.push(el);
        }

        // Clean stale stamp attributes before stamping fresh IDs
        const staleNotifs = document.querySelectorAll('[data-autotest-notif-id]');
        for (let i = 0; i < staleNotifs.length; i++) {
          staleNotifs[i].removeAttribute('data-autotest-notif-id');
        }
        const staleClose = document.querySelectorAll('[data-autotest-notif-close]');
        for (let i = 0; i < staleClose.length; i++) {
          staleClose[i].removeAttribute('data-autotest-notif-close');
        }

        const results: RawDomNotification[] = [];
        let seq = 1;

        for (let i = 0; i < filtered.length; i++) {
          const el = filtered[i];
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();

          // Compute floating status (walk up briefly for fixed/absolute/sticky positioned ancestors)
          let position = style.position || 'static';
          let zIndex = parseInt(style.zIndex || '0', 10);
          if (Number.isNaN(zIndex)) zIndex = 0;
          let isFloating = position === 'fixed' || position === 'absolute' || position === 'sticky' || zIndex >= 10;

          if (!isFloating) {
            let ancestor: HTMLElement | null = el.parentElement;
            let depth = 0;
            while (ancestor && ancestor !== document.body && depth < 4) {
              const aStyle = window.getComputedStyle(ancestor);
              const aPos = aStyle.position || 'static';
              const aZ = parseInt(aStyle.zIndex || '0', 10) || 0;
              if (aPos === 'fixed' || aPos === 'absolute' || aPos === 'sticky' || aZ >= 10) {
                isFloating = true;
                if (aZ > zIndex) zIndex = aZ;
                break;
              }
              ancestor = ancestor.parentElement;
              depth++;
            }
          }

          if (!includeInline && !isFloating) continue;

          const id = `autotest-notif-${seq++}`;
          el.setAttribute('data-autotest-notif-id', id);

          // Find close button inside this notification
          let closeBtn: HTMLElement | null = null;
          for (const cs of closeSels) {
            try {
              const found = el.querySelector(cs) as HTMLElement | null;
              if (found) {
                const cr = found.getBoundingClientRect();
                const cStyle = window.getComputedStyle(found);
                if (cr.width > 4 && cr.height > 4 && cStyle.display !== 'none' && cStyle.visibility !== 'hidden') {
                  closeBtn = found;
                  break;
                }
              }
            } catch {
              // ignore invalid selector
            }
          }

          if (!closeBtn) {
            const buttons = el.querySelectorAll('button, [role="button"], a, span');
            for (let b = 0; b < buttons.length; b++) {
              const btn = buttons[b] as HTMLElement;
              const btnText = (btn.innerText || btn.textContent || '').replace(/\s+/g, ' ').trim();
              const br = btn.getBoundingClientRect();
              const bStyle = window.getComputedStyle(btn);
              if (br.width <= 4 || br.height <= 4 || bStyle.display === 'none' || bStyle.visibility === 'hidden') {
                continue;
              }
              if (closeTextRegex.test(btnText)) {
                closeBtn = btn;
                break;
              }
            }
          }

          let closeButtonSelector: string | undefined;
          let closeButtonRect: Rect | undefined;
          if (closeBtn) {
            closeBtn.setAttribute('data-autotest-notif-close', id);
            closeButtonSelector = `[data-autotest-notif-close="${id}"]`;
            const cr = closeBtn.getBoundingClientRect();
            closeButtonRect = { x: cr.x, y: cr.y, width: cr.width, height: cr.height };
          }

          // Extract clean notification text excluding the close button text
          const rawText = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          let cleanText = rawText;
          if (closeBtn) {
            const clone = el.cloneNode(true) as HTMLElement;
            const cloneClose = clone.querySelector(`[data-autotest-notif-close="${id}"]`);
            if (cloneClose && cloneClose.parentNode) {
              cloneClose.parentNode.removeChild(cloneClose);
            }
            cleanText = (clone.textContent || '').replace(/\s+/g, ' ').trim();
          }

          // Gather combined class names (element + severity-bearing inner nodes, excluding close button)
          const classParts: string[] = [];
          if (typeof el.className === 'string' && el.className.trim()) {
            classParts.push(el.className.trim());
          }
          const innerSevNodes = el.querySelectorAll(
            '[class*="success" i], [class*="error" i], [class*="danger" i], [class*="warn" i], [class*="info" i]'
          );
          for (let k = 0; k < innerSevNodes.length; k++) {
            const node = innerSevNodes[k] as HTMLElement;
            if (closeBtn && (node === closeBtn || closeBtn.contains(node))) continue;
            if (typeof node.className === 'string' && node.className.trim()) {
              classParts.push(node.className.trim());
            }
          }

          // Gather icon class & text + chromatic colors
          let iconClassName = '';
          let iconText = '';
          let iconColor = '';
          const iconNodes = el.querySelectorAll('svg, i, [class*="icon" i], [class*="anticon" i], .toast-icon');
          for (let k = 0; k < iconNodes.length; k++) {
            const icon = iconNodes[k] as HTMLElement;
            if (closeBtn && (icon === closeBtn || closeBtn.contains(icon))) continue;
            const icls = typeof icon.className === 'string'
              ? icon.className
              : (icon.getAttribute('class') || '');
            if (icls) iconClassName += ` ${icls}`;
            const itxt = (icon.textContent || '').trim();
            if (itxt && itxt.length <= 4) iconText += itxt;
            const iStyle = window.getComputedStyle(icon);
            if (!iconColor && iStyle.color && iStyle.color !== 'rgb(0, 0, 0)') {
              iconColor = iStyle.color;
            }
            if (!iconColor && iStyle.fill && iStyle.fill !== 'none' && iStyle.fill !== 'rgb(0, 0, 0)') {
              iconColor = iStyle.fill;
            }
          }

          // Background / border / text color with child fallback for wrapper notices (e.g. AntD)
          let bgColor = style.backgroundColor || '';
          if (
            !bgColor ||
            bgColor === 'rgba(0, 0, 0, 0)' ||
            bgColor === 'transparent' ||
            bgColor === 'rgb(255, 255, 255)'
          ) {
            let contentChild: HTMLElement | null = null;
            try {
              contentChild = el.querySelector(
                '.ant-message-notice-content, .ant-notification-notice-content, .MuiAlert-root, .toast-body, :scope > div'
              ) as HTMLElement | null;
            } catch {
              contentChild = el.firstElementChild as HTMLElement | null;
            }
            if (contentChild) {
              const childBg = window.getComputedStyle(contentChild).backgroundColor || '';
              if (childBg && childBg !== 'rgba(0, 0, 0, 0)' && childBg !== 'transparent') {
                bgColor = childBg;
              }
            }
          }

          let borderColor = '';
          const borderCandidates = [
            style.borderLeftColor,
            style.borderTopColor,
            style.borderColor,
          ];
          for (let b = 0; b < borderCandidates.length; b++) {
            const bc = borderCandidates[b];
            if (bc && bc !== 'rgba(0, 0, 0, 0)' && bc !== 'transparent' && bc !== 'rgb(255, 255, 255)') {
              borderColor = bc;
              break;
            }
          }

          const effectiveColor = iconColor || style.color || '';
          const dataType =
            el.getAttribute('data-severity') ||
            el.getAttribute('data-type') ||
            el.getAttribute('data-status') ||
            el.getAttribute('data-variant') ||
            undefined;

          results.push({
            id,
            selector: `[data-autotest-notif-id="${id}"]`,
            tag: el.tagName.toLowerCase(),
            text: cleanText,
            rawText,
            className: classParts.join(' '),
            role: el.getAttribute('role') || undefined,
            ariaLive: el.getAttribute('aria-live') || undefined,
            dataType,
            backgroundColor: bgColor,
            borderColor,
            color: effectiveColor,
            iconClassName: iconClassName.trim(),
            iconText: iconText.trim(),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            zIndex,
            position,
            pointerEvents: style.pointerEvents || 'auto',
            isFloating,
            hasCloseButton: Boolean(closeBtn),
            closeButtonSelector,
            closeButtonRect,
          });
        }

        return results;
      },
      {
        containerSels: containerSelectors,
        closeSels: closeSelectors,
        includeInline: includeInlineAlerts,
      }
    )
    .catch(() => []);

  const now = Date.now();
  return rawItems.map((item) => {
    const classification = classifyNotificationSeverity({
      text: item.text,
      className: item.className,
      role: item.role,
      ariaLive: item.ariaLive,
      dataType: item.dataType,
      backgroundColor: item.backgroundColor,
      borderColor: item.borderColor,
      color: item.color,
      iconClassName: item.iconClassName,
      iconText: item.iconText,
    });

    return {
      id: item.id,
      selector: item.selector,
      tag: item.tag,
      text: item.text,
      rawText: item.rawText,
      className: item.className,
      role: item.role,
      ariaLive: item.ariaLive,
      dataType: item.dataType,
      severity: classification.severity,
      classification,
      rect: item.rect,
      zIndex: item.zIndex,
      position: item.position,
      pointerEvents: item.pointerEvents,
      isFloating: item.isFloating,
      hasCloseButton: item.hasCloseButton,
      closeButtonSelector: item.closeButtonSelector,
      closeButtonRect: item.closeButtonRect,
      detectedAt: now,
    };
  });
}

// ============================================================================
// EXPECTED VS UNEXPECTED NOTIFICATION ORACLE
// ============================================================================

function extractExpectedPhrases(stepContext?: NotificationStepContext): string[] {
  if (!stepContext) return [];
  const phrases: string[] = [];

  const pushUnique = (val?: string) => {
    const cleaned = (val || '').trim();
    if (cleaned && !phrases.includes(cleaned)) {
      phrases.push(cleaned);
    }
  };

  if (stepContext.expectedErrorTexts) {
    for (const phrase of stepContext.expectedErrorTexts) {
      pushUnique(phrase);
    }
  }

  if (stepContext.action?.type === 'ASSERT_TEXT' && stepContext.action.expectedText) {
    pushUnique(stepContext.action.expectedText);
  }

  if (stepContext.upcomingActions) {
    for (const act of stepContext.upcomingActions) {
      if (act.type === 'ASSERT_TEXT' && act.expectedText) {
        pushUnique(act.expectedText);
      }
    }
  }

  // Extract quoted expected phrases from stepText / rawStepText when the instruction is an assertion
  const candidateTexts = [
    stepContext.stepText,
    stepContext.action?.rawStepText,
    stepContext.action?.subInstruction,
  ];
  const assertIntentRegex = /(?:kiểm\s*tra|xác\s*nhận|thấy|hiển\s*thị|assert|expect|verify|báo\s*lỗi|thông\s*báo)/i;
  for (const txt of candidateTexts) {
    if (!txt || !assertIntentRegex.test(txt)) continue;
    const matches = txt.matchAll(/["'“”]([^"'“”]{2,160})["'“”]/g);
    for (const m of matches) {
      pushUnique(m[1]);
    }
  }

  return phrases;
}

function findMatchingExpectedPhrase(notificationText: string, expectedPhrases: string[]): string | undefined {
  const normNotif = normalizeTextForMatch(notificationText);
  if (!normNotif) return undefined;
  const asciiNotif = stripVietnameseDiacritics(normNotif);

  for (const phrase of expectedPhrases) {
    const normPhrase = normalizeTextForMatch(phrase);
    if (!normPhrase) continue;

    if (normNotif.includes(normPhrase)) {
      return phrase;
    }
    if (normPhrase.length >= 4 && normNotif.length >= 4 && normPhrase.includes(normNotif)) {
      return phrase;
    }

    const asciiPhrase = stripVietnameseDiacritics(normPhrase);
    if (asciiPhrase.length >= 4 && asciiNotif.includes(asciiPhrase)) {
      return phrase;
    }
  }

  return undefined;
}

function isDetectedNotification(
  item: DetectedNotification | NotificationClassificationInput
): item is DetectedNotification {
  return 'severity' in item && 'id' in item && 'selector' in item;
}

/**
 * Reconcile detected notifications against the active test step context (Expected vs Unexpected Oracle):
 * - SUCCESS -> 'SUCCESS_EVIDENCE' (records PASS evidence, NEVER fails scenario)
 * - INFO    -> 'IGNORED' (cleanly ignored, NEVER fails scenario)
 * - WARNING -> 'WARNING_LOGGED' (records yellow warning log, NEVER fails scenario)
 * - ERROR matching expected negative assertion -> 'EXPECTED_PASS' (does NOT trigger PRODUCT_DEFECT)
 * - Unexpected ERROR (or server crash/HTTP 5xx) -> 'PRODUCT_DEFECT' (fails scenario)
 */
export function evaluateNotificationsAgainstStep(
  notifications: Array<DetectedNotification | NotificationClassificationInput>,
  stepContext?: NotificationStepContext
): NotificationOracleReport {
  const expectedPhrases = extractExpectedPhrases(stepContext);
  const items: NotificationEvaluationItem[] = [];
  const successEvidences: string[] = [];
  const warningLogs: string[] = [];
  const ignoredInfos: string[] = [];
  const productDefects: string[] = [];
  let hasExpectedErrorMatch = false;

  for (let idx = 0; idx < notifications.length; idx++) {
    const raw = notifications[idx];
    let notif: Pick<DetectedNotification, 'id' | 'text' | 'severity' | 'selector' | 'className'> &
      Partial<DetectedNotification>;

    if (isDetectedNotification(raw)) {
      notif = raw;
    } else {
      const cls = classifyNotificationSeverity(raw);
      notif = {
        id: `notif-inline-${idx + 1}`,
        selector: '',
        text: (raw.text || '').trim(),
        className: raw.className || '',
        severity: cls.severity,
        classification: cls,
      };
    }

    const label = notif.text || `[${notif.className || notif.severity}]`;

    if (notif.severity === 'SUCCESS') {
      const evidenceEntry = `[SUCCESS_EVIDENCE] Xác nhận thao tác thành công: "${label}"`;
      successEvidences.push(evidenceEntry);
      items.push({
        notification: notif,
        verdict: 'SUCCESS_EVIDENCE',
        shouldFailScenario: false,
        reason: 'IEEE 29119 SUCCESS notification confirms prior action succeeded (never fail scenario).',
        evidenceEntry,
      });
      continue;
    }

    if (notif.severity === 'INFO') {
      const infoEntry = `[INFO_IGNORED] Bỏ qua thông báo thông tin/mẹo: "${label}"`;
      ignoredInfos.push(infoEntry);
      items.push({
        notification: notif,
        verdict: 'IGNORED',
        shouldFailScenario: false,
        reason: 'IEEE 29119 INFO notification ignored cleanly.',
      });
      continue;
    }

    if (notif.severity === 'WARNING') {
      const warningEntry = `[WARNING_LOGGED] Cảnh báo giao diện (không đánh trượt): "${label}"`;
      warningLogs.push(warningEntry);
      items.push({
        notification: notif,
        verdict: 'WARNING_LOGGED',
        shouldFailScenario: false,
        reason: 'IEEE 29119 WARNING notification recorded as yellow warning log (never fail scenario).',
        warningEntry,
      });
      continue;
    }

    // Severity === 'ERROR' -> Reconcile against expected negative test intent
    const matchedPhrase = findMatchingExpectedPhrase(notif.text, expectedPhrases);
    const isServerCrash = SERVER_CRASH_OR_HTTP_ERROR_REGEX.test(notif.text);

    if (matchedPhrase) {
      hasExpectedErrorMatch = true;
      const evidenceEntry = `[EXPECTED_PASS] Thông báo lỗi khớp kỳ vọng ca phủ định ("${matchedPhrase}"): "${label}"`;
      successEvidences.push(evidenceEntry);
      items.push({
        notification: notif,
        verdict: 'EXPECTED_PASS',
        shouldFailScenario: false,
        reason: `ERROR notification matches expected negative assertion phrase "${matchedPhrase}" -> EXPECTED_PASS.`,
        matchedExpectedPhrase: matchedPhrase,
        evidenceEntry,
      });
      continue;
    }

    // If explicitly marked negative test with NO specific phrase list and NOT a server crash/5xx
    if (stepContext?.isNegativeTest && expectedPhrases.length === 0 && !isServerCrash) {
      hasExpectedErrorMatch = true;
      const evidenceEntry = `[EXPECTED_PASS] Thông báo lỗi nằm trong kịch bản kiểm thử phủ định: "${label}"`;
      successEvidences.push(evidenceEntry);
      items.push({
        notification: notif,
        verdict: 'EXPECTED_PASS',
        shouldFailScenario: false,
        reason: 'ERROR validation notification observed during explicit negative test step -> EXPECTED_PASS.',
        evidenceEntry,
      });
      continue;
    }

    // Otherwise -> Unexpected ERROR triggers PRODUCT_DEFECT
    const defectMsg = `[PRODUCT_DEFECT] Phát hiện thông báo lỗi ngoài kỳ vọng trên giao diện: "${label}"`;
    productDefects.push(defectMsg);
    items.push({
      notification: notif,
      verdict: 'PRODUCT_DEFECT',
      shouldFailScenario: true,
      reason: isServerCrash
        ? `Unexpected critical server/runtime ERROR notification ("${label}") -> PRODUCT_DEFECT.`
        : `Unexpected ERROR notification ("${label}") with no matching negative test expectation -> PRODUCT_DEFECT.`,
    });
  }

  const shouldFailScenario = productDefects.length > 0;
  let overallVerdict: NotificationOracleReport['overallVerdict'] = 'PASS';
  if (shouldFailScenario) {
    overallVerdict = 'PRODUCT_DEFECT';
  } else if (hasExpectedErrorMatch) {
    overallVerdict = 'EXPECTED_PASS';
  } else if (warningLogs.length > 0) {
    overallVerdict = 'PASS_WITH_WARNING';
  }

  const summaryParts: string[] = [];
  if (productDefects.length > 0) summaryParts.push(`PRODUCT_DEFECT(${productDefects.length})`);
  if (hasExpectedErrorMatch) summaryParts.push(`EXPECTED_PASS`);
  if (successEvidences.length > 0) summaryParts.push(`SUCCESS_EVIDENCE(${successEvidences.length})`);
  if (warningLogs.length > 0) summaryParts.push(`WARNING_LOGGED(${warningLogs.length})`);
  if (ignoredInfos.length > 0) summaryParts.push(`IGNORED(${ignoredInfos.length})`);
  const summary =
    summaryParts.length > 0
      ? `Notification Oracle [${overallVerdict}]: ${summaryParts.join(', ')}`
      : 'Notification Oracle [PASS]: No active notifications detected.';

  return {
    overallVerdict,
    shouldFailScenario,
    hasExpectedErrorMatch,
    items,
    successEvidences,
    warningLogs,
    ignoredInfos,
    productDefects,
    summary,
  };
}

// ============================================================================
// GEOMETRIC EXPOSED SUB-REGION CALCULATOR (TIER 2 SPATIAL EVASION)
// ============================================================================

function intersectRects(a: Rect, b: Rect): Rect | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function centerOfRect(r: Rect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * Compute exact exposed area ratio and maximal contiguous exposed axis-aligned sub-region
 * of `targetRect` outside all `obstacleRects`.
 * Meets Tier 2 Spatial Evasion criteria when:
 *   exposedRatio >= 0.40 (40%) AND subRegion.width >= 24px AND subRegion.height >= 24px.
 */
export function computeExposedSubRegion(
  targetRect: Rect,
  obstacleRects: Rect[],
  options: { minExposedRatio?: number; minExposedWidth?: number; minExposedHeight?: number } = {}
): ExposedSubRegionResult {
  const minRatio = options.minExposedRatio ?? 0.4;
  const minW = options.minExposedWidth ?? 24;
  const minH = options.minExposedHeight ?? 24;

  const tx1 = targetRect.x;
  const ty1 = targetRect.y;
  const tx2 = targetRect.x + targetRect.width;
  const ty2 = targetRect.y + targetRect.height;
  const totalArea = Math.max(0, targetRect.width * targetRect.height);

  if (totalArea <= 0) {
    return {
      totalArea: 0,
      exposedArea: 0,
      exposedRatio: 0,
      bestSubRegion: null,
      safeClickPoint: null,
      meetsThreshold: false,
    };
  }

  // Clamp obstacles to targetRect
  const clipped: Rect[] = [];
  for (const obs of obstacleRects) {
    const inter = intersectRects(targetRect, obs);
    if (inter) clipped.push(inter);
  }

  if (clipped.length === 0) {
    const meets = targetRect.width >= minW && targetRect.height >= minH;
    return {
      totalArea,
      exposedArea: totalArea,
      exposedRatio: 1,
      bestSubRegion: { ...targetRect },
      safeClickPoint: meets ? centerOfRect(targetRect) : null,
      meetsThreshold: meets,
    };
  }

  // Partition targetRect along unique X and Y cut lines
  const xSet = new Set<number>([tx1, tx2]);
  const ySet = new Set<number>([ty1, ty2]);
  for (const c of clipped) {
    xSet.add(c.x);
    xSet.add(c.x + c.width);
    ySet.add(c.y);
    ySet.add(c.y + c.height);
  }

  const xs = Array.from(xSet).sort((a, b) => a - b);
  const ys = Array.from(ySet).sort((a, b) => a - b);
  const cols = xs.length - 1;
  const rows = ys.length - 1;

  // Determine exposed grid cells
  const exposedGrid: boolean[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => false)
  );
  let exposedArea = 0;

  for (let r = 0; r < rows; r++) {
    const cy = (ys[r] + ys[r + 1]) / 2;
    const cellH = ys[r + 1] - ys[r];
    for (let c = 0; c < cols; c++) {
      const cx = (xs[c] + xs[c + 1]) / 2;
      const cellW = xs[c + 1] - xs[c];
      if (cellW <= 0.01 || cellH <= 0.01) continue;

      let covered = false;
      for (const obs of clipped) {
        if (cx >= obs.x && cx <= obs.x + obs.width && cy >= obs.y && cy <= obs.y + obs.height) {
          covered = true;
          break;
        }
      }
      if (!covered) {
        exposedGrid[r][c] = true;
        exposedArea += cellW * cellH;
      }
    }
  }

  const exposedRatio = totalArea > 0 ? exposedArea / totalArea : 0;

  // Find maximal exposed contiguous axis-aligned sub-rectangle using 2D prefix sum of blocked cells
  const blockedPrefix: number[][] = Array.from({ length: rows + 1 }, () =>
    Array.from({ length: cols + 1 }, () => 0)
  );
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const blocked = exposedGrid[r][c] ? 0 : 1;
      blockedPrefix[r + 1][c + 1] =
        blocked + blockedPrefix[r][c + 1] + blockedPrefix[r + 1][c] - blockedPrefix[r][c];
    }
  }

  let bestSubRegion: Rect | null = null;
  let bestArea = 0;
  let bestMeetsDims = false;

  for (let r1 = 0; r1 < rows; r1++) {
    for (let r2 = r1; r2 < rows; r2++) {
      const h = ys[r2 + 1] - ys[r1];
      if (h <= 0.01) continue;
      for (let c1 = 0; c1 < cols; c1++) {
        for (let c2 = c1; c2 < cols; c2++) {
          const blockedCount =
            blockedPrefix[r2 + 1][c2 + 1] -
            blockedPrefix[r1][c2 + 1] -
            blockedPrefix[r2 + 1][c1] +
            blockedPrefix[r1][c1];
          if (blockedCount > 0) continue;

          const w = xs[c2 + 1] - xs[c1];
          if (w <= 0.01) continue;
          const area = w * h;
          const meetsDims = w >= minW && h >= minH;

          // Prefer rectangles meeting minW x minH; tie-break by largest area
          if (
            (meetsDims && !bestMeetsDims) ||
            (meetsDims === bestMeetsDims && area > bestArea)
          ) {
            bestArea = area;
            bestMeetsDims = meetsDims;
            bestSubRegion = { x: xs[c1], y: ys[r1], width: w, height: h };
          }
        }
      }
    }
  }

  const meetsThreshold = Boolean(
    bestSubRegion && exposedRatio >= minRatio - 1e-6 && bestSubRegion.width >= minW && bestSubRegion.height >= minH
  );

  return {
    totalArea,
    exposedArea,
    exposedRatio,
    bestSubRegion,
    safeClickPoint: meetsThreshold && bestSubRegion ? centerOfRect(bestSubRegion) : null,
    meetsThreshold,
  };
}

// ============================================================================
// TIER 4: POINTER-EVENTS ISOLATION (RAII WRAPPER + RESTORE HANDLE)
// ============================================================================

/**
 * Temporarily apply `pointer-events: none !important` on occluding toast containers
 * (and their descendants via a scoped stylesheet) and return an idempotent `restore()` handle.
 */
export async function applyToastPointerEventsIsolation(
  page: Page,
  toastTargets: Array<string | Pick<DetectedNotification, 'selector'>>
): Promise<PointerEventsIsolationHandle> {
  await ensureNameHelper(page);

  const selectors = Array.from(
    new Set(
      toastTargets
        .map((t) => (typeof t === 'string' ? t : t.selector))
        .filter((s): s is string => Boolean(s && s.trim()))
    )
  );

  const token = `autotest-pe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  if (selectors.length === 0) {
    return {
      token,
      isolatedCount: 0,
      isolatedSelectors: [],
      restore: async () => {},
    };
  }

  const isolatedCount = await page
    .evaluate(
      ({ sels, tok }) => {
        const win = window as any;
        if (!win.__autotestPeBackups) {
          win.__autotestPeBackups = {};
        }
        const backups: Array<{
          el: HTMLElement;
          prevVal: string;
          prevPriority: string;
          prevAttr: string | null;
        }> = [];
        const seen = new Set<HTMLElement>();

        for (let i = 0; i < sels.length; i++) {
          let matched: NodeListOf<Element>;
          try {
            matched = document.querySelectorAll(sels[i]);
          } catch {
            continue;
          }
          for (let j = 0; j < matched.length; j++) {
            const el = matched[j] as HTMLElement;
            if (seen.has(el)) continue;
            seen.add(el);

            backups.push({
              el,
              prevVal: el.style.getPropertyValue('pointer-events'),
              prevPriority: el.style.getPropertyPriority('pointer-events'),
              prevAttr: el.getAttribute('data-autotest-pe-isolated'),
            });

            el.setAttribute('data-autotest-pe-isolated', tok);
            el.style.setProperty('pointer-events', 'none', 'important');
          }
        }

        if (backups.length > 0) {
          const styleEl = document.createElement('style');
          styleEl.setAttribute('data-autotest-pe-style', tok);
          styleEl.textContent = `[data-autotest-pe-isolated="${tok}"], [data-autotest-pe-isolated="${tok}"] * { pointer-events: none !important; }`;
          (document.head || document.documentElement).appendChild(styleEl);
          win.__autotestPeBackups[tok] = backups;
        }

        return backups.length;
      },
      { sels: selectors, tok: token }
    )
    .catch(() => 0);

  let restored = false;

  const restore = async (): Promise<void> => {
    if (restored) return;
    restored = true;
    await ensureNameHelper(page);
    await page
      .evaluate((tok) => {
        const win = window as any;
        const backups = win.__autotestPeBackups ? win.__autotestPeBackups[tok] : null;
        if (Array.isArray(backups)) {
          for (let i = 0; i < backups.length; i++) {
            const entry = backups[i];
            const el = entry.el as HTMLElement;
            if (entry.prevVal) {
              el.style.setProperty('pointer-events', entry.prevVal, entry.prevPriority || '');
            } else {
              el.style.removeProperty('pointer-events');
            }
            if (entry.prevAttr !== null) {
              el.setAttribute('data-autotest-pe-isolated', entry.prevAttr);
            } else {
              el.removeAttribute('data-autotest-pe-isolated');
            }
          }
          delete win.__autotestPeBackups[tok];
        }

        const styleEl = document.querySelector(`style[data-autotest-pe-style="${tok}"]`);
        if (styleEl && styleEl.parentNode) {
          styleEl.parentNode.removeChild(styleEl);
        }
      }, token)
      .catch(() => {});
  };

  return {
    token,
    isolatedCount,
    isolatedSelectors: selectors,
    restore,
  };
}

/**
 * Tier 4 RAII helper: temporarily isolates pointer-events on occluding toast containers,
 * runs `action()`, and guarantees restoration in `finally` even if `action()` throws.
 */
export async function withToastPointerEventsIsolation<T>(
  page: Page,
  toastTargets: Array<string | Pick<DetectedNotification, 'selector'>>,
  action: () => Promise<T>
): Promise<PointerEventsIsolationResult<T>> {
  const handle = await applyToastPointerEventsIsolation(page, toastTargets);
  try {
    const result = await action();
    return {
      result,
      isolatedCount: handle.isolatedCount,
      restored: true,
    };
  } finally {
    await handle.restore();
  }
}

// ============================================================================
// 4-TIER TOAST EVASION LADDER
// ============================================================================

function isPlainRect(target: TargetInput): target is Rect {
  return (
    typeof target === 'object' &&
    target !== null &&
    'x' in target &&
    'y' in target &&
    'width' in target &&
    'height' in target &&
    typeof (target as Rect).x === 'number'
  );
}

function isCandidateLike(target: TargetInput): target is Pick<DOMCandidate, 'rect' | 'selectorPath'> {
  return typeof target === 'object' && target !== null && 'rect' in target && 'selectorPath' in target;
}

async function resolveTargetRectAndSelector(
  page: Page,
  target: TargetInput,
  explicitSelector?: string
): Promise<{ rect: Rect; selector?: string; cleanup?: () => Promise<void> }> {
  if (typeof target === 'string') {
    const box = await page.locator(target).first().boundingBox();
    if (!box) {
      throw new Error(`Target selector "${target}" is not visible or has no bounding box.`);
    }
    return { rect: box, selector: explicitSelector || target };
  }

  if (isPlainRect(target)) {
    return { rect: { ...target }, selector: explicitSelector };
  }

  if (isCandidateLike(target)) {
    if (target.selectorPath) {
      const liveBox = await page.locator(target.selectorPath).first().boundingBox().catch(() => null);
      if (liveBox) {
        return { rect: liveBox, selector: explicitSelector || target.selectorPath };
      }
    }
    return { rect: { ...target.rect }, selector: explicitSelector || target.selectorPath };
  }

  // Playwright Locator
  const locator = target as Locator;
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Target Locator is not visible or has no bounding box.');
  }

  if (explicitSelector) {
    return { rect: box, selector: explicitSelector };
  }

  const marker = `autotest-target-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const stamped = await locator
    .evaluate((el, m) => {
      el.setAttribute('data-autotest-evasion-target', m);
      return true;
    }, marker)
    .catch(() => false);

  if (!stamped) {
    return { rect: box };
  }

  return {
    rect: box,
    selector: `[data-autotest-evasion-target="${marker}"]`,
    cleanup: async () => {
      await locator
        .evaluate((el) => {
          el.removeAttribute('data-autotest-evasion-target');
        })
        .catch(() => {});
    },
  };
}

/**
 * Determine which visible notifications are actively occluding `targetRect`
 * using bounding-box intersection AND live Chromium `document.elementFromPoint` verification.
 */
async function detectOccludingToasts(
  page: Page,
  targetRect: Rect,
  targetSelector?: string,
  extraSelectors?: string[]
): Promise<DetectedNotification[]> {
  const notifications = await detectVisibleNotifications(page, {
    includeInlineAlerts: true,
    extraSelectors,
  });

  if (notifications.length === 0) return [];

  // Filter geometrically overlapping notifications first
  const overlapping = notifications.filter((n) => intersectRects(targetRect, n.rect) !== null);
  if (overlapping.length === 0) return [];

  await ensureNameHelper(page);

  // Confirm via Chromium elementFromPoint hit-testing that each overlapping toast actually intercepts pointer events above target
  const occludingIds = await page
    .evaluate(
      ({ tRect, tSel, toasts }) => {
        const targetEl = tSel ? document.querySelector(tSel) : null;
        const blockedIds: string[] = [];

        for (let i = 0; i < toasts.length; i++) {
          const t = toasts[i];
          const toastEl = document.querySelector(t.selector);
          if (!toastEl) continue;

          // Compute overlap rect
          const x1 = Math.max(tRect.x, t.rect.x);
          const y1 = Math.max(tRect.y, t.rect.y);
          const x2 = Math.min(tRect.x + tRect.width, t.rect.x + t.rect.width);
          const y2 = Math.min(tRect.y + tRect.height, t.rect.y + t.rect.height);
          if (x2 <= x1 || y2 <= y1) continue;

          const ix = (x1 + x2) / 2;
          const iy = (y1 + y2) / 2;
          const insetX = Math.min(3, (x2 - x1) / 4);
          const insetY = Math.min(3, (y2 - y1) / 4);

          const samplePoints: Array<[number, number]> = [
            [ix, iy],
            [x1 + insetX, y1 + insetY],
            [x2 - insetX, y1 + insetY],
            [x1 + insetX, y2 - insetY],
            [x2 - insetX, y2 - insetY],
          ];

          let intercepts = false;
          for (let p = 0; p < samplePoints.length; p++) {
            const px = samplePoints[p][0];
            const py = samplePoints[p][1];
            const hit = document.elementFromPoint(px, py);
            if (!hit) continue;
            if (hit === toastEl || toastEl.contains(hit)) {
              // Ensure toast is not actually a child/ancestor of target itself
              if (!targetEl || (!targetEl.contains(toastEl) && !toastEl.contains(targetEl))) {
                intercepts = true;
                break;
              }
            }
          }

          if (intercepts) {
            blockedIds.push(t.id);
          }
        }

        return blockedIds;
      },
      {
        tRect: targetRect,
        tSel: targetSelector || null,
        toasts: overlapping.map((n) => ({ id: n.id, selector: n.selector, rect: n.rect })),
      }
    )
    .catch(() => [] as string[]);

  const occludingSet = new Set(occludingIds);
  return overlapping.filter((n) => occludingSet.has(n.id));
}

async function verifyPointHitsTarget(
  page: Page,
  point: { x: number; y: number },
  occludingSelectors: string[],
  targetSelector?: string
): Promise<boolean> {
  await ensureNameHelper(page);
  return page
    .evaluate(
      ({ pt, obsSels, tSel }) => {
        const hit = document.elementFromPoint(pt.x, pt.y);
        if (!hit) return false;

        for (let i = 0; i < obsSels.length; i++) {
          const obsEl = document.querySelector(obsSels[i]);
          if (obsEl && (hit === obsEl || obsEl.contains(hit))) {
            return false;
          }
        }

        if (tSel) {
          const targetEl = document.querySelector(tSel);
          if (targetEl) {
            return hit === targetEl || targetEl.contains(hit) || hit.contains(targetEl);
          }
        }
        return true;
      },
      { pt: point, obsSels: occludingSelectors, tSel: targetSelector || null }
    )
    .catch(() => false);
}

/**
 * Execute the 4-Tier Toast Evasion Ladder (Pillar 17) when floating toast notifications occlude a target:
 * - Tier 0: Target already unobstructed -> immediate center coordinates.
 * - Tier 1 (Auto-Dismiss): Click toast close button (✕, ×, [aria-label="Close"], .toast-close, etc.) or send Escape.
 * - Tier 2 (Spatial Evasion): Subtract toast rects from target rect; if exposed >= 40% & >= 24x24px, shift to exposed centroid.
 * - Tier 3 (Smart TTL Drain): Poll (~100ms) for toast natural expiration within TTL window (default 3000ms).
 * - Tier 4 (Pointer-Events Isolation): Temporarily apply `pointer-events: none` on stubborn persistent toast containers with restore handle.
 */
export async function evadeOccludingToasts(
  page: Page,
  target: TargetInput,
  options: ToastEvasionOptions = {}
): Promise<ToastEvasionResult> {
  const minExposedRatio = options.minExposedRatio ?? 0.4;
  const minExposedWidth = options.minExposedWidth ?? 24;
  const minExposedHeight = options.minExposedHeight ?? 24;
  const enableEscapeDismiss = options.enableEscapeDismiss !== false;
  const ttlDrainTimeoutMs = options.ttlDrainTimeoutMs ?? 3000;
  const ttlPollIntervalMs = options.ttlPollIntervalMs ?? 100;
  const allowPointerEventsIsolation = options.allowPointerEventsIsolation !== false;

  const resolvedTarget = await resolveTargetRectAndSelector(page, target, options.targetSelector);
  const logs: string[] = [];

  try {
    let targetRect = resolvedTarget.rect;
    const targetSelector = resolvedTarget.selector;
    const initialOccluding = await detectOccludingToasts(
      page,
      targetRect,
      targetSelector,
      options.extraNotificationSelectors
    );

    if (initialOccluding.length === 0) {
      return {
        evaded: true,
        occludedInitially: false,
        tierUsed: 0,
        strategy: 'NONE',
        clickPoint: centerOfRect(targetRect),
        targetRect,
        occludingToasts: [],
        dismissedCount: 0,
        logs: ['Target is unobstructed by any toast notification.'],
      };
    }

    logs.push(
      `Detected ${initialOccluding.length} occluding toast(s): ${initialOccluding
        .map((t) => `[${t.severity}] "${t.text}"`)
        .join(', ')}`
    );

    let currentOccluding = initialOccluding;
    let dismissedCount = 0;

    // ------------------------------------------------------------------------
    // TIER 1: AUTO-DISMISS (Close button click -> Escape key)
    // ------------------------------------------------------------------------
    const dismissibleToasts = currentOccluding.filter((t) => t.hasCloseButton && t.closeButtonSelector);
    if (dismissibleToasts.length > 0) {
      for (const toast of dismissibleToasts) {
        try {
          const closeLoc = page.locator(toast.closeButtonSelector!).first();
          await closeLoc.click({ timeout: 1500 });
          dismissedCount++;
          logs.push(`Tier 1: Clicked close button on toast "${toast.text}".`);
        } catch {
          if (toast.closeButtonRect) {
            const c = centerOfRect(toast.closeButtonRect);
            await page.mouse.click(c.x, c.y).catch(() => {});
            dismissedCount++;
            logs.push(`Tier 1: Physically clicked close button centroid on toast "${toast.text}".`);
          }
        }
      }

      // Brief poll up to 250ms to let dismiss transition complete
      const closeDeadline = Date.now() + 250;
      while (Date.now() < closeDeadline) {
        await new Promise((r) => setTimeout(r, 50));
        currentOccluding = await detectOccludingToasts(
          page,
          targetRect,
          targetSelector,
          options.extraNotificationSelectors
        );
        if (currentOccluding.length === 0) break;
      }

      if (currentOccluding.length === 0) {
        logs.push('Tier 1 succeeded (AUTO_DISMISS_CLOSE_BUTTON): target is now unobstructed.');
        return {
          evaded: true,
          occludedInitially: true,
          tierUsed: 1,
          strategy: 'AUTO_DISMISS_CLOSE_BUTTON',
          clickPoint: centerOfRect(targetRect),
          targetRect,
          occludingToasts: initialOccluding,
          dismissedCount,
          logs,
        };
      }
    }

    if (enableEscapeDismiss && currentOccluding.length > 0) {
      await page.keyboard.press('Escape').catch(() => {});
      logs.push('Tier 1: Sent Escape key to dismiss occluding toast.');

      const escDeadline = Date.now() + 200;
      while (Date.now() < escDeadline) {
        await new Promise((r) => setTimeout(r, 50));
        currentOccluding = await detectOccludingToasts(
          page,
          targetRect,
          targetSelector,
          options.extraNotificationSelectors
        );
        if (currentOccluding.length === 0) break;
      }

      if (currentOccluding.length === 0) {
        dismissedCount = Math.max(dismissedCount, initialOccluding.length);
        logs.push('Tier 1 succeeded (AUTO_DISMISS_ESCAPE): target is now unobstructed.');
        return {
          evaded: true,
          occludedInitially: true,
          tierUsed: 1,
          strategy: 'AUTO_DISMISS_ESCAPE',
          clickPoint: centerOfRect(targetRect),
          targetRect,
          occludingToasts: initialOccluding,
          dismissedCount,
          logs,
        };
      }
    }

    // ------------------------------------------------------------------------
    // TIER 2: SPATIAL EVASION (Exposed area >= 40% & >= 24x24px)
    // ------------------------------------------------------------------------
    const spatial = computeExposedSubRegion(
      targetRect,
      currentOccluding.map((t) => t.rect),
      { minExposedRatio, minExposedWidth, minExposedHeight }
    );

    if (spatial.meetsThreshold && spatial.safeClickPoint && spatial.bestSubRegion) {
      const pointValid = await verifyPointHitsTarget(
        page,
        spatial.safeClickPoint,
        currentOccluding.map((t) => t.selector),
        targetSelector
      );

      if (pointValid) {
        logs.push(
          `Tier 2 succeeded (SPATIAL_EVASION): exposed ${(spatial.exposedRatio * 100).toFixed(1)}% (${Math.round(
            spatial.bestSubRegion.width
          )}x${Math.round(spatial.bestSubRegion.height)}px), shifted click to (${Math.round(
            spatial.safeClickPoint.x
          )}, ${Math.round(spatial.safeClickPoint.y)}).`
        );
        return {
          evaded: true,
          occludedInitially: true,
          tierUsed: 2,
          strategy: 'SPATIAL_EVASION',
          clickPoint: spatial.safeClickPoint,
          targetRect,
          occludingToasts: initialOccluding,
          dismissedCount,
          exposedRatio: spatial.exposedRatio,
          exposedRegion: spatial.bestSubRegion,
          logs,
        };
      }
    } else {
      logs.push(
        `Tier 2 skipped: exposed ratio ${(spatial.exposedRatio * 100).toFixed(1)}% below threshold (${(
          minExposedRatio * 100
        ).toFixed(0)}% & >= ${minExposedWidth}x${minExposedHeight}px).`
      );
    }

    // ------------------------------------------------------------------------
    // TIER 3: SMART TTL DRAIN (Wait for auto-expiring toast to vanish naturally)
    // ------------------------------------------------------------------------
    if (ttlDrainTimeoutMs > 0) {
      const drainStart = Date.now();
      logs.push(`Tier 3: Waiting up to ${ttlDrainTimeoutMs}ms for toast TTL natural expiration...`);

      while (Date.now() - drainStart < ttlDrainTimeoutMs) {
        await new Promise((r) => setTimeout(r, ttlPollIntervalMs));
        currentOccluding = await detectOccludingToasts(
          page,
          targetRect,
          targetSelector,
          options.extraNotificationSelectors
        );
        if (currentOccluding.length === 0) {
          const drainedMs = Date.now() - drainStart;
          logs.push(`Tier 3 succeeded (SMART_TTL_DRAIN): toast vanished naturally after ${drainedMs}ms.`);
          return {
            evaded: true,
            occludedInitially: true,
            tierUsed: 3,
            strategy: 'SMART_TTL_DRAIN',
            clickPoint: centerOfRect(targetRect),
            targetRect,
            occludingToasts: initialOccluding,
            dismissedCount,
            drainedMs,
            logs,
          };
        }
      }

      logs.push(`Tier 3 timed out after ${Date.now() - drainStart}ms: ${currentOccluding.length} stubborn toast(s) remain.`);
    }

    // ------------------------------------------------------------------------
    // TIER 4: POINTER-EVENTS ISOLATION (Last resort with restore callback)
    // ------------------------------------------------------------------------
    if (allowPointerEventsIsolation && currentOccluding.length > 0) {
      const clickPt = centerOfRect(targetRect);
      const extraWrapperSelectors: string[] = [];

      // Check if an outer toast positioning wrapper (not containing target) also covers clickPt
      await ensureNameHelper(page);
      const wrapperMarker = `autotest-wrap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const wrapperCount = await page
        .evaluate(
          ({ pt, toastSels, tSel, marker }) => {
            const targetEl = tSel ? document.querySelector(tSel) : null;
            const toastEls: Element[] = [];
            for (let i = 0; i < toastSels.length; i++) {
              const el = document.querySelector(toastSels[i]);
              if (el) toastEls.push(el);
            }
            const stack = document.elementsFromPoint(pt.x, pt.y);
            let count = 0;
            for (let i = 0; i < stack.length; i++) {
              const layer = stack[i] as HTMLElement;
              if (layer === document.body || layer === document.documentElement) break;
              if (targetEl && (layer === targetEl || layer.contains(targetEl))) break;
              let wrapsToast = false;
              for (let j = 0; j < toastEls.length; j++) {
                if (layer !== toastEls[j] && layer.contains(toastEls[j])) {
                  wrapsToast = true;
                  break;
                }
              }
              if (wrapsToast) {
                layer.setAttribute('data-autotest-pe-wrapper', marker);
                count++;
              }
            }
            return count;
          },
          {
            pt: clickPt,
            toastSels: currentOccluding.map((t) => t.selector),
            tSel: targetSelector || null,
            marker: wrapperMarker,
          }
        )
        .catch(() => 0);

      if (wrapperCount > 0) {
        extraWrapperSelectors.push(`[data-autotest-pe-wrapper="${wrapperMarker}"]`);
      }

      const targetsToIsolate = [
        ...currentOccluding.map((t) => t.selector),
        ...extraWrapperSelectors,
      ];
      const handle = await applyToastPointerEventsIsolation(page, targetsToIsolate);

      const fullRestore = async (): Promise<void> => {
        await handle.restore();
        if (wrapperCount > 0) {
          await page
            .evaluate((m) => {
              const els = document.querySelectorAll(`[data-autotest-pe-wrapper="${m}"]`);
              for (let i = 0; i < els.length; i++) {
                els[i].removeAttribute('data-autotest-pe-wrapper');
              }
            }, wrapperMarker)
            .catch(() => {});
        }
      };

      const verified = await verifyPointHitsTarget(
        page,
        clickPt,
        targetsToIsolate,
        targetSelector
      );

      if (verified) {
        logs.push(
          `Tier 4 succeeded (POINTER_EVENTS_ISOLATION): isolated ${handle.isolatedCount} stubborn toast container(s).`
        );
        return {
          evaded: true,
          occludedInitially: true,
          tierUsed: 4,
          strategy: 'POINTER_EVENTS_ISOLATION',
          clickPoint: clickPt,
          targetRect,
          occludingToasts: initialOccluding,
          dismissedCount,
          isolatedSelectors: handle.isolatedSelectors,
          restore: fullRestore,
          logs,
        };
      }

      // Could not clear target even with isolation -> restore immediately and fail
      await fullRestore();
      logs.push('Tier 4 failed: target still occluded after pointer-events isolation (restored styles).');
    }

    return {
      evaded: false,
      occludedInitially: true,
      tierUsed: 0,
      strategy: 'FAILED',
      clickPoint: centerOfRect(targetRect),
      targetRect,
      occludingToasts: currentOccluding,
      dismissedCount,
      logs,
    };
  } finally {
    if (resolvedTarget.cleanup) {
      await resolvedTarget.cleanup();
    }
  }
}

/**
 * Convenience end-to-end helper: runs the 4-Tier Toast Evasion Ladder, executes a real
 * physical Playwright mouse click (`isTrusted: true`) at the safe click point, and
 * automatically restores Tier 4 `pointer-events` isolation in a `finally` block.
 */
export async function clickTargetWithToastEvasion(
  page: Page,
  target: TargetInput,
  options: ToastEvasionOptions = {}
): Promise<ClickWithEvasionResult> {
  const evasion = await evadeOccludingToasts(page, target, options);
  if (!evasion.evaded) {
    return {
      clicked: false,
      evasion,
      restoredPointerEvents: false,
    };
  }

  let clicked = false;
  let restoredPointerEvents = false;
  try {
    await page.mouse.click(evasion.clickPoint.x, evasion.clickPoint.y);
    clicked = true;
  } finally {
    if (evasion.restore) {
      await evasion.restore();
      restoredPointerEvents = true;
    }
  }

  return {
    clicked,
    evasion,
    restoredPointerEvents,
  };
}
