import test from 'node:test';
import assert from 'node:assert';
import * as http from 'http';
import { chromium } from 'playwright';
import {
  waitForUIQuiescence,
  getOrCreateBarrier,
  RETRY_BACKOFF_MS,
  runStrictTestScenario,
} from '../src/runner';

test('Prompt 02 - Hằng số Exponential Backoff Retry', () => {
  assert.deepStrictEqual(
    RETRY_BACKOFF_MS,
    [500, 1500, 3000],
    'Hằng số retry phải tăng dần: 500ms -> 1500ms -> 3000ms'
  );
});

test('Prompt 02 - UI Quiescence: Chờ Inflight Network Requests = 0 duy trì liên tục >= 300ms', async () => {
  let requestFinished = false;
  const server = http.createServer((req, res) => {
    if (req.url === '/api/data') {
      setTimeout(() => {
        requestFinished = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'done' }));
      }, 400);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><body><h1>Test Inflight</h1></body></html>');
  });

  await new Promise<void>((resolve) => server.listen(39123, resolve));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const barrier = getOrCreateBarrier(page);

  await page.goto('http://localhost:39123');

  // Kích hoạt fetch API ngay lập tức
  await page.evaluate(() => {
    (window as any).__fetchPromise = fetch('/api/data');
  });

  // Chờ 50ms để Playwright bắt được sự kiện request
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(barrier.getInflightCount(), 1, 'Inflight request phải bằng 1');

  const start = Date.now();
  await waitForUIQuiescence(page, 5000, barrier);
  const elapsed = Date.now() - start;

  assert.strictEqual(requestFinished, true, 'Request API phải hoàn thành trước khi thoát');
  assert.strictEqual(barrier.getInflightCount(), 0, 'Inflight request phải trở về 0');
  // Phải chờ request hoàn tất (~350ms còn lại) + 300ms tĩnh mạng liên tục = ~650ms
  assert.ok(
    elapsed >= 550,
    `waitForUIQuiescence phải chờ ít nhất 550ms (bao gồm 300ms tĩnh mạng). Thực tế: ${elapsed}ms`
  );

  await browser.close();
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('Prompt 02 - UI Quiescence: Lắng nghe DOM Mutation (Node thêm/xóa/sửa thuộc tính trong 200ms cuối)', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const barrier = getOrCreateBarrier(page);

  await page.setContent(`
    <html>
      <body>
        <div id="target">Nội dung</div>
      </body>
    </html>
  `);

  await barrier.ensureInPageObserver();

  // Thay đổi attribute liên tục 8 lần mỗi 40ms = 320ms
  await page.evaluate(() => {
    let count = 0;
    const interval = setInterval(() => {
      count++;
      const el = document.getElementById('target')!;
      el.setAttribute('data-tick', String(count));
      el.className = `class-${count}`;
      if (count >= 8) {
        clearInterval(interval);
      }
    }, 40);
  });

  const start = Date.now();
  await waitForUIQuiescence(page, 5000, barrier);
  const elapsed = Date.now() - start;

  // 320ms đột biến + 200ms DOM tĩnh = ~520ms
  assert.ok(
    elapsed >= 450,
    `waitForUIQuiescence phải chờ các đột biến DOM kết thúc và duy trì tĩnh 200ms. Thực tế: ${elapsed}ms`
  );

  await browser.close();
});

test('Prompt 02 - UI Quiescence: Đợi Spinner / Skeleton ([aria-busy="true"], .spinner, .skeleton, [data-loading]) biến mất', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const barrier = getOrCreateBarrier(page);

  await page.setContent(`
    <html>
      <head>
        <style>
          .spinner { width: 30px; height: 30px; }
          .skeleton { width: 100px; height: 20px; }
        </style>
      </head>
      <body>
        <div id="sp" class="spinner">Đang tải...</div>
        <div id="sk" class="skeleton" data-loading="true"></div>
        <div id="ab" aria-busy="true">Loading container</div>
      </body>
    </html>
  `);

  await barrier.ensureInPageObserver();

  // Ẩn spinner/skeleton sau 400ms
  await page.evaluate(() => {
    setTimeout(() => {
      document.getElementById('sp')!.style.display = 'none';
      document.getElementById('sk')!.style.display = 'none';
      document.getElementById('ab')!.removeAttribute('aria-busy');
    }, 400);
  });

  const start = Date.now();
  await waitForUIQuiescence(page, 5000, barrier);
  const elapsed = Date.now() - start;

  // 400ms spinner hiển thị + 200ms DOM tĩnh = ~600ms
  assert.ok(
    elapsed >= 500,
    `waitForUIQuiescence phải đợi cho đến khi spinner, skeleton và aria-busy biến mất hoàn toàn. Thực tế: ${elapsed}ms`
  );

  await browser.close();
});

test('Prompt 02 - Dynamic Retry Loop: Tự phục hồi khi phần tử xuất hiện trễ sau khi trang tải', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <body>
          <h1>Trang Single Page App</h1>
          <div id="container">Chờ dữ liệu...</div>
          <script>
            // Nút "Xác nhận mua" xuất hiện trễ sau 700ms (sau khi lần quét đầu thất bại)
            setTimeout(() => {
              const btn = document.createElement('button');
              btn.id = 'buy-btn';
              btn.textContent = 'Xác nhận mua';
              btn.onclick = () => {
                const div = document.createElement('div');
                div.id = 'success-msg';
                div.textContent = 'Mua hàng thành công!';
                document.body.appendChild(div);
              };
              document.getElementById('container').appendChild(btn);
            }, 700);
          </script>
        </body>
      </html>
    `);
  });

  await new Promise<void>((resolve) => server.listen(39124, resolve));

  const scenario = `
    (1) Bấm nút "Xác nhận mua" ->
    (2) Kiểm tra hiện thông báo "Mua hàng thành công!"
  `.trim();

  const result = await runStrictTestScenario({
    url: 'http://localhost:39124',
    scenario,
    headless: true,
  });

  assert.strictEqual(
    result.status,
    'PASSED',
    `Kịch bản phải PASSED nhờ cơ chế Exponential Backoff Retry tự phục hồi khi nút xuất hiện trễ`
  );
  assert.strictEqual(result.completedSteps, 2, 'Cả 2 bước phải hoàn tất thành công');

  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
