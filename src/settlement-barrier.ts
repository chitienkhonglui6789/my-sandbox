import { Page, Request } from 'playwright';
import { DOMCandidate } from './types';
import {
  ActiveOverlayInfo,
  DismissalOptions,
  DismissalResult,
  ImplicitDismissalManager,
  NextTargetInfo,
  TriggerRecord,
  getOrCreateImplicitDismissalManager,
} from './implicit-dismissal';
import {
  ClickWithEvasionResult,
  DetectNotificationsOptions,
  DetectedNotification,
  NotificationClassificationInput,
  NotificationOracleReport,
  NotificationStepContext,
  PointerEventsIsolationResult,
  TargetInput,
  ToastEvasionOptions,
  ToastEvasionResult,
  clickTargetWithToastEvasion,
  detectVisibleNotifications,
  evaluateNotificationsAgainstStep,
  evadeOccludingToasts as runToastEvasionLadder,
  withToastPointerEventsIsolation as runWithToastPointerEventsIsolation,
} from './notification-oracle';

export type {
  ActiveOverlayInfo,
  DismissalOptions,
  DismissalResult,
  NextTargetInfo,
  TriggerRecord,
  DetectNotificationsOptions,
  DetectedNotification,
  NotificationOracleReport,
  NotificationStepContext,
  TargetInput,
  ToastEvasionOptions,
  ToastEvasionResult,
  ClickWithEvasionResult,
  PointerEventsIsolationResult,
};

export interface VerifyExpectedTextResult {
  matched: boolean;
  detectedPageErrors: string[];
  notificationReport?: NotificationOracleReport;
  warningLogs?: string[];
  successEvidences?: string[];
}

export interface UnexpectedPageErrorsResult {
  errors: string[];
  report: NotificationOracleReport;
}

const IGNORED_TRACKER_PATTERNS =
  /google-analytics|googletagmanager|googlesyndication|doubleclick|googleads|youtubei\/v1\/log_event|ptracking|stats\/qoe|stats\/watchtime|play\.google\.com|facebook|connect\.facebook|pixel|tiktok|criteo|sentry|backtrace\.io|hotjar|clarity\.ms|tawk|zalo|socket\.io|favicon\.ico|appsflyer|mixpanel|datadoghq|newrelic|segment\.io|amplitude|fullstory|onetrust|cookiebot/i;

declare global {
  interface Window {
    __autotestObserverInstalled?: boolean;
    __autotestState?: {
      lastMutationTime: number;
      mutationCount: number;
      recentTexts: { text: string; timestamp: number }[];
    };
  }
}

/**
 * Rào chắn đồng bộ 4 pha (ActionSettlementBarrier - Production Web Edition):
 * 1. Chống lỗi bất đồng bộ khi gọi API ngầm (XHR/Fetch).
 * 2. Tự động bỏ qua các tracker, pixel quảng cáo và request analytics.
 * 3. Chống kẹt vô tận khi trang có Live Ticker / Video Streaming / Websocket / Polling.
 * 4. Tự động đóng các hộp thoại native alert/confirm/prompt (nhường quyền cho NativeDialogInterceptor nếu có).
 * 5. Bộ đệm TransientTextBuffer bắt trúng các thông báo Toast tự biến mất sau 1-2 giây.
 * 6. Tích hợp Trụ cột 18 (Prompt 11): Implicit Dismissal Protocol cho Dropdown / Popover / Modal treo.
 * 7. Tích hợp Trụ cột 17 (Prompt 13): IEEE 29119 Notification Oracle & 4-Tier Toast Evasion Ladder.
 */
export class ActionSettlementBarrier {
  private page: Page;
  private inflightRequests = new Set<Request>();
  private lastNetworkActivityTime = Date.now();
  private lastInflightNonZeroTime = Date.now();
  private dismissalManager: ImplicitDismissalManager;

  constructor(page: Page) {
    this.page = page;
    this.dismissalManager = getOrCreateImplicitDismissalManager(page);
    this.setupNetworkListeners();
  }

  /**
   * Cập nhật lại đối tượng page khi chuyển tab hoặc mở popup mới
   */
  public updatePage(newPage: Page): void {
    this.page = newPage;
    this.inflightRequests.clear();
    this.lastNetworkActivityTime = Date.now();
    this.lastInflightNonZeroTime = Date.now();
    this.dismissalManager = getOrCreateImplicitDismissalManager(newPage);
    this.setupNetworkListeners();
  }

  public resetQuietTimers(): void {
    this.lastInflightNonZeroTime = Date.now();
  }

  public getInflightCount(): number {
    return this.inflightRequests.size;
  }

  // ==========================================================================
  // TRỤ CỘT 18 (PROMPT 11): HANGING OVERLAYS & IMPLICIT DISMISSAL PROTOCOL
  // ==========================================================================

  /**
   * Trả về ImplicitDismissalManager gắn với trang hiện tại.
   */
  public getImplicitDismissalManager(): ImplicitDismissalManager {
    if (!this.dismissalManager) {
      this.dismissalManager = getOrCreateImplicitDismissalManager(this.page);
    }
    return this.dismissalManager;
  }

  /**
   * Quét toàn bộ lớp phủ tương tác đang mở (Dropdown, Popover, Modal/Dialog)
   * thông qua `detectActiveOverlays(this.page)` và đồng bộ ActiveOverlayTracker.
   */
  public async getActiveOverlays(): Promise<ActiveOverlayInfo[]> {
    return this.getImplicitDismissalManager().syncActiveOverlays();
  }

  /**
   * Ghi nhận nút Trigger vừa tương tác (Dropdown / Popover trigger)
   * để phục vụ Tier 2 Re-Toggle khi component không hỗ trợ phím Escape.
   */
  public recordOverlayTrigger(
    trigger: (Omit<TriggerRecord, 'timestamp'> & { timestamp?: number }) | DOMCandidate
  ): void {
    const manager = this.getImplicitDismissalManager();
    if ('candidateId' in trigger && 'selectorPath' in trigger) {
      manager.recordCandidateInteraction(trigger);
      return;
    }
    manager.recordTrigger({
      ...trigger,
      timestamp: trigger.timestamp ?? Date.now(),
    });
  }

  /**
   * Kiểm tra Context-Boundary Crossing với mục tiêu tiếp theo `nextTarget`
   * và tự động giải phóng lớp phủ treo theo thang 4 cấp (Tier 1 Escape + 150ms quiescence ->
   * Tier 2 Re-Toggle Trigger -> Tier 3 Safe Neutral Click -> Tier 4 Modal Safe Dismiss w/ Antonym Guardrail).
   */
  public async dismissHangingOverlaysIfCrossing(
    nextTarget: NextTargetInfo,
    options: Partial<DismissalOptions> = {}
  ): Promise<DismissalResult> {
    return this.getImplicitDismissalManager().ensureDismissedBeforeAction(nextTarget, options);
  }

  // ==========================================================================
  // TRỤ CỘT 17 (PROMPT 13): ADAPTIVE NOTIFICATION ORACLE & 4-TIER TOAST EVASION
  // ==========================================================================

  /**
   * Quét và phân loại tất cả thông báo Toast/Snackbar/Alert/Banner đang hiển thị
   * theo chuẩn IEEE 29119 (SUCCESS, INFO, WARNING, ERROR).
   */
  public async detectNotifications(
    options: DetectNotificationsOptions = {}
  ): Promise<DetectedNotification[]> {
    return detectVisibleNotifications(this.page, options);
  }

  /**
   * Đối soát toàn bộ thông báo đang hiển thị với ngữ cảnh bước kiểm thử hiện tại:
   * - SUCCESS -> SUCCESS_EVIDENCE (ghi bằng chứng PASS, cấm đánh trượt)
   * - INFO    -> IGNORED (bỏ qua sạch sẽ)
   * - WARNING -> WARNING_LOGGED (ghi log cảnh báo vàng, cấm đánh trượt)
   * - ERROR khớp kỳ vọng ca phủ định -> EXPECTED_PASS
   * - ERROR ngoài kỳ vọng -> PRODUCT_DEFECT
   */
  public async evaluateStepNotifications(
    stepContext?: NotificationStepContext,
    detectOptions: DetectNotificationsOptions = {}
  ): Promise<NotificationOracleReport> {
    const notifications = await this.detectNotifications(detectOptions);
    return evaluateNotificationsAgainstStep(notifications, stepContext);
  }

  /**
   * Thực thi Thang né tránh Toast 4 cấp (4-Tier Toast Evasion Ladder) khi Toast nổi che nút mục tiêu:
   * - Tier 1 (Auto-Dismiss): Click nút đóng ✕ hoặc gửi Escape.
   * - Tier 2 (Spatial Evasion): Click trọng tâm vùng hở >= 40% & >= 24x24px.
   * - Tier 3 (Smart TTL Drain): Chờ Toast tự tiêu biến trong cửa sổ TTL.
   * - Tier 4 (Pointer-Events Isolation): Áp dụng `pointer-events: none` tạm thời kèm callback `restore()`.
   */
  public async evadeOccludingToasts(
    targetRect: TargetInput,
    options: ToastEvasionOptions = {}
  ): Promise<ToastEvasionResult> {
    return runToastEvasionLadder(this.page, targetRect, options);
  }

  /**
   * Kết hợp Thang né tránh Toast 4 cấp với cú click vật lý Playwright (`isTrusted: true`)
   * và tự động khôi phục `pointer-events` trong khối `finally`.
   */
  public async clickTargetWithToastEvasion(
    target: TargetInput,
    options: ToastEvasionOptions = {}
  ): Promise<ClickWithEvasionResult> {
    return clickTargetWithToastEvasion(this.page, target, options);
  }

  /**
   * Helper RAII tạm thời cô lập `pointer-events: none` trên container Toast bị kẹt
   * và bảo đảm khôi phục nguyên trạng trong `finally`.
   */
  public async withToastPointerEventsIsolation<T>(
    toastTargets: Array<string | Pick<DetectedNotification, 'selector'>>,
    action: () => Promise<T>
  ): Promise<PointerEventsIsolationResult<T>> {
    return runWithToastPointerEventsIsolation(this.page, toastTargets, action);
  }

  /**
   * Quét các thông báo lỗi thực sự ngoài kỳ vọng (PRODUCT_DEFECT) theo chuẩn IEEE 29119.
   * Tuyệt đối KHÔNG gắn cờ sai cho thông báo SUCCESS (xanh lục, "thành công"), INFO (xanh dương),
   * WARNING (vàng, "mật khẩu yếu"), hoặc ERROR đã được ca kiểm thử phủ định kỳ vọng (EXPECTED_PASS).
   */
  public async detectUnexpectedPageErrors(
    stepContext?: NotificationStepContext
  ): Promise<UnexpectedPageErrorsResult> {
    const detectedNotifications = await this.detectNotifications();

    // Thu thập thêm các thông báo lỗi inline thuần túy (VD: .error-msg, .field-error, .text-danger)
    // chưa nằm trong danh sách notification container đã quét, nhưng PHẢI phân loại qua IEEE 29119
    // để tránh False Positive trên các phần tử thành công/cảnh báo/thông tin.
    await this.ensureInPageObserver();
    const extraInlineInputs: NotificationClassificationInput[] = await this.page
      .evaluate(() => {
        const items: Array<{
          text: string;
          className: string;
          role?: string;
          backgroundColor: string;
          borderColor: string;
          color: string;
        }> = [];
        const seenTexts = new Set<string>();
        const nodes = document.querySelectorAll('[class*="error" i], [class*="danger" i]');

        for (let i = 0; i < nodes.length; i++) {
          const el = nodes[i] as HTMLElement;
          if (el.id === 'autotest-status-banner' || el.hasAttribute('data-autotest-overlay')) continue;
          if (el.hasAttribute('data-autotest-notif-id') || el.closest('[data-autotest-notif-id]')) continue;
          if (el.querySelector('[data-autotest-notif-id]')) continue;

          const style = window.getComputedStyle(el);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            parseFloat(style.opacity || '1') <= 0.05
          ) {
            continue;
          }

          const rect = el.getBoundingClientRect();
          if (rect.width <= 20 || rect.height <= 10) continue;

          const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          if (text.length <= 5 || text.length >= 200 || seenTexts.has(text)) continue;
          seenTexts.add(text);

          items.push({
            text,
            className: typeof el.className === 'string' ? el.className : '',
            role: el.getAttribute('role') || undefined,
            backgroundColor: style.backgroundColor || '',
            borderColor: style.borderLeftColor || style.borderColor || '',
            color: style.color || '',
          });
        }
        return items.slice(0, 6);
      })
      .catch(() => []);

    const existingTexts = new Set(
      detectedNotifications.map((n) => n.text.toLowerCase().trim()).filter(Boolean)
    );
    const mergedInputs: Array<DetectedNotification | NotificationClassificationInput> = [
      ...detectedNotifications,
    ];

    for (const extra of extraInlineInputs) {
      const key = (extra.text || '').toLowerCase().trim();
      if (key && !existingTexts.has(key)) {
        existingTexts.add(key);
        mergedInputs.push(extra);
      }
    }

    const report = evaluateNotificationsAgainstStep(mergedInputs, stepContext);
    const errors: string[] = [];
    for (const item of report.items) {
      if (item.verdict === 'PRODUCT_DEFECT') {
        const text = (item.notification.text || '').trim();
        if (text && !errors.includes(text)) {
          errors.push(text);
        }
      }
    }

    return {
      errors: errors.slice(0, 3),
      report,
    };
  }

  private isBusinessRequest(req: Request): boolean {
    const type = req.resourceType();
    if (!['fetch', 'xhr', 'document'].includes(type)) return false;
    const url = req.url();
    if (IGNORED_TRACKER_PATTERNS.test(url)) return false;
    return true;
  }

  private setupNetworkListeners(): void {
    this.page.on('request', (req) => {
      if (this.isBusinessRequest(req)) {
        this.inflightRequests.add(req);
        this.lastNetworkActivityTime = Date.now();
        this.lastInflightNonZeroTime = Date.now();
      }
    });

    const onDone = (req: Request) => {
      if (this.inflightRequests.has(req)) {
        this.inflightRequests.delete(req);
        this.lastNetworkActivityTime = Date.now();
        if (this.inflightRequests.size > 0) {
          this.lastInflightNonZeroTime = Date.now();
        }
      }
    };

    this.page.on('requestfinished', onDone);
    this.page.on('requestfailed', onDone);

    // Tự động đóng hộp thoại native alert/confirm/prompt (nếu chưa có NativeDialogInterceptor đăng ký)
    this.page.on('dialog', async (dialog) => {
      if ((this.page as any).__nativeDialogInterceptor) {
        return;
      }
      try {
        await dialog.accept();
      } catch {
        // ignore
      }
    });
  }

  public async ensureInPageObserver(): Promise<void> {
    try {
      await this.page
        .evaluate(
          'var __name = globalThis.__name = window.__name = globalThis.__name || function(fn) { return fn; };'
        )
        .catch(() => {});

      await this.page.evaluate(() => {
        if (window.__autotestObserverInstalled) return;
        window.__autotestObserverInstalled = true;
        window.__autotestState = {
          lastMutationTime: Date.now(),
          mutationCount: 0,
          recentTexts: [],
        };

        const pushTransientText = (raw: string | null | undefined) => {
          const cleaned = (raw || '').replace(/\s+/g, ' ').trim();
          if (!cleaned || cleaned.length > 300) return;
          const now = Date.now();
          const state = window.__autotestState!;
          state.recentTexts.push({ text: cleaned, timestamp: now });
          state.recentTexts = state.recentTexts.filter((item) => now - item.timestamp <= 12000);
        };

        const observer = new MutationObserver((mutations) => {
          const state = window.__autotestState!;
          state.lastMutationTime = Date.now();
          state.mutationCount += mutations.length;

          for (const m of mutations) {
            if (m.type === 'childList') {
              m.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  const el = node as HTMLElement;
                  pushTransientText(el.innerText || el.textContent);
                } else if (node.nodeType === Node.TEXT_NODE) {
                  pushTransientText(node.textContent);
                }
              });
            } else if (m.type === 'characterData') {
              pushTransientText(m.target.textContent);
            }
          }
        });

        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
      });
    } catch {
      // ignore
    }
  }

  /**
   * Triển khai Trụ cột 1 & 2 theo QUY_CHUAN_AI_RESOLVER.md (UI Quiescence Watcher):
   * 1. Theo dõi Inflight Network Requests: Đợi cho đến khi Inflight = 0 duy trì liên tục trong tối thiểu 300ms.
   * 2. Lắng nghe DOM Mutation: Đảm bảo không có node nào được thêm/xóa/sửa thuộc tính trong 200ms cuối.
   * 3. Kiểm tra Spinner/Skeleton: Đợi các selector phổ biến biến mất hoặc ẩn đi (display: none / visibility: hidden).
   */
  public async waitForQuiescence(timeoutMs = 7000): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 50;
    const requiredNetworkQuietMs = 300;
    const requiredDomQuietMs = 200;

    await this.ensureInPageObserver();

    while (Date.now() - startTime < timeoutMs) {
      const now = Date.now();

      // Đảm bảo in-page observer vẫn hoạt động nếu trang vừa chuyển trang
      await this.ensureInPageObserver();

      // 1. Inflight Network: Inflight = 0 duy trì liên tục trong tối thiểu 300ms
      const inflightCount = this.inflightRequests.size;
      if (inflightCount > 0) {
        this.lastInflightNonZeroTime = now;
      }
      const networkQuietMs = inflightCount === 0 ? now - this.lastInflightNonZeroTime : 0;
      const isNetworkQuiet = inflightCount === 0 && networkQuietMs >= requiredNetworkQuietMs;

      // 2. Spinner / Skeleton
      const hasActiveSpinner = await this.page
        .evaluate(() => {
          const spinnerSelectors = [
            '[aria-busy="true"]',
            '.spinner',
            '.loading',
            '.loader',
            '.skeleton',
            '[data-loading]',
            '[role="progressbar"]',
            '.ant-spin-spinning',
            '.shopee-loading-spinner',
            '.v-progress-circular--indeterminate',
            '[class*="skeleton" i]',
            '[class*="spinner" i]',
          ];
          for (const sel of spinnerSelectors) {
            const els = document.querySelectorAll(sel);
            for (const el of Array.from(els)) {
              const r = el.getBoundingClientRect();
              const ariaBusy = el.getAttribute('aria-busy') === 'true';
              const hasDataLoading = el.hasAttribute('data-loading');
              if (ariaBusy || hasDataLoading || (r.width > 4 && r.height > 4)) {
                const style = window.getComputedStyle(el);
                if (
                  style.display !== 'none' &&
                  style.visibility !== 'hidden' &&
                  style.opacity !== '0'
                ) {
                  return true;
                }
              }
            }
          }
          return false;
        })
        .catch(() => false);

      // 3. DOM Mutation: Đảm bảo không có node nào được thêm/xóa/sửa thuộc tính trong 200ms cuối
      const domState = await this.page
        .evaluate(() => {
          const s = window.__autotestState;
          if (!s) return { quietMs: 9999, mutCount: 0 };
          return {
            quietMs: Date.now() - s.lastMutationTime,
            mutCount: s.mutationCount,
          };
        })
        .catch(() => ({ quietMs: 9999, mutCount: 0 }));

      // Chống treo vô tận: Trang video streaming hoặc ticker chứng khoán
      const isHighFrequencyStreaming =
        domState.mutCount > 50 &&
        isNetworkQuiet &&
        !hasActiveSpinner &&
        now - this.lastNetworkActivityTime > 1200;

      const isDomQuiet = domState.quietMs >= requiredDomQuietMs || isHighFrequencyStreaming;

      if (isNetworkQuiet && !hasActiveSpinner && isDomQuiet) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }

  public async waitForSettlement(maxWaitMs = 6000): Promise<void> {
    await this.waitForQuiescence(maxWaitMs);
  }

  /**
   * Xác nhận nội dung văn bản kỳ vọng xuất hiện (bao gồm cả Toast tự biến mất),
   * đồng thời áp dụng IEEE 29119 Notification Oracle để loại bỏ 100% False Positive
   * trên thông báo SUCCESS / INFO / WARNING / EXPECTED_PASS.
   */
  public async verifyExpectedText(
    expectedText: string,
    timeoutMs = 12000,
    stepContext?: NotificationStepContext
  ): Promise<VerifyExpectedTextResult> {
    const start = Date.now();
    const cleanExpected = expectedText.toLowerCase().trim();
    const effectiveStepContext: NotificationStepContext = {
      ...stepContext,
      action: stepContext?.action ?? {
        type: 'ASSERT_TEXT',
        expectedText,
      },
      expectedErrorTexts: Array.from(
        new Set([...(stepContext?.expectedErrorTexts || []), expectedText])
      ),
    };

    while (Date.now() - start < timeoutMs) {
      await this.ensureInPageObserver();

      const foundOnMain = await this.page
        .evaluate((target) => {
          const pageText = (document.body ? document.body.innerText : '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
          const pageTitle = (document.title || '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();

          if (pageText.includes(target) || pageTitle.includes(target)) {
            return true;
          }

          // Kiểm tra bộ đệm Toast biến mất
          const state = window.__autotestState;
          if (state && state.recentTexts) {
            for (let i = 0; i < state.recentTexts.length; i++) {
              const itemText = (state.recentTexts[i].text || '')
                .toLowerCase()
                .replace(/\s+/g, ' ')
                .trim();
              if (itemText.includes(target)) {
                return true;
              }
            }
          }

          return false;
        }, cleanExpected)
        .catch(() => false);

      if (foundOnMain) {
        const notificationReport = await this.evaluateStepNotifications(effectiveStepContext).catch(
          () => undefined
        );
        return {
          matched: true,
          detectedPageErrors: [],
          notificationReport,
          warningLogs: notificationReport?.warningLogs,
          successEvidences: notificationReport?.successEvidences,
        };
      }

      // Kiểm tra trong các iframes nếu chưa thấy ở trang chính
      for (const frame of this.page.frames()) {
        if (frame === this.page.mainFrame()) continue;
        try {
          const frameMatch = await frame.evaluate((target) => {
            const t = (document.body?.innerText || '').toLowerCase();
            return t.includes(target);
          }, cleanExpected);
          if (frameMatch) {
            const notificationReport = await this.evaluateStepNotifications(
              effectiveStepContext
            ).catch(() => undefined);
            return {
              matched: true,
              detectedPageErrors: [],
              notificationReport,
              warningLogs: notificationReport?.warningLogs,
              successEvidences: notificationReport?.successEvidences,
            };
          }
        } catch {
          // ignore
        }
      }

      await new Promise((r) => setTimeout(r, 250));
    }

    // Lần quét cuối cùng qua IEEE 29119 Notification Oracle trước khi quyết định FAILED:
    // Chỉ báo các lỗi ERROR ngoài kỳ vọng (PRODUCT_DEFECT), tuyệt đối không báo nhầm SUCCESS/INFO/WARNING/EXPECTED_PASS.
    const unexpected = await this.detectUnexpectedPageErrors(effectiveStepContext).catch(() => ({
      errors: [] as string[],
      report: undefined,
    }));

    return {
      matched: false,
      detectedPageErrors: unexpected.errors,
      notificationReport: unexpected.report,
      warningLogs: unexpected.report?.warningLogs,
      successEvidences: unexpected.report?.successEvidences,
    };
  }

  /**
   * Xác nhận URL trang web thỏa mãn điều kiện
   */
  public async verifyExpectedUrl(expectedPart: string, timeoutMs = 8000): Promise<boolean> {
    const start = Date.now();
    const cleanExpected = expectedPart.toLowerCase().trim();

    while (Date.now() - start < timeoutMs) {
      const current = this.page.url().toLowerCase();
      if (current.includes(cleanExpected)) {
        return true;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return this.page.url().toLowerCase().includes(cleanExpected);
  }
}
