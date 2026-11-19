import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { chromium, Page, BrowserContext, Frame } from 'playwright';
import {
  AtomicAction,
  CapturedDialog,
  DOMCandidate,
  FailureReasonCode,
  StepLog,
  TestRunResult,
  XAIDecision,
  StepAuditTrail,
  AIForensicAutopsy,
} from './types';
import { compileVietnameseScenarioAsync } from './step-parser';
import { distillPageDOM } from './dom-distiller';
import {
  ActionSettlementBarrier,
  NotificationStepContext,
  NotificationOracleReport,
  DismissalResult,
} from './settlement-barrier';
import {
  resolveTargetCandidate,
  ResolveCandidateResult,
  isCustomSelectTrigger,
  isPortalOption,
  resolvePortalOptionCandidate,
  FLOATING_PORTAL_SELECTORS,
  computeDamerauSimilarity,
} from './element-resolver';
import { LLMBridge } from './llm-bridge';
import {
  scrollIntoSafeViewportBand,
  resolveSafeClickPoint,
  SafeClickResolution,
} from './occlusion-engine';
import { probeHoverTooltip, SvgIconCandidateInput } from './svg-icon-topology';

export interface PhysicalActionTelemetry {
  occlusionStrategy?: string;
  dismissedOverlays?: string[];
  notificationVerdict?: string;
  notificationWarnings?: string[];
  resolvedClickPoint?: { x: number; y: number };
}

function buildNotificationStepContext(
  action: AtomicAction,
  rawStepText: string,
  nextRawStepText?: string,
  nextSubActions?: AtomicAction[]
): NotificationStepContext {
  const expectedErrorTexts: string[] = [];
  if (action.expectedText) {
    expectedErrorTexts.push(action.expectedText);
  }
  if (nextSubActions) {
    for (const na of nextSubActions) {
      if (na.type === 'ASSERT_TEXT' && na.expectedText) {
        expectedErrorTexts.push(na.expectedText);
      }
    }
  }
  return {
    action,
    upcomingActions: nextSubActions && nextSubActions.length > 0 ? nextSubActions : undefined,
    stepText: nextRawStepText ? `${rawStepText} | ${nextRawStepText}` : rawStepText,
    expectedErrorTexts: expectedErrorTexts.length > 0 ? expectedErrorTexts : undefined,
    stepNumber: action.stepNumber,
  };
}

function extractDismissedOverlayLabels(res: DismissalResult | null | undefined): string[] {
  if (!res || res.dismissedCount <= 0) return [];
  const labels: string[] = [];
  for (const att of res.attempts || []) {
    if (att.succeeded) {
      labels.push(`${att.overlayKind}:${att.overlayId} (${att.tier})`);
    }
  }
  if (labels.length === 0 && res.summary) {
    labels.push(res.summary);
  }
  return labels;
}

function summarizeNotificationVerdict(
  report: NotificationOracleReport | null | undefined
): { verdict?: string; warnings: string[] } {
  if (!report) return { warnings: [] };
  const warnings = [...(report.warningLogs || [])];
  if (report.items.length === 0) {
    return { warnings };
  }
  if (report.productDefects.length > 0) {
    return { verdict: 'PRODUCT_DEFECT', warnings };
  }
  if (report.hasExpectedErrorMatch || report.overallVerdict === 'EXPECTED_PASS') {
    return { verdict: 'EXPECTED_PASS', warnings };
  }
  if (warnings.length > 0 || report.overallVerdict === 'PASS_WITH_WARNING') {
    return { verdict: 'WARNING_LOGGED', warnings };
  }
  if (report.successEvidences.length > 0) {
    return { verdict: 'SUCCESS_EVIDENCE', warnings };
  }
  if (report.ignoredInfos.length > 0) {
    return { verdict: 'IGNORED', warnings };
  }
  return { verdict: report.overallVerdict, warnings };
}

function isPotentialOverlayTrigger(candidate: DOMCandidate): boolean {
  if (!candidate || isPortalOption(candidate)) return false;
  if (isCustomSelectTrigger(candidate)) return true;
  if (candidate.ariaExpanded !== undefined || candidate.ariaControls !== undefined) return true;
  const role = (candidate.role || '').toLowerCase();
  if (role === 'combobox' || role === 'button' || role === 'menuitem') return true;
  const classes = (candidate.fingerprint?.stableClasses || []).join(' ').toLowerCase();
  if (/\b(dropdown|select|popover|menu|trigger|modal|dialog|open|toggle)\b/.test(classes)) {
    return true;
  }
  return candidate.tag === 'button';
}

export interface RunOptions {
  url: string;
  scenario?: string;
  actions?: AtomicAction[];
  outputDir?: string;
  casePrefix?: string;
  headless?: boolean;
  deadlockThreshold?: number;
}

export const RETRY_BACKOFF_MS = [500, 1500, 3000];

export interface StepDialogContext {
  stepNumber: number;
  stepText: string;
  subActions?: AtomicAction[];
  currentSubActionIndex?: number;
  nextStepText?: string;
  nextSubActions?: AtomicAction[];
}

export interface DialogInterceptorOptions {
  getContext?: () => StepDialogContext | undefined;
  onDialogHandled?: (dialog: CapturedDialog) => void;
  defaultPromptValue?: string;
  allowDismissOnCancel?: boolean;
}

/**
 * Trụ cột 7: Native Dialog Interceptor (Alert, Confirm, Prompt, BeforeUnload)
 * theo QUY_CHUAN_AI_RESOLVER.md:
 * - Lắng nghe toàn cục page.on('dialog') ngay khi khởi tạo trang.
 * - Tự động ghi lại loại dialog (alert, confirm, prompt, beforeunload), nội dung, giá trị mặc định.
 * - alert: Tự động dialog.accept() và lưu vào log execution.
 * - confirm: Nếu kịch bản mang tính khẳng định ("Xác nhận", "Đồng ý", "OK") -> dialog.accept().
 *            Nếu là "Hủy" hoặc không nhắc tới -> gọi dialog.accept() mặc định để giải phóng luồng,
 *            đồng thời đính kèm cảnh báo vào báo cáo.
 * - prompt: Tự động điền giá trị từ kịch bản hoặc chuỗi rỗng rồi accept().
 * - beforeunload: Tự động dialog.accept() để không cản trở quá trình điều hướng trang.
 * - Cung cấp API truy xuất lịch sử dialog đã bắt để phục vụ kiểm tra Assertion.
 */
export class NativeDialogInterceptor {
  private history: CapturedDialog[] = [];
  private pendingStepDialogs: CapturedDialog[] = [];
  private currentContext?: StepDialogContext;
  private options: DialogInterceptorOptions;
  public readonly page: Page;

  constructor(page: Page, options: DialogInterceptorOptions = {}) {
    this.page = page;
    this.options = options;
    (page as any).__nativeDialogInterceptor = this;
    this.setupListener();
  }

  private setupListener(): void {
    this.page.on('dialog', async (dialog) => {
      try {
        const dialogType = dialog.type() as 'alert' | 'beforeunload' | 'confirm' | 'prompt';
        const message = dialog.message() || '';
        const defaultValue = dialog.defaultValue() || '';
        const timestamp = Date.now();
        const ctx = this.currentContext || this.options.getContext?.();

        let actionTaken: 'accept' | 'dismiss' = 'accept';
        let promptInput: string | undefined = undefined;
        let warning: string | undefined = undefined;

        if (dialogType === 'alert') {
          await dialog.accept();
          actionTaken = 'accept';
        } else if (dialogType === 'beforeunload') {
          await dialog.accept();
          actionTaken = 'accept';
        } else if (dialogType === 'prompt') {
          // Lấy giá trị điền vào prompt từ kịch bản nếu có
          let valToFill = this.options.defaultPromptValue || '';
          if (ctx) {
            const curAct =
              ctx.subActions && ctx.currentSubActionIndex !== undefined
                ? ctx.subActions[ctx.currentSubActionIndex]
                : undefined;
            const nextAct =
              ctx.subActions &&
              ctx.currentSubActionIndex !== undefined &&
              ctx.currentSubActionIndex + 1 < ctx.subActions.length
                ? ctx.subActions[ctx.currentSubActionIndex + 1]
                : ctx.nextSubActions?.[0];

            if (curAct?.value) {
              valToFill = curAct.value;
            } else if (nextAct?.value) {
              valToFill = nextAct.value;
            } else {
              const match = (ctx.nextStepText || ctx.stepText).match(/["'`]([^"'`]+)["'`]/);
              if (match) {
                valToFill = match[1];
              } else if (defaultValue) {
                valToFill = defaultValue;
              }
            }
          } else if (defaultValue) {
            valToFill = defaultValue;
          }

          promptInput = valToFill;
          await dialog.accept(valToFill);
          actionTaken = 'accept';
        } else if (dialogType === 'confirm') {
          let isAffirmative = false;
          let isCancel = false;

          if (ctx) {
            const remainingSubActions =
              ctx.subActions && ctx.currentSubActionIndex !== undefined
                ? ctx.subActions.slice(ctx.currentSubActionIndex + 1)
                : [];
            const candidates = [...remainingSubActions, ...(ctx.nextSubActions || [])];

            for (const act of candidates) {
              if (act.dialogAction === 'ACCEPT') isAffirmative = true;
              if (act.dialogAction === 'DISMISS') isCancel = true;
              const target = (act.targetHint || act.subInstruction || '').toLowerCase();
              if (/(?:xác\s*nhận|đồng\s*ý|ok|chấp\s*nhận|accept|yes)/i.test(target)) isAffirmative = true;
              if (/(?:hủy|không|từ\s*chối|bỏ\s*qua|cancel|dismiss)/i.test(target)) isCancel = true;
            }

            const combinedText = `${ctx.stepText} ${ctx.nextStepText || ''}`.toLowerCase();
            if (/(?:xác\s*nhận|đồng\s*ý|ok|chấp\s*nhận|accept|yes)\b/i.test(combinedText)) {
              isAffirmative = true;
            }
            if (/(?:hủy|không|từ\s*chối|bỏ\s*qua|cancel|dismiss)\b/i.test(combinedText)) {
              isCancel = true;
            }
          }

          if (isAffirmative) {
            await dialog.accept();
            actionTaken = 'accept';
          } else if (isCancel && this.options.allowDismissOnCancel) {
            await dialog.dismiss();
            actionTaken = 'dismiss';
            warning = `[AI WARNING] Hộp thoại confirm "${message}" đã được hủy (dismiss) theo yêu cầu kịch bản.`;
          } else {
            // Quy chuẩn: "nếu là 'Hủy' hoặc không nhắc tới -> gọi dialog.accept() mặc định để giải phóng luồng, đồng thời đính kèm cảnh báo vào báo cáo."
            await dialog.accept();
            actionTaken = 'accept';
            const reason = isCancel
              ? 'Kịch bản đề cập Hủy nhưng dialog được accept mặc định để giải phóng luồng'
              : 'Hộp thoại bất ngờ / kịch bản không nhắc tới';
            warning = `[AI WARNING: Native Dialog (confirm) auto-accepted: "${message}" (${reason})]`;
          }
        }

        const record: CapturedDialog = {
          type: dialogType,
          message,
          defaultValue: defaultValue || undefined,
          actionTaken,
          promptInput,
          warning,
          timestamp,
          stepNumber: ctx?.stepNumber,
        };

        this.history.push(record);
        this.pendingStepDialogs.push(record);
        this.options.onDialogHandled?.(record);
      } catch {
        // ignore
      }
    });
  }

  public getHistory(): CapturedDialog[] {
    return [...this.history];
  }

  public getLastDialog(): CapturedDialog | undefined {
    return this.history.length > 0 ? this.history[this.history.length - 1] : undefined;
  }

  public clearHistory(): void {
    this.history = [];
    this.pendingStepDialogs = [];
  }

  public getHistoryForStep(stepNumber: number): CapturedDialog[] {
    return this.history.filter((d) => d.stepNumber === stepNumber);
  }

  public findDialog(predicate: (d: CapturedDialog) => boolean): CapturedDialog | undefined {
    return this.history.find(predicate);
  }

  public filterDialogs(predicate: (d: CapturedDialog) => boolean): CapturedDialog[] {
    return this.history.filter(predicate);
  }

  public hasCapturedMatchingMessage(textOrRegex: string | RegExp): boolean {
    if (typeof textOrRegex === 'string') {
      const lower = textOrRegex.toLowerCase();
      return this.history.some((d) => d.message.toLowerCase().includes(lower));
    }
    return this.history.some((d) => textOrRegex.test(d.message));
  }

  public setCurrentStepContext(ctx: StepDialogContext): void {
    this.currentContext = ctx;
  }

  public consumePendingStepDialogs(): CapturedDialog[] {
    const list = [...this.pendingStepDialogs];
    this.pendingStepDialogs = [];
    return list;
  }
}

const pageInterceptorMap = new WeakMap<Page, NativeDialogInterceptor>();

export function attachDialogInterceptor(
  page: Page,
  options?: DialogInterceptorOptions
): NativeDialogInterceptor {
  let interceptor = pageInterceptorMap.get(page) || (page as any).__nativeDialogInterceptor;
  if (!interceptor) {
    interceptor = new NativeDialogInterceptor(page, options);
    pageInterceptorMap.set(page, interceptor);
  }
  return interceptor;
}

export function getCapturedDialogs(page: Page): CapturedDialog[] {
  const interceptor = pageInterceptorMap.get(page) || (page as any).__nativeDialogInterceptor;
  return interceptor ? interceptor.getHistory() : [];
}

export function getLastCapturedDialog(page: Page): CapturedDialog | undefined {
  const interceptor = pageInterceptorMap.get(page) || (page as any).__nativeDialogInterceptor;
  return interceptor ? interceptor.getLastDialog() : undefined;
}

export function clearCapturedDialogs(page: Page): void {
  const interceptor = pageInterceptorMap.get(page) || (page as any).__nativeDialogInterceptor;
  if (interceptor) {
    interceptor.clearHistory();
  }
}

export interface TabSwitchEvent {
  oldPageUrl: string;
  newPageUrl: string;
  newPageTitle: string;
  timestamp: number;
  reason: 'OPENED_BY_ACTION' | 'EXPLICIT_SWITCH' | 'CHILD_CLOSED';
}

export interface MultiTabManagerOptions {
  onTabSwitched?: (event: TabSwitchEvent) => void;
  autoSwitchOnNewTab?: boolean;
}

/**
 * Trụ cột 8: Multi-Tab Manager & Context Switcher
 * theo QUY_CHUAN_AI_RESOLVER.md:
 * - Lắng nghe sự kiện tab mới ở cấp độ Browser Context: context.on('page').
 * - Tự động đợi tab mới sẵn sàng (domcontentloaded).
 * - Tự động chuyển con trỏ hoạt động chính (activePage) sang tab mới.
 * - Log: [TAB SWITCH] Chuyển ngữ cảnh sang Tab mới: ${title} (${url}).
 * - Quản lý vòng đời tab: Cho phép runner đóng tab con và quay về tab gốc (parentPage).
 * - Bảo đảm khi chụp màn hình và phân tích element luôn thao tác trên tab đang active.
 */
export class MultiTabManager {
  private context: BrowserContext;
  private parentPage: Page;
  private activePage: Page;
  private switchHistory: TabSwitchEvent[] = [];
  private pendingLogMessages: string[] = [];
  private options: MultiTabManagerOptions;
  private pendingTransitions: Promise<void>[] = [];

  constructor(
    context: BrowserContext,
    initialPage: Page,
    options: MultiTabManagerOptions = {}
  ) {
    this.context = context;
    this.parentPage = initialPage;
    this.activePage = initialPage;
    this.options = { autoSwitchOnNewTab: true, ...options };
    (context as any).__multiTabManager = this;
    this.setupListener();
  }

  private setupListener(): void {
    this.context.on('page', (newPage) => {
      const transition = (async () => {
        try {
          // Đảm bảo tab mới có helper __name và barrier / dialog interceptor
          attachDialogInterceptor(newPage);
          const newBarrier = getOrCreateBarrier(newPage);

          await newPage.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
          await newBarrier.ensureInPageObserver().catch(() => {});

          if (this.options.autoSwitchOnNewTab !== false) {
            const oldUrl = this.activePage ? this.activePage.url() : '';
            await newPage.bringToFront().catch(() => {});
            this.activePage = newPage;

            const title = (await newPage.title().catch(() => '')) || 'Tab mới';
            const url = newPage.url();
            const logMsg = `[TAB SWITCH] Chuyển ngữ cảnh sang Tab mới: ${title} (${url})`;
            this.pendingLogMessages.push(logMsg);

            const event: TabSwitchEvent = {
              oldPageUrl: oldUrl,
              newPageUrl: url,
              newPageTitle: title,
              timestamp: Date.now(),
              reason: 'OPENED_BY_ACTION',
            };
            this.switchHistory.push(event);
            this.options.onTabSwitched?.(event);
          }

          // Lắng nghe sự kiện tab đóng ngoài ý muốn hoặc do web tự close()
          newPage.on('close', async () => {
            if (this.activePage === newPage) {
              const remaining = this.getOpenPages();
              this.activePage = remaining.length > 0 ? remaining[remaining.length - 1] : this.parentPage;
              if (!this.activePage.isClosed()) {
                await this.activePage.bringToFront().catch(() => {});
                const logMsg = `[TAB SWITCH] Tab con đã đóng, chuyển ngữ cảnh về: ${this.activePage.url()}`;
                this.pendingLogMessages.push(logMsg);
                const event: TabSwitchEvent = {
                  oldPageUrl: newPage.url(),
                  newPageUrl: this.activePage.url(),
                  newPageTitle: (await this.activePage.title().catch(() => '')) || '',
                  timestamp: Date.now(),
                  reason: 'CHILD_CLOSED',
                };
                this.switchHistory.push(event);
                this.options.onTabSwitched?.(event);
              }
            }
          });
        } catch {
          // ignore
        }
      })();

      this.pendingTransitions.push(transition);
      transition.finally(() => {
        const idx = this.pendingTransitions.indexOf(transition);
        if (idx !== -1) {
          this.pendingTransitions.splice(idx, 1);
        }
      });
    });
  }

  public async waitForPendingTransitions(timeoutMs = 3000): Promise<void> {
    // Cho phép event loop đón sự kiện context.on('page') từ Chromium IPC
    await new Promise((r) => setTimeout(r, 200));
    if (this.pendingTransitions.length === 0) return;
    await Promise.race([
      Promise.all([...this.pendingTransitions]),
      new Promise((r) => setTimeout(r, timeoutMs)),
    ]);
  }

  public async waitForPageCount(expectedCount: number, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (this.getOpenPages().length < expectedCount && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await this.waitForPendingTransitions(timeoutMs);
  }

  public getActivePage(): Page {
    if (this.activePage.isClosed()) {
      const openPages = this.context.pages().filter((p) => !p.isClosed());
      this.activePage = openPages.length > 0 ? openPages[openPages.length - 1] : this.parentPage;
    }
    return this.activePage;
  }

  public getParentPage(): Page {
    return this.parentPage;
  }

  public getOpenPages(): Page[] {
    return this.context.pages().filter((p) => !p.isClosed());
  }

  public getSwitchHistory(): TabSwitchEvent[] {
    return [...this.switchHistory];
  }

  public consumePendingLogMessages(): string[] {
    const list = [...this.pendingLogMessages];
    this.pendingLogMessages = [];
    return list;
  }

  public async switchToTab(targetPage: Page, reason: TabSwitchEvent['reason'] = 'EXPLICIT_SWITCH'): Promise<void> {
    if (targetPage.isClosed()) return;
    const oldUrl = this.activePage.url();
    await targetPage.bringToFront().catch(() => {});
    this.activePage = targetPage;
    const title = (await targetPage.title().catch(() => '')) || '';
    const url = targetPage.url();
    const logMsg = `[TAB SWITCH] Chuyển ngữ cảnh sang Tab: ${title} (${url})`;
    this.pendingLogMessages.push(logMsg);

    const event: TabSwitchEvent = {
      oldPageUrl: oldUrl,
      newPageUrl: url,
      newPageTitle: title,
      timestamp: Date.now(),
      reason,
    };
    this.switchHistory.push(event);
    this.options.onTabSwitched?.(event);
  }

  public async switchToParent(): Promise<void> {
    if (!this.parentPage.isClosed()) {
      await this.switchToTab(this.parentPage, 'EXPLICIT_SWITCH');
    }
  }

  public async switchToLatestTab(): Promise<void> {
    const pages = this.getOpenPages();
    if (pages.length > 0) {
      const latest = pages[pages.length - 1];
      if (latest !== this.activePage) {
        await this.switchToTab(latest, 'EXPLICIT_SWITCH');
      }
    }
  }

  public async closeCurrentTab(): Promise<void> {
    const isParent = this.activePage === this.parentPage;
    const current = this.activePage;

    if (!isParent && !current.isClosed()) {
      const oldUrl = current.url();
      await current.close().catch(() => {});
      await this.switchToParent();
      const logMsg = `[TAB SWITCH] Đã đóng tab con (${oldUrl}) và quay về Tab gốc: ${this.parentPage.url()}`;
      this.pendingLogMessages.push(logMsg);
    }
  }

  public getAllCapturedDialogs(): CapturedDialog[] {
    const list: CapturedDialog[] = [];
    const seen = new Set<CapturedDialog>();
    for (const p of this.context.pages()) {
      for (const d of getCapturedDialogs(p)) {
        if (!seen.has(d)) {
          seen.add(d);
          list.push(d);
        }
      }
    }
    return list.sort((a, b) => a.timestamp - b.timestamp);
  }
}

const contextTabManagerMap = new WeakMap<BrowserContext, MultiTabManager>();

export function attachMultiTabManager(
  context: BrowserContext,
  initialPage: Page,
  options?: MultiTabManagerOptions
): MultiTabManager {
  let mgr = contextTabManagerMap.get(context) || (context as any).__multiTabManager;
  if (!mgr) {
    mgr = new MultiTabManager(context, initialPage, options);
    contextTabManagerMap.set(context, mgr);
  }
  return mgr;
}

export function getTabManager(context: BrowserContext): MultiTabManager | undefined {
  return contextTabManagerMap.get(context) || (context as any).__multiTabManager;
}

const pageBarrierMap = new WeakMap<Page, ActionSettlementBarrier>();

export function getOrCreateBarrier(page: Page): ActionSettlementBarrier {
  let barrier = pageBarrierMap.get(page) || (page as any).__settlementBarrier;
  if (!barrier) {
    attachDialogInterceptor(page);
    barrier = new ActionSettlementBarrier(page);
    pageBarrierMap.set(page, barrier);
    (page as any).__settlementBarrier = barrier;
  }
  return barrier;
}

/**
 * Trụ cột 1 (Quiescence & Network Inflight) theo QUY_CHUAN_AI_RESOLVER.md:
 * - Theo dõi Inflight Network Requests: Đợi Inflight = 0 duy trì liên tục tối thiểu 300ms.
 * - Lắng nghe DOM Mutation: Đảm bảo không có node nào được thêm/xóa/sửa thuộc tính trong 200ms cuối.
 * - Kiểm tra Spinner/Skeleton: Đợi các selector phổ biến biến mất hoặc ẩn đi.
 */
export async function waitForUIQuiescence(
  page: Page,
  timeoutMs = 7000,
  barrier?: ActionSettlementBarrier
): Promise<void> {
  const b = barrier || getOrCreateBarrier(page);
  await b.waitForQuiescence(timeoutMs);
}

export interface VirtualScrollSearchOptions {
  stepPx?: number;
  maxSteps?: number;
  pauseWaitMs?: number;
  screenshotBase64?: string;
}

export interface VirtualScrollSearchResult {
  found: boolean;
  candidate: DOMCandidate | null;
  candidates: DOMCandidate[];
  resolved: ResolveCandidateResult | null;
  stepsScrolled: number;
  totalPxScrolled: number;
  hitBottom: boolean;
}

/**
 * Trụ cột 10: Virtualized List Incremental Scroll Engine
 * Theo đúng QUY_CHUAN_AI_RESOLVER.md (Mục 12):
 * - Khi phần tử mục tiêu không tìm thấy trong viewport hiện tại:
 *   - Không fail ngay; thực hiện cuộn phân đoạn (Step Scroll): Cuộn xuống 350px mỗi lần (tối đa 5 lần = 1750px).
 *   - Sau mỗi lần cuộn, nín thở 200ms để Virtual DOM / API nạp và mount node mới rồi quét lại danh sách candidates.
 *   - Nếu phát hiện thấy element xuất hiện, gọi element.scrollIntoViewIfNeeded() trước khi tương tác.
 *   - Điểm dừng chạm đáy (Bottom Boundary Cutoff): Nếu đã cuộn đến đáy trang mà phần tử vẫn không xuất hiện, hoặc hết 5 lần cuộn -> dừng lại fail-fast.
 */
export async function executeVirtualListScrollSearch(
  page: Page,
  action: AtomicAction,
  barrier: ActionSettlementBarrier,
  initialCandidates: DOMCandidate[],
  options: VirtualScrollSearchOptions = {}
): Promise<VirtualScrollSearchResult> {
  const stepPx = options.stepPx ?? 350;
  const maxSteps = options.maxSteps ?? 5;
  const pauseWaitMs = options.pauseWaitMs ?? 200;

  let currentCandidates = initialCandidates;
  let resolved = await resolveTargetCandidate(
    page.url(),
    action,
    currentCandidates,
    options.screenshotBase64,
    { page, enableVisionSoM: true }
  );

  if (resolved.candidate) {
    return {
      found: true,
      candidate: resolved.candidate,
      candidates: currentCandidates,
      resolved,
      stepsScrolled: 0,
      totalPxScrolled: 0,
      hitBottom: false,
    };
  }

  let stepsScrolled = 0;
  let totalPxScrolled = 0;
  let hitBottom = false;

  for (let step = 1; step <= maxSteps; step++) {
    // 1. Thực hiện cuộn từng nấc 350px (hỗ trợ cả Window và Container cuộn ảo)
    const scrollInfo = await page.evaluate((px) => {
      const scrollContainers = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.virtual-list, .virtual-scroll, [data-virtual-scroll], [role="listbox"], .rc-virtual-list-holder, .MuiAutocomplete-listbox, [style*="overflow"]'
        )
      ).filter((el) => {
        const style = window.getComputedStyle(el);
        const hasScroll =
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight;
        const rect = el.getBoundingClientRect();
        return hasScroll && rect.width > 50 && rect.height > 50 && rect.top < window.innerHeight && rect.bottom > 0;
      });

      let containerScrolled = false;
      let containerAtBottom = false;

      if (scrollContainers.length > 0) {
        const container = scrollContainers[scrollContainers.length - 1];
        const oldTop = container.scrollTop;
        container.scrollBy({ top: px, behavior: 'instant' });
        if (container.scrollTop > oldTop) {
          containerScrolled = true;
          containerAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 5;
        }
      }

      const prevWindowY = window.scrollY;
      window.scrollBy({ top: px, behavior: 'instant' });
      const windowScrolled = window.scrollY > prevWindowY;
      const windowAtBottom =
        window.scrollY + window.innerHeight >=
        Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - 10;

      return {
        didScroll: containerScrolled || windowScrolled,
        atBottom: containerAtBottom || (windowAtBottom && !containerScrolled),
      };
    }, stepPx).catch(() => ({ didScroll: false, atBottom: true }));

    stepsScrolled = step;
    totalPxScrolled += stepPx;
    hitBottom = scrollInfo.atBottom;

    // 2. Nín thở 200ms để DOM ảo mount node mới
    await new Promise((r) => setTimeout(r, pauseWaitMs));
    await waitForUIQuiescence(page, 300, barrier).catch(() => {});

    // 3. Quét lại danh sách candidates
    currentCandidates = await distillPageDOM(page, action.targetHint, action.contextHint);

    // 4. Đối soát lại candidate
    resolved = await resolveTargetCandidate(
      page.url(),
      action,
      currentCandidates,
      options.screenshotBase64,
      { page, enableVisionSoM: true }
    );

    if (resolved.candidate) {
      // Prompt 10: Cuộn phần tử vào chính giữa Safe Viewport Band (fallback scrollIntoViewIfNeeded)
      const targetFrame =
        resolved.candidate.frameIndex !== undefined &&
        resolved.candidate.frameIndex < page.frames().length
          ? page.frames()[resolved.candidate.frameIndex]
          : page;

      const frameArg: Frame | undefined = targetFrame !== page ? (targetFrame as Frame) : undefined;
      const safeScrollRes = await scrollIntoSafeViewportBand(page, resolved.candidate, {
        frame: frameArg,
      }).catch(() => null);

      if (!safeScrollRes || !safeScrollRes.inSafeBand) {
        const loc = targetFrame.locator(resolved.candidate.selectorPath).first();
        await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(async () => {
          await loc.evaluate((el) => {
            if (typeof (el as any).scrollIntoViewIfNeeded === 'function') {
              (el as any).scrollIntoViewIfNeeded();
            } else {
              el.scrollIntoView({ behavior: 'instant', block: 'center' });
            }
          }).catch(() => {});
        });
      }

      return {
        found: true,
        candidate: resolved.candidate,
        candidates: currentCandidates,
        resolved,
        stepsScrolled,
        totalPxScrolled,
        hitBottom,
      };
    }

    // Nếu đã chạm đáy (Bottom Boundary Cutoff) và không thể cuộn thêm, dừng lại
    if (hitBottom && !scrollInfo.didScroll) {
      break;
    }
  }

  return {
    found: false,
    candidate: null,
    candidates: currentCandidates,
    resolved,
    stepsScrolled,
    totalPxScrolled,
    hitBottom,
  };
}

export interface CustomDropdownOptions {
  portalTimeoutMs?: number;
  animationWaitMs?: number;
  autoCloseHangingMenu?: boolean;
}

export interface CustomDropdownResult {
  success: boolean;
  triggerClicked: boolean;
  portalFound: boolean;
  portalSelector?: string;
  optionFound: boolean;
  optionText?: string;
  menuClosed: boolean;
  error?: string;
}

/**
 * Trụ cột 11: Custom Select / Floating Dropdown Protocol (React-Select, Ant Design, MUI, Select2)
 * Theo đúng QUY_CHUAN_AI_RESOLVER.md (Mục 13):
 * - Pha 1: Click vào container trigger để mở popup menu.
 * - Pha 2: Chờ menu overlay xuất hiện tại cuối body (body > [role="listbox"], body > .ant-select-dropdown, .MuiAutocomplete-popper, v.v.).
 * - Pha 3: Tìm option bên trong overlay portal theo text cần chọn và click.
 * - Khôi phục khi menu treo: Nếu sau khi chọn mà menu không chịu biến mất (che khuất các nút bên dưới), tự động gửi phím Escape để đóng portal.
 */
export async function executeCustomDropdownProtocol(
  page: Page,
  barrier: ActionSettlementBarrier,
  trigger: DOMCandidate,
  optionText: string,
  options: CustomDropdownOptions = {}
): Promise<CustomDropdownResult> {
  const portalTimeoutMs = options.portalTimeoutMs ?? 3500;
  const animationWaitMs = options.animationWaitMs ?? 200;
  const autoCloseHanging = options.autoCloseHangingMenu !== false;

  const targetFrame =
    trigger.frameIndex !== undefined && trigger.frameIndex < page.frames().length
      ? page.frames()[trigger.frameIndex]
      : page;

  const triggerLocator = targetFrame.locator(trigger.selectorPath).first();

  // Pha 1: Cuộn trigger vào Safe Viewport Band, ghi nhận trigger cho Prompt 11 Tier 2 Re-Toggle, rồi click vật lý mở popup menu
  try {
    const frameArg: Frame | undefined = targetFrame !== page ? (targetFrame as Frame) : undefined;
    await scrollIntoSafeViewportBand(page, trigger, { frame: frameArg }).catch(async () => {
      await triggerLocator.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {});
    });
    barrier.recordOverlayTrigger(trigger);

    const safeTrigger = await resolveSafeClickPoint(page, trigger.rect, trigger, {
      autoScroll: false,
      frame: frameArg,
    }).catch(() => null);

    if (safeTrigger && safeTrigger.canClick && safeTrigger.clickPoint) {
      await page.mouse.move(safeTrigger.clickPoint.x, safeTrigger.clickPoint.y);
      await page.mouse.click(safeTrigger.clickPoint.x, safeTrigger.clickPoint.y);
    } else {
      await triggerLocator.click({ timeout: 5000 });
    }
  } catch (err: any) {
    return {
      success: false,
      triggerClicked: false,
      portalFound: false,
      optionFound: false,
      menuClosed: false,
      error: `Pha 1 thất bại: Không thể click vào trigger dropdown (${err?.message || String(err)})`,
    };
  }

  await waitForUIQuiescence(page, 200, barrier).catch(() => {});

  // Pha 2: Chờ menu overlay xuất hiện tại cuối body
  let matchedPortalSelector: string | undefined = undefined;
  const portalDeadline = Date.now() + portalTimeoutMs;

  while (Date.now() < portalDeadline) {
    const found = await page.evaluate((selectors) => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0'
        ) {
          return sel;
        }
      }
      return null;
    }, FLOATING_PORTAL_SELECTORS).catch(() => null);

    if (found) {
      matchedPortalSelector = found;
      break;
    }
    await new Promise((r) => setTimeout(r, 60));
  }

  // Nín thở 200ms để animation mở menu hoàn tất
  await new Promise((r) => setTimeout(r, animationWaitMs));
  await waitForUIQuiescence(page, 200, barrier).catch(() => {});

  // Pha 3: Tìm option bên trong overlay portal theo text cần chọn và click
  const clickRes = await page.evaluate(
    ({ portalSel, targetText }) => {
      const norm = (s: string | null | undefined) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const removeAccents = (str: string) =>
        str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

      const targetNorm = norm(targetText);
      const targetNoAcc = removeAccents(targetNorm);

      const portalRoot = portalSel ? document.querySelector(portalSel) : document.body;
      const root = portalRoot || document.body;

      const candidates = Array.from(
        root.querySelectorAll<HTMLElement>(
          '[role="option"], [role="menuitem"], .ant-select-item-option, .MuiAutocomplete-option, .MuiMenuItem-root, .select2-results__option, [class*="-option"], .dropdown-item, li, div, span'
        )
      ).filter((el) => {
        const r = el.getBoundingClientRect();
        const st = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden';
      });

      // 1. Khớp chính xác tuyệt đối
      for (const el of candidates) {
        const t = norm(el.innerText || el.textContent);
        if (t === targetNorm || removeAccents(t) === targetNoAcc) {
          el.scrollIntoView({ block: 'center' });
          el.click();
          return { clicked: true, text: t, method: 'EXACT' };
        }
      }

      // 2. Khớp chứa chuỗi / từ khóa
      for (const el of candidates) {
        const t = norm(el.innerText || el.textContent);
        if (t.includes(targetNorm) || removeAccents(t).includes(targetNoAcc)) {
          el.scrollIntoView({ block: 'center' });
          el.click();
          return { clicked: true, text: t, method: 'SUBSTRING' };
        }
      }

      return { clicked: false };
    },
    { portalSel: matchedPortalSelector, targetText: optionText }
  ).catch(() => ({ clicked: false }));

  let optionClicked = clickRes.clicked;

  // Fallback qua Playwright Locator nếu page.evaluate click chưa bắt được
  if (!optionClicked) {
    const rootLoc = matchedPortalSelector ? page.locator(matchedPortalSelector) : page;
    const optionLoc = rootLoc.locator(`text="${optionText}"`).first();
    if ((await optionLoc.count().catch(() => 0)) > 0) {
      await optionLoc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await optionLoc.click({ timeout: 3000 }).catch(() => {});
      optionClicked = true;
    }
  }

  if (!optionClicked) {
    return {
      success: false,
      triggerClicked: true,
      portalFound: !!matchedPortalSelector,
      portalSelector: matchedPortalSelector,
      optionFound: false,
      optionText,
      menuClosed: false,
      error: `Pha 3 thất bại: Không tìm thấy option khớp với "${optionText}" bên trong portal overlay (${matchedPortalSelector || 'không xác định'})`,
    };
  }

  await waitForUIQuiescence(page, 400, barrier).catch(() => {});

  // Khôi phục khi menu treo: kiểm tra portal còn mở không, nếu còn thì bấm Escape
  let menuClosed = true;
  if (matchedPortalSelector) {
    const isStillOpen = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      );
    }, matchedPortalSelector).catch(() => false);

    if (isStillOpen) {
      if (autoCloseHanging) {
        await page.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 150));
        const closedAfterEsc = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return true;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return !(
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
          );
        }, matchedPortalSelector).catch(() => true);
        menuClosed = closedAfterEsc;
      } else {
        menuClosed = false;
      }
    }
  }

  return {
    success: true,
    triggerClicked: true,
    portalFound: !!matchedPortalSelector,
    portalSelector: matchedPortalSelector,
    optionFound: true,
    optionText,
    menuClosed,
  };
}

// ============================================================================
// TRỤ CỘT 12: POST-FILL MASKED INPUT INTEGRITY VERIFICATION (PILLAR 12)
// ============================================================================

/**
 * Chuẩn hóa chuỗi bằng cách loại bỏ các ký tự định dạng tự sinh (khoảng trắng, gạch nối, dấu ngoặc).
 */
export function normalizeMaskedValue(str: string): string {
  if (!str) return '';
  return str.replace(/[\s\-\(\)]/g, '');
}

/**
 * Kiểm tra tính toàn vẹn của ô nhập liệu có mặt nạ (Masked Input):
 * Trả về true nếu actualVal chứa đủ các ký tự nghiệp vụ cần nhập từ expectedVal (sau khi đã chuẩn hóa).
 */
export function checkMaskedInputIntegrity(actualVal: string, expectedVal: string): boolean {
  if (!expectedVal) return true;
  if (actualVal === expectedVal) return true;

  const normActual = normalizeMaskedValue(actualVal);
  const normExpected = normalizeMaskedValue(expectedVal);

  if (normActual === normExpected) return true;
  if (normActual.includes(normExpected)) return true;

  // Kiểm tra xem tất cả các ký tự của normExpected có xuất hiện theo thứ tự trong normActual không
  let expIdx = 0;
  for (let i = 0; i < normActual.length && expIdx < normExpected.length; i++) {
    if (normActual[i] === normExpected[expIdx]) {
      expIdx++;
    }
  }
  return expIdx === normExpected.length;
}

// ============================================================================
// TRỤ CỘT 14: DEADLOCK WATCHDOG CIRCUIT BREAKER (PILLAR 14)
// ============================================================================

/**
 * Tính mã hash SHA-256 tóm tắt của DOM cây (URL + Document Title + Body Text Content).
 */
export async function computePageDomHash(page: Page): Promise<string> {
  try {
    const rawContent = await page.evaluate(() => {
      const href = window.location.href || '';
      const title = document.title || '';
      const text = document.body ? document.body.innerText || '' : '';
      return `${href}###${title}###${text}`;
    });
    return crypto.createHash('sha256').update(rawContent, 'utf8').digest('hex');
  } catch {
    return crypto.createHash('sha256').update(page.url() || 'about:blank', 'utf8').digest('hex');
  }
}

export interface WatchdogCycleRecord {
  cycle: number;
  hash: string;
  url: string;
  success: boolean;
  stepNumber?: number;
  actionType?: string;
  timestamp: number;
}

/**
 * Bộ ngắt mạch chống treo (Deadlock Watchdog Circuit Breaker):
 * - Theo dõi chuỗi trạng thái qua mã băm SHA-256 của DOM.
 * - Nếu trong 3 chu kỳ thao tác liên tiếp, mã hash hoàn toàn không đổi và hành động thất bại liên tục:
 *   -> Kích hoạt CIRCUIT_BREAKER_TRIGGERED để dừng khẩn cấp thay vì tiếp tục chạy vô nghĩa.
 */
export class DeadlockWatchdogCircuitBreaker {
  private lastHash: string = '';
  private consecutiveDeadlockCount: number = 0;
  private readonly threshold: number;
  private history: WatchdogCycleRecord[] = [];

  constructor(threshold = 3) {
    this.threshold = threshold;
  }

  public recordCycle(
    hash: string,
    success: boolean,
    metadata: { url?: string; stepNumber?: number; actionType?: string } = {}
  ): {
    tripped: boolean;
    consecutiveCount: number;
    hash: string;
  } {
    const record: WatchdogCycleRecord = {
      cycle: this.history.length + 1,
      hash,
      url: metadata.url || '',
      success,
      stepNumber: metadata.stepNumber,
      actionType: metadata.actionType,
      timestamp: Date.now(),
    };
    this.history.push(record);

    if (success) {
      // Thao tác thành công, reset bộ đếm kẹt
      this.consecutiveDeadlockCount = 0;
      this.lastHash = hash;
      return { tripped: false, consecutiveCount: 0, hash };
    }

    // Thao tác thất bại
    if (this.lastHash && this.lastHash === hash) {
      this.consecutiveDeadlockCount++;
    } else {
      this.consecutiveDeadlockCount = 1;
      this.lastHash = hash;
    }

    const tripped = this.consecutiveDeadlockCount >= this.threshold;
    return {
      tripped,
      consecutiveCount: this.consecutiveDeadlockCount,
      hash,
    };
  }

  public isTripped(): boolean {
    return this.consecutiveDeadlockCount >= this.threshold;
  }

  public getConsecutiveCount(): number {
    return this.consecutiveDeadlockCount;
  }

  public getLastHash(): string {
    return this.lastHash;
  }

  public getHistory(): WatchdogCycleRecord[] {
    return [...this.history];
  }

  public reset(): void {
    this.lastHash = '';
    this.consecutiveDeadlockCount = 0;
    this.history = [];
  }
}

/**
 * STRICT STEP-BY-STEP TEST RUNNER
 * - Chạy tuần tự từng bước 1..N theo đúng kịch bản.
 * - Tuyệt đối không tự ý đi đường vòng khi gặp lỗi.
 * - Dừng ngay tại bước gãy (Fail-Fast), hủy toàn bộ các bước phía sau.
 * - Chụp ảnh màn hình pass_step_N.png hoặc fail_step_X.png kèm đánh dấu trực quan trên giao diện.
 */
export async function runStrictTestScenario(options: RunOptions): Promise<TestRunResult> {
  const startTime = Date.now();
  const outputDir = options.outputDir || path.join(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const prefix = options.casePrefix ? `${options.casePrefix}_` : '';
  let compiled: {
    totalSteps: number;
    rawSteps: { stepNumber: number; text: string }[];
    atomicActions: AtomicAction[];
  };

  if (options.actions && options.actions.length > 0) {
    const rawStepsMap = new Map<number, string>();
    for (const act of options.actions) {
      if (!rawStepsMap.has(act.stepNumber)) {
        rawStepsMap.set(
          act.stepNumber,
          act.rawStepText || act.subInstruction || `${act.type} ${act.targetHint || ''}`
        );
      }
    }
    const rawSteps = Array.from(rawStepsMap.entries()).map(([stepNumber, text]) => ({
      stepNumber,
      text,
    }));
    compiled = {
      totalSteps: rawSteps.length,
      rawSteps,
      atomicActions: options.actions,
    };
  } else {
    compiled = await compileVietnameseScenarioAsync(options.scenario || '');
  }

  const logs: StepLog[] = [];

  function finalizeResult(res: TestRunResult): TestRunResult {
    const reportPath = path.join(outputDir, 'report.json');
    try {
      const reportData = {
        ...res,
        steps: res.logs.map((l) => ({
          stepNumber: l.step,
          instruction: l.instruction,
          status: l.status,
          action: l.aiAuditTrail?.action || 'UNKNOWN',
          targetHint: l.aiAuditTrail?.targetHint,
          decision: l.aiAuditTrail?.decision,
          quiescenceWaitMs: l.aiAuditTrail?.quiescenceWaitMs || l.durationMs,
          screenshotPath: l.screenshotPath || l.aiAuditTrail?.screenshotPath || res.screenshotPath,
          domHash: l.domHash,
          autopsy: l.aiAuditTrail?.autopsy,
          detail: l.detail,
          durationMs: l.durationMs,
          boundingBox: l.aiAuditTrail?.boundingBox,
          routingTier: l.routingTier || l.aiAuditTrail?.decision?.routingTier,
          somMarkId: l.somMarkId ?? l.aiAuditTrail?.decision?.somMarkId,
          occlusionStrategy: l.occlusionStrategy || l.aiAuditTrail?.decision?.occlusionStrategy,
          dismissedOverlays: l.dismissedOverlays || l.aiAuditTrail?.decision?.dismissedOverlays,
          notificationVerdict: l.notificationVerdict || l.aiAuditTrail?.decision?.notificationVerdict,
          notificationWarnings: l.notificationWarnings || l.aiAuditTrail?.decision?.notificationWarnings,
        })),
        aiAuditTrail: res.logs.map((l) => l.aiAuditTrail).filter(Boolean),
      };
      fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2), 'utf-8');
      res.reportPath = reportPath;
      res.steps = reportData.steps;
      res.aiAuditTrail = reportData.aiAuditTrail as StepAuditTrail[];
    } catch {
      // ignore
    }
    return res;
  }

  const browser = await chromium.launch({
    headless: options.headless !== false,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });

  // Tương thích với esbuild/tsx keepNames helper (__name) khi truyền hàm vào page.evaluate
  await context.addInitScript(() => {
    try {
      (window as any).__name = (globalThis as any).__name = (fn: unknown) => fn;
    } catch {}
  });

  const page = await context.newPage();
  const tabManager = attachMultiTabManager(context, page);
  const dialogInterceptor = attachDialogInterceptor(page);
  const barrier = getOrCreateBarrier(page);
  const deadlockWatchdog = new DeadlockWatchdogCircuitBreaker(options.deadlockThreshold || 3);

  try {
    // Mở URL mục tiêu và đợi trang ổn định
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await barrier.ensureInPageObserver();
    await waitForUIQuiescence(page, 7000, barrier);

    // Gom nhóm các AtomicAction theo stepNumber gốc (1..N)
    const stepGroups = new Map<number, AtomicAction[]>();
    for (const act of compiled.atomicActions) {
      const list = stepGroups.get(act.stepNumber) || [];
      list.push(act);
      stepGroups.set(act.stepNumber, list);
    }

    let completedSteps = 0;

    for (let stepIndex = 0; stepIndex < compiled.rawSteps.length; stepIndex++) {
      const rawStep = compiled.rawSteps[stepIndex];
      const stepNum = rawStep.stepNumber;
      const subActions = stepGroups.get(stepNum) || [];
      const stepStart = Date.now();
      const subDetails: string[] = [];
      let stepAuditTrail: StepAuditTrail | undefined = undefined;
      let stepRoutingTier: 'L1' | 'L2' | 'L3' | undefined = undefined;
      let stepSomMarkId: number | undefined = undefined;
      let stepOcclusionStrategy: string | undefined = undefined;
      const stepDismissedOverlays: string[] = [];
      let stepNotificationVerdict: string | undefined = undefined;
      const stepNotificationWarnings: string[] = [];

      const nextRawStep = compiled.rawSteps[stepIndex + 1];
      const nextSubActions = nextRawStep ? stepGroups.get(nextRawStep.stepNumber) || [] : [];

      await tabManager.waitForPendingTransitions(1000);
      const preStepTabLogs = tabManager.consumePendingLogMessages();
      if (preStepTabLogs.length > 0) {
        subDetails.push(...preStepTabLogs);
      }

      const activePage = tabManager.getActivePage();
      const activeBarrier = getOrCreateBarrier(activePage);
      const activeDialogInterceptor = attachDialogInterceptor(activePage);
      await activeBarrier.ensureInPageObserver().catch(() => {});

      activeDialogInterceptor.setCurrentStepContext({
        stepNumber: stepNum,
        stepText: rawStep.text,
        subActions,
        nextStepText: nextRawStep?.text,
        nextSubActions,
      });

      // Đảm bảo UI tĩnh trước khi thực hiện bước mới
      await waitForUIQuiescence(activePage, 7000, activeBarrier);

      for (let subIdx = 0; subIdx < subActions.length; subIdx++) {
        const action = subActions[subIdx];

        await tabManager.waitForPendingTransitions(800);
        const midActionTabLogs = tabManager.consumePendingLogMessages();
        if (midActionTabLogs.length > 0) {
          subDetails.push(...midActionTabLogs);
        }

        const currentActivePage = tabManager.getActivePage();
        const currentBarrier = getOrCreateBarrier(currentActivePage);
        const currentDialogInterceptor = attachDialogInterceptor(currentActivePage);
        await currentBarrier.ensureInPageObserver().catch(() => {});

        currentDialogInterceptor.setCurrentStepContext({
          stepNumber: stepNum,
          stepText: rawStep.text,
          subActions,
          currentSubActionIndex: subIdx,
          nextStepText: nextRawStep?.text,
          nextSubActions,
        });

        // --- LOẠI 1: BƯỚC CHỜ (WAIT) ---
        if (action.type === 'WAIT') {
          const ms = action.waitMs || 1000;
          await new Promise((r) => setTimeout(r, ms));
          await waitForUIQuiescence(tabManager.getActivePage(), 7000, getOrCreateBarrier(tabManager.getActivePage()));
          subDetails.push(`Đã chờ ${ms}ms`);
          continue;
        }

        // --- LOẠI 2: CUỘN TRANG (SCROLL) ---
        if (action.type === 'SCROLL') {
          const p = tabManager.getActivePage();
          const b = getOrCreateBarrier(p);
          if (action.scrollDirection === 'BOTTOM') {
            await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
            subDetails.push('Đã cuộn xuống cuối trang');
          } else if (action.scrollDirection === 'TOP') {
            await p.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
            subDetails.push('Đã cuộn lên đầu trang');
          } else if (action.scrollDirection === 'UP') {
            const amt = action.scrollAmount || 600;
            await p.evaluate((y) => window.scrollBy({ top: -y, behavior: 'smooth' }), amt).catch(() => {});
            subDetails.push(`Đã cuộn lên ${amt}px`);
          } else {
            const amt = action.scrollAmount || 600;
            await p.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), amt).catch(() => {});
            subDetails.push(`Đã cuộn xuống ${amt}px`);
          }
          await waitForUIQuiescence(p, 2000, b);
          continue;
        }

        // --- LOẠI 3: NHẤN PHÍM BÀN PHÍM (PRESS_KEY) ---
        if (action.type === 'PRESS_KEY') {
          const p = tabManager.getActivePage();
          const b = getOrCreateBarrier(p);
          const key = action.keyName || 'Enter';
          await p.keyboard.press(key);
          await waitForUIQuiescence(p, 3000, b);
          subDetails.push(`Đã nhấn phím ${key}`);
          continue;
        }

        // --- LOẠI 4: QUAY LẠI / TẢI LẠI TRANG (NAVIGATE_BACK / RELOAD) ---
        if (action.type === 'NAVIGATE_BACK') {
          const p = tabManager.getActivePage();
          const b = getOrCreateBarrier(p);
          await p.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
          await waitForUIQuiescence(p, 5000, b);
          subDetails.push('Đã quay lại trang trước');
          continue;
        }
        if (action.type === 'RELOAD') {
          const p = tabManager.getActivePage();
          const b = getOrCreateBarrier(p);
          await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
          await waitForUIQuiescence(p, 5000, b);
          subDetails.push('Đã tải lại trang');
          continue;
        }

        // --- LOẠI 5: CHUYỂN TAB / ĐÓNG TAB (SWITCH_TAB) ---
        if (action.type === 'SWITCH_TAB') {
          if (action.tabAction === 'CLOSE_TAB') {
            await tabManager.closeCurrentTab();
            const logs = tabManager.consumePendingLogMessages();
            if (logs.length > 0) {
              subDetails.push(...logs);
            } else {
              subDetails.push(`Đã đóng tab con và chuyển về tab gốc: ${tabManager.getActivePage().url()}`);
            }
          } else {
            const openPages = tabManager.getOpenPages();
            if (openPages.length > 1) {
              const current = tabManager.getActivePage();
              const otherPages = openPages.filter((p) => p !== current);
              const targetPage = otherPages.length > 0 ? otherPages[otherPages.length - 1] : openPages[0];
              await tabManager.switchToTab(targetPage);
              const logs = tabManager.consumePendingLogMessages();
              if (logs.length > 0) {
                subDetails.push(...logs);
              } else {
                subDetails.push(`Đã chuyển sang tab: ${targetPage.url()}`);
              }
            } else {
              subDetails.push('Chỉ có 1 tab đang mở');
            }
          }
          const curP = tabManager.getActivePage();
          const curB = getOrCreateBarrier(curP);
          await waitForUIQuiescence(curP, 3000, curB);
          continue;
        }

        // --- LOẠI 5.1: XỬ LÝ HỘP THOẠI POPUP (HANDLE_DIALOG) ---
        if (action.type === 'HANDLE_DIALOG') {
          const targetAction = action.dialogAction || 'ACCEPT';
          const allCaptured = tabManager.getAllCapturedDialogs();
          const lastDialog = allCaptured.length > 0 ? allCaptured[allCaptured.length - 1] : undefined;
          if (lastDialog) {
            subDetails.push(
              `Đã xử lý hộp thoại [${lastDialog.type}]: "${lastDialog.message}" (${targetAction === 'ACCEPT' ? 'Chấp nhận' : 'Hủy'})`
            );
          } else {
            subDetails.push(`Đã ghi nhận cấu hình xử lý hộp thoại: ${targetAction}`);
          }
          continue;
        }

        // --- LOẠI 6: KIỂM TRA ĐƯỜNG DẪN URL (ASSERT_URL) ---
        if (action.type === 'ASSERT_URL') {
          const p = tabManager.getActivePage();
          const b = getOrCreateBarrier(p);
          const expectedUrl = action.expectedUrlPart || '';
          stepAuditTrail = {
            stepNumber: stepNum,
            action: action.type,
            targetHint: expectedUrl,
            decision: {
              chosenElement: `URL: "${expectedUrl}"`,
              healedIntent: expectedUrl,
              confidence: 1.0,
              criticVerdict: 'APPROVED',
              reasoning: 'Kiểm tra đường dẫn URL trên trình duyệt',
              matchSource: 'EXACT',
            },
            quiescenceWaitMs: Date.now() - stepStart,
          };
          const ok = await b.verifyExpectedUrl(expectedUrl, 8000);
          if (!ok) {
            const reasonDetail = `Sai URL: Kỳ vọng đường dẫn chứa "${expectedUrl}" nhưng URL hiện tại là "${p.url()}".`;
            const failShotName = `${prefix}fail_step_${stepNum}.png`;
            const failShotPath = path.join(outputDir, failShotName);

            await drawStatusBannerOnPage(
              p,
              'FAILED',
              `BƯỚC ${stepNum} FAILED: URL không chứa "${expectedUrl}"`,
              null
            );
            await p.screenshot({ path: failShotPath, fullPage: false });

            stepAuditTrail.screenshotPath = failShotPath;
            logs.push({
              step: stepNum,
              instruction: rawStep.text,
              status: 'FAILED',
              detail: reasonDetail,
              durationMs: Date.now() - stepStart,
              aiAuditTrail: stepAuditTrail,
              screenshotPath: failShotPath,
            });

            return finalizeResult({
              status: 'FAILED',
              url: options.url,
              totalSteps: compiled.totalSteps,
              completedSteps,
              failedStep: stepNum,
              reasonCode: 'ASSERTION_MISMATCH',
              reasonDetail,
              summary: `FAILED: Dừng ngay tại bước ${stepNum}/${compiled.totalSteps} | Lý do: ${reasonDetail}`,
              screenshotPath: failShotPath,
              totalDurationMs: Date.now() - startTime,
              logs,
            });
          }
          subDetails.push(`Đã xác nhận URL chứa "${expectedUrl}"`);
          continue;
        }

        // --- TRƯỜNG HỢP 1: BƯỚC KIỂM TRA NỘI DUNG (ASSERT_TEXT) ---
        if (action.type === 'ASSERT_TEXT') {
          const p = tabManager.getActivePage();
          const b = getOrCreateBarrier(p);
          const expected = action.expectedText || '';

          stepAuditTrail = {
            stepNumber: stepNum,
            action: action.type,
            targetHint: expected,
            decision: {
              chosenElement: `TextContent: "${expected}"`,
              healedIntent: expected,
              confidence: 1.0,
              criticVerdict: 'APPROVED',
              reasoning: 'Kiểm tra nội dung văn bản hiển thị trên trang',
              matchSource: 'EXACT',
            },
            quiescenceWaitMs: Date.now() - stepStart,
          };

          // Kiểm tra xem nội dung kỳ vọng có xuất hiện trong các Native Dialogs (alert/confirm/prompt) đã bắt không (0ms Fast-Path)
          const allCaptured = tabManager.getAllCapturedDialogs();
          const matchingDialog = allCaptured.find((d) =>
            d.message.toLowerCase().includes(expected.toLowerCase())
          );
          if (matchingDialog) {
            subDetails.push(
              `Đã xác nhận hiển thị "${expected}" từ hộp thoại Native [${matchingDialog.type}: "${matchingDialog.message}"]`
            );
            continue;
          }

          const assertNotifStepCtx = buildNotificationStepContext(
            action,
            rawStep.text,
            nextRawStep?.text,
            nextSubActions
          );
          const checkRes = await b.verifyExpectedText(expected, 16000, assertNotifStepCtx);

          const assertNotifSummary = summarizeNotificationVerdict(checkRes.notificationReport);
          if (assertNotifSummary.verdict) {
            stepNotificationVerdict = assertNotifSummary.verdict;
            if (stepAuditTrail?.decision) {
              stepAuditTrail.decision.notificationVerdict = assertNotifSummary.verdict;
            }
          }
          if (assertNotifSummary.warnings.length > 0) {
            for (const w of assertNotifSummary.warnings) {
              if (!stepNotificationWarnings.includes(w)) stepNotificationWarnings.push(w);
            }
            if (stepAuditTrail?.decision) {
              stepAuditTrail.decision.notificationWarnings = [...stepNotificationWarnings];
            }
          }
          if (checkRes.successEvidences && checkRes.successEvidences.length > 0) {
            subDetails.push(`[NOTIFICATION SUCCESS]: "${checkRes.successEvidences[0]}"`);
          }

          if (!checkRes.matched) {
            // Kiểm tra lại lần nữa phòng trường hợp dialog vừa xuất hiện trong lúc chờ
            const lateCaptured = tabManager.getAllCapturedDialogs();
            const lateMatchingDialog = lateCaptured.find((d) =>
              d.message.toLowerCase().includes(expected.toLowerCase())
            );
            if (lateMatchingDialog) {
              subDetails.push(
                `Đã xác nhận hiển thị "${expected}" từ hộp thoại Native [${lateMatchingDialog.type}: "${lateMatchingDialog.message}"]`
              );
              continue;
            }

            // AI-First Semantic Oracle: Thử đối soát ngữ nghĩa qua Gemini Multimodal trước khi kết luận FAILED
            const pageText = await p.evaluate(() => document.body.innerText || '').catch(() => '');
            const shotBuf = await p.screenshot({ fullPage: false }).catch(() => null);
            const shotBase64 = shotBuf ? shotBuf.toString('base64') : undefined;

            const aiVerify = await LLMBridge.semanticVerifyWithAI(expected, pageText, shotBase64);
            if (aiVerify.matched) {
              const assertPassHash = await computePageDomHash(p);
              deadlockWatchdog.recordCycle(assertPassHash, true, {
                url: p.url(),
                stepNumber: stepNum,
              });
              subDetails.push(`Đã xác nhận hiển thị "${expected}" [AI Semantic Verified: ${aiVerify.reasoning}]`);
              continue;
            }

            const assertHash = await computePageDomHash(p);
            const assertCycle = deadlockWatchdog.recordCycle(assertHash, false, {
              url: p.url(),
              stepNumber: stepNum,
              actionType: action.type,
            });

            const autopsy = await LLMBridge.diagnoseFailureWithAI(
              rawStep.text,
              assertCycle.tripped
                ? `CIRCUIT_BREAKER_TRIGGERED: Deadlock Watchdog ngắt mạch khẩn cấp khi kiểm tra assertion thất bại 3 chu kỳ liên tiếp trên DOM hoàn toàn không đổi (DOM SHA-256 Hash: ${assertHash})`
                : `Không tìm thấy nội dung "${expected}"`,
              pageText,
              shotBase64
            );

            const errExtra =
              checkRes.detectedPageErrors.length > 0
                ? ` (Phát hiện thông báo lỗi trên màn hình: "${checkRes.detectedPageErrors.join(' | ')}")`
                : ' (Nội dung không xuất hiện trên DOM)';

            const reasonCode: FailureReasonCode = assertCycle.tripped
              ? 'CIRCUIT_BREAKER_TRIGGERED'
              : 'ASSERTION_MISMATCH';

            const reasonDetail = assertCycle.tripped
              ? `Ngắt mạch khẩn cấp chống treo (CIRCUIT_BREAKER_TRIGGERED): Deadlock Watchdog phát hiện 3 chu kỳ kiểm tra liên tiếp trên giao diện hoàn toàn không thay đổi (Hash: ${assertHash.slice(0, 16)}...) và nội dung "${expected}" không xuất hiện. [AI Forensic Autopsy: (${autopsy.verdictCategory}) ${autopsy.rootCause}. Đề xuất: ${autopsy.recommendation}]`
              : `Sai nội dung kiểm tra: Kỳ vọng hiện "${expected}" nhưng không tìm thấy${errExtra}. [AI Autopsy: (${autopsy.verdictCategory}) ${autopsy.rootCause}. Đề xuất: ${autopsy.recommendation}]`;

            const failShotName = `${prefix}fail_step_${stepNum}.png`;
            const failShotPath = path.join(outputDir, failShotName);

            await drawStatusBannerOnPage(
              p,
              'FAILED',
              assertCycle.tripped
                ? `BƯỚC ${stepNum} CIRCUIT BREAKER TRIGGERED: Deadlock Watchdog (${assertHash.slice(0, 8)})`
                : `BƯỚC ${stepNum} FAILED: ${autopsy.rootCause || `Không thấy "${expected}"`}`,
              null
            );
            await p.screenshot({ path: failShotPath, fullPage: false });

            if (stepAuditTrail) {
              stepAuditTrail.autopsy = {
                failureCode: assertCycle.tripped ? 'CIRCUIT_BREAKER_TRIGGERED' : 'ASSERTION_MISMATCH',
                verdictCategory: autopsy.verdictCategory,
                rootCause: autopsy.rootCause,
                recommendation: autopsy.recommendation,
                suggestedRemediation: autopsy.recommendation,
                confidence: 0.95,
              };
              stepAuditTrail.screenshotPath = failShotPath;
              stepAuditTrail.domHash = assertHash;
            }

            logs.push({
              step: stepNum,
              instruction: rawStep.text,
              status: 'FAILED',
              detail: reasonDetail,
              durationMs: Date.now() - stepStart,
              domHash: assertHash,
              aiAuditTrail: stepAuditTrail,
              screenshotPath: failShotPath,
            });

            return finalizeResult({
              status: 'FAILED',
              url: options.url,
              totalSteps: compiled.totalSteps,
              completedSteps,
              failedStep: stepNum,
              reasonCode,
              reasonDetail,
              summary: assertCycle.tripped
                ? `FAILED: Dừng ngay tại bước ${stepNum}/${compiled.totalSteps} do ngắt mạch chống treo (CIRCUIT_BREAKER_TRIGGERED) | Lý do: ${reasonDetail}`
                : `FAILED: Dừng ngay tại bước ${stepNum}/${compiled.totalSteps} | Lý do: ${reasonDetail}`,
              screenshotPath: failShotPath,
              totalDurationMs: Date.now() - startTime,
              logs,
              circuitBreakerTripped: assertCycle.tripped ? true : undefined,
            });
          }

          const assertPassHash = await computePageDomHash(p);
          deadlockWatchdog.recordCycle(assertPassHash, true, {
            url: p.url(),
            stepNumber: stepNum,
          });

          subDetails.push(`Đã xác nhận hiển thị "${expected}"`);
          continue;
        }

        // --- TRƯỜNG HỢP 2: BƯỚC TƯƠNG TÁC (FILL / CLICK / SEARCH / SELECT_ITEM) ---
        // Triển khai Trụ cột 2 (Auto-Wait & Dynamic Exponential Backoff Retry Loop):
        // Khi tìm kiếm element hoặc thực hiện hành động thất bại, thử lại tối đa 3 lần: 500ms -> 1500ms -> 3000ms.
        // Mỗi lần retry phải kích hoạt lại waitForUIQuiescence.
        const maxRetries = RETRY_BACKOFF_MS.length;
        let lastCandidates: DOMCandidate[] = [];
        let resolved: ResolveCandidateResult | null = null;
        let target: DOMCandidate | null = null;
        let actionExecuted = false;
        let executionError: Error | null = null;
        let latestPreShotBase64: string | undefined = undefined;
        let circuitBreakerTriggered = false;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          const iterPage = tabManager.getActivePage();
          const iterBarrier = getOrCreateBarrier(iterPage);
          await iterBarrier.ensureInPageObserver().catch(() => {});

          if (attempt > 0) {
            const backoffMs = RETRY_BACKOFF_MS[attempt - 1];
            await new Promise((r) => setTimeout(r, backoffMs));
            await waitForUIQuiescence(iterPage, 7000, iterBarrier);
          }

          lastCandidates = await distillPageDOM(
            iterPage,
            action.targetHint,
            action.contextHint
          );

          const preShotBuf = await iterPage.screenshot({ fullPage: false }).catch(() => null);
          latestPreShotBase64 = preShotBuf ? preShotBuf.toString('base64') : undefined;

          resolved = await resolveTargetCandidate(
            iterPage.url(),
            action,
            lastCandidates,
            latestPreShotBase64,
            { page: iterPage, enableVisionSoM: true }
          );

          // Prompt 12: Synthetic Hover Tooltip Trap cho nút SVG không nhãn nếu resolve lần đầu chưa đạt / mơ hồ
          if (
            (!resolved.candidate || resolved.flag === 'AMBIGUOUS_TARGET') &&
            resolved.flag !== 'ANTYNOM_VIOLATION' &&
            (action.type === 'CLICK' || action.type === 'HOVER' || action.type === 'SEARCH')
          ) {
            const namelessSvgCands = lastCandidates
              .filter(
                (c) =>
                  (!c.text || !c.text.trim()) &&
                  (!c.ariaLabel || !c.ariaLabel.trim()) &&
                  Boolean(c.svgMarkup || c.svgTopologyData) &&
                  !(
                    c.svgTopologyData &&
                    (c.svgTopologyData as SvgIconCandidateInput).tooltip?.found
                  )
              )
              .sort((a, b) => (b.svgScore ?? 0) - (a.svgScore ?? 0))
              .slice(0, 3);

            if (namelessSvgCands.length > 0) {
              let harvestedAnyTooltip = false;
              const hintText = action.targetHint || action.subInstruction || '';
              for (const svgCand of namelessSvgCands) {
                const tip = await probeHoverTooltip(
                  iterPage,
                  svgCand.selectorPath || svgCand.rect,
                  { targetHint: hintText, waitMs: 220, cleanupHover: true }
                ).catch(() => null);
                if (tip && tip.found && tip.tooltipText.trim()) {
                  harvestedAnyTooltip = true;
                  svgCand.virtualLabel = svgCand.virtualLabel
                    ? `${svgCand.virtualLabel} ${tip.tooltipText}`.trim()
                    : tip.tooltipText;
                  if (svgCand.svgTopologyData && typeof svgCand.svgTopologyData === 'object') {
                    (svgCand.svgTopologyData as SvgIconCandidateInput).tooltip = tip;
                  }
                }
              }
              if (harvestedAnyTooltip) {
                resolved = await resolveTargetCandidate(
                  iterPage.url(),
                  action,
                  lastCandidates,
                  latestPreShotBase64,
                  { page: iterPage, enableVisionSoM: true }
                );
              }
            }
          }

          // Trụ cột 10: Virtualized List Incremental Scroll Engine
          // Khi phần tử mục tiêu không tìm thấy trong viewport hiện tại:
          // Không fail ngay; thực hiện cuộn phân đoạn (Step Scroll): Cuộn xuống 350px mỗi lần (tối đa 5 lần = 1750px).
          // Sau mỗi lần cuộn, đợi 200ms để DOM ảo mount node mới rồi quét lại danh sách candidates.
          const isVisionCoordResolved =
            !resolved.candidate &&
            resolved.matchSource === 'VISION_SOM' &&
            Boolean(resolved.clickPoint || resolved.resolvedBox);

          if (
            !resolved.candidate &&
            !isVisionCoordResolved &&
            (action.type === 'CLICK' ||
              action.type === 'SELECT_ITEM' ||
              action.type === 'FILL' ||
              action.type === 'HOVER' ||
              action.type === 'SELECT_OPTION')
          ) {
            const vScrollRes = await executeVirtualListScrollSearch(
              iterPage,
              action,
              iterBarrier,
              lastCandidates,
              { screenshotBase64: latestPreShotBase64 }
            );
            if (vScrollRes.found && vScrollRes.candidate) {
              lastCandidates = vScrollRes.candidates;
              resolved = vScrollRes.resolved || resolved;
              subDetails.push(
                `[VIRTUAL SCROLL] Đã cuộn tìm thấy phần tử sau ${vScrollRes.stepsScrolled} nấc (${vScrollRes.totalPxScrolled}px)`
              );
            }
          }

          const finalIsVisionCoord =
            !resolved.candidate &&
            resolved.matchSource === 'VISION_SOM' &&
            Boolean(resolved.clickPoint || resolved.resolvedBox);

          // Cập nhật telemetry định tuyến L1/L2/L3 (Prompt 14)
          const resolvedRoutingTier =
            resolved?.routingTier || resolved?.routingTelemetry?.tier;
          const resolvedSomMarkId =
            resolved?.somMarkId ?? resolved?.routingTelemetry?.somMarkId ?? undefined;
          const resolvedCostUsd = resolved?.routingTelemetry?.estimatedCostUsd;
          const resolvedLatencyMs = resolved?.routingTelemetry?.latencyMs;
          if (resolvedRoutingTier) stepRoutingTier = resolvedRoutingTier;
          if (typeof resolvedSomMarkId === 'number') stepSomMarkId = resolvedSomMarkId;

          const candidateForAudit = resolved?.candidate || target;

          // Bảo toàn damerauDistance & healedIntent cho XAI Audit Trail khi ứng viên được chữa lành lỗi chính tả
          // ngay cả khi deltaMargin > 1.0 kích hoạt nhánh L3/LLM fallback
          if (
            resolved &&
            candidateForAudit &&
            resolved.damerauDistance === undefined &&
            action.targetHint
          ) {
            const candidateLabels = [
              candidateForAudit.text,
              candidateForAudit.ariaLabel,
              candidateForAudit.placeholder,
              candidateForAudit.nearLabel,
              candidateForAudit.value,
            ].filter((s): s is string => Boolean(s && s.trim()));

            const hintClean = action.targetHint.trim().toLowerCase();
            const hasExactLabel = candidateLabels.some(
              (lbl) => lbl.trim().toLowerCase() === hintClean
            );
            if (!hasExactLabel) {
              for (const lbl of candidateLabels) {
                const dam = computeDamerauSimilarity(action.targetHint, lbl);
                if (dam.isAcceptable && dam.distance >= 1) {
                  resolved.damerauDistance = dam.distance;
                  resolved.similarity = dam.similarity;
                  if (resolved.matchSource !== 'SVG_TOPOLOGY' && resolved.matchSource !== 'VISION_SOM') {
                    resolved.matchSource = 'FUZZY_HEALED';
                  }
                  break;
                }
              }
            }
          }

          const auditBBox =
            candidateForAudit?.rect ||
            (resolved?.resolvedBox
              ? {
                  x: resolved.resolvedBox.x,
                  y: resolved.resolvedBox.y,
                  width: resolved.resolvedBox.width,
                  height: resolved.resolvedBox.height,
                }
              : undefined);

          stepAuditTrail = {
            stepNumber: stepNum,
            action: action.type,
            targetHint: action.targetHint || action.subInstruction,
            decision: {
              chosenElement: candidateForAudit
                ? `<${candidateForAudit.tag}>${candidateForAudit.elemId ? '#' + candidateForAudit.elemId : ''}${candidateForAudit.text ? ' "' + candidateForAudit.text + '"' : ''}`
                : finalIsVisionCoord
                ? `VisionSoM Mark #${resolvedSomMarkId ?? '?'}`
                : undefined,
              healedIntent:
                resolved?.matchSource === 'FUZZY_HEALED' ||
                (resolved?.damerauDistance !== undefined && resolved.damerauDistance > 0)
                  ? candidateForAudit?.text || candidateForAudit?.nearLabel || candidateForAudit?.placeholder
                  : undefined,
              damerauDistance: resolved?.damerauDistance,
              confidence:
                resolved?.confidence ?? (resolved?.similarity ?? (resolved?.matchSource === 'SEMANTIC_RULE' ? 1.0 : 0.95)),
              deltaMargin: resolved?.deltaMargin,
              criticVerdict: resolved?.criticVerdict || (resolved?.flag ? 'REJECTED' : 'APPROVED'),
              reasoning:
                resolved?.reasoning ||
                (resolved?.matchSource === 'FUZZY_HEALED'
                  ? `Tự phục hồi lỗi chính tả "${action.targetHint}" -> "${candidateForAudit?.text || ''}" (Damerau distance: ${resolved?.damerauDistance})`
                  : `Khớp phần tử mục tiêu trên DOM`),
              matchSource: resolved?.matchSource,
              flag: resolved?.flag,
              routingTier: resolvedRoutingTier,
              somMarkId: typeof resolvedSomMarkId === 'number' ? resolvedSomMarkId : undefined,
              estimatedCostUsd: resolvedCostUsd,
              routingLatencyMs: resolvedLatencyMs,
              occlusionStrategy: stepOcclusionStrategy,
              dismissedOverlays: stepDismissedOverlays.length > 0 ? [...stepDismissedOverlays] : undefined,
              notificationVerdict: stepNotificationVerdict,
              notificationWarnings:
                stepNotificationWarnings.length > 0 ? [...stepNotificationWarnings] : undefined,
            },
            quiescenceWaitMs: Date.now() - stepStart,
            boundingBox: auditBBox,
          };

          let attemptFailed = false;

          // CỔNG 1: Kiểm tra tồn tại phần tử (hỗ trợ cả L3 Vision SoM coordinate-only cho <canvas>/WebGL)
          if (!resolved.candidate && !finalIsVisionCoord) {
            attemptFailed = true;
          } else if (finalIsVisionCoord) {
            // Prompt 14: Click vật lý trực tiếp vào tọa độ tâm Set-of-Marks (không cần DOM selector)
            try {
              const clickPt = resolved.clickPoint || {
                x: resolved.resolvedBox!.x + resolved.resolvedBox!.width / 2,
                y: resolved.resolvedBox!.y + resolved.resolvedBox!.height / 2,
              };
              const somDismiss = await iterBarrier
                .dismissHangingOverlaysIfCrossing({
                  rect: resolved.resolvedBox || undefined,
                  point: clickPt,
                  targetHint: action.targetHint,
                  actionType: action.type,
                })
                .catch(() => null);
              const somDismissLabels = extractDismissedOverlayLabels(somDismiss);
              if (somDismissLabels.length > 0) {
                for (const lbl of somDismissLabels) {
                  if (!stepDismissedOverlays.includes(lbl)) stepDismissedOverlays.push(lbl);
                }
              }

              iterBarrier.resetQuietTimers();
              await iterPage.mouse.move(clickPt.x, clickPt.y);
              await iterPage.mouse.click(clickPt.x, clickPt.y);
              await waitForUIQuiescence(iterPage, 7000, iterBarrier);
              stepOcclusionStrategy = 'VISION_SOM_PHYSICAL_CLICK';
              if (stepAuditTrail?.decision) {
                stepAuditTrail.decision.occlusionStrategy = stepOcclusionStrategy;
                if (stepDismissedOverlays.length > 0) {
                  stepAuditTrail.decision.dismissedOverlays = [...stepDismissedOverlays];
                }
              }
              actionExecuted = true;
              await tabManager.waitForPendingTransitions(1200);
              const postActionTabLogs = tabManager.consumePendingLogMessages();
              if (postActionTabLogs.length > 0) {
                subDetails.push(...postActionTabLogs);
              }
              break;
            } catch (err: any) {
              executionError = err;
              attemptFailed = true;
            }
          } else {
            target = resolved.candidate!;

            // Prompt 11: Trước khi tương tác với E_next, tự động giải phóng lớp phủ treo nếu vượt ranh giới ngữ cảnh
            if (
              action.type === 'CLICK' ||
              action.type === 'FILL' ||
              action.type === 'SEARCH' ||
              action.type === 'SELECT_ITEM' ||
              action.type === 'SELECT_OPTION' ||
              action.type === 'HOVER'
            ) {
              const preDismissRes = await iterBarrier
                .dismissHangingOverlaysIfCrossing({
                  selector: target.selectorPath,
                  elemId: target.elemId,
                  rect: target.rect,
                  point: target.safeClickPoint || {
                    x: target.rect.x + target.rect.width / 2,
                    y: target.rect.y + target.rect.height / 2,
                  },
                  candidate: target,
                  targetHint: action.targetHint,
                  actionType: action.type,
                })
                .catch(() => null);

              const dismissedNow = extractDismissedOverlayLabels(preDismissRes);
              if (dismissedNow.length > 0) {
                for (const lbl of dismissedNow) {
                  if (!stepDismissedOverlays.includes(lbl)) stepDismissedOverlays.push(lbl);
                }
                subDetails.push(`[IMPLICIT DISMISS] Đã tự động đóng lớp phủ treo: ${dismissedNow.join(', ')}`);
                await waitForUIQuiescence(iterPage, 500, iterBarrier).catch(() => {});
                if (target.obscured) {
                  const postDismissSafe = await resolveSafeClickPoint(
                    iterPage,
                    target.rect,
                    target,
                    { autoScroll: true }
                  ).catch(() => null);
                  if (postDismissSafe?.canClick && postDismissSafe.clickPoint) {
                    target.obscured = false;
                    target.safeClickPoint = postDismissSafe.clickPoint;
                    stepOcclusionStrategy =
                      postDismissSafe.scrolledToSafeBand && postDismissSafe.strategy === 'CENTER'
                        ? 'SAFE_BAND_SCROLL'
                        : postDismissSafe.strategy;
                  }
                }
              }
            }

            // CỔNG 2: Kiểm tra trạng thái bị khóa (ELEMENT_DISABLED)
            if (target.disabled) {
              attemptFailed = true;
            } else {
              // CỔNG 3: Nếu phần tử đang bị che khuất, kích hoạt Prompt 10 (Safe Band + Sutherland-Hodgman)
              // và Prompt 13 (4-Tier Toast Evasion) trước khi kết luận ELEMENT_OBSCURED
              if (target.obscured) {
                const targetFrameForCheck =
                  target.frameIndex !== undefined && target.frameIndex < iterPage.frames().length
                    ? iterPage.frames()[target.frameIndex]
                    : undefined;
                const frameArgForCheck: Frame | undefined =
                  targetFrameForCheck && targetFrameForCheck !== iterPage.mainFrame()
                    ? targetFrameForCheck
                    : undefined;

                let recoverySafe = await resolveSafeClickPoint(iterPage, target.rect, target, {
                  autoScroll: true,
                  frame: frameArgForCheck,
                }).catch(() => null);

                if (recoverySafe && !recoverySafe.canClick && recoverySafe.requiresDismissalLadder) {
                  const toastEvasion = await iterBarrier
                    .evadeOccludingToasts(recoverySafe.targetRect || target.rect, {
                      targetSelector: target.selectorPath,
                    })
                    .catch(() => null);
                  if (toastEvasion && toastEvasion.evaded && toastEvasion.occludedInitially) {
                    if (toastEvasion.restore) {
                      await toastEvasion.restore().catch(() => {});
                    }
                    recoverySafe = await resolveSafeClickPoint(
                      iterPage,
                      recoverySafe.targetRect || target.rect,
                      target,
                      { autoScroll: false, frame: frameArgForCheck }
                    ).catch(() => recoverySafe);
                  }
                }

                if (recoverySafe && recoverySafe.canClick && recoverySafe.clickPoint) {
                  target.obscured = false;
                  target.safeClickPoint = recoverySafe.clickPoint;
                  if (recoverySafe.targetRect) {
                    target.rect = recoverySafe.targetRect;
                  }
                  stepOcclusionStrategy =
                    recoverySafe.scrolledToSafeBand && recoverySafe.strategy === 'CENTER'
                      ? 'SAFE_BAND_SCROLL'
                      : recoverySafe.strategy;
                }
              }

              if (target.obscured) {
                attemptFailed = true;
              } else {
                // CỔNG 4: Thực thi thao tác vật lý
                try {
                  iterBarrier.resetQuietTimers();
                  const actionTelemetry: PhysicalActionTelemetry = {};
                  await executePhysicalAction(iterPage, iterBarrier, action, target, actionTelemetry);

                  if (actionTelemetry.occlusionStrategy) {
                    stepOcclusionStrategy = actionTelemetry.occlusionStrategy;
                  }
                  if (actionTelemetry.dismissedOverlays && actionTelemetry.dismissedOverlays.length > 0) {
                    for (const lbl of actionTelemetry.dismissedOverlays) {
                      if (!stepDismissedOverlays.includes(lbl)) stepDismissedOverlays.push(lbl);
                    }
                  }
                  if (stepAuditTrail?.decision) {
                    if (stepOcclusionStrategy) {
                      stepAuditTrail.decision.occlusionStrategy = stepOcclusionStrategy;
                    }
                    if (stepDismissedOverlays.length > 0) {
                      stepAuditTrail.decision.dismissedOverlays = [...stepDismissedOverlays];
                    }
                  }

                  actionExecuted = true;

                  // Nếu thao tác vừa thực hiện có khả năng mở tab mới, đợi và cập nhật ngữ cảnh
                  await tabManager.waitForPendingTransitions(1200);
                  const postActionTabLogs = tabManager.consumePendingLogMessages();
                  if (postActionTabLogs.length > 0) {
                    subDetails.push(...postActionTabLogs);
                  }

                  break; // Thao tác thành công!
                } catch (err: any) {
                  executionError = err;
                  attemptFailed = true;
                }
              }
            }
          }

          if (attemptFailed) {
            const currentHash = await computePageDomHash(iterPage);
            const cycle = deadlockWatchdog.recordCycle(currentHash, false, {
              url: iterPage.url(),
              stepNumber: stepNum,
              actionType: action.type,
            });
            if (cycle.tripped) {
              circuitBreakerTriggered = true;
              break;
            }
            if (attempt < maxRetries) {
              continue; // Thử lại với exponential backoff
            }
            break; // Đã hết lượt retry
          }
        }

        if (actionExecuted) {
          const postActionPage = tabManager.getActivePage();
          const postActionBarrier = getOrCreateBarrier(postActionPage);
          const postActionHash = await computePageDomHash(postActionPage);
          deadlockWatchdog.recordCycle(postActionHash, true, {
            url: postActionPage.url(),
            stepNumber: stepNum,
            actionType: action.type,
          });

          // Prompt 13: Đánh giá thông báo nổi sau thao tác theo chuẩn IEEE 29119
          // SUCCESS -> bằng chứng PASS (cấm fail); INFO -> bỏ qua; WARNING -> ghi cảnh báo (cấm fail);
          // ERROR -> EXPECTED_PASS nếu khớp kỳ vọng phủ định, ngược lại ghi nhận PRODUCT_DEFECT.
          const postNotifCtx = buildNotificationStepContext(
            action,
            rawStep.text,
            nextRawStep?.text,
            nextSubActions
          );
          const postNotifReport = await postActionBarrier
            .evaluateStepNotifications(postNotifCtx)
            .catch(() => null);
          const postNotifSummary = summarizeNotificationVerdict(postNotifReport);
          if (postNotifSummary.verdict) {
            stepNotificationVerdict = postNotifSummary.verdict;
            if (stepAuditTrail?.decision) {
              stepAuditTrail.decision.notificationVerdict = postNotifSummary.verdict;
            }
          }
          if (postNotifSummary.warnings.length > 0) {
            for (const w of postNotifSummary.warnings) {
              if (!stepNotificationWarnings.includes(w)) stepNotificationWarnings.push(w);
            }
            if (stepAuditTrail?.decision) {
              stepAuditTrail.decision.notificationWarnings = [...stepNotificationWarnings];
            }
            subDetails.push(`[NOTIFICATION WARNING]: ${postNotifSummary.warnings.join(' | ')}`);
          }
          if (postNotifReport && postNotifReport.successEvidences.length > 0) {
            subDetails.push(`[NOTIFICATION SUCCESS]: ${postNotifReport.successEvidences[0]}`);
          }
          if (postNotifReport && postNotifReport.productDefects.length > 0) {
            subDetails.push(`[NOTIFICATION ORACLE: PRODUCT_DEFECT] ${postNotifReport.productDefects.join(' | ')}`);
          }
        }

        // Trụ cột 14: Nếu Deadlock Watchdog Circuit Breaker bị kích hoạt
        if (circuitBreakerTriggered || deadlockWatchdog.isTripped()) {
          const failPage = tabManager.getActivePage();
          const domHash = deadlockWatchdog.getLastHash();
          const pageText = await failPage.evaluate(() => document.body.innerText || '').catch(() => '');
          const shotBuf = await failPage.screenshot({ fullPage: false }).catch(() => null);
          const shotBase64 = shotBuf ? shotBuf.toString('base64') : latestPreShotBase64;

          const autopsy = await LLMBridge.diagnoseFailureWithAI(
            rawStep.text,
            `CIRCUIT_BREAKER_TRIGGERED: Deadlock Watchdog ngắt mạch khẩn cấp do 3 chu kỳ liên tiếp DOM hoàn toàn không thay đổi và hành động thất bại liên tục (DOM SHA-256 Hash: ${domHash})`,
            pageText,
            shotBase64
          );

          const reasonDetail = `Ngắt mạch khẩn cấp chống treo (CIRCUIT_BREAKER_TRIGGERED): Deadlock Watchdog phát hiện 3 chu kỳ thao tác liên tiếp trên giao diện hoàn toàn không thay đổi (Hash: ${domHash.slice(0, 16)}...) và hành động thất bại liên tục. [AI Forensic Autopsy: (${autopsy.verdictCategory}) ${autopsy.rootCause}. Đề xuất: ${autopsy.recommendation}]`;

          const failShotName = `${prefix}fail_step_${stepNum}.png`;
          const failShotPath = path.join(outputDir, failShotName);

          await drawStatusBannerOnPage(
            failPage,
            'FAILED',
            `BƯỚC ${stepNum} CIRCUIT BREAKER TRIGGERED: Deadlock Watchdog (${domHash.slice(0, 8)})`,
            target
          );
          await failPage.screenshot({ path: failShotPath, fullPage: false });

          if (stepAuditTrail) {
            stepAuditTrail.autopsy = {
              failureCode: 'CIRCUIT_BREAKER_TRIGGERED',
              verdictCategory: autopsy.verdictCategory,
              rootCause: autopsy.rootCause,
              recommendation: autopsy.recommendation,
              suggestedRemediation: autopsy.recommendation,
              confidence: 0.95,
            };
            stepAuditTrail.screenshotPath = failShotPath;
            stepAuditTrail.domHash = domHash;
          }

          logs.push({
            step: stepNum,
            instruction: rawStep.text,
            status: 'FAILED',
            detail: reasonDetail,
            durationMs: Date.now() - stepStart,
            domHash,
            aiAuditTrail: stepAuditTrail,
            screenshotPath: failShotPath,
          });

          return finalizeResult({
            status: 'FAILED',
            url: options.url,
            totalSteps: compiled.totalSteps,
            completedSteps,
            failedStep: stepNum,
            reasonCode: 'CIRCUIT_BREAKER_TRIGGERED',
            reasonDetail,
            summary: `FAILED: Dừng ngay tại bước ${stepNum}/${compiled.totalSteps} do ngắt mạch chống treo (CIRCUIT_BREAKER_TRIGGERED) | Lý do: ${reasonDetail}`,
            screenshotPath: failShotPath,
            totalDurationMs: Date.now() - startTime,
            logs,
            circuitBreakerTripped: true,
          });
        }

        // Nếu sau vòng lặp retry mà hành động chưa được thực thi thành công:
        if (!actionExecuted) {
          const failPage = tabManager.getActivePage();

          // Trường hợp 1: Không tìm thấy phần tử (ELEMENT_NOT_FOUND)
          if (!resolved || !resolved.candidate) {
            const availablePreview = lastCandidates
              .slice(0, 6)
              .map((c) => `[${c.tag}: "${c.text || c.nearLabel || c.placeholder || c.name || ''}"]`)
              .join(', ');

            const pageText = await failPage.evaluate(() => document.body.innerText || '').catch(() => '');
            const autopsy = await LLMBridge.diagnoseFailureWithAI(
              rawStep.text,
              `Không tìm thấy phần tử "${action.targetHint || action.subInstruction}"`,
              pageText,
              latestPreShotBase64
            );

            const isAntonym = resolved?.flag === 'ANTYNOM_VIOLATION';
            const isAmbiguous = resolved?.flag === 'AMBIGUOUS_TARGET';

            const guardrailNote = isAntonym
              ? ` [GUARDRAIL VETO: ${resolved?.reasoning || 'Chặn đứng tương tác do vi phạm Hàng rào từ trái nghĩa (Antonym Barrier)'}]`
              : isAmbiguous
              ? ` [CRITIC VETO: ${resolved?.reasoning || 'Hệ thống Actor-Critic hủy thao tác vì mục tiêu mơ hồ (AMBIGUOUS_TARGET)'}]`
              : '';

            const reasonCode: FailureReasonCode = isAntonym
              ? 'ANTYNOM_VIOLATION'
              : isAmbiguous
              ? 'AMBIGUOUS_TARGET'
              : 'ELEMENT_NOT_FOUND';

            const reasonDetail = `Không tìm thấy phần tử mục tiêu "${action.targetHint || action.subInstruction
              }" trên màn hình hiện tại sau 3 lần retry.${guardrailNote} (Các phần tử đang hiển thị: ${availablePreview || 'Trống'}). [AI Autopsy: (${autopsy.verdictCategory}) ${autopsy.rootCause}. Đề xuất: ${autopsy.recommendation}]`;

            const failShotName = `${prefix}fail_step_${stepNum}.png`;
            const failShotPath = path.join(outputDir, failShotName);

            await drawStatusBannerOnPage(
              failPage,
              'FAILED',
              `BƯỚC ${stepNum} FAILED: ${autopsy.rootCause || `Không tìm thấy "${action.targetHint}"`}`,
              null
            );
            await failPage.screenshot({ path: failShotPath, fullPage: false });

            if (stepAuditTrail) {
              stepAuditTrail.autopsy = {
                failureCode: reasonCode,
                verdictCategory: autopsy.verdictCategory,
                rootCause: autopsy.rootCause,
                recommendation: autopsy.recommendation,
                suggestedRemediation: autopsy.recommendation,
                confidence: 0.95,
              };
              stepAuditTrail.screenshotPath = failShotPath;
            }

            logs.push({
              step: stepNum,
              instruction: rawStep.text,
              status: 'FAILED',
              detail: reasonDetail,
              durationMs: Date.now() - stepStart,
              aiAuditTrail: stepAuditTrail,
              screenshotPath: failShotPath,
            });

            return finalizeResult({
              status: 'FAILED',
              url: options.url,
              totalSteps: compiled.totalSteps,
              completedSteps,
              failedStep: stepNum,
              reasonCode,
              reasonDetail,
              summary: `FAILED: Dừng ngay tại bước ${stepNum}/${compiled.totalSteps} (Đã hủy các bước ${stepNum + 1
                } -> ${compiled.totalSteps}) | Lý do: ${reasonDetail}`,
              screenshotPath: failShotPath,
              totalDurationMs: Date.now() - startTime,
              logs,
            });
          }

          // Trường hợp 2: Phần tử bị disabled (ELEMENT_DISABLED)
          if (target && target.disabled) {
            const pageText = await failPage.evaluate(() => document.body.innerText || '').catch(() => '');
            const autopsy = await LLMBridge.diagnoseFailureWithAI(
              rawStep.text,
              `Phần tử "${target.text || action.targetHint}" bị khóa (disabled)`,
              pageText,
              latestPreShotBase64
            );

            const reasonDetail = `Phần tử "${target.text || target.nearLabel || target.placeholder || action.targetHint
              }" (<${target.tag}>) đang bị khóa (disabled). Chi tiết: ${target.disabledReason || 'disabled=true'
              }. [AI Autopsy: (${autopsy.verdictCategory}) ${autopsy.rootCause}. Đề xuất: ${autopsy.recommendation}]`;

            const failShotName = `${prefix}fail_step_${stepNum}.png`;
            const failShotPath = path.join(outputDir, failShotName);

            await drawStatusBannerOnPage(
              failPage,
              'FAILED',
              `BƯỚC ${stepNum} FAILED: ${autopsy.rootCause || `Nút "${target.text || action.targetHint}" bị khóa`}`,
              target
            );
            await failPage.screenshot({ path: failShotPath, fullPage: false });

            if (stepAuditTrail) {
              stepAuditTrail.autopsy = {
                failureCode: 'ELEMENT_DISABLED',
                verdictCategory: autopsy.verdictCategory,
                rootCause: autopsy.rootCause,
                recommendation: autopsy.recommendation,
                suggestedRemediation: autopsy.recommendation,
                confidence: 0.95,
              };
              stepAuditTrail.screenshotPath = failShotPath;
            }

            logs.push({
              step: stepNum,
              instruction: rawStep.text,
              status: 'FAILED',
              detail: reasonDetail,
              durationMs: Date.now() - stepStart,
              aiAuditTrail: stepAuditTrail,
              screenshotPath: failShotPath,
            });

            return finalizeResult({
              status: 'FAILED',
              url: options.url,
              totalSteps: compiled.totalSteps,
              completedSteps,
              failedStep: stepNum,
              reasonCode: 'ELEMENT_DISABLED',
              reasonDetail,
              summary: `FAILED: Dừng ngay tại bước ${stepNum}/${compiled.totalSteps} | Lý do: ${reasonDetail}`,
              screenshotPath: failShotPath,
              totalDurationMs: Date.now() - startTime,
              logs,
            });
          }

          // Trường hợp 3: Phần tử bị che khuất (ELEMENT_OBSCURED)
          if (target && target.obscured) {
            const pageText = await failPage.evaluate(() => document.body.innerText || '').catch(() => '');
            const autopsy = await LLMBridge.diagnoseFailureWithAI(
              rawStep.text,
              `Phần tử "${target.text || action.targetHint}" bị che bởi "${target.obscuredBy}"`,
              pageText,
              latestPreShotBase64
            );

            const reasonDetail = `Phần tử "${target.text || action.targetHint
              }" bị che khuất bởi lớp phủ "${target.obscuredBy}" không thể thao tác. [AI Autopsy: (${autopsy.verdictCategory}) ${autopsy.rootCause}. Đề xuất: ${autopsy.recommendation}]`;

            const failShotName = `${prefix}fail_step_${stepNum}.png`;
            const failShotPath = path.join(outputDir, failShotName);

            await drawStatusBannerOnPage(
              failPage,
              'FAILED',
              `BƯỚC ${stepNum} FAILED: ${autopsy.rootCause || `Bị che bởi ${target.obscuredBy}`}`,
              target
            );
            await failPage.screenshot({ path: failShotPath, fullPage: false });

            if (stepAuditTrail) {
              stepAuditTrail.autopsy = {
                failureCode: 'ELEMENT_OBSCURED',
                verdictCategory: autopsy.verdictCategory,
                rootCause: autopsy.rootCause,
                recommendation: autopsy.recommendation,
                suggestedRemediation: autopsy.recommendation,
                confidence: 0.95,
              };
              stepAuditTrail.screenshotPath = failShotPath;
            }

            logs.push({
              step: stepNum,
              instruction: rawStep.text,
              status: 'FAILED',
              detail: reasonDetail,
              durationMs: Date.now() - stepStart,
              aiAuditTrail: stepAuditTrail,
              screenshotPath: failShotPath,
            });

            return finalizeResult({
              status: 'FAILED',
              url: options.url,
              totalSteps: compiled.totalSteps,
              completedSteps,
              failedStep: stepNum,
              reasonCode: 'ELEMENT_OBSCURED',
              reasonDetail,
              summary: `FAILED: Dừng ngay tại bước ${stepNum}/${compiled.totalSteps} | Lý do: ${reasonDetail}`,
              screenshotPath: failShotPath,
              totalDurationMs: Date.now() - startTime,
              logs,
            });
          }

          // Trường hợp 4: Lỗi thực thi ném ra từ executePhysicalAction
          if (executionError) {
            throw executionError;
          }
        }

        if (target) {
          const targetLabel =
            target.text ||
            target.placeholder ||
            target.ariaLabel ||
            target.virtualLabel ||
            target.nearLabel ||
            target.name ||
            target.elemId ||
            target.tag;
          const aiTag =
            resolved!.matchSource === 'LLM' ||
            resolved!.matchSource === 'FUZZY_HEALED' ||
            resolved!.matchSource === 'SVG_TOPOLOGY' ||
            resolved!.matchSource === 'VISION_SOM'
              ? ` [AI Self-Healed (${resolved!.matchSource}): ${resolved!.reasoning || 'Resolved'}]`
              : '';
          subDetails.push(`${action.type} -> <${target.tag}> "${targetLabel}"${aiTag}`);
        } else if (resolved?.matchSource === 'VISION_SOM') {
          subDetails.push(
            `${action.type} -> [VISION_SOM Mark #${resolved.somMarkId ?? '?'}] (${resolved.reasoning || 'L3 Vision SoM'})`
          );
        }
      }

      // Thu thập các dialogs phát sinh trong bước này trên activePage
      const curActiveInterceptor = attachDialogInterceptor(tabManager.getActivePage());
      const stepDialogs = curActiveInterceptor.consumePendingStepDialogs();
      for (const d of stepDialogs) {
        if (d.warning) {
          subDetails.push(d.warning);
        } else {
          subDetails.push(`[Hộp thoại native ${d.type}]: "${d.message}"`);
        }
      }

      // Thu thập tab logs cuối bước nếu có
      const postStepTabLogs = tabManager.consumePendingLogMessages();
      if (postStepTabLogs.length > 0) {
        subDetails.push(...postStepTabLogs);
      }

      const stepDomHash = await computePageDomHash(tabManager.getActivePage());
      const stepShotName = `${prefix}step_${stepNum}_pass.png`;
      const stepShotPath = path.join(outputDir, stepShotName);
      await tabManager.getActivePage().screenshot({ path: stepShotPath, fullPage: false }).catch(() => {});

      if (stepAuditTrail) {
        stepAuditTrail.screenshotPath = stepShotPath;
        stepAuditTrail.domHash = stepDomHash;
        if (stepAuditTrail.decision) {
          if (stepRoutingTier && !stepAuditTrail.decision.routingTier) {
            stepAuditTrail.decision.routingTier = stepRoutingTier;
          }
          if (stepSomMarkId !== undefined && stepAuditTrail.decision.somMarkId === undefined) {
            stepAuditTrail.decision.somMarkId = stepSomMarkId;
          }
          if (stepOcclusionStrategy && !stepAuditTrail.decision.occlusionStrategy) {
            stepAuditTrail.decision.occlusionStrategy = stepOcclusionStrategy;
          }
          if (stepDismissedOverlays.length > 0) {
            stepAuditTrail.decision.dismissedOverlays = [...stepDismissedOverlays];
          }
          if (stepNotificationVerdict && !stepAuditTrail.decision.notificationVerdict) {
            stepAuditTrail.decision.notificationVerdict = stepNotificationVerdict;
          }
          if (stepNotificationWarnings.length > 0) {
            stepAuditTrail.decision.notificationWarnings = [...stepNotificationWarnings];
          }
        }
      }

      completedSteps++;
      logs.push({
        step: stepNum,
        instruction: rawStep.text,
        status: 'OK',
        detail: subDetails.join(' ; '),
        durationMs: Date.now() - stepStart,
        dialogs: stepDialogs.length > 0 ? stepDialogs : undefined,
        domHash: stepDomHash,
        aiAuditTrail: stepAuditTrail,
        screenshotPath: stepShotPath,
        routingTier: stepRoutingTier,
        somMarkId: stepSomMarkId,
        occlusionStrategy: stepOcclusionStrategy,
        dismissedOverlays: stepDismissedOverlays.length > 0 ? [...stepDismissedOverlays] : undefined,
        notificationVerdict: stepNotificationVerdict,
        notificationWarnings: stepNotificationWarnings.length > 0 ? [...stepNotificationWarnings] : undefined,
      });
    }

    // Hoàn thành toàn bộ N/N bước -> Chụp ảnh pass_step_N.png trên activePage
    const finalPage = tabManager.getActivePage();
    const finalStepNum = compiled.totalSteps;
    const passShotName = `${prefix}pass_step_${finalStepNum}.png`;
    const passShotPath = path.join(outputDir, passShotName);

    await drawStatusBannerOnPage(
      finalPage,
      'PASSED',
      `PASSED: Hoàn thành ${completedSteps}/${compiled.totalSteps} bước (Bước cuối #${finalStepNum} OK)`,
      null
    );
    await finalPage.screenshot({ path: passShotPath, fullPage: false });

    const allCapturedDialogs = tabManager.getAllCapturedDialogs();
    const warningsCount = allCapturedDialogs.filter((d) => d.warning).length;
    const warningNote = warningsCount > 0 ? ` (Có ${warningsCount} cảnh báo hộp thoại native)` : '';

    return finalizeResult({
      status: 'PASSED',
      url: options.url,
      totalSteps: compiled.totalSteps,
      completedSteps,
      summary: `PASSED: Hoàn thành ${completedSteps}/${compiled.totalSteps} bước | Nhật ký từng bước OK${warningNote} | Ảnh chụp màn hình bước cuối ${passShotName}`,
      screenshotPath: passShotPath,
      totalDurationMs: Date.now() - startTime,
      logs,
      dialogs: allCapturedDialogs,
    });
  } catch (err: any) {
    const failedStep = logs.length + 1;
    const failShotName = `${prefix}fail_step_${failedStep}.png`;
    const failShotPath = path.join(outputDir, failShotName);
    const reasonDetail = `Lỗi thực thi tại bước ${failedStep}: ${err?.message || String(err)}`;

    try {
      const errorPage = tabManager ? tabManager.getActivePage() : page;
      await errorPage.screenshot({ path: failShotPath, fullPage: false });
    } catch {
      // ignore
    }

    return finalizeResult({
      status: 'FAILED',
      url: options.url,
      totalSteps: compiled.totalSteps,
      completedSteps: logs.length,
      failedStep,
      reasonCode: 'EXECUTION_ERROR' as FailureReasonCode,
      reasonDetail,
      summary: `FAILED: Dừng ngay tại bước ${failedStep}/${compiled.totalSteps} | Lý do: ${reasonDetail}`,
      screenshotPath: failShotPath,
      totalDurationMs: Date.now() - startTime,
      logs,
      dialogs: tabManager ? tabManager.getAllCapturedDialogs() : (dialogInterceptor ? dialogInterceptor.getHistory() : undefined),
    });
  } finally {
    await browser.close();
  }
}

/**
 * Thực thi hành động vật lý (Resilient Action Executor):
 * - Cuộn phần tử ra giữa màn hình (tránh Sticky Header đè lên).
 * - Với FILL: Click focus -> xóa sạch -> fill -> kiểm tra lại value (fallback gõ từng phím nếu cần).
 * - Với SEARCH: Điền từ khóa -> nhấn Enter (hoặc bấm nút tìm kiếm kế bên).
 * - Với CLICK / SELECT_ITEM: Click chuẩn xác -> nếu DOM đứng im tuyệt đối thì fallback dispatchEvent.
 * - Sau mỗi thao tác đều gọi barrier.waitForSettlement() để đợi API & DOM ổn định.
 */
export async function executePhysicalAction(
  page: Page,
  barrier: ActionSettlementBarrier,
  action: AtomicAction,
  target: DOMCandidate,
  telemetry?: PhysicalActionTelemetry
): Promise<void> {
  const targetFrame =
    target.frameIndex !== undefined && target.frameIndex < page.frames().length
      ? page.frames()[target.frameIndex]
      : page;
  const frameArg: Frame | undefined = targetFrame !== page ? (targetFrame as Frame) : undefined;

  const locator = targetFrame.locator(target.selectorPath).first();

  // Prompt 11: Nếu có lớp phủ treo (dropdown/popover/modal) đang mở và bước kế tiếp vượt ranh giới ngữ cảnh,
  // tự động giải phóng ngầm định trước khi cuộn/tương tác
  const preDismiss = await barrier
    .dismissHangingOverlaysIfCrossing({
      selector: target.selectorPath,
      elemId: target.elemId,
      rect: target.rect,
      point: target.safeClickPoint || {
        x: target.rect.x + target.rect.width / 2,
        y: target.rect.y + target.rect.height / 2,
      },
      candidate: target,
      targetHint: action.targetHint,
      actionType: action.type,
    })
    .catch(() => null);
  const preDismissLabels = extractDismissedOverlayLabels(preDismiss);
  if (preDismissLabels.length > 0 && telemetry) {
    telemetry.dismissedOverlays = Array.from(
      new Set([...(telemetry.dismissedOverlays || []), ...preDismissLabels])
    );
  }

  // Prompt 10: Cuộn phần tử vào chính giữa Safe Viewport Band [H_top + 20px, VH - H_bottom - 20px]
  const safeScrollRes = await scrollIntoSafeViewportBand(page, target, {
    frame: frameArg,
  }).catch(() => null);

  if (!safeScrollRes || !safeScrollRes.inSafeBand) {
    await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    await locator
      .evaluate((el) => {
        if (typeof (el as any).scrollIntoViewIfNeeded === 'function') {
          (el as any).scrollIntoViewIfNeeded();
        } else {
          el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
        }
      })
      .catch(() => {});
  } else if (safeScrollRes.afterRect) {
    target.rect = safeScrollRes.afterRect;
  }
  await waitForUIQuiescence(page, 300, barrier);

  if (action.type === 'HOVER') {
    await locator.hover({ timeout: 5000 });
    await waitForUIQuiescence(page, 2000, barrier);
    return;
  }

  if (action.type === 'SELECT_OPTION') {
    const val = action.value || action.targetHint || '';
    if (target.tag === 'select') {
      const selLoc = targetFrame.locator(target.selectorPath).first();
      await selLoc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      try {
        await selLoc.selectOption({ label: val }, { timeout: 3000 });
      } catch {
        await selLoc.selectOption({ value: val }, { timeout: 3000 });
      }
      await selLoc.evaluate((el) => {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }).catch(() => {});
      await waitForUIQuiescence(page, 500, barrier);
      return;
    }

    // Custom Select Trigger (React-Select, Ant Design, Material-UI, Select2)
    const customRes = await executeCustomDropdownProtocol(page, barrier, target, val);
    if (!customRes.success) {
      throw new Error(customRes.error || `Không thể chọn option "${val}" từ custom dropdown`);
    }
    return;
  }

  if (action.type === 'FILL') {
    const val = action.value || '';
    await locator.click({ timeout: 4000 });
    let activeLocator =
      (await locator.count()) > 0
        ? locator
        : page.locator('input:focus, textarea:focus').first();

    try {
      await activeLocator.fill(val, { timeout: 2500 });
    } catch {
      // Nếu framework (như Wikipedia Vue Codex) thay thế thẻ stub <input> ngay giữa lúc đang fill
      activeLocator = page
        .locator('input:focus, textarea:focus, input[type="text"]:visible, input[type="search"]:visible')
        .first();
      await activeLocator.fill(val, { timeout: 4000 });
    }

    // Trụ cột 12: Post-Fill Masked Input Integrity Verification
    let actualVal = await activeLocator.inputValue().catch(() => '');
    if (!actualVal) {
      actualVal = await activeLocator.evaluate((el: any) => el.value || el.innerText || '').catch(() => '');
    }

    // Nếu giá trị thực tế không chứa đủ chuỗi ký tự cần nhập (do mask nuốt ký tự)
    if (!checkMaskedInputIntegrity(actualVal, val)) {
      // Fallback: Focus vào ô, nhấn Ctrl+A, Backspace, sau đó dùng page.keyboard.pressSequentially(value, { delay: 60 })
      if (typeof (page.keyboard as any).pressSequentially !== 'function') {
        (page.keyboard as any).pressSequentially = (text: string, opts?: any) => page.keyboard.type(text, opts);
      }
      await activeLocator.focus().catch(() => {});
      try {
        await page.keyboard.press('ControlOrMeta+a');
      } catch {
        await page.keyboard.press('Control+a');
      }
      await page.keyboard.press('Backspace');
      await activeLocator.evaluate((el: any) => { if (el.value) el.value = ''; }).catch(() => {});
      await (page.keyboard as any).pressSequentially(val, { delay: 60 });
    } else if (actualVal !== val && !normalizeMaskedValue(actualVal).includes(normalizeMaskedValue(val))) {
      await activeLocator.selectText().catch(() => {});
      await page.keyboard.press('Backspace');
      await activeLocator.pressSequentially(val, { delay: 25 });
    }

    // Bắn sự kiện blur nhẹ để kích hoạt form validation nếu có
    await activeLocator
      .evaluate((el) => {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })
      .catch(() => { });
    await waitForUIQuiescence(page, 1500, barrier);
    return;
  }

  if (action.type === 'SEARCH') {
    const val = action.value || '';
    await locator.click({ timeout: 4000 });
    await waitForUIQuiescence(page, 300, barrier);
    let activeSearchLocator =
      (await locator.count()) > 0
        ? locator
        : page.locator('input:focus, input[type="search"]:visible, input[name="search"]:visible').first();

    try {
      await activeSearchLocator.fill(val, { timeout: 2500 });
    } catch {
      // Nếu framework (như Wikipedia Vue Codex) tải xong bundle bất đồng bộ và thay thế thẻ <input> ngay giữa lúc đang fill
      activeSearchLocator = page
        .locator('input:focus, input[type="search"]:visible, input[name="search"]:visible')
        .first();
      await activeSearchLocator.fill(val, { timeout: 4000 });
    }

    // Trụ cột 12: Post-Fill Masked Input Integrity Verification cho SEARCH
    let actualSearchVal = await activeSearchLocator.inputValue().catch(() => '');
    if (!actualSearchVal) {
      actualSearchVal = await activeSearchLocator.evaluate((el: any) => el.value || el.innerText || '').catch(() => '');
    }

    if (!checkMaskedInputIntegrity(actualSearchVal, val)) {
      if (typeof (page.keyboard as any).pressSequentially !== 'function') {
        (page.keyboard as any).pressSequentially = (text: string, opts?: any) => page.keyboard.type(text, opts);
      }
      await activeSearchLocator.focus().catch(() => {});
      try {
        await page.keyboard.press('ControlOrMeta+a');
      } catch {
        await page.keyboard.press('Control+a');
      }
      await page.keyboard.press('Backspace');
      await activeSearchLocator.evaluate((el: any) => { if (el.value) el.value = ''; }).catch(() => {});
      await (page.keyboard as any).pressSequentially(val, { delay: 60 });
      await activeSearchLocator
        .evaluate((el) => {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        })
        .catch(() => {});
    }

    await page.keyboard.press('Enter');
    await waitForUIQuiescence(page, 6000, barrier);
    return;
  }

  if (action.type === 'CLICK' || action.type === 'SELECT_ITEM') {
    // Nếu target là Custom Select Trigger và kịch bản có kèm giá trị option cần chọn
    if (isCustomSelectTrigger(target) && action.value) {
      const customRes = await executeCustomDropdownProtocol(page, barrier, target, action.value);
      if (!customRes.success) {
        throw new Error(customRes.error || `Không thể chọn "${action.value}" từ custom dropdown`);
      }
      return;
    }

    // Trường hợp chọn <option> bên trong thẻ <select> native
    if (target.tag === 'option') {
      await locator.evaluate((el) => {
        const opt = el as HTMLOptionElement;
        const sel = opt.closest('select');
        if (sel) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('input', { bubbles: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await waitForUIQuiescence(page, 4000, barrier);
      return;
    }

    // Prompt 11: Ghi nhận trigger nếu phần tử có khả năng mở dropdown/popover/modal
    if (isPotentialOverlayTrigger(target)) {
      barrier.recordOverlayTrigger(target);
    }

    // Prompt 10: Safe Viewport Band + 5-Point Hit-Test + Sutherland-Hodgman Centroid (>=40%, >=24x24px)
    // Bảo đảm 100% sự kiện vật lý tin cậy (isTrusted: true), tuyệt đối KHÔNG bypass bằng JS synthetic el.click()
    let safeRes: SafeClickResolution | null = await resolveSafeClickPoint(
      page,
      target.rect,
      target,
      { autoScroll: true, frame: frameArg }
    ).catch(() => null);

    // Nếu bị che hoàn toàn (FULLY_OCCLUDED) hoặc vùng hở không đủ (<40% / <24x24px):
    // Kích hoạt thang cứu nguy Prompt 11 (Implicit Dismissal) & Prompt 13 (4-Tier Toast Evasion) rồi tái kiểm tra
    if (safeRes && !safeRes.canClick && safeRes.requiresDismissalLadder) {
      const escDismiss = await barrier
        .dismissHangingOverlaysIfCrossing({
          selector: target.selectorPath,
          elemId: target.elemId,
          rect: safeRes.targetRect || target.rect,
          candidate: target,
          targetHint: action.targetHint,
          actionType: action.type,
        })
        .catch(() => null);
      const escDismissLabels = extractDismissedOverlayLabels(escDismiss);
      if (escDismissLabels.length > 0 && telemetry) {
        telemetry.dismissedOverlays = Array.from(
          new Set([...(telemetry.dismissedOverlays || []), ...escDismissLabels])
        );
      }

      const hasToastObstacle = safeRes.obstacles.some((o) => o.category === 'toast');
      if (hasToastObstacle || escDismissLabels.length === 0) {
        const toastClickRes = await barrier
          .clickTargetWithToastEvasion(
            { rect: safeRes.targetRect || target.rect, selectorPath: target.selectorPath },
            { targetSelector: target.selectorPath }
          )
          .catch(() => null);

        if (toastClickRes && toastClickRes.clicked && toastClickRes.evasion.occludedInitially) {
          if (telemetry) {
            telemetry.occlusionStrategy = `TOAST_EVASION_${toastClickRes.evasion.strategy}`;
            telemetry.resolvedClickPoint = toastClickRes.evasion.clickPoint;
          }
          await waitForUIQuiescence(page, 7000, barrier);
          return;
        }
      }

      // Tái đánh giá tọa độ click an toàn sau khi dẹp vật cản
      safeRes = await resolveSafeClickPoint(
        page,
        safeRes.targetRect || target.rect,
        target,
        { autoScroll: true, frame: frameArg }
      ).catch(() => safeRes);
    }

    if (safeRes && safeRes.canClick && safeRes.clickPoint) {
      if (telemetry) {
        telemetry.occlusionStrategy =
          safeRes.scrolledToSafeBand && safeRes.strategy === 'CENTER'
            ? 'SAFE_BAND_SCROLL'
            : safeRes.strategy;
        telemetry.resolvedClickPoint = safeRes.clickPoint;
      }
      await page.mouse.move(safeRes.clickPoint.x, safeRes.clickPoint.y);
      await page.mouse.click(safeRes.clickPoint.x, safeRes.clickPoint.y);
    } else if (
      safeRes &&
      (safeRes.status === 'FULLY_OCCLUDED' || safeRes.status === 'INSUFFICIENT_EXPOSED_AREA')
    ) {
      throw new Error(
        `ELEMENT_OBSCURED (${safeRes.status}): ${safeRes.reason}`
      );
    } else {
      // Fallback sang Playwright physical locator.click() (vẫn đảm bảo isTrusted: true)
      if (telemetry && !telemetry.occlusionStrategy) {
        telemetry.occlusionStrategy = 'PLAYWRIGHT_PHYSICAL_CLICK';
      }
      await locator.click({ timeout: 15000 });
    }

    await waitForUIQuiescence(page, 7000, barrier);
  }
}

export const executeStepAction = executePhysicalAction;

/**
 * Vẽ khung khoanh vùng phần tử bị lỗi và thanh trạng thái lên màn hình trước khi chụp ảnh bằng chứng.
 */
async function drawStatusBannerOnPage(
  page: Page,
  status: 'PASSED' | 'FAILED',
  message: string,
  target: DOMCandidate | null
): Promise<void> {
  try {
    await page.evaluate(
      ({ st, msg, rect }) => {
        const color = st === 'PASSED' ? '#16a34a' : '#dc2626';

        // Vẽ khung khoanh vùng phần tử lỗi nếu có
        if (rect) {
          const box = document.createElement('div');
          box.style.position = 'fixed';
          box.style.left = `${rect.x - 4}px`;
          box.style.top = `${rect.y - 4}px`;
          box.style.width = `${rect.width + 8}px`;
          box.style.height = `${rect.height + 8}px`;
          box.style.border = `3px solid ${color}`;
          box.style.backgroundColor =
            st === 'PASSED' ? 'rgba(22, 163, 74, 0.12)' : 'rgba(220, 38, 38, 0.18)';
          box.style.zIndex = '2147483646';
          box.style.pointerEvents = 'none';
          box.style.borderRadius = '6px';
          document.body.appendChild(box);
        }

        // Vẽ thanh thông báo kết quả ở góc trên
        const banner = document.createElement('div');
        banner.style.position = 'fixed';
        banner.style.top = '10px';
        banner.style.right = '10px';
        banner.style.maxWidth = '620px';
        banner.style.padding = '10px 16px';
        banner.style.backgroundColor = color;
        banner.style.color = '#ffffff';
        banner.style.fontFamily = 'system-ui, sans-serif';
        banner.style.fontSize = '14px';
        banner.style.fontWeight = '700';
        banner.style.borderRadius = '8px';
        banner.style.boxShadow = '0 4px 16px rgba(0,0,0,0.35)';
        banner.style.zIndex = '2147483647';
        banner.style.pointerEvents = 'none';
        banner.textContent = msg;
        document.body.appendChild(banner);
      },
      { st: status, msg: message, rect: target?.rect || null }
    );
  } catch {
    // ignore
  }
}
