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
}

export type FailureReasonCode =
  | 'ELEMENT_NOT_FOUND'
  | 'ELEMENT_DISABLED'
  | 'ELEMENT_OBSCURED'
  | 'ASSERTION_MISMATCH'
  | 'EXECUTION_ERROR'
  | 'AMBIGUOUS_TARGET'
  | 'ANTYNOM_VIOLATION';

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

export interface StepLog {
  step: number;
  instruction: string;
  status: 'OK' | 'FAILED';
  detail: string;
  durationMs: number;
  dialogs?: CapturedDialog[];
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
}
