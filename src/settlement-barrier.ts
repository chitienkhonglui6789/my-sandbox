import { Page, Request } from 'playwright';

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
 * 4. Tự động đóng các hộp thoại native alert/confirm/prompt.
 * 5. Bộ đệm TransientTextBuffer bắt trúng các thông báo Toast tự biến mất sau 1-2 giây.
 */
export class ActionSettlementBarrier {
  private page: Page;
  private inflightRequests = new Set<Request>();
  private lastNetworkActivityTime = Date.now();
  private lastInflightNonZeroTime = Date.now();

  constructor(page: Page) {
    this.page = page;
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
    this.setupNetworkListeners();
  }

  public resetQuietTimers(): void {
    this.lastInflightNonZeroTime = Date.now();
  }

  public getInflightCount(): number {
    return this.inflightRequests.size;
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
      await this.page.evaluate(
        'var __name = globalThis.__name = window.__name = globalThis.__name || function(fn) { return fn; };'
      ).catch(() => {});

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
   * Xác nhận nội dung văn bản kỳ vọng xuất hiện (bao gồm cả Toast tự biến mất)
   */
  public async verifyExpectedText(
    expectedText: string,
    timeoutMs = 12000
  ): Promise<{ matched: boolean; detectedPageErrors: string[] }> {
    const start = Date.now();
    const cleanExpected = expectedText.toLowerCase().trim();

    while (Date.now() - start < timeoutMs) {
      await this.ensureInPageObserver();

      const result = await this.page
        .evaluate((target) => {
          const norm = (s: string | null | undefined) =>
            (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

          const pageText = norm(document.body ? document.body.innerText : '');
          const pageTitle = norm(document.title);

          if (pageText.includes(target) || pageTitle.includes(target)) {
            return { found: true, errors: [] };
          }

          // Kiểm tra bộ đệm Toast biến mất
          const state = window.__autotestState;
          if (state && state.recentTexts) {
            for (const item of state.recentTexts) {
              if (norm(item.text).includes(target)) {
                return { found: true, errors: [] };
              }
            }
          }

          // Quét xem trên màn hình có xuất hiện câu thông báo lỗi nào không
          const errList: string[] = [];
          const errorNodes = document.querySelectorAll(
            '[class*="error" i], [class*="alert" i], [class*="danger" i], [role="alert"]'
          );
          for (const node of Array.from(errorNodes)) {
            const h = node as HTMLElement;
            const r = h.getBoundingClientRect();
            if (r.width > 20 && r.height > 10) {
              const t = (h.innerText || h.textContent || '').trim();
              if (t.length > 5 && t.length < 200 && !errList.includes(t)) {
                errList.push(t);
              }
            }
          }

          return { found: false, errors: errList.slice(0, 3) };
        }, cleanExpected)
        .catch(() => ({ found: false, errors: [] }));

      if (result.found) {
        return { matched: true, detectedPageErrors: [] };
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
            return { matched: true, detectedPageErrors: [] };
          }
        } catch {
          // ignore
        }
      }

      await new Promise((r) => setTimeout(r, 250));
    }

    // Lần quét cuối cùng trước khi quyết định FAILED
    const finalCheck = await this.page
      .evaluate(() => {
        const errList: string[] = [];
        const errorNodes = document.querySelectorAll(
          '[class*="error" i], [class*="alert" i], [class*="danger" i], [role="alert"]'
        );
        for (const node of Array.from(errorNodes)) {
          const h = node as HTMLElement;
          const r = h.getBoundingClientRect();
          if (r.width > 20 && r.height > 10) {
            const t = (h.innerText || h.textContent || '').trim();
            if (t.length > 5 && t.length < 200 && !errList.includes(t)) {
              errList.push(t);
            }
          }
        }
        return errList.slice(0, 3);
      })
      .catch(() => []);

    return { matched: false, detectedPageErrors: finalCheck };
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
