import test from 'node:test';
import assert from 'node:assert';
import * as http from 'http';
import { chromium, Browser, Page } from 'playwright';
import {
  executeVirtualListScrollSearch,
  executeCustomDropdownProtocol,
  runStrictTestScenario,
  getOrCreateBarrier,
  waitForUIQuiescence,
} from '../src/runner';
import {
  isCustomSelectTrigger,
  isPortalOption,
  resolvePortalOptionCandidate,
  FLOATING_PORTAL_SELECTORS,
} from '../src/element-resolver';
import { compileVietnameseScenario } from '../src/step-parser';
import { distillPageDOM } from '../src/dom-distiller';
import { DOMCandidate, AtomicAction } from '../src/types';

// Helper tạo Mock Web Server phục vụ các bài test Virtual Scroll & Custom Dropdown
function createMockServer(): Promise<{ server: http.Server; baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url || '/';

      if (url === '/virtual-page.html') {
        // Trang mô phỏng Virtualized Infinite List:
        // Ban đầu chỉ hiển thị 5 item (chiều cao 500px).
        // Khi người dùng cuộn xuống (scroll event), JavaScript tự động mount thêm item mới vào DOM.
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Virtual List Test</title>
              <style>
                body { margin: 0; padding: 20px; font-family: sans-serif; min-height: 2500px; }
                .item-card { height: 120px; margin: 10px 0; padding: 10px; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; }
                #dynamic-footer { margin-top: 40px; padding: 20px; background: #e2e8f0; }
              </style>
            </head>
            <body>
              <h1>Danh Sách Sản Phẩm Ảo Hóa</h1>
              <div id="item-list">
                <div class="item-card" id="item-1"><h3>Sản phẩm 1</h3><p>Mô tả 1</p></div>
                <div class="item-card" id="item-2"><h3>Sản phẩm 2</h3><p>Mô tả 2</p></div>
                <div class="item-card" id="item-3"><h3>Sản phẩm 3</h3><p>Mô tả 3</p></div>
                <div class="item-card" id="item-4"><h3>Sản phẩm 4</h3><p>Mô tả 4</p></div>
                <div class="item-card" id="item-5"><h3>Sản phẩm 5</h3><p>Mô tả 5</p></div>
              </div>
              <div id="dynamic-footer">Footer đáy trang</div>

              <script>
                var loadedItems = 5;
                window.addEventListener('scroll', function() {
                  if (window.scrollY > 400 && loadedItems < 10) {
                    for (var i = loadedItems + 1; i <= 10; i++) {
                      var div = document.createElement('div');
                      div.className = 'item-card';
                      div.id = 'item-' + i;
                      div.innerHTML = '<h3>Sản phẩm ' + i + '</h3><button id="btn-buy-' + i + '">Mua Ngay ' + i + '</button>';
                      document.getElementById('item-list').appendChild(div);
                    }
                    loadedItems = 10;
                  }
                  if (window.scrollY > 800 && loadedItems < 15) {
                    var targetDiv = document.createElement('div');
                    targetDiv.className = 'item-card';
                    targetDiv.id = 'target-hidden-card';
                    targetDiv.innerHTML = '<h3>Mục Tiêu Cuộn Sâu</h3><button id="btn-deep-action">Kích Hoạt Cuộn Sâu</button>';
                    document.getElementById('item-list').appendChild(targetDiv);
                    loadedItems = 15;
                  }
                });
              </script>
            </body>
          </html>
        `);
      } else if (url === '/short-page.html') {
        // Trang ngắn không có phần tử mục tiêu (kiểm tra Bottom Boundary Cutoff)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Trang Ngắn</title><style>body { height: 400px; margin: 0; padding: 20px; }</style></head>
            <body>
              <h2>Chỉ có vài phần tử</h2>
              <button id="btn-static">Nút Tĩnh</button>
            </body>
          </html>
        `);
      } else if (url === '/virtual-container.html') {
        // Danh sách ảo nằm bên trong một Container có scrollbar (overflow-y: scroll)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Container Virtual Scroll</title>
              <style>
                .scroll-box { height: 260px; overflow-y: scroll; border: 2px solid #64748b; padding: 10px; }
                .row { height: 70px; margin: 6px 0; background: #e0f2fe; }
              </style>
            </head>
            <body>
              <h2>Hộp Cuộn Phân Đoạn</h2>
              <div class="scroll-box virtual-list" id="my-virtual-box">
                <div class="row">Hàng 1</div>
                <div class="row">Hàng 2</div>
                <div class="row">Hàng 3</div>
                <div class="row">Hàng 4</div>
                <div class="row" style="margin-top: 500px;">
                  <button id="btn-inside-container">Nút Nằm Sâu Trong Hộp</button>
                </div>
              </div>
            </body>
          </html>
        `);
      } else if (url === '/antd-dropdown.html') {
        // Giao diện mô phỏng Dropdown Ant Design:
        // Trigger là div.ant-select-selector, khi click sẽ sinh ra body > div.ant-select-dropdown
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Ant Design Select Mock</title>
              <style>
                .ant-select { display: inline-block; width: 220px; cursor: pointer; border: 1px solid #d9d9d9; padding: 6px 12px; border-radius: 4px; }
                .ant-select-dropdown { position: absolute; top: 70px; left: 20px; width: 220px; background: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.15); border-radius: 4px; z-index: 1000; }
                .ant-select-item-option { padding: 8px 12px; cursor: pointer; }
                .ant-select-item-option:hover { background: #f5f5f5; }
              </style>
            </head>
            <body>
              <h2>Chọn Tỉnh Thành Phố</h2>
              <div class="ant-select ant-select-single" id="city-select">
                <div class="ant-select-selector" role="combobox" aria-haspopup="listbox" aria-expanded="false">
                  <span class="ant-select-selection-item" id="selected-city-text">Vui lòng chọn thành phố</span>
                </div>
              </div>
              <div id="result-status" style="margin-top: 20px; font-weight: bold;">Chưa chọn</div>

              <script>
                var trigger = document.getElementById('city-select');
                var dropdown = null;

                trigger.addEventListener('click', function() {
                  if (dropdown) return;
                  dropdown = document.createElement('div');
                  dropdown.className = 'ant-select-dropdown';
                  dropdown.setAttribute('role', 'listbox');
                  dropdown.innerHTML = \`
                    <div class="ant-select-item ant-select-item-option" role="option" data-value="HN">Hà Nội</div>
                    <div class="ant-select-item ant-select-item-option" role="option" data-value="HCM">Hồ Chí Minh</div>
                    <div class="ant-select-item ant-select-item-option" role="option" data-value="DN">Đà Nẵng</div>
                  \`;
                  document.body.appendChild(dropdown);

                  dropdown.querySelectorAll('.ant-select-item-option').forEach(function(opt) {
                    opt.addEventListener('click', function(e) {
                      var text = opt.innerText.trim();
                      document.getElementById('selected-city-text').innerText = text;
                      document.getElementById('result-status').innerText = 'Đã chọn: ' + text;
                      if (dropdown) {
                        dropdown.remove();
                        dropdown = null;
                      }
                    });
                  });
                });

                document.addEventListener('keydown', function(e) {
                  if (e.key === 'Escape' && dropdown) {
                    dropdown.remove();
                    dropdown = null;
                  }
                });
              </script>
            </body>
          </html>
        `);
      } else if (url === '/mui-dropdown.html') {
        // Giao diện mô phỏng Dropdown Material-UI:
        // Trigger có role="combobox", overlay portal gắn trực tiếp vào body (body > .MuiAutocomplete-popper)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Material-UI Select Mock</title>
              <style>
                .MuiInputBase-root { border: 1px solid #1976d2; padding: 8px; width: 240px; cursor: pointer; }
                .MuiAutocomplete-popper { position: absolute; top: 80px; left: 20px; background: white; border: 1px solid #ccc; width: 240px; box-shadow: 0 4px 10px rgba(0,0,0,0.2); }
                .MuiAutocomplete-option { padding: 8px 12px; cursor: pointer; }
              </style>
            </head>
            <body>
              <h2>Material-UI Dropdown</h2>
              <div class="MuiAutocomplete-root" id="country-select">
                <div class="MuiInputBase-root" role="combobox" aria-expanded="false">
                  <span id="country-display">Chọn quốc gia</span>
                </div>
              </div>
              <div id="mui-status">Trạng thái: Trống</div>

              <script>
                var trigger = document.getElementById('country-select');
                var popper = null;

                trigger.addEventListener('click', function() {
                  if (popper) return;
                  popper = document.createElement('div');
                  popper.className = 'MuiAutocomplete-popper';
                  popper.setAttribute('role', 'listbox');
                  popper.innerHTML = \`
                    <div class="MuiAutocomplete-option" role="option">Vietnam</div>
                    <div class="MuiAutocomplete-option" role="option">United States</div>
                    <div class="MuiAutocomplete-option" role="option">Japan</div>
                  \`;
                  document.body.appendChild(popper);

                  popper.querySelectorAll('.MuiAutocomplete-option').forEach(function(opt) {
                    opt.addEventListener('click', function() {
                      var val = opt.innerText.trim();
                      document.getElementById('country-display').innerText = val;
                      document.getElementById('mui-status').innerText = 'Trạng thái: ' + val;
                      popper.remove();
                      popper = null;
                    });
                  });
                });
              </script>
            </body>
          </html>
        `);
      } else if (url === '/react-select.html') {
        // Giao diện mô phỏng React-Select:
        // Trigger có class class="select__control", portal có class="select__menu"
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>React-Select Mock</title>
              <style>
                .select__control { border: 1px solid #38bdf8; padding: 8px; width: 220px; cursor: pointer; }
                .select__menu { position: absolute; top: 75px; left: 20px; background: #fff; width: 220px; border: 1px solid #94a3b8; }
                .select__option { padding: 6px 12px; cursor: pointer; }
              </style>
            </head>
            <body>
              <h2>React-Select Demo</h2>
              <div class="select__control" id="status-select">
                <div class="select__placeholder" id="rs-display">Chọn trạng thái</div>
              </div>
              <div id="rs-result">None</div>

              <script>
                var ctrl = document.getElementById('status-select');
                var menu = null;

                ctrl.addEventListener('click', function() {
                  if (menu) return;
                  menu = document.createElement('div');
                  menu.className = 'select__menu';
                  menu.setAttribute('role', 'listbox');
                  menu.innerHTML = \`
                    <div class="select__option" role="option">Hoạt động</div>
                    <div class="select__option" role="option">Tạm dừng</div>
                    <div class="select__option" role="option">Đã hủy</div>
                  \`;
                  document.body.appendChild(menu);

                  menu.querySelectorAll('.select__option').forEach(function(item) {
                    item.addEventListener('click', function() {
                      var txt = item.innerText.trim();
                      document.getElementById('rs-display').innerText = txt;
                      document.getElementById('rs-result').innerText = txt;
                      menu.remove();
                      menu = null;
                    });
                  });
                });
              </script>
            </body>
          </html>
        `);
      } else if (url === '/hanging-menu.html') {
        // Dropdown bị treo (menu không tự động biến mất sau khi click)
        // Hệ thống phải tự động gửi phím Escape để đóng portal
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Hanging Menu Mock</title>
              <style>
                .custom-select-trigger { border: 1px solid #333; padding: 8px; cursor: pointer; width: 200px; }
                .hanging-portal { position: fixed; top: 80px; left: 20px; width: 200px; background: yellow; border: 2px solid red; z-index: 9999; }
                .portal-item { padding: 6px; cursor: pointer; }
              </style>
            </head>
            <body>
              <div class="custom-select-trigger" id="hang-trigger" role="combobox">Bấm mở menu</div>
              <div id="hang-status">Chưa chọn</div>

              <script>
                var p = null;
                document.getElementById('hang-trigger').addEventListener('click', function() {
                  if (p) return;
                  p = document.createElement('div');
                  p.className = 'hanging-portal';
                  p.setAttribute('role', 'listbox');
                  p.innerHTML = '<div class="portal-item" role="option">Mục Treo 1</div><div class="portal-item" role="option">Mục Treo 2</div>';
                  document.body.appendChild(p);

                  p.querySelector('.portal-item').addEventListener('click', function() {
                    document.getElementById('hang-status').innerText = 'Đã chọn Mục Treo 1';
                    // CỐ TÌNH KHÔNG REMOVE DROPDOWN ĐỂ MÔ PHỎNG MENU TREO
                  });
                });

                document.addEventListener('keydown', function(e) {
                  if (e.key === 'Escape' && p) {
                    p.remove();
                    p = null;
                  }
                });
              </script>
            </body>
          </html>
        `);
      } else if (url === '/native-select.html') {
        // Thẻ <select> native
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Native Select</title></head>
            <body>
              <h2>Thẻ Select Native</h2>
              <select id="country-native">
                <option value="">-- Chọn nước --</option>
                <option value="vn">Vietnam</option>
                <option value="us">United States</option>
                <option value="jp">Japan</option>
              </select>
              <div id="native-result">Chưa chọn</div>

              <script>
                document.getElementById('country-native').addEventListener('change', function(e) {
                  document.getElementById('native-result').innerText = 'Đã chọn: ' + e.target.value;
                });
              </script>
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

// =========================================================================
// BỘ KIỂM THỬ TRỤ CỘT 10: VIRTUALIZED LIST INCREMENTAL SCROLL ENGINE
// =========================================================================

test('Trụ cột 10: Virtualized List Incremental Scroll tìm thấy phần tử ở vị trí cuộn sâu', async () => {
  const { baseUrl, close } = await createMockServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const barrier = getOrCreateBarrier(page);

    await page.goto(`${baseUrl}/virtual-page.html`);
    await waitForUIQuiescence(page, 2000, barrier);

    // Quét danh sách candidates ban đầu: Phần tử mục tiêu "Kích Hoạt Cuộn Sâu" chưa hề xuất hiện trong DOM
    const initialCandidates = await distillPageDOM(page);
    const hasDeepButtonInitial = initialCandidates.some((c) => (c.text || '').includes('Kích Hoạt Cuộn Sâu'));
    assert.strictEqual(hasDeepButtonInitial, false, 'Ban đầu phần tử ở sâu chưa mount vào DOM');

    // Khởi chạy executeVirtualListScrollSearch với Step Scroll 350px
    const action: AtomicAction = {
      stepNumber: 1,
      subIndex: 1,
      totalSubActions: 1,
      rawStepText: 'Bấm "Kích Hoạt Cuộn Sâu"',
      subInstruction: 'Bấm "Kích Hoạt Cuộn Sâu"',
      type: 'CLICK',
      targetHint: 'Kích Hoạt Cuộn Sâu',
    };

    const scrollRes = await executeVirtualListScrollSearch(
      page,
      action,
      barrier,
      initialCandidates,
      { stepPx: 350, maxSteps: 5, pauseWaitMs: 200 }
    );

    assert.strictEqual(scrollRes.found, true, 'Hệ thống phải tìm thấy phần tử sau các bước cuộn phân đoạn');
    assert.ok(scrollRes.candidate !== null);
    assert.ok(scrollRes.stepsScrolled >= 2, `Cần cuộn ít nhất 2 bước (thực tế: ${scrollRes.stepsScrolled})`);
    assert.ok(scrollRes.totalPxScrolled >= 700, `Tổng quãng đường cuộn >= 700px (thực tế: ${scrollRes.totalPxScrolled})`);

    // Kiểm tra element đã được scroll vào tầm nhìn
    const isTargetVisible = await page.evaluate(() => {
      const el = document.getElementById('btn-deep-action');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight + 100;
    });
    assert.ok(isTargetVisible, 'Phần tử phải nằm trong tầm nhìn sau scrollIntoViewIfNeeded');
  } finally {
    await browser.close();
    await close();
  }
});

test('Trụ cột 10: Bottom Boundary Cutoff dừng cuộn sớm khi trang chạm đáy', async () => {
  const { baseUrl, close } = await createMockServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const barrier = getOrCreateBarrier(page);

    await page.goto(`${baseUrl}/short-page.html`);
    await waitForUIQuiescence(page, 2000, barrier);

    const initialCandidates = await distillPageDOM(page);

    const action: AtomicAction = {
      stepNumber: 1,
      subIndex: 1,
      totalSubActions: 1,
      rawStepText: 'Bấm "Phần Tử Ảo Tưởng"',
      subInstruction: 'Bấm "Phần Tử Ảo Tưởng"',
      type: 'CLICK',
      targetHint: 'Phần Tử Ảo Tưởng',
    };

    const scrollRes = await executeVirtualListScrollSearch(
      page,
      action,
      barrier,
      initialCandidates,
      { stepPx: 350, maxSteps: 5, pauseWaitMs: 150 }
    );

    assert.strictEqual(scrollRes.found, false, 'Không được tìm thấy phần tử ảo');
    assert.strictEqual(scrollRes.hitBottom, true, 'Phải kích hoạt Bottom Boundary Cutoff');
    assert.ok(scrollRes.stepsScrolled <= 2, `Phải dừng lại sớm khi chạm đáy trang (thực tế: ${scrollRes.stepsScrolled} bước)`);
  } finally {
    await browser.close();
    await close();
  }
});

test('Trụ cột 10: Cuộn phân đoạn bên trong Container có thanh cuộn riêng (overflow-y)', async () => {
  const { baseUrl, close } = await createMockServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const barrier = getOrCreateBarrier(page);

    await page.goto(`${baseUrl}/virtual-container.html`);
    await waitForUIQuiescence(page, 2000, barrier);

    const initialCandidates = await distillPageDOM(page);

    const action: AtomicAction = {
      stepNumber: 1,
      subIndex: 1,
      totalSubActions: 1,
      rawStepText: 'Bấm "Nút Nằm Sâu Trong Hộp"',
      subInstruction: 'Bấm "Nút Nằm Sâu Trong Hộp"',
      type: 'CLICK',
      targetHint: 'Nút Nằm Sâu Trong Hộp',
    };

    const scrollRes = await executeVirtualListScrollSearch(
      page,
      action,
      barrier,
      initialCandidates,
      { stepPx: 350, maxSteps: 5, pauseWaitMs: 150 }
    );

    assert.strictEqual(scrollRes.found, true, 'Phải tìm thấy nút bên trong scrollable box');
    assert.ok(scrollRes.candidate !== null);
  } finally {
    await browser.close();
    await close();
  }
});

// =========================================================================
// BỘ KIỂM THỬ TRỤ CỘT 11: CUSTOM PORTAL DROPDOWN PROTOCOL
// =========================================================================

test('Trụ cột 11: Nhận diện chính xác Trigger Dropdown và Option qua Helper functions', () => {
  // Ant Design Trigger
  const antdTrigger: DOMCandidate = {
    candidateId: 1,
    tag: 'div',
    text: 'Chọn thành phố',
    role: 'combobox',
    disabled: false,
    obscured: false,
    rect: { x: 10, y: 10, width: 200, height: 35 },
    selectorPath: '#city-select',
    fingerprint: {
      tag: 'div',
      role: 'combobox',
      stableClasses: ['ant-select-selector', 'ant-select'],
      selectorPath: '#city-select',
    },
  };
  assert.strictEqual(isCustomSelectTrigger(antdTrigger), true, 'Antd Selector phải được nhận diện là Trigger');

  // React-Select Trigger
  const rsTrigger: DOMCandidate = {
    candidateId: 2,
    tag: 'div',
    text: 'Select status...',
    disabled: false,
    obscured: false,
    rect: { x: 10, y: 10, width: 200, height: 35 },
    selectorPath: '.select__control',
    fingerprint: {
      tag: 'div',
      stableClasses: ['select__control', 'css-1s2enng-control'],
      selectorPath: '.select__control',
    },
  };
  assert.strictEqual(isCustomSelectTrigger(rsTrigger), true, 'React-Select Control phải là Trigger');

  // Native select không phải là Custom Trigger
  const nativeSelect: DOMCandidate = {
    candidateId: 3,
    tag: 'select',
    text: 'Option 1 Option 2',
    disabled: false,
    obscured: false,
    rect: { x: 10, y: 10, width: 100, height: 30 },
    selectorPath: 'select#lang',
    fingerprint: { tag: 'select', stableClasses: [], selectorPath: 'select#lang' },
  };
  assert.strictEqual(isCustomSelectTrigger(nativeSelect), false, 'Native select không phải Custom Trigger');

  // Antd Option Candidate
  const antdOption: DOMCandidate = {
    candidateId: 4,
    tag: 'div',
    text: 'Hà Nội',
    role: 'option',
    disabled: false,
    obscured: false,
    rect: { x: 10, y: 80, width: 200, height: 30 },
    selectorPath: '.ant-select-item-option',
    fingerprint: {
      tag: 'div',
      role: 'option',
      stableClasses: ['ant-select-item-option'],
      selectorPath: '.ant-select-item-option',
    },
  };
  assert.strictEqual(isPortalOption(antdOption), true, 'Phải nhận diện là Portal Option');

  // So khớp option với text có dấu / không dấu / typo
  const optionCandidates: DOMCandidate[] = [
    antdOption,
    {
      candidateId: 5,
      tag: 'div',
      text: 'Hồ Chí Minh',
      role: 'option',
      disabled: false,
      obscured: false,
      rect: { x: 10, y: 110, width: 200, height: 30 },
      selectorPath: '.ant-select-item-option:nth-child(2)',
      fingerprint: { tag: 'div', role: 'option', stableClasses: ['ant-select-item-option'], selectorPath: '' },
    },
  ];

  const matchExact = resolvePortalOptionCandidate(optionCandidates, 'Hà Nội');
  assert.strictEqual(matchExact?.candidateId, 4, 'Khớp chính xác Hà Nội');

  const matchNoAccent = resolvePortalOptionCandidate(optionCandidates, 'ho chi minh');
  assert.strictEqual(matchNoAccent?.candidateId, 5, 'Khớp không dấu Hồ Chí Minh');

  const matchFuzzy = resolvePortalOptionCandidate(optionCandidates, 'Ha Nọi');
  assert.strictEqual(matchFuzzy?.candidateId, 4, 'Khớp mờ Damerau Ha Nọi -> Hà Nội');
});

test('Trụ cột 11: Ant Design Custom Dropdown 3-Pha Protocol (Click Trigger -> Chờ Portal -> Chọn Option)', async () => {
  const { baseUrl, close } = await createMockServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const barrier = getOrCreateBarrier(page);

    await page.goto(`${baseUrl}/antd-dropdown.html`);
    await waitForUIQuiescence(page, 2000, barrier);

    const candidates = await distillPageDOM(page);
    const triggerCand = candidates.find((c) => isCustomSelectTrigger(c) || c.selectorPath.includes('city-select'));
    assert.ok(triggerCand, 'Phải tìm thấy trigger selector của Antd');

    // Thực thi giao thức 3 pha chọn "Đà Nẵng"
    const dropRes = await executeCustomDropdownProtocol(page, barrier, triggerCand!, 'Đà Nẵng');

    assert.strictEqual(dropRes.success, true, 'Thực thi giao thức dropdown Antd phải thành công');
    assert.strictEqual(dropRes.triggerClicked, true, 'Pha 1: Trigger đã được click');
    assert.strictEqual(dropRes.portalFound, true, 'Pha 2: Menu overlay xuất hiện tại cuối body');
    assert.ok(
      dropRes.portalSelector?.includes('ant-select-dropdown') || dropRes.portalSelector?.includes('listbox'),
      `Portal selector phải khớp với overlay dropdown: ${dropRes.portalSelector}`
    );
    assert.strictEqual(dropRes.optionFound, true, 'Pha 3: Đã tìm thấy và click option "Đà Nẵng"');

    // Xác nhận kết quả trên trang
    const resultText = await page.innerText('#result-status');
    assert.strictEqual(resultText, 'Đã chọn: Đà Nẵng');
  } finally {
    await browser.close();
    await close();
  }
});

test('Trụ cột 11: Material-UI Dropdown với Overlay Portal gắn vào cuối body', async () => {
  const { baseUrl, close } = await createMockServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const barrier = getOrCreateBarrier(page);

    await page.goto(`${baseUrl}/mui-dropdown.html`);
    await waitForUIQuiescence(page, 2000, barrier);

    const candidates = await distillPageDOM(page);
    const muiTrigger = candidates.find((c) => c.role === 'combobox' || c.selectorPath.includes('country-select'));
    assert.ok(muiTrigger, 'Phải tìm thấy MUI combobox trigger');

    const dropRes = await executeCustomDropdownProtocol(page, barrier, muiTrigger!, 'Vietnam');

    assert.strictEqual(dropRes.success, true);
    assert.strictEqual(dropRes.portalFound, true);
    assert.ok(
      dropRes.portalSelector?.includes('MuiAutocomplete-popper') || dropRes.portalSelector?.includes('listbox'),
      `Portal selector phải là MUI listbox/popper: ${dropRes.portalSelector}`
    );
    assert.strictEqual(dropRes.optionFound, true);

    const statusText = await page.innerText('#mui-status');
    assert.strictEqual(statusText, 'Trạng thái: Vietnam');
  } finally {
    await browser.close();
    await close();
  }
});

test('Trụ cột 11: React-Select Control và Menu Overlay', async () => {
  const { baseUrl, close } = await createMockServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const barrier = getOrCreateBarrier(page);

    await page.goto(`${baseUrl}/react-select.html`);
    await waitForUIQuiescence(page, 2000, barrier);

    const candidates = await distillPageDOM(page);
    const rsTrigger = candidates.find((c) => c.selectorPath.includes('status-select') || isCustomSelectTrigger(c));
    assert.ok(rsTrigger, 'Phải tìm thấy React-Select trigger');

    const dropRes = await executeCustomDropdownProtocol(page, barrier, rsTrigger!, 'Hoạt động');

    assert.strictEqual(dropRes.success, true);
    assert.strictEqual(dropRes.optionFound, true);

    const resultText = await page.innerText('#rs-result');
    assert.strictEqual(resultText, 'Hoạt động');
  } finally {
    await browser.close();
    await close();
  }
});

test('Trụ cột 11: Tự động khôi phục khi Menu Treo (Gửi phím Escape để đóng Portal che)', async () => {
  const { baseUrl, close } = await createMockServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const barrier = getOrCreateBarrier(page);

    await page.goto(`${baseUrl}/hanging-menu.html`);
    await waitForUIQuiescence(page, 2000, barrier);

    const candidates = await distillPageDOM(page);
    const hangTrigger = candidates.find((c) => c.selectorPath.includes('hang-trigger') || c.role === 'combobox');
    assert.ok(hangTrigger, 'Phải tìm thấy hanging trigger');

    const dropRes = await executeCustomDropdownProtocol(page, barrier, hangTrigger!, 'Mục Treo 1', {
      autoCloseHangingMenu: true,
    });

    assert.strictEqual(dropRes.success, true);
    assert.strictEqual(dropRes.optionFound, true);
    assert.strictEqual(dropRes.menuClosed, true, 'Hệ thống phải tự động giải phóng portal treo bằng phím Escape');

    // Xác nhận portal đã được gỡ khỏi DOM
    const portalCount = await page.locator('.hanging-portal').count();
    assert.strictEqual(portalCount, 0, 'Portal treo phải biến mất sau khi nhấn Escape');
  } finally {
    await browser.close();
    await close();
  }
});

test('Trụ cột 11: Biên dịch cú pháp DSL tự nhiên tiếng Việt cho hành động chọn dropdown', () => {
  const scenarioText = `
    (1) Chọn "Hà Nội" từ dropdown "Thành phố"
    (2) Chọn "Vietnam" trong "Quốc gia"
    (3) Chọn dropdown "Trạng thái" là "Hoạt động"
    (4) Chọn option "Tháng 5"
  `;

  const parsed = compileVietnameseScenario(scenarioText);
  assert.strictEqual(parsed.totalSteps, 4);

  // Bước 1
  assert.strictEqual(parsed.atomicActions[0].type, 'SELECT_OPTION');
  assert.strictEqual(parsed.atomicActions[0].value, 'Hà Nội');
  assert.strictEqual(parsed.atomicActions[0].targetHint, 'Thành phố');

  // Bước 2
  assert.strictEqual(parsed.atomicActions[1].type, 'SELECT_OPTION');
  assert.strictEqual(parsed.atomicActions[1].value, 'Vietnam');
  assert.strictEqual(parsed.atomicActions[1].targetHint, 'Quốc gia');

  // Bước 3
  assert.strictEqual(parsed.atomicActions[2].type, 'SELECT_OPTION');
  assert.strictEqual(parsed.atomicActions[2].targetHint, 'Trạng thái');
  assert.strictEqual(parsed.atomicActions[2].value, 'Hoạt động');

  // Bước 4
  assert.strictEqual(parsed.atomicActions[3].type, 'SELECT_OPTION');
  assert.strictEqual(parsed.atomicActions[3].value, 'Tháng 5');
});

// =========================================================================
// BỘ KIỂM THỬ TÍCH HỢP TOÀN DIỆN E2E QUA runStrictTestScenario
// =========================================================================

test('E2E: runStrictTestScenario tự động cuộn tìm mục ảo hóa và chọn Custom Dropdown Antd', async () => {
  const { baseUrl, close } = await createMockServer();
  try {
    const scenario = `
      (1) Chọn "Đà Nẵng" từ dropdown "city-select"
      (2) Kiểm tra "Đã chọn: Đà Nẵng"
    `;

    const result = await runStrictTestScenario({
      url: `${baseUrl}/antd-dropdown.html`,
      scenario,
      headless: true,
    });

    assert.strictEqual(result.status, 'PASSED', `Kịch bản E2E phải đạt PASSED: ${result.summary}`);
    assert.strictEqual(result.completedSteps, 2);
    assert.strictEqual(result.totalSteps, 2);
  } finally {
    await close();
  }
});

test('E2E: runStrictTestScenario chọn Option trên thẻ select native', async () => {
  const { baseUrl, close } = await createMockServer();
  try {
    const scenario = `
      (1) Chọn "Vietnam" trong dropdown "country-native"
      (2) Kiểm tra "Đã chọn: vn"
    `;

    const result = await runStrictTestScenario({
      url: `${baseUrl}/native-select.html`,
      scenario,
      headless: true,
    });

    assert.strictEqual(result.status, 'PASSED', `Native Select phải đạt PASSED: ${result.summary}`);
    assert.strictEqual(result.completedSteps, 2);
  } finally {
    await close();
  }
});

test('E2E: runStrictTestScenario tự động cuộn Virtual Scroll để tìm và click nút ở sâu', async () => {
  const { baseUrl, close } = await createMockServer();
  try {
    const scenario = `
      (1) Bấm "Kích Hoạt Cuộn Sâu"
      (2) Chờ 1 giây
    `;

    const result = await runStrictTestScenario({
      url: `${baseUrl}/virtual-page.html`,
      scenario,
      headless: true,
    });

    assert.strictEqual(result.status, 'PASSED', `Virtual Scroll E2E phải đạt PASSED: ${result.summary}`);
    assert.strictEqual(result.completedSteps, 2);
  } finally {
    await close();
  }
});
