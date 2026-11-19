export type ActionType =
  | 'FILL'
  | 'CLICK'
  | 'HOVER'
  | 'SEARCH'
  | 'SELECT_ITEM'
  | 'SCROLL'
  | 'PRESS_KEY'
  | 'WAIT'
  | 'ASSERT_TEXT'
  | 'ASSERT_URL'
  | 'ASSERT_NOT_TEXT'
  | 'ASSERT_DISABLED'
  | 'SELECT_OPTION'
  | 'CHECK'
  | 'UNCHECK'
  | 'UPLOAD_FILE'
  | 'HANDLE_DIALOG'
  | 'NAVIGATE_BACK'
  | 'RELOAD'
  | 'SWITCH_TAB';

export interface AtomicAction {
  /** Số thứ tự bước gốc trong kịch bản (1..N) */
  stepNumber: number;
  /** Thứ tự hành động con nếu bước gốc là bước gộp (VD: Bước 11 có 11.1, 11.2, 11.3) */
  subIndex: number;
  /** Tổng số hành động con trong bước gốc */
  totalSubActions: number;
  /** Câu lệnh gốc bằng tiếng Việt của bước */
  rawStepText: string;
  /** Câu lệnh con đã tách */
  subInstruction: string;
  /** Loại thao tác nguyên tử */
  type: ActionType;
  /** Từ khóa mô tả phần tử mục tiêu (VD: "tài khoản", "Đăng nhập", "màu Đen") */
  targetHint?: string;
  /** Ngữ cảnh phụ (VD: "màu" khi chọn "Đen") */
  contextHint?: string;
  /** Giá trị cần điền (cho FILL / SEARCH / SELECT_OPTION) */
  value?: string;
  /** Chỉ số phần tử cần chọn (1-based, cho SELECT_ITEM) */
  itemIndex?: number;
  /** Nội dung chữ kỳ vọng (cho ASSERT_TEXT / ASSERT_NOT_TEXT) */
  expectedText?: string;
  /** Chuỗi URL kỳ vọng (cho ASSERT_URL) */
  expectedUrlPart?: string;
  /** Hướng cuộn trang (cho SCROLL) */
  scrollDirection?: 'DOWN' | 'UP' | 'BOTTOM' | 'TOP';
  /** Khoảng cách cuộn tính bằng pixel (cho SCROLL) */
  scrollAmount?: number;
  /** Tên phím nhấn (cho PRESS_KEY) */
  keyName?: string;
  /** Thời gian chờ tính bằng ms (cho WAIT) */
  waitMs?: number;
  /** Đường dẫn file đính kèm (cho UPLOAD_FILE) */
  filePath?: string;
  /** Thao tác với hộp thoại popup (cho HANDLE_DIALOG) */
  dialogAction?: 'ACCEPT' | 'DISMISS';
  /** Thao tác với tab trình duyệt (cho SWITCH_TAB) */
  tabAction?: 'NEW_TAB' | 'CLOSE_TAB';
}

export interface ElementFingerprint {
  tag: string;
  id?: string;
  name?: string;
  type?: string;
  role?: string;
  placeholder?: string;
  ariaLabel?: string;
  nearLabel?: string;
  text?: string;
  stableClasses: string[];
  selectorPath: string;
}

export interface DOMCandidate {
  /** ID tạm thời gắn vào thuộc tính data-autotest-id trên DOM */
  candidateId: number;
  tag: string;
  type?: string;
  role?: string;
  text: string;
  value?: string;
  placeholder?: string;
  name?: string;
  elemId?: string;
  href?: string;
  ariaLabel?: string;
  /** Nhãn không gian tìm được từ thẻ label/cha/anh em đứng cạnh (dành cho input không chuẩn) */
  nearLabel?: string;
  /** Ngữ cảnh nhóm (VD: tiêu đề khu vực "Màu sắc", "Kích thước") */
  groupContext?: string;
  /** Có phải là item trong danh sách sản phẩm lặp lại không */
  isCardItem?: boolean;
  cardIndex?: number;
  /** Chỉ số frame nếu phần tử nằm trong thẻ <iframe> */
  frameIndex?: number;
  frameUrl?: string;
  /** Trạng thái phần tử bị vô hiệu hóa */
  disabled: boolean;
  disabledReason?: string;
  /** Có bị phần tử khác (như modal/overlay) che khuất tâm không */
  obscured: boolean;
  obscuredBy?: string;
  rect: { x: number; y: number; width: number; height: number };
  selectorPath: string;
  fingerprint: ElementFingerprint;
  /** Prompt 12: Nhãn ngữ nghĩa ảo sinh từ Vector Path Structural Signature Bank */
  virtualLabel?: string;
  /** Prompt 12: Họ chữ ký hình học vector SVG (hamburger, chevron_left, chevron_right, sidebar_layout, close, search, settings) */
  svgIconFamily?: string;
  /** Prompt 12: Ngữ cảnh vị trí không gian của nút icon SVG (VD: "Sidebar Boundary Control") */
  svgContext?: string;
  /** Prompt 12: Điểm tổng hợp 4 trọng số SVG Topology (0..1) */
  svgScore?: number;
  /** Prompt 12: Chuỗi outerHTML của thẻ <svg> bên trong ứng viên không nhãn */
  svgMarkup?: string;
  /** Prompt 12: Thuộc tính aria-expanded ("true" | "false") */
  ariaExpanded?: string;
  /** Prompt 12: Thuộc tính aria-controls liên kết tới sidebar/menu/drawer */
  ariaControls?: string;
  /** Prompt 12: Dữ liệu topology SVG đã trích xuất để resolver tái sử dụng trực tiếp */
  svgTopologyData?: any;
  /** Prompt 10: Phần tử có nằm trong Safe Viewport Band [H_top + 20px, VH - H_bottom - 20px] không */
  inSafeViewportBand?: boolean;
  /** Prompt 10: Trạng thái che khuất từ bộ Hit-Test đa điểm 5 điểm */
  occlusionStatus?: 'EXPOSED' | 'PARTIALLY_OCCLUDED' | 'FULLY_OCCLUDED';
  /** Prompt 10: Tọa độ click vật lý an toàn đã dịch chuyển sang vùng hở (isTrusted: true) */
  safeClickPoint?: { x: number; y: number };
}

export type FailureReasonCode =
  | 'ELEMENT_NOT_FOUND'
  | 'ELEMENT_DISABLED'
  | 'ELEMENT_OBSCURED'
  | 'ASSERTION_MISMATCH'
  | 'EXECUTION_ERROR'
  | 'AMBIGUOUS_TARGET'
  | 'ANTYNOM_VIOLATION'
  | 'CIRCUIT_BREAKER_TRIGGERED'
  | 'DEADLOCK_LOOP_DETECTED';

export interface CapturedDialog {
  type: 'alert' | 'beforeunload' | 'confirm' | 'prompt';
  message: string;
  defaultValue?: string;
  actionTaken: 'accept' | 'dismiss';
  promptInput?: string;
  warning?: string;
  timestamp: number;
  stepNumber?: number;
}

export interface XAIDecision {
  chosenElement?: string;
  healedIntent?: string;
  damerauDistance?: number;
  confidence?: number;
  deltaMargin?: number;
  criticVerdict?: 'APPROVED' | 'REJECTED' | string;
  reasoning?: string;
  matchSource?: string;
  flag?: string;
  /** Prompt 14: Tầng định tuyến AI đã giải quyết (L1 Fast-Path / L2 Typo & Antonym / L3 Vision SoM) */
  routingTier?: 'L1' | 'L2' | 'L3';
  /** Prompt 14: Mã số Mark ID Set-of-Marks [1], [2]... khi dùng Vision SoM */
  somMarkId?: number;
  /** Prompt 14: Chi phí ước tính USD của bước định tuyến */
  estimatedCostUsd?: number;
  /** Prompt 14: Độ trễ định tuyến (ms) */
  routingLatencyMs?: number;
  /** Prompt 10: Chiến lược xử lý che khuất vật lý (CENTER / SAFE_CORNER / POLYGON_CENTROID / SAFE_BAND_SCROLL) */
  occlusionStrategy?: string;
  /** Prompt 11: Danh sách lớp phủ treo đã được tự động giải phóng ngầm định */
  dismissedOverlays?: string[];
  /** Prompt 13: Phán quyết của Notification Oracle (SUCCESS_EVIDENCE / IGNORED / WARNING_LOGGED / EXPECTED_PASS / PRODUCT_DEFECT) */
  notificationVerdict?: string;
  /** Prompt 13: Các cảnh báo WARNING ghi nhận được (không đánh trượt kịch bản) */
  notificationWarnings?: string[];
}

export type XAIAuditDecision = XAIDecision;

export interface AIForensicAutopsy {
  verdictCategory: string;
  rootCause: string;
  recommendation: string;
  failureCode?: string;
  suggestedRemediation?: string;
  confidence?: number;
}

export interface StepAuditTrail {
  stepNumber: number;
  action: string;
  targetHint?: string;
  decision?: XAIDecision;
  quiescenceWaitMs?: number;
  screenshotPath?: string;
  domHash?: string;
  autopsy?: AIForensicAutopsy;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface StepLog {
  step: number;
  instruction: string;
  status: 'OK' | 'FAILED';
  detail: string;
  durationMs: number;
  dialogs?: CapturedDialog[];
  domHash?: string;
  aiAuditTrail?: StepAuditTrail;
  screenshotPath?: string;
  /** Prompt 14: Tầng định tuyến L1 / L2 / L3 */
  routingTier?: 'L1' | 'L2' | 'L3';
  /** Prompt 14: Mã số Mark ID Set-of-Marks nếu dùng Vision SoM */
  somMarkId?: number;
  /** Prompt 10: Chiến lược xử lý che khuất vật lý */
  occlusionStrategy?: string;
  /** Prompt 11: Các lớp phủ treo đã tự động dọn dẹp */
  dismissedOverlays?: string[];
  /** Prompt 13: Phán quyết thông báo IEEE 29119 */
  notificationVerdict?: string;
  /** Prompt 13: Nhật ký cảnh báo màu vàng (WARNING) */
  notificationWarnings?: string[];
}

export interface TestRunResult {
  status: 'PASSED' | 'FAILED';
  url: string;
  totalSteps: number;
  completedSteps: number;
  summary: string;
  failedStep?: number;
  reasonCode?: FailureReasonCode;
  reasonDetail?: string;
  screenshotPath: string;
  totalDurationMs: number;
  logs: StepLog[];
  dialogs?: CapturedDialog[];
  circuitBreakerTripped?: boolean;
  reportPath?: string;
  steps?: any[];
  aiAuditTrail?: StepAuditTrail[];
}
