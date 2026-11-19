import test from 'node:test';
import assert from 'node:assert';
import * as http from 'http';
import { chromium, BrowserContext } from 'playwright';
import {
  parseCssColor,
  classifyColorToSeverity,
  classifyNotificationSeverity,
  detectVisibleNotifications,
  evaluateNotificationsAgainstStep,
  computeExposedSubRegion,
  evadeOccludingToasts,
  withToastPointerEventsIsolation,
  clickTargetWithToastEvasion,
  DetectedNotification,
} from '../src/notification-oracle';
import { AtomicAction } from '../src/types';

// ============================================================================
// HELPER: MOCK HTTP SERVER + PLAYWRIGHT CONTEXT WITH __name GUARD
// ============================================================================

function createMockServer(
  routes: Record<string, string>
): Promise<{ server: http.Server; baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = (req.url || '/').split('?')[0];
      const html = routes[url];
      if (html !== undefined) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

async function injectTsxNameGuard(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    (window as any).__name = (globalThis as any).__name = (fn: unknown) => fn;
  });
}

// ============================================================================
// 1. UNIT TESTS: COLOR PARSING & IEEE 29119 SEVERITY CLASSIFICATION TAXONOMY
// ============================================================================

test('Prompt 13 [Unit]: parseCssColor & classifyColorToSeverity accurately classify IEEE 29119 color bands', () => {
  assert.deepStrictEqual(parseCssColor('#52c41a'), { r: 82, g: 196, b: 26, a: 1 });
  assert.deepStrictEqual(parseCssColor('rgb(255, 77, 79)'), { r: 255, g: 77, b: 79, a: 1 });
  assert.deepStrictEqual(parseCssColor('rgba(24, 144, 255, 0.9)'), { r: 24, g: 144, b: 255, a: 0.9 });

  // Ant Design & standard palette colors
  assert.strictEqual(classifyColorToSeverity('#52c41a'), 'SUCCESS');
  assert.strictEqual(classifyColorToSeverity('rgb(82, 196, 26)'), 'SUCCESS');
  assert.strictEqual(classifyColorToSeverity('#f6ffed'), 'SUCCESS');
  assert.strictEqual(classifyColorToSeverity('#edf7ed'), 'SUCCESS');

  assert.strictEqual(classifyColorToSeverity('#1890ff'), 'INFO');
  assert.strictEqual(classifyColorToSeverity('rgb(24, 144, 255)'), 'INFO');
  assert.strictEqual(classifyColorToSeverity('#e6f7ff'), 'INFO');

  assert.strictEqual(classifyColorToSeverity('#faad14'), 'WARNING');
  assert.strictEqual(classifyColorToSeverity('rgb(250, 173, 20)'), 'WARNING');
  assert.strictEqual(classifyColorToSeverity('#fffbe6'), 'WARNING');

  assert.strictEqual(classifyColorToSeverity('#ff4d4f'), 'ERROR');
  assert.strictEqual(classifyColorToSeverity('rgb(255, 77, 79)'), 'ERROR');
  assert.strictEqual(classifyColorToSeverity('#fff2f0'), 'ERROR');

  // Neutrals and transparent must NOT trigger false classification
  assert.strictEqual(classifyColorToSeverity('#ffffff'), null);
  assert.strictEqual(classifyColorToSeverity('#f5f5f5'), null);
  assert.strictEqual(classifyColorToSeverity('#64748b'), null);
  assert.strictEqual(classifyColorToSeverity('#e2e8f0'), null);
  assert.strictEqual(classifyColorToSeverity('rgba(0, 0, 0, 0)'), null);
  assert.strictEqual(classifyColorToSeverity('transparent'), null);
});

test('Prompt 13 [Unit]: classifyNotificationSeverity classifies SUCCESS, INFO, WARNING, ERROR across CSS, colors, icons & VN/EN text', () => {
  // SUCCESS variations
  const s1 = classifyNotificationSeverity({
    text: 'Cập nhật thành công',
    className: 'toast toast-success',
    backgroundColor: '#52c41a',
    iconText: '✓',
  });
  assert.strictEqual(s1.severity, 'SUCCESS');
  assert.ok(s1.confidence >= 0.9);

  // MUI Success Alert with role="alert" MUST still be SUCCESS (never false positive ERROR!)
  const s2 = classifyNotificationSeverity({
    text: 'Profile updated successfully',
    className: 'MuiAlert-root MuiAlert-standardSuccess',
    role: 'alert',
    backgroundColor: '#edf7ed',
  });
  assert.strictEqual(s2.severity, 'SUCCESS');

  // AntD Notification Notice Success (contains word "notice" but MUST be SUCCESS)
  const s3 = classifyNotificationSeverity({
    text: 'Đã lưu thay đổi',
    className: 'ant-notification-notice ant-notification-notice-success',
  });
  assert.strictEqual(s3.severity, 'SUCCESS');

  // INFO variations
  const i1 = classifyNotificationSeverity({
    text: 'Mẹo: Nhấn Ctrl+S để lưu nhanh hơn',
    className: 'toast-info ant-message-info',
    backgroundColor: '#1890ff',
  });
  assert.strictEqual(i1.severity, 'INFO');

  // WARNING variations
  const w1 = classifyNotificationSeverity({
    text: 'Mật khẩu yếu - khuyến cáo dùng tối thiểu 8 ký tự',
    className: 'toast-warning ant-message-warning',
    backgroundColor: '#faad14',
  });
  assert.strictEqual(w1.severity, 'WARNING');
  assert.ok(w1.confidence >= 0.9);

  // Plain unstyled warning text
  const w2 = classifyNotificationSeverity({
    text: 'Cảnh báo: Phiên đăng nhập sắp hết hạn',
  });
  assert.strictEqual(w2.severity, 'WARNING');

  // ERROR variations
  const e1 = classifyNotificationSeverity({
    text: 'Mật khẩu không đúng',
    className: 'toast-error ant-message-error',
    backgroundColor: '#ff4d4f',
  });
  assert.strictEqual(e1.severity, 'ERROR');
  assert.ok(e1.confidence >= 0.9);

  const e2 = classifyNotificationSeverity({
    text: 'HTTP 500 Internal Server Error',
    backgroundColor: 'rgb(255, 77, 79)',
  });
  assert.strictEqual(e2.severity, 'ERROR');

  // Negated success phrase trap ("không thành công" MUST be ERROR, NOT SUCCESS)
  const e3 = classifyNotificationSeverity({
    text: 'Lưu dữ liệu không thành công',
  });
  assert.strictEqual(e3.severity, 'ERROR');
});

// ============================================================================
// 2. UNIT TESTS: EXPECTED VS UNEXPECTED NOTIFICATION ORACLE
// ============================================================================

test('Prompt 13 [Unit]: evaluateNotificationsAgainstStep reconciles SUCCESS, INFO, WARNING, EXPECTED_PASS & PRODUCT_DEFECT', () => {
  // 1) SUCCESS ("Cập nhật thành công") -> SUCCESS_EVIDENCE, NEVER fails scenario
  const successReport = evaluateNotificationsAgainstStep(
    [{ text: 'Cập nhật thành công', className: 'toast-success', backgroundColor: '#52c41a' }],
    { stepText: 'Bấm nút "Lưu"' }
  );
  assert.strictEqual(successReport.overallVerdict, 'PASS');
  assert.strictEqual(successReport.shouldFailScenario, false);
  assert.strictEqual(successReport.items[0].verdict, 'SUCCESS_EVIDENCE');
  assert.strictEqual(successReport.successEvidences.length, 1);
  assert.strictEqual(successReport.productDefects.length, 0);

  // 2) WARNING ("Mật khẩu yếu") -> WARNING_LOGGED, NEVER fails scenario
  const warningReport = evaluateNotificationsAgainstStep(
    [{ text: 'Mật khẩu yếu', className: 'toast-warning', backgroundColor: '#faad14' }],
    { stepText: 'Điền "123456" vào ô "Mật khẩu"' }
  );
  assert.strictEqual(warningReport.overallVerdict, 'PASS_WITH_WARNING');
  assert.strictEqual(warningReport.shouldFailScenario, false);
  assert.strictEqual(warningReport.items[0].verdict, 'WARNING_LOGGED');
  assert.strictEqual(warningReport.warningLogs.length, 1);
  assert.strictEqual(warningReport.productDefects.length, 0);

  // 3) INFO -> IGNORED, NEVER fails scenario
  const infoReport = evaluateNotificationsAgainstStep(
    [{ text: 'Mẹo: Bạn có thể kéo thả ảnh vào đây', className: 'toast-info', backgroundColor: '#1890ff' }]
  );
  assert.strictEqual(infoReport.overallVerdict, 'PASS');
  assert.strictEqual(infoReport.shouldFailScenario, false);
  assert.strictEqual(infoReport.items[0].verdict, 'IGNORED');
  assert.strictEqual(infoReport.ignoredInfos.length, 1);

  // 4) Negative test expecting "Mật khẩu không đúng" with red ERROR toast -> EXPECTED_PASS (NO PRODUCT_DEFECT)
  const negativeAction: Partial<AtomicAction> = {
    stepNumber: 3,
    type: 'ASSERT_TEXT',
    expectedText: 'Mật khẩu không đúng',
    rawStepText: 'Kiểm tra thông báo "Mật khẩu không đúng"',
  };
  const expectedErrReport = evaluateNotificationsAgainstStep(
    [{ text: 'Mật khẩu không đúng', className: 'toast-error', backgroundColor: '#ff4d4f' }],
    { action: negativeAction }
  );
  assert.strictEqual(expectedErrReport.overallVerdict, 'EXPECTED_PASS');
  assert.strictEqual(expectedErrReport.shouldFailScenario, false);
  assert.strictEqual(expectedErrReport.hasExpectedErrorMatch, true);
  assert.strictEqual(expectedErrReport.items[0].verdict, 'EXPECTED_PASS');
  assert.strictEqual(expectedErrReport.productDefects.length, 0);

  // 5) Lookahead upcoming ASSERT_TEXT also prevents false PRODUCT_DEFECT on CLICK step
  const clickWithUpcomingAssert = evaluateNotificationsAgainstStep(
    [{ text: 'Lỗi: Mật khẩu không đúng', className: 'toast-error', backgroundColor: '#ff4d4f' }],
    {
      action: { stepNumber: 2, type: 'CLICK', targetHint: 'Đăng nhập' },
      upcomingActions: [negativeAction],
    }
  );
  assert.strictEqual(clickWithUpcomingAssert.overallVerdict, 'EXPECTED_PASS');
  assert.strictEqual(clickWithUpcomingAssert.shouldFailScenario, false);
  assert.strictEqual(clickWithUpcomingAssert.items[0].verdict, 'EXPECTED_PASS');

  // 6) Unexpected HTTP 500 red ERROR toast -> PRODUCT_DEFECT (even if negative test expected a different message!)
  const unexpected500Report = evaluateNotificationsAgainstStep(
    [{ text: 'HTTP 500 Internal Server Error', className: 'toast-error', backgroundColor: '#ff4d4f' }],
    { action: negativeAction }
  );
  assert.strictEqual(unexpected500Report.overallVerdict, 'PRODUCT_DEFECT');
  assert.strictEqual(unexpected500Report.shouldFailScenario, true);
  assert.strictEqual(unexpected500Report.items[0].verdict, 'PRODUCT_DEFECT');
  assert.strictEqual(unexpected500Report.productDefects.length, 1);
});

// ============================================================================
// 3. UNIT TESTS: GEOMETRIC EXPOSED SUB-REGION (TIER 2 SPATIAL EVASION)
// ============================================================================

test('Prompt 13 [Unit]: computeExposedSubRegion enforces >=40% area & >=24x24px threshold accurately', () => {
  const target = { x: 100, y: 200, width: 200, height: 50 }; // Area = 10,000

  // Case A: Right 50% covered -> Left 50% (100x50px) exposed -> PASSES threshold
  const half = computeExposedSubRegion(target, [{ x: 200, y: 180, width: 250, height: 90 }]);
  assert.strictEqual(half.exposedRatio, 0.5);
  assert.strictEqual(half.meetsThreshold, true);
  assert.deepStrictEqual(half.bestSubRegion, { x: 100, y: 200, width: 100, height: 50 });
  assert.deepStrictEqual(half.safeClickPoint, { x: 150, y: 225 });

  // Case B: Right 65% covered -> Left 35% exposed (< 40%) -> REJECTED
  const tooCovered = computeExposedSubRegion(target, [{ x: 170, y: 180, width: 200, height: 90 }]);
  assert.ok(Math.abs(tooCovered.exposedRatio - 0.35) < 1e-6);
  assert.strictEqual(tooCovered.meetsThreshold, false);
  assert.strictEqual(tooCovered.safeClickPoint, null);

  // Case C: Small button where 50% exposed is only 15px wide (< 24px) -> REJECTED
  const tinyTarget = { x: 50, y: 50, width: 30, height: 30 };
  const tinyHalf = computeExposedSubRegion(tinyTarget, [{ x: 65, y: 40, width: 40, height: 50 }]);
  assert.strictEqual(tinyHalf.exposedRatio, 0.5);
  assert.strictEqual(tinyHalf.meetsThreshold, false);

  // Case D: 100% occluded -> REJECTED
  const full = computeExposedSubRegion(target, [{ x: 90, y: 190, width: 220, height: 70 }]);
  assert.strictEqual(full.exposedRatio, 0);
  assert.strictEqual(full.meetsThreshold, false);
  assert.strictEqual(full.bestSubRegion, null);
});

// ============================================================================
// 4. PLAYWRIGHT CHROMIUM INTEGRATION TESTS: ORACLE DETECTION & VERDICTS
// ============================================================================

test('Prompt 13 [Chromium]: Live DOM detection & IEEE 29119 reconciliation for SUCCESS, WARNING, INFO, Expected ERROR & Unexpected HTTP 500', async () => {
  const { baseUrl, close } = await createMockServer({
    '/oracle-success-warning.html': `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            .toast { position: fixed; right: 20px; padding: 12px 18px; border-radius: 6px; font-family: sans-serif; z-index: 1000; }
            .toast-success { top: 20px; background: #52c41a; color: #fff; }
            .toast-warning { top: 80px; background: #faad14; color: #1f2937; }
            .toast-info { top: 140px; background: #1890ff; color: #fff; }
            .MuiAlert-standardSuccess { position: fixed; top: 200px; right: 20px; background: #edf7ed; color: #1e4620; padding: 10px 16px; border-radius: 4px; }
            .ant-message-notice { position: fixed; top: 260px; right: 20px; z-index: 1000; }
            .ant-message-notice-content { background: #fff; padding: 10px 16px; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
            .ant-message-success .anticon { color: #52c41a; margin-right: 6px; }
          </style>
        </head>
        <body>
          <h1>Profile Settings</h1>
          <div class="toast toast-success" role="status">
            <span class="toast-icon">✓</span> Cập nhật thành công
            <button class="toast-close" aria-label="Close">✕</button>
          </div>
          <div class="toast toast-warning" role="alert">
            <span>⚠ Mật khẩu yếu</span>
          </div>
          <div class="toast toast-info" role="status">
            <span>Mẹo: Bật xác thực 2 bước để bảo vệ tài khoản</span>
          </div>
          <div class="MuiSnackbar-root">
            <div class="MuiAlert-root MuiAlert-standardSuccess" role="alert">
              <div class="MuiAlert-message">Settings saved</div>
            </div>
          </div>
          <div class="ant-message-notice">
            <div class="ant-message-notice-content">
              <div class="ant-message-custom-content ant-message-success">
                <span class="anticon anticon-check-circle">✓</span>
                <span>Completed profile sync</span>
              </div>
            </div>
          </div>
        </body>
      </html>
    `,
    '/oracle-negative-error.html': `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            .ant-notification-notice { position: fixed; top: 20px; right: 20px; width: 320px; padding: 14px; background: #fff2f0; border: 1px solid #ffccc7; border-left: 4px solid #ff4d4f; color: #cf1322; z-index: 1000; }
          </style>
        </head>
        <body>
          <h1>Login</h1>
          <div id="err-toast" class="ant-notification-notice ant-notification-notice-error" role="alert">
            <div class="ant-notification-notice-message">Đăng nhập thất bại</div>
            <div class="ant-notification-notice-description">Mật khẩu không đúng</div>
          </div>
        </body>
      </html>
    `,
    '/oracle-http-500.html': `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            .toast-error { position: fixed; top: 20px; right: 20px; background: #ff4d4f; color: #fff; padding: 14px 20px; z-index: 1000; }
          </style>
        </head>
        <body>
          <h1>Checkout</h1>
          <div class="toast toast-error" role="alert">HTTP 500 Internal Server Error - Backend crash</div>
        </body>
      </html>
    `,
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await injectTsxNameGuard(context);
    const page = await context.newPage();

    // 1) SUCCESS + WARNING + INFO + MUI Success(role="alert") + AntD Message Success page
    await page.goto(`${baseUrl}/oracle-success-warning.html`);
    const benignNotifs = await detectVisibleNotifications(page);
    assert.strictEqual(benignNotifs.length, 5, `Expected 5 deduplicated toasts, got ${benignNotifs.length}`);

    const successToast = benignNotifs.find((n) => n.text.includes('Cập nhật thành công'));
    assert.ok(successToast, 'Must detect "Cập nhật thành công" toast');
    assert.strictEqual(successToast!.severity, 'SUCCESS');
    assert.strictEqual(successToast!.hasCloseButton, true);
    assert.ok(!successToast!.text.includes('✕'), 'Close button text must be stripped from notification text');

    const warningToast = benignNotifs.find((n) => n.text.includes('Mật khẩu yếu'));
    assert.ok(warningToast, 'Must detect "Mật khẩu yếu" warning toast');
    assert.strictEqual(warningToast!.severity, 'WARNING');

    const infoToast = benignNotifs.find((n) => n.text.includes('Mẹo:'));
    assert.ok(infoToast, 'Must detect INFO tip toast');
    assert.strictEqual(infoToast!.severity, 'INFO');

    const muiToast = benignNotifs.find((n) => n.text.includes('Settings saved'));
    assert.ok(muiToast, 'Must detect MUI Alert Success');
    assert.strictEqual(muiToast!.severity, 'SUCCESS', 'MUI standardSuccess with role="alert" must be SUCCESS');

    const antdToast = benignNotifs.find((n) => n.text.includes('Completed profile sync'));
    assert.ok(antdToast, 'Must detect AntD .ant-message-notice wrapper');
    assert.strictEqual(antdToast!.severity, 'SUCCESS', 'AntD .ant-message-success inside white card must be SUCCESS');

    const benignReport = evaluateNotificationsAgainstStep(benignNotifs, {
      stepText: 'Bấm nút "Cập nhật"',
    });
    assert.strictEqual(benignReport.shouldFailScenario, false, 'Benign toasts must NEVER fail scenario');
    assert.strictEqual(benignReport.overallVerdict, 'PASS_WITH_WARNING');
    assert.strictEqual(benignReport.successEvidences.length, 3);
    assert.strictEqual(benignReport.warningLogs.length, 1);
    assert.strictEqual(benignReport.ignoredInfos.length, 1);
    assert.strictEqual(benignReport.productDefects.length, 0);

    // 2) Negative test expecting "Mật khẩu không đúng" -> EXPECTED_PASS
    await page.goto(`${baseUrl}/oracle-negative-error.html`);
    const negNotifs = await detectVisibleNotifications(page);
    assert.strictEqual(negNotifs.length, 1);
    assert.strictEqual(negNotifs[0].severity, 'ERROR');

    const negReport = evaluateNotificationsAgainstStep(negNotifs, {
      action: {
        stepNumber: 3,
        type: 'ASSERT_TEXT',
        expectedText: 'Mật khẩu không đúng',
        rawStepText: 'Kiểm tra chữ "Mật khẩu không đúng"',
      },
    });
    assert.strictEqual(negReport.overallVerdict, 'EXPECTED_PASS');
    assert.strictEqual(negReport.shouldFailScenario, false);
    assert.strictEqual(negReport.items[0].verdict, 'EXPECTED_PASS');

    // 3) Unexpected HTTP 500 red ERROR toast -> PRODUCT_DEFECT
    await page.goto(`${baseUrl}/oracle-http-500.html`);
    const crashNotifs = await detectVisibleNotifications(page);
    assert.strictEqual(crashNotifs.length, 1);
    assert.strictEqual(crashNotifs[0].severity, 'ERROR');

    const crashReport = evaluateNotificationsAgainstStep(crashNotifs, {
      action: {
        stepNumber: 4,
        type: 'CLICK',
        targetHint: 'Thanh toán',
      },
    });
    assert.strictEqual(crashReport.overallVerdict, 'PRODUCT_DEFECT');
    assert.strictEqual(crashReport.shouldFailScenario, true);
    assert.strictEqual(crashReport.items[0].verdict, 'PRODUCT_DEFECT');
    assert.strictEqual(crashReport.productDefects.length, 1);
  } finally {
    await browser.close();
    await close();
  }
});

// ============================================================================
// 5. PLAYWRIGHT CHROMIUM INTEGRATION TESTS: 4-TIER TOAST EVASION LADDER
// ============================================================================

test('Prompt 13 [Chromium - Tier 1]: Auto-Dismiss closes toast via ✕ button AND via Escape key, then clicks Submit', async () => {
  const { baseUrl, close } = await createMockServer({
    '/tier1-close-btn.html': `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { margin: 0; font-family: sans-serif; }
            #submit-btn { position: fixed; top: 200px; left: 100px; width: 180px; height: 48px; font-size: 16px; }
            #blocking-toast {
              position: fixed; top: 185px; left: 85px; width: 260px; height: 80px;
              background: #52c41a; color: #fff; z-index: 9999; display: flex; align-items: center;
              justify-content: space-between; padding: 0 14px; box-sizing: border-box;
            }
            .toast-close { background: rgba(0,0,0,0.2); color: #fff; border: none; width: 28px; height: 28px; cursor: pointer; }
          </style>
        </head>
        <body>
          <button id="submit-btn">Submit Order</button>
          <div id="blocking-toast" class="toast toast-success" role="status">
            <span>Cập nhật thành công</span>
            <button class="toast-close" aria-label="Close" onclick="document.getElementById('blocking-toast').remove()">✕</button>
          </div>
          <script>
            window.__submitState = { clicked: false, trusted: false };
            document.getElementById('submit-btn').addEventListener('click', (e) => {
              window.__submitState = { clicked: true, trusted: e.isTrusted };
            });
          </script>
        </body>
      </html>
    `,
    '/tier1-escape.html': `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { margin: 0; font-family: sans-serif; }
            #submit-btn { position: fixed; top: 200px; left: 100px; width: 180px; height: 48px; }
            #esc-toast {
              position: fixed; top: 185px; left: 85px; width: 260px; height: 80px;
              background: #1890ff; color: #fff; z-index: 9999; display: flex; align-items: center; padding: 0 14px;
            }
          </style>
        </head>
        <body>
          <button id="submit-btn">Submit Escape</button>
          <div id="esc-toast" class="toast toast-info" role="status">Nhấn ESC để đóng thông báo</div>
          <script>
            window.__submitState = { clicked: false, trusted: false };
            document.getElementById('submit-btn').addEventListener('click', (e) => {
              window.__submitState = { clicked: true, trusted: e.isTrusted };
            });
            document.addEventListener('keydown', (e) => {
              if (e.key === 'Escape') {
                const t = document.getElementById('esc-toast');
                if (t) t.remove();
              }
            });
          </script>
        </body>
      </html>
    `,
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await injectTsxNameGuard(context);
    const page = await context.newPage();

    // Tier 1a: Close button ✕
    await page.goto(`${baseUrl}/tier1-close-btn.html`);
    const resBtn = await clickTargetWithToastEvasion(page, '#submit-btn');
    assert.strictEqual(resBtn.clicked, true);
    assert.strictEqual(resBtn.evasion.occludedInitially, true);
    assert.strictEqual(resBtn.evasion.tierUsed, 1);
    assert.strictEqual(resBtn.evasion.strategy, 'AUTO_DISMISS_CLOSE_BUTTON');
    assert.strictEqual(await page.locator('#blocking-toast').count(), 0, 'Toast should be dismissed');

    const btnState = await page.evaluate(() => (window as any).__submitState);
    assert.strictEqual(btnState.clicked, true, 'Submit button must be clicked');
    assert.strictEqual(btnState.trusted, true, 'Click event must be physical isTrusted === true');

    // Tier 1b: Escape key fallback
    await page.goto(`${baseUrl}/tier1-escape.html`);
    const resEsc = await clickTargetWithToastEvasion(page, '#submit-btn');
    assert.strictEqual(resEsc.clicked, true);
    assert.strictEqual(resEsc.evasion.tierUsed, 1);
    assert.strictEqual(resEsc.evasion.strategy, 'AUTO_DISMISS_ESCAPE');
    assert.strictEqual(await page.locator('#esc-toast').count(), 0, 'Escape-dismissible toast should be gone');

    const escState = await page.evaluate(() => (window as any).__submitState);
    assert.strictEqual(escState.clicked, true);
    assert.strictEqual(escState.trusted, true);
  } finally {
    await browser.close();
    await close();
  }
});

test('Prompt 13 [Chromium - Tier 2]: Spatial Evasion clicks exposed left >=40% region when sticky non-closable toast covers right 50%', async () => {
  const { baseUrl, close } = await createMockServer({
    '/tier2-spatial.html': `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { margin: 0; font-family: sans-serif; }
            /* Submit button: x=100..300 (w=200), y=200..250 (h=50) */
            #submit-btn { position: fixed; top: 200px; left: 100px; width: 200px; height: 50px; font-size: 16px; }
            /* Sticky non-closable toast covering right 50%: x=200..440, y=185..265 */
            #sticky-toast {
              position: fixed; top: 185px; left: 200px; width: 240px; height: 80px;
              background: #faad14; color: #111; z-index: 9999; display: flex; align-items: center; padding: 0 12px;
            }
          </style>
        </head>
        <body>
          <button id="submit-btn">Submit Form</button>
          <div id="sticky-toast" class="toast toast-warning" role="status">
            Mật khẩu yếu (không có nút đóng)
          </div>
          <script>
            window.__submitState = { clicked: false, trusted: false, clientX: 0, clientY: 0 };
            document.getElementById('submit-btn').addEventListener('click', (e) => {
              window.__submitState = { clicked: true, trusted: e.isTrusted, clientX: e.clientX, clientY: e.clientY };
            });
          </script>
        </body>
      </html>
    `,
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await injectTsxNameGuard(context);
    const page = await context.newPage();

    await page.goto(`${baseUrl}/tier2-spatial.html`);
    const res = await clickTargetWithToastEvasion(page, '#submit-btn', {
      ttlDrainTimeoutMs: 2500,
    });

    assert.strictEqual(res.clicked, true);
    assert.strictEqual(res.evasion.occludedInitially, true);
    assert.strictEqual(res.evasion.tierUsed, 2, `Expected Tier 2 Spatial Evasion, got Tier ${res.evasion.tierUsed}`);
    assert.strictEqual(res.evasion.strategy, 'SPATIAL_EVASION');
    assert.ok((res.evasion.exposedRatio || 0) >= 0.4, `Expected exposedRatio >= 0.4, got ${res.evasion.exposedRatio}`);
    assert.ok(
      res.evasion.clickPoint.x >= 100 && res.evasion.clickPoint.x < 200,
      `Expected clickPoint.x in exposed left half [100, 200), got ${res.evasion.clickPoint.x}`
    );

    const state = await page.evaluate(() => (window as any).__submitState);
    assert.strictEqual(state.clicked, true, 'Submit button must receive click on exposed left region');
    assert.strictEqual(state.trusted, true, 'Click event must be isTrusted === true');
    assert.ok(state.clientX < 200, `Physical click landed at x=${state.clientX} outside toast`);
    assert.strictEqual(await page.locator('#sticky-toast').count(), 1, 'Sticky toast remains non-destructively mounted');
  } finally {
    await browser.close();
    await close();
  }
});

test('Prompt 13 [Chromium - Tier 3]: Smart TTL Drain patiently waits for 800ms auto-expiring toast covering 100%, then clicks Submit', async () => {
  const { baseUrl, close } = await createMockServer({
    '/tier3-ttl.html': `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { margin: 0; font-family: sans-serif; }
            #submit-btn { position: fixed; top: 200px; left: 100px; width: 180px; height: 48px; }
            #ttl-toast {
              position: fixed; top: 180px; left: 80px; width: 260px; height: 90px;
              background: #52c41a; color: #fff; z-index: 9999; display: flex; align-items: center; padding: 0 14px;
            }
          </style>
        </head>
        <body>
          <button id="submit-btn">Submit After TTL</button>
          <div id="ttl-toast" class="toast toast-success" role="status">Cập nhật thành công (tự đóng sau 800ms)</div>
          <script>
            window.__submitState = { clicked: false, trusted: false };
            document.getElementById('submit-btn').addEventListener('click', (e) => {
              window.__submitState = { clicked: true, trusted: e.isTrusted };
            });
            setTimeout(() => {
              const t = document.getElementById('ttl-toast');
              if (t) t.remove();
            }, 800);
          </script>
        </body>
      </html>
    `,
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await injectTsxNameGuard(context);
    const page = await context.newPage();

    await page.goto(`${baseUrl}/tier3-ttl.html`);
    const res = await clickTargetWithToastEvasion(page, '#submit-btn', {
      ttlDrainTimeoutMs: 2500,
      ttlPollIntervalMs: 100,
    });

    assert.strictEqual(res.clicked, true);
    assert.strictEqual(res.evasion.occludedInitially, true);
    assert.strictEqual(res.evasion.tierUsed, 3, `Expected Tier 3 Smart TTL Drain, got Tier ${res.evasion.tierUsed}`);
    assert.strictEqual(res.evasion.strategy, 'SMART_TTL_DRAIN');
    assert.ok((res.evasion.drainedMs || 0) >= 350, `Expected drainedMs >= 350ms, got ${res.evasion.drainedMs}`);
    assert.strictEqual(await page.locator('#ttl-toast').count(), 0, 'Auto-expiring toast must have vanished');

    const state = await page.evaluate(() => (window as any).__submitState);
    assert.strictEqual(state.clicked, true, 'Submit must be clicked cleanly after TTL drain');
    assert.strictEqual(state.trusted, true);
  } finally {
    await browser.close();
    await close();
  }
});

test('Prompt 13 [Chromium - Tier 4]: Pointer-Events Isolation clicks Submit through permanent non-closable toast and restores pointer-events afterwards', async () => {
  const { baseUrl, close } = await createMockServer({
    '/tier4-permanent.html': `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { margin: 0; font-family: sans-serif; }
            #submit-btn { position: fixed; top: 200px; left: 100px; width: 180px; height: 48px; }
            #perm-toast {
              position: fixed; top: 180px; left: 80px; width: 260px; height: 90px;
              background: #faad14; color: #111; z-index: 9999; pointer-events: auto;
              display: flex; align-items: center; padding: 0 14px;
            }
            #perm-toast .inner-badge { pointer-events: auto; background: #fff; padding: 2px 6px; margin-right: 8px; }
          </style>
        </head>
        <body>
          <button id="submit-btn">Submit Permanent</button>
          <div id="perm-toast" class="toast toast-warning" role="status">
            <span class="inner-badge">!</span> Cảnh báo cố định không thể đóng
          </div>
          <script>
            window.__submitClicks = [];
            document.getElementById('submit-btn').addEventListener('click', (e) => {
              window.__submitClicks.push({ trusted: e.isTrusted });
            });
          </script>
        </body>
      </html>
    `,
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await injectTsxNameGuard(context);
    const page = await context.newPage();

    await page.goto(`${baseUrl}/tier4-permanent.html`);

    // 1) Full 4-tier ladder escalates to Tier 4 and restores automatically via clickTargetWithToastEvasion
    const res = await clickTargetWithToastEvasion(page, '#submit-btn', {
      ttlDrainTimeoutMs: 350,
      ttlPollIntervalMs: 80,
    });

    assert.strictEqual(res.clicked, true);
    assert.strictEqual(res.evasion.occludedInitially, true);
    assert.strictEqual(res.evasion.tierUsed, 4, `Expected Tier 4 Pointer-Events Isolation, got Tier ${res.evasion.tierUsed}`);
    assert.strictEqual(res.evasion.strategy, 'POINTER_EVENTS_ISOLATION');
    assert.strictEqual(res.restoredPointerEvents, true);

    const clicksAfterLadder = await page.evaluate(() => (window as any).__submitClicks);
    assert.strictEqual(clicksAfterLadder.length, 1, 'Submit must be clicked once');
    assert.strictEqual(clicksAfterLadder[0].trusted, true, 'Physical click must have isTrusted === true');

    // Confirm pointer-events is restored back to 'auto' and no leftover style tags exist
    const afterRestoreState = await page.evaluate(() => {
      const toast = document.getElementById('perm-toast')!;
      const inner = toast.querySelector('.inner-badge')!;
      return {
        computedToastPe: window.getComputedStyle(toast).pointerEvents,
        computedInnerPe: window.getComputedStyle(inner).pointerEvents,
        inlineToastPe: toast.style.pointerEvents,
        attrIsolated: toast.getAttribute('data-autotest-pe-isolated'),
        leftoverStyles: document.querySelectorAll('style[data-autotest-pe-style]').length,
      };
    });
    assert.strictEqual(afterRestoreState.computedToastPe, 'auto', 'Toast pointer-events must be restored to auto');
    assert.strictEqual(afterRestoreState.computedInnerPe, 'auto', 'Inner badge pointer-events must be restored to auto');
    assert.strictEqual(afterRestoreState.inlineToastPe, '', 'Original empty inline pointer-events must be restored');
    assert.strictEqual(afterRestoreState.attrIsolated, null, 'Isolation attribute must be removed');
    assert.strictEqual(afterRestoreState.leftoverStyles, 0, 'Injected isolation <style> must be removed');

    // 2) Direct withToastPointerEventsIsolation verification (during action -> none, after throw -> still restored!)
    let peDuringAction = '';
    let innerPeDuringAction = '';
    const isoResult = await withToastPointerEventsIsolation(page, ['#perm-toast'], async () => {
      const during = await page.evaluate(() => {
        const t = document.getElementById('perm-toast')!;
        const inner = t.querySelector('.inner-badge')!;
        return {
          toastPe: window.getComputedStyle(t).pointerEvents,
          innerPe: window.getComputedStyle(inner).pointerEvents,
        };
      });
      peDuringAction = during.toastPe;
      innerPeDuringAction = during.innerPe;
      const box = (await page.locator('#submit-btn').boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      return 'clicked-ok';
    });

    assert.strictEqual(peDuringAction, 'none', 'During isolation, toast computed pointer-events must be none');
    assert.strictEqual(innerPeDuringAction, 'none', 'During isolation, child pointer-events must also be none');
    assert.strictEqual(isoResult.result, 'clicked-ok');
    assert.strictEqual(isoResult.isolatedCount, 1);
    assert.strictEqual(isoResult.restored, true);

    const clicksAfterDirect = await page.evaluate(() => (window as any).__submitClicks);
    assert.strictEqual(clicksAfterDirect.length, 2, 'Second isolated click must succeed');

    // Verify restoration even when action callback throws
    await assert.rejects(
      () =>
        withToastPointerEventsIsolation(page, ['#perm-toast'], async () => {
          throw new Error('simulated click failure');
        }),
      /simulated click failure/
    );

    const peAfterError = await page.evaluate(() => window.getComputedStyle(document.getElementById('perm-toast')!).pointerEvents);
    assert.strictEqual(peAfterError, 'auto', 'pointer-events must STILL be restored if action throws');
  } finally {
    await browser.close();
    await close();
  }
});

test('Prompt 13 [Chromium - Tier 0]: Unobstructed target bypasses evasion immediately with tierUsed=0', async () => {
  const { baseUrl, close } = await createMockServer({
    '/tier0-clear.html': `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { margin: 0; font-family: sans-serif; }
            #submit-btn { position: fixed; top: 300px; left: 100px; width: 160px; height: 44px; }
            #corner-toast {
              position: fixed; top: 16px; right: 16px; width: 240px; height: 50px;
              background: #52c41a; color: #fff; z-index: 9999; display: flex; align-items: center; padding: 0 12px;
            }
          </style>
        </head>
        <body>
          <button id="submit-btn">Clear Submit</button>
          <div id="corner-toast" class="toast toast-success" role="status">Cập nhật thành công</div>
        </body>
      </html>
    `,
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await injectTsxNameGuard(context);
    const page = await context.newPage();

    await page.goto(`${baseUrl}/tier0-clear.html`);
    const evasion = await evadeOccludingToasts(page, '#submit-btn');

    assert.strictEqual(evasion.evaded, true);
    assert.strictEqual(evasion.occludedInitially, false);
    assert.strictEqual(evasion.tierUsed, 0);
    assert.strictEqual(evasion.strategy, 'NONE');
    assert.strictEqual(evasion.occludingToasts.length, 0);

    // Ensure non-occluding toast is still detected by Notification Oracle as SUCCESS
    const notifs: DetectedNotification[] = await detectVisibleNotifications(page);
    assert.strictEqual(notifs.length, 1);
    assert.strictEqual(notifs[0].severity, 'SUCCESS');
  } finally {
    await browser.close();
    await close();
  }
});
