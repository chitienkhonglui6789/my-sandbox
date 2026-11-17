import test from 'node:test';
import assert from 'node:assert';
import * as http from 'http';
import { chromium } from 'playwright';
import {
  attachDialogInterceptor,
  getCapturedDialogs,
  getLastCapturedDialog,
  clearCapturedDialogs,
  runStrictTestScenario,
} from '../src/runner';
import { compileVietnameseScenario } from '../src/step-parser';

test('Prompt 04 - Alert: Tự động ghi nhận loại, thông điệp và tự động accept()', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const interceptor = attachDialogInterceptor(page);

  await page.setContent(`
    <html>
      <body>
        <button id="btn-alert" onclick="alert('Chào mừng bạn đến với hệ thống!')">Bật Alert</button>
      </body>
    </html>
  `);

  await page.click('#btn-alert');

  const history = interceptor.getHistory();
  assert.strictEqual(history.length, 1, 'Phải bắt được 1 hộp thoại');
  assert.strictEqual(history[0].type, 'alert', 'Loại hộp thoại phải là alert');
  assert.strictEqual(history[0].message, 'Chào mừng bạn đến với hệ thống!');
  assert.strictEqual(history[0].actionTaken, 'accept', 'Hành động phải là accept');
  assert.ok(history[0].timestamp > 0);

  await browser.close();
});

test('Prompt 04 - Confirm: Bước tiếp theo khẳng định ("Xác nhận", "Đồng ý", "OK") -> dialog.accept()', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const interceptor = attachDialogInterceptor(page);

  // Giả lập ngữ cảnh bước tiếp theo mang tính khẳng định
  interceptor.setCurrentStepContext({
    stepNumber: 1,
    stepText: 'Bấm nút "Xóa"',
    nextStepText: 'Bấm "Xác nhận"',
  });

  await page.setContent(`
    <html>
      <body>
        <button id="btn-confirm" onclick="window.__confirmResult = confirm('Bạn có chắc chắn muốn xóa không?')">Bật Confirm</button>
      </body>
    </html>
  `);

  await page.click('#btn-confirm');

  const history = interceptor.getHistory();
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].type, 'confirm');
  assert.strictEqual(history[0].message, 'Bạn có chắc chắn muốn xóa không?');
  assert.strictEqual(history[0].actionTaken, 'accept');
  assert.strictEqual(history[0].warning, undefined, 'Không được có cảnh báo khi khẳng định theo kịch bản');

  const resultInPage = await page.evaluate(() => (window as any).__confirmResult);
  assert.strictEqual(resultInPage, true, 'Confirm phải trả về true khi accept()');

  await browser.close();
});

test('Prompt 04 - Confirm: Không nhắc tới hoặc là "Hủy" -> dialog.accept() mặc định để giải phóng luồng kèm cảnh báo', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const interceptor = attachDialogInterceptor(page);

  // Không có bước kế tiếp khẳng định (hộp thoại ngoài kịch bản)
  interceptor.setCurrentStepContext({
    stepNumber: 2,
    stepText: 'Cuộn xuống 300px',
    nextStepText: 'Kiểm tra hiện chữ "Sản phẩm"',
  });

  await page.setContent(`
    <html>
      <body>
        <button id="btn-unexpected" onclick="window.__unexpResult = confirm('Đăng ký nhận tin khuyến mãi?')">Bật Confirm Bất Ngờ</button>
      </body>
    </html>
  `);

  await page.click('#btn-unexpected');

  const history = interceptor.getHistory();
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].type, 'confirm');
  assert.strictEqual(history[0].actionTaken, 'accept', 'Phải accept() mặc định để giải phóng luồng');
  assert.ok(history[0].warning, 'Phải đính kèm cảnh báo vào báo cáo khi confirm ngoài kịch bản');
  assert.ok(history[0].warning.includes('AI WARNING'));

  const resultInPage = await page.evaluate(() => (window as any).__unexpResult);
  assert.strictEqual(resultInPage, true, 'Luồng phải được giải phóng với confirm trả về true');

  await browser.close();
});

test('Prompt 04 - Confirm: Hỗ trợ dismiss khi allowDismissOnCancel được bật và kịch bản yêu cầu Hủy', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const interceptor = attachDialogInterceptor(page, { allowDismissOnCancel: true });

  interceptor.setCurrentStepContext({
    stepNumber: 1,
    stepText: 'Bấm nút "Hủy đơn"',
    nextStepText: 'Hủy hộp thoại',
  });

  await page.setContent(`
    <html>
      <body>
        <button id="btn-cancel" onclick="window.__cancelResult = confirm('Bạn có muốn hủy đơn?')">Hủy đơn</button>
      </body>
    </html>
  `);

  await page.click('#btn-cancel');

  const history = interceptor.getHistory();
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].type, 'confirm');
  assert.strictEqual(history[0].actionTaken, 'dismiss');

  const resultInPage = await page.evaluate(() => (window as any).__cancelResult);
  assert.strictEqual(resultInPage, false, 'Confirm phải trả về false khi dismiss()');

  await browser.close();
});

test('Prompt 04 - Prompt: Tự động điền giá trị từ kịch bản hoặc chuỗi rỗng rồi accept()', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const interceptor = attachDialogInterceptor(page);

  // Ngữ cảnh kịch bản có giá trị cần điền: "VOUCHER100"
  interceptor.setCurrentStepContext({
    stepNumber: 3,
    stepText: 'Bấm nút "Nhập mã"',
    nextStepText: 'Điền "VOUCHER100" vào ô "Mã"',
    subActions: [
      {
        stepNumber: 3,
        subIndex: 1,
        totalSubActions: 1,
        rawStepText: 'Bấm nút "Nhập mã"',
        subInstruction: 'Bấm nút "Nhập mã"',
        type: 'CLICK',
      },
    ],
    nextSubActions: [
      {
        stepNumber: 4,
        subIndex: 1,
        totalSubActions: 1,
        rawStepText: 'Điền "VOUCHER100"',
        subInstruction: 'Điền "VOUCHER100"',
        type: 'FILL',
        value: 'VOUCHER100',
      },
    ],
  });

  await page.setContent(`
    <html>
      <body>
        <button id="btn-prompt" onclick="window.__code = prompt('Nhập mã quà tặng:', 'DEF123')">Nhập mã</button>
      </body>
    </html>
  `);

  await page.click('#btn-prompt');

  const history = interceptor.getHistory();
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].type, 'prompt');
  assert.strictEqual(history[0].message, 'Nhập mã quà tặng:');
  assert.strictEqual(history[0].defaultValue, 'DEF123');
  assert.strictEqual(history[0].promptInput, 'VOUCHER100', 'Phải tự động trích xuất value từ kịch bản');
  assert.strictEqual(history[0].actionTaken, 'accept');

  const valInPage = await page.evaluate(() => (window as any).__code);
  assert.strictEqual(valInPage, 'VOUCHER100', 'Trình duyệt phải nhận được chuỗi VOUCHER100');

  await browser.close();
});

test('Prompt 04 - BeforeUnload: Tự động dialog.accept() không cản trở điều hướng trang', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/next') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1>Trang đích</h1></body></html>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <html>
        <body>
          <input id="inp" type="text" value="chưa lưu" />
          <a id="link-leave" href="/next">Rời khỏi trang</a>
          <script>
            window.addEventListener('beforeunload', function (e) {
              e.preventDefault();
              e.returnValue = 'Bạn có thay đổi chưa lưu!';
            });
          </script>
        </body>
      </html>
    `);
  });

  await new Promise<void>((r) => server.listen(39128, r));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const interceptor = attachDialogInterceptor(page);

  await page.goto('http://localhost:39128');
  await page.fill('#inp', 'đã chỉnh sửa dữ liệu');
  await page.click('#link-leave');
  await page.waitForURL('**/next', { timeout: 5000 });

  const history = interceptor.getHistory();
  assert.ok(history.length >= 1, 'Phải bắt được sự kiện beforeunload');
  const beforeUnloadDialog = history.find((d) => d.type === 'beforeunload');
  assert.ok(beforeUnloadDialog, 'Phải có dialog loại beforeunload');
  assert.strictEqual(beforeUnloadDialog.actionTaken, 'accept', 'BeforeUnload phải được accept để trang không bị kẹt');
  assert.ok(page.url().includes('/next'), 'Trang phải điều hướng thành công');

  await browser.close();
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
});

test('Prompt 04 - API Truy xuất lịch sử dialog: getCapturedDialogs, getLastCapturedDialog, clearCapturedDialogs', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  attachDialogInterceptor(page);

  await page.setContent(`
    <html>
      <body>
        <script>
          function runSequence() {
            alert('Thông báo 1');
            alert('Thông báo 2');
          }
        </script>
        <button id="btn-seq" onclick="runSequence()">Chạy chuỗi</button>
      </body>
    </html>
  `);

  await page.click('#btn-seq');

  const dialogs = getCapturedDialogs(page);
  assert.strictEqual(dialogs.length, 2);
  assert.strictEqual(dialogs[0].message, 'Thông báo 1');
  assert.strictEqual(dialogs[1].message, 'Thông báo 2');

  const lastDialog = getLastCapturedDialog(page);
  assert.ok(lastDialog);
  assert.strictEqual(lastDialog.message, 'Thông báo 2');

  clearCapturedDialogs(page);
  assert.strictEqual(getCapturedDialogs(page).length, 0);

  await browser.close();
});

test('Prompt 04 - Parser: Nhận diện cú pháp kịch bản HANDLE_DIALOG chuẩn hóa', () => {
  const parsedAccept = compileVietnameseScenario('(1) Chấp nhận hộp thoại');
  assert.strictEqual(parsedAccept.atomicActions.length, 1);
  assert.strictEqual(parsedAccept.atomicActions[0].type, 'HANDLE_DIALOG');
  assert.strictEqual(parsedAccept.atomicActions[0].dialogAction, 'ACCEPT');

  const parsedDismiss = compileVietnameseScenario('(1) Hủy hộp thoại');
  assert.strictEqual(parsedDismiss.atomicActions.length, 1);
  assert.strictEqual(parsedDismiss.atomicActions[0].type, 'HANDLE_DIALOG');
  assert.strictEqual(parsedDismiss.atomicActions[0].dialogAction, 'DISMISS');
});

test('Prompt 04 - E2E Strict Scenario: Xử lý Native Dialogs và Assertion kiểm tra thông điệp Alert', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>Test Native Dialogs</title></head>
      <body>
        <h1>Cổng thanh toán điện tử</h1>
        <button id="btn-pay" onclick="alert('Thanh toán thành công hóa đơn #998877!')">Thanh toán ngay</button>
      </body>
      </html>
    `);
  });

  await new Promise<void>((resolve) => server.listen(39124, resolve));

  const scenario = `
    (1) Bấm "Thanh toán ngay"
    (2) Kiểm tra hiện chữ "Thanh toán thành công"
  `;

  const result = await runStrictTestScenario({
    url: 'http://localhost:39124',
    scenario,
    headless: true,
  });

  assert.strictEqual(result.status, 'PASSED', 'Kịch bản phải PASSED');
  assert.strictEqual(result.completedSteps, 2, 'Cả 2 bước phải hoàn thành');
  assert.ok(result.dialogs && result.dialogs.length >= 1, 'Phải ghi nhận dialog vào kết quả TestRunResult');
  assert.strictEqual(result.dialogs[0].type, 'alert');
  assert.ok(result.dialogs[0].message.includes('Thanh toán thành công'));

  // Kiểm tra nhật ký bước 2 xác nhận từ Native Dialog
  const step2Log = result.logs.find((l) => l.step === 2);
  assert.ok(step2Log);
  assert.ok(step2Log.detail.includes('hộp thoại Native'));

  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
