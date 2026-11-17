import test from 'node:test';
import assert from 'node:assert';
import * as http from 'http';
import { chromium, BrowserContext, Page } from 'playwright';
import {
  attachMultiTabManager,
  getTabManager,
  MultiTabManager,
  runStrictTestScenario,
} from '../src/runner';

// Helper tạo mock server HTTP đơn giản với cổng ngẫu nhiên (listen 0)
function createMultiTabTestServer(): Promise<{ server: http.Server; baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url || '/';

      if (url === '/' || url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Trang Chu Multi-Tab</title></head>
            <body>
              <h1 id="main-title">Trang Chủ Hệ Thống</h1>
              <a id="link-new-tab" href="/child.html" target="_blank">Mở Tab Con</a>
              <button id="btn-popup" onclick="window.open('/child.html', '_blank')">Mở Cửa Sổ Popup</button>
            </body>
          </html>
        `);
      } else if (url === '/child.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Trang Con Độc Lập</title></head>
            <body>
              <h1 id="child-title">Chào mừng Trang Con</h1>
              <input id="child-input" placeholder="Nhập mã xác thực" />
              <button id="btn-child-alert" onclick="alert('Thông báo từ tab con!')">Bật Alert Con</button>
              <button id="btn-child-action" onclick="document.getElementById('child-title').innerText = 'Đã Thao Tác Xong'">Xác Nhận Tab Con</button>
            </body>
          </html>
        `);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        server,
        baseUrl,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

test('Prompt 05 - MultiTabManager: Tự động lắng nghe context.on("page") và chuyển activePage khi mở tab mới', async () => {
  const { baseUrl, close } = await createMultiTabTestServer();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const initialPage = await context.newPage();

  const tabManager = attachMultiTabManager(context, initialPage);

  await initialPage.goto(baseUrl);
  assert.strictEqual(tabManager.getActivePage(), initialPage, 'Active page ban đầu phải là initialPage');
  assert.strictEqual(tabManager.getOpenPages().length, 1);

  // Click vào link có target="_blank"
  await initialPage.click('#link-new-tab');

  // Đợi tab mới chuyển xong
  await tabManager.waitForPendingTransitions(3000);

  const activePage = tabManager.getActivePage();
  assert.notStrictEqual(activePage, initialPage, 'Active page phải chuyển sang tab mới');
  assert.strictEqual(tabManager.getOpenPages().length, 2, 'Tổng số tab mở phải là 2');

  const childTitle = await activePage.title();
  assert.strictEqual(childTitle, 'Trang Con Độc Lập');

  // Kiểm tra nhật ký tab switch
  const history = tabManager.getSwitchHistory();
  assert.ok(history.length >= 1, 'Phải ghi nhận ít nhất 1 sự kiện switch');
  const lastEvt = history[history.length - 1];
  assert.strictEqual(lastEvt.reason, 'OPENED_BY_ACTION');
  assert.ok(lastEvt.newPageUrl.includes('/child.html'));
  assert.strictEqual(lastEvt.newPageTitle, 'Trang Con Độc Lập');

  const logs = tabManager.consumePendingLogMessages();
  assert.ok(logs.some((l) => l.includes('[TAB SWITCH] Chuyển ngữ cảnh sang Tab mới: Trang Con Độc Lập')));

  await browser.close();
  await close();
});

test('Prompt 05 - MultiTabManager: Quản lý vòng đời tab: Đóng tab con và tự động quay về tab gốc', async () => {
  const { baseUrl, close } = await createMultiTabTestServer();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const initialPage = await context.newPage();

  const tabManager = attachMultiTabManager(context, initialPage);
  await initialPage.goto(baseUrl);

  // Mở tab con
  await initialPage.click('#link-new-tab');
  await tabManager.waitForPendingTransitions(3000);

  const childPage = tabManager.getActivePage();
  assert.notStrictEqual(childPage, initialPage);

  // Thao tác trên tab con
  await childPage.fill('#child-input', 'OTP-9999');
  await childPage.click('#btn-child-action');
  const updatedHeading = await childPage.textContent('#child-title');
  assert.strictEqual(updatedHeading, 'Đã Thao Tác Xong');

  // Runner đóng tab con
  await tabManager.closeCurrentTab();

  assert.strictEqual(childPage.isClosed(), true, 'Tab con phải được đóng lại');
  assert.strictEqual(tabManager.getActivePage(), initialPage, 'Active page phải trở về initialPage');
  assert.strictEqual(tabManager.getOpenPages().length, 1);

  const logs = tabManager.consumePendingLogMessages();
  assert.ok(logs.some((l) => l.includes('Đã đóng tab con')));

  await browser.close();
  await close();
});

test('Prompt 05 - MultiTabManager: Chuyển tab chủ động bằng switchToTab / switchToParent / switchToLatestTab', async () => {
  const { baseUrl, close } = await createMultiTabTestServer();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const initialPage = await context.newPage();

  const tabManager = attachMultiTabManager(context, initialPage);
  await initialPage.goto(baseUrl);

  // Mở tab con thứ nhất
  await initialPage.click('#link-new-tab');
  await tabManager.waitForPendingTransitions(3000);
  const firstChild = tabManager.getActivePage();

  // Mở thêm tab con thứ hai
  const secondChild = await context.newPage();
  await secondChild.goto(`${baseUrl}/child.html`);
  await tabManager.switchToTab(secondChild);

  assert.strictEqual(tabManager.getActivePage(), secondChild);
  assert.strictEqual(tabManager.getOpenPages().length, 3);

  // Chuyển về tab gốc
  await tabManager.switchToParent();
  assert.strictEqual(tabManager.getActivePage(), initialPage);

  // Chuyển về tab mới nhất
  await tabManager.switchToLatestTab();
  assert.strictEqual(tabManager.getActivePage(), secondChild);

  // Chuyển sang tab con thứ nhất
  await tabManager.switchToTab(firstChild);
  assert.strictEqual(tabManager.getActivePage(), firstChild);

  await browser.close();
  await close();
});

test('Prompt 05 - MultiTabManager: Tự động phục hồi khi tab con bị đóng từ bên ngoài (newPage.on("close"))', async () => {
  const { baseUrl, close } = await createMultiTabTestServer();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const initialPage = await context.newPage();

  const tabManager = attachMultiTabManager(context, initialPage);
  await initialPage.goto(baseUrl);

  // Mở tab con
  await initialPage.click('#btn-popup');
  await tabManager.waitForPendingTransitions(3000);
  const childPage = tabManager.getActivePage();
  assert.notStrictEqual(childPage, initialPage);

  // Giả lập tab con bị đóng ngoài ý muốn hoặc do web window.close()
  await childPage.close();

  // Đợi microtask event handler 'close'
  await new Promise((r) => setTimeout(r, 200));

  assert.strictEqual(tabManager.getActivePage(), initialPage, 'Phải tự động fallback về tab gốc khi tab con đóng');
  const logs = tabManager.consumePendingLogMessages();
  assert.ok(logs.some((l) => l.includes('Tab con đã đóng, chuyển ngữ cảnh về:')));

  await browser.close();
  await close();
});

test('Prompt 05 - MultiTabManager: Dialog Interceptor bắt trọn vẹn alert xuất hiện trên tab con', async () => {
  const { baseUrl, close } = await createMultiTabTestServer();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const initialPage = await context.newPage();

  const tabManager = attachMultiTabManager(context, initialPage);
  await initialPage.goto(baseUrl);

  // Mở tab con
  await initialPage.click('#link-new-tab');
  await tabManager.waitForPendingTransitions(3000);
  const childPage = tabManager.getActivePage();

  // Kích hoạt alert trên tab con
  await childPage.click('#btn-child-alert');

  // Đảm bảo dialog trên tab con được bắt và giải phóng tự động
  const allDialogs = tabManager.getAllCapturedDialogs();
  assert.strictEqual(allDialogs.length, 1);
  assert.strictEqual(allDialogs[0].type, 'alert');
  assert.strictEqual(allDialogs[0].message, 'Thông báo từ tab con!');
  assert.strictEqual(allDialogs[0].actionTaken, 'accept');

  await browser.close();
  await close();
});

test('Prompt 05 - Integration: runStrictTestScenario tự động switch tab khi click link và quay về tab gốc', async () => {
  const { baseUrl, close } = await createMultiTabTestServer();

  const scenario = `
    Bước 1: Bấm vào "Mở Tab Con"
    Bước 2: Kiểm tra màn hình hiện "Chào mừng Trang Con"
    Bước 3: Nhập "Mã OTP 123456" vào ô "Nhập mã xác thực"
    Bước 4: Bấm nút "Xác Nhận Tab Con"
    Bước 5: Kiểm tra màn hình hiện "Đã Thao Tác Xong"
    Bước 6: Đóng tab hiện tại
    Bước 7: Kiểm tra đường dẫn chứa "127.0.0.1"
    Bước 8: Kiểm tra màn hình hiện "Trang Chủ Hệ Thống"
  `;

  const result = await runStrictTestScenario({
    url: `${baseUrl}/index.html`,
    scenario,
    headless: true,
    casePrefix: 'multi_tab_integration',
  });

  assert.strictEqual(result.status, 'PASSED', `Kịch bản phải PASSED: ${result.summary}`);
  assert.strictEqual(result.completedSteps, 8, 'Phải hoàn thành cả 8 bước');

  // Kiểm tra nhật ký thực thi có log chuyển ngữ cảnh tab
  const allDetails = result.logs.map((l) => l.detail).join(' | ');
  assert.ok(
    allDetails.includes('[TAB SWITCH] Chuyển ngữ cảnh sang Tab mới:') ||
    allDetails.includes('Đã đóng tab con'),
    'Phải có nhật ký ghi nhận chuyển tab và đóng tab con'
  );

  await close();
});
