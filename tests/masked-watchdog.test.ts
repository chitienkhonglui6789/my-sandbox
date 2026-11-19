import test from 'node:test';
import assert from 'node:assert';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import {
  normalizeMaskedValue,
  checkMaskedInputIntegrity,
  computePageDomHash,
  DeadlockWatchdogCircuitBreaker,
  executePhysicalAction,
  executeStepAction,
  runStrictTestScenario,
  getOrCreateBarrier,
} from '../src/runner';
import { AtomicAction, DOMCandidate } from '../src/types';

// ============================================================================
// 1. UNIT TESTS: NORMALIZE MASKED VALUE & INTEGRITY VERIFICATION (PILLAR 12)
// ============================================================================

test('Prompt 07 - Pillar 12: normalizeMaskedValue loại bỏ khoảng trắng, dấu gạch ngang, dấu ngoặc', () => {
  assert.strictEqual(normalizeMaskedValue('(090) 123-4567'), '0901234567');
  assert.strictEqual(normalizeMaskedValue('090-123-4567'), '0901234567');
  assert.strictEqual(normalizeMaskedValue(' (098) - 765 - 4321 '), '0987654321');
  assert.strictEqual(normalizeMaskedValue('2026-11-18'), '20261118');
  assert.strictEqual(normalizeMaskedValue('1234 5678 9012 3456'), '1234567890123456');
  assert.strictEqual(normalizeMaskedValue(''), '');
});

test('Prompt 07 - Pillar 12: checkMaskedInputIntegrity xác thực tính toàn vẹn ký tự sau khi nhập', () => {
  // Khớp chính xác
  assert.strictEqual(checkMaskedInputIntegrity('0901234567', '0901234567'), true);

  // Ô nhập có mặt nạ tự format (090) 123-4567 vs giá trị thô 0901234567
  assert.strictEqual(checkMaskedInputIntegrity('(090) 123-4567', '0901234567'), true);

  // Cả hai đều có định dạng
  assert.strictEqual(checkMaskedInputIntegrity('(090) 123-4567', '(090) 123-4567'), true);

  // Mặt nạ nuốt ký tự (chỉ nhận 090 123 thay vì đủ 10 số) -> Phải trả về false
  assert.strictEqual(checkMaskedInputIntegrity('(090) 123', '0901234567'), false);

  // Mặt nạ nuốt ký tự, trả về chuỗi rỗng hoặc thiếu -> Phải trả về false
  assert.strictEqual(checkMaskedInputIntegrity('', '0901234567'), false);

  // Mặt nạ thêm tiền tố quốc gia: +84 (090) 123-4567
  assert.strictEqual(checkMaskedInputIntegrity('+84 (090) 123-4567', '0901234567'), true);

  // Thẻ tín dụng 16 số có dấu cách
  assert.strictEqual(
    checkMaskedInputIntegrity('1234 5678 9012 3456', '1234567890123456'),
    true
  );

  // Thẻ tín dụng bị nuốt số (chỉ có 12 số) -> false
  assert.strictEqual(
    checkMaskedInputIntegrity('1234 5678 9012', '1234567890123456'),
    false
  );
});

// ============================================================================
// 2. UNIT TESTS: DEADLOCK WATCHDOG CIRCUIT BREAKER (PILLAR 14)
// ============================================================================

test('Prompt 07 - Pillar 14: DeadlockWatchdogCircuitBreaker kích hoạt ngắt mạch khi 3 chu kỳ liên tiếp DOM không đổi và thất bại', () => {
  const watchdog = new DeadlockWatchdogCircuitBreaker(3);
  const hash1 = 'abc123sha256hashunchanged';

  assert.strictEqual(watchdog.isTripped(), false);
  assert.strictEqual(watchdog.getConsecutiveCount(), 0);

  // Chu kỳ 1: Thất bại với hash1
  const r1 = watchdog.recordCycle(hash1, false, { stepNumber: 1, actionType: 'CLICK' });
  assert.strictEqual(r1.tripped, false);
  assert.strictEqual(r1.consecutiveCount, 1);
  assert.strictEqual(watchdog.isTripped(), false);

  // Chu kỳ 2: Tiếp tục thất bại với hash1 (DOM không đổi)
  const r2 = watchdog.recordCycle(hash1, false, { stepNumber: 1, actionType: 'CLICK' });
  assert.strictEqual(r2.tripped, false);
  assert.strictEqual(r2.consecutiveCount, 2);
  assert.strictEqual(watchdog.isTripped(), false);

  // Chu kỳ 3: Lần thứ 3 liên tiếp thất bại trên hash1 -> Phải kích hoạt ngắt mạch khẩn cấp!
  const r3 = watchdog.recordCycle(hash1, false, { stepNumber: 1, actionType: 'CLICK' });
  assert.strictEqual(r3.tripped, true);
  assert.strictEqual(r3.consecutiveCount, 3);
  assert.strictEqual(watchdog.isTripped(), true);
  assert.strictEqual(watchdog.getLastHash(), hash1);
});

test('Prompt 07 - Pillar 14: DeadlockWatchdogCircuitBreaker tự reset khi hash thay đổi hoặc thao tác thành công', () => {
  const watchdog = new DeadlockWatchdogCircuitBreaker(3);
  const hashA = 'hash_state_a';
  const hashB = 'hash_state_b';

  // 2 chu kỳ thất bại trên hashA
  watchdog.recordCycle(hashA, false);
  watchdog.recordCycle(hashA, false);
  assert.strictEqual(watchdog.getConsecutiveCount(), 2);

  // Chu kỳ 3: Giao diện chuyển đổi sang hashB (DOM thay đổi, trang đang tiến triển)
  const rB = watchdog.recordCycle(hashB, false);
  assert.strictEqual(rB.tripped, false);
  assert.strictEqual(rB.consecutiveCount, 1, 'Bộ đếm kẹt phải reset về 1 khi hash thay đổi');
  assert.strictEqual(watchdog.isTripped(), false);

  // Thao tác thành công trên hashB -> Bộ đếm kẹt phải reset về 0
  const rSuccess = watchdog.recordCycle(hashB, true);
  assert.strictEqual(rSuccess.tripped, false);
  assert.strictEqual(rSuccess.consecutiveCount, 0);
  assert.strictEqual(watchdog.getConsecutiveCount(), 0);

  // Kiểm tra hàm reset()
  watchdog.recordCycle(hashA, false);
  watchdog.reset();
  assert.strictEqual(watchdog.getConsecutiveCount(), 0);
  assert.strictEqual(watchdog.getHistory().length, 0);
});

// ============================================================================
// 3. INTEGRATION TESTS: DOM SHA-256 HASH COMPUTATION (PILLAR 14)
// ============================================================================

test('Prompt 07 - Pillar 14: computePageDomHash sinh mã SHA-256 nhất quán và phản ánh chính xác biến đổi DOM', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.setContent(`
    <html>
      <head><title>Trang Kiểm Thử Hash</title></head>
      <body>
        <div id="content">Nội dung ban đầu</div>
      </body>
    </html>
  `);

  const hash1 = await computePageDomHash(page);
  assert.strictEqual(typeof hash1, 'string');
  assert.strictEqual(hash1.length, 64, 'Mã SHA-256 phải có độ dài 64 ký tự hex');

  // Gọi lại trên cùng DOM -> Phải sinh mã hash giống hệt 100%
  const hash2 = await computePageDomHash(page);
  assert.strictEqual(hash1, hash2, 'DOM không đổi thì mã SHA-256 phải nhất quán');

  // Biến đổi nội dung DOM -> Mã hash phải khác
  await page.evaluate(() => {
    document.getElementById('content')!.textContent = 'Nội dung đã bị thay đổi!';
  });

  const hash3 = await computePageDomHash(page);
  assert.notStrictEqual(hash1, hash3, 'DOM thay đổi thì mã SHA-256 phải khác nhau');

  await browser.close();
});

// ============================================================================
// 4. INTEGRATION TESTS: POST-FILL MASKED INPUT FALLBACK TRÊN BROWSER (PILLAR 12)
// ============================================================================

test('Prompt 07 - Pillar 12: executePhysicalAction tự động kích hoạt fallback gõ tuần tự khi ô nhập bị mask nuốt ký tự', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const barrier = getOrCreateBarrier(page);

  // Tạo trang HTML với input có mask:
  // Nếu dùng programmatic .fill() (chuỗi thô 10 số), mask giả lập bị lỗi nuốt chỉ còn 4 ký tự
  // Khi fallback gõ tuần tự từng phím (pressSequentially), mask định dạng đầy đủ (090) 123-4567
  await page.setContent(`
    <html>
      <body>
        <label for="phone">Số điện thoại</label>
        <input id="phone" type="text" placeholder="(###) ###-####" />
        <script>
          const input = document.getElementById('phone');
          input.addEventListener('input', (e) => {
            if (/^\\d{10}$/.test(input.value)) {
              // Giả lập thư viện mask nuốt ký tự khi dùng .fill() trực tiếp
              input.value = '(090) 1';
            } else {
              // Gõ tuần tự từng phím
              const digits = input.value.replace(/\\D/g, '').slice(0, 10);
              if (digits.length === 0) {
                input.value = '';
                return;
              }
              let formatted = '(' + digits.slice(0, 3);
              if (digits.length >= 3) formatted += ') ' + digits.slice(3, 6);
              if (digits.length >= 6) formatted += '-' + digits.slice(6, 10);
              input.value = formatted;
            }
          });
        </script>
      </body>
    </html>
  `);

  const targetCandidate: DOMCandidate = {
    candidateId: 1,
    tag: 'input',
    type: 'text',
    text: '',
    nearLabel: 'Số điện thoại',
    disabled: false,
    obscured: false,
    rect: { x: 10, y: 10, width: 200, height: 40 },
    selectorPath: '#phone',
    fingerprint: {
      tag: 'input',
      id: 'phone',
      stableClasses: [],
      selectorPath: '#phone',
    },
  };

  const fillAction: AtomicAction = {
    stepNumber: 1,
    subIndex: 0,
    totalSubActions: 1,
    rawStepText: 'Điền "0901234567" vào ô "Số điện thoại"',
    subInstruction: 'Điền "0901234567" vào ô "Số điện thoại"',
    type: 'FILL',
    targetHint: 'Số điện thoại',
    value: '0901234567',
  };

  // Thực thi action FILL
  await executePhysicalAction(page, barrier, fillAction, targetCandidate);

  // Đọc lại giá trị cuối cùng trên input
  const finalVal = await page.inputValue('#phone');

  // Nhờ cơ chế fallback pressSequentially { delay: 60 }, giá trị phải đủ 10 số đã format: (090) 123-4567
  assert.strictEqual(
    finalVal,
    '(090) 123-4567',
    'Ô nhập liệu phải chứa đầy đủ chuỗi định dạng (090) 123-4567 sau khi kích hoạt fallback'
  );

  // Xác nhận alias executeStepAction cũng hoạt động giống hệt
  assert.strictEqual(executeStepAction, executePhysicalAction);

  await browser.close();
});

test('Prompt 07 - Pillar 12: executePhysicalAction cho SEARCH kích hoạt fallback gõ tuần tự khi cần', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const barrier = getOrCreateBarrier(page);

  await page.setContent(`
    <html>
      <body>
        <input id="search-box" type="search" placeholder="Nhập mã thẻ..." />
        <script>
          const input = document.getElementById('search-box');
          input.addEventListener('input', (e) => {
            if (/^\\d{8}$/.test(input.value)) {
              // Nuốt ký tự khi fill thô
              input.value = '1234';
            } else {
              const digits = input.value.replace(/\\D/g, '').slice(0, 8);
              if (digits.length === 0) {
                input.value = '';
              } else if (digits.length <= 4) {
                input.value = digits;
              } else {
                input.value = digits.slice(0, 4) + '-' + digits.slice(4);
              }
            }
          });
        </script>
      </body>
    </html>
  `);

  const searchTarget: DOMCandidate = {
    candidateId: 2,
    tag: 'input',
    type: 'search',
    text: '',
    nearLabel: 'search',
    disabled: false,
    obscured: false,
    rect: { x: 10, y: 10, width: 250, height: 40 },
    selectorPath: '#search-box',
    fingerprint: {
      tag: 'input',
      id: 'search-box',
      stableClasses: [],
      selectorPath: '#search-box',
    },
  };

  const searchAction: AtomicAction = {
    stepNumber: 1,
    subIndex: 0,
    totalSubActions: 1,
    rawStepText: 'Tìm kiếm "12345678"',
    subInstruction: 'Tìm kiếm "12345678"',
    type: 'SEARCH',
    targetHint: 'search-box',
    value: '12345678',
  };

  await executePhysicalAction(page, barrier, searchAction, searchTarget);

  const finalVal = await page.inputValue('#search-box');
  assert.strictEqual(
    finalVal,
    '1234-5678',
    'SEARCH action phải kích hoạt fallback pressSequentially để giữ toàn vẹn mã thẻ'
  );

  await browser.close();
});

// ============================================================================
// 5. INTEGRATION TESTS: DEADLOCK WATCHDOG CIRCUIT BREAKER TRONG RUNNER (PILLAR 14)
// ============================================================================

test('Prompt 07 - Pillar 14: runStrictTestScenario kích hoạt ngắt mạch CIRCUIT_BREAKER_TRIGGERED khi giao diện bị kẹt', async () => {
  // Tạo server mock phục vụ trang web đứng im tuyệt đối (không có nút bấm mong muốn)
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>Deadlock Frozen Page</title></head>
        <body>
          <h1>Giao diện tĩnh</h1>
          <p>Trang này đứng im và không có nút mục tiêu.</p>
        </body>
      </html>
    `);
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  const outputDir = path.join(process.cwd(), 'output', 'test_watchdog');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    const result = await runStrictTestScenario({
      url: `http://localhost:${port}`,
      actions: [
        {
          stepNumber: 1,
          subIndex: 0,
          totalSubActions: 1,
          rawStepText: 'Bấm nút "Nút Tuyệt Đối Không Tồn Tại"',
          subInstruction: 'Bấm nút "Nút Tuyệt Đối Không Tồn Tại"',
          type: 'CLICK',
          targetHint: 'Nút Tuyệt Đối Không Tồn Tại',
        },
      ],
      outputDir,
      casePrefix: 'watchdog_test',
      headless: true,
      deadlockThreshold: 3,
    });

    // Xác nhận kết quả
    assert.strictEqual(result.status, 'FAILED');
    assert.strictEqual(
      result.reasonCode,
      'CIRCUIT_BREAKER_TRIGGERED',
      'Mã lý do thất bại phải là CIRCUIT_BREAKER_TRIGGERED'
    );
    assert.strictEqual(result.circuitBreakerTripped, true);
    assert.ok(
      result.reasonDetail?.includes('CIRCUIT_BREAKER_TRIGGERED'),
      'Chi tiết lỗi phải chứa nhãn ngắt mạch khẩn cấp'
    );
    assert.ok(
      result.summary?.includes('CIRCUIT_BREAKER_TRIGGERED'),
      'Bản tóm tắt kết quả phải ghi rõ CIRCUIT_BREAKER_TRIGGERED'
    );

    // Xác nhận chụp ảnh hiện trường ngắt mạch
    assert.ok(result.screenshotPath, 'Phải có đường dẫn ảnh chụp');
    assert.ok(fs.existsSync(result.screenshotPath), 'File ảnh chụp màn hình phải tồn tại trên đĩa');

    // Xác nhận log ghi nhận SHA-256 hash của DOM
    assert.strictEqual(result.logs.length, 1);
    assert.ok(result.logs[0].domHash, 'Log của bước thất bại phải ghi nhận DOM SHA-256 hash');
    assert.strictEqual(result.logs[0].domHash?.length, 64);
  } finally {
    server.close();
  }
});

test('Prompt 07 - E2E Scenario: Kịch bản điền ô số điện thoại có mặt nạ hoàn thành thành công (PASSED)', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>Form Đăng Ký Masked Input</title></head>
        <body>
          <h1>Đăng Ký Tài Khoản</h1>
          <label for="phone-input">Số điện thoại</label>
          <input id="phone-input" type="text" placeholder="(090) 000-0000" />
          <button id="submit-btn" onclick="document.getElementById('status-msg').textContent = 'Đăng ký thành công!'">
            Xác nhận
          </button>
          <div id="status-msg"></div>
          <script>
            const input = document.getElementById('phone-input');
            let digits = '';
            input.addEventListener('keydown', (e) => {
              if (e.key === 'Backspace') digits = digits.slice(0, -1);
              else if (/^[0-9]$/.test(e.key)) {
                if (digits.length < 10) digits += e.key;
              }
              if (digits.length === 0) input.value = '';
              else {
                let fmt = '(' + digits.slice(0, 3);
                if (digits.length >= 3) fmt += ') ' + digits.slice(3, 6);
                if (digits.length >= 6) fmt += '-' + digits.slice(6, 10);
                input.value = fmt;
              }
            });
            // Nuốt ký tự nếu programmatic fill
            input.addEventListener('input', (e) => {
              if (!e.inputType) {
                input.value = input.value.slice(0, 3);
              }
            });
          </script>
        </body>
      </html>
    `);
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  const outputDir = path.join(process.cwd(), 'output', 'test_masked_e2e');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    const result = await runStrictTestScenario({
      url: `http://localhost:${port}`,
      actions: [
        {
          stepNumber: 1,
          subIndex: 0,
          totalSubActions: 1,
          rawStepText: 'Điền "0901234567" vào ô "Số điện thoại"',
          subInstruction: 'Điền "0901234567" vào ô "Số điện thoại"',
          type: 'FILL',
          targetHint: 'Số điện thoại',
          value: '0901234567',
        },
        {
          stepNumber: 2,
          subIndex: 0,
          totalSubActions: 1,
          rawStepText: 'Bấm nút "Xác nhận"',
          subInstruction: 'Bấm nút "Xác nhận"',
          type: 'CLICK',
          targetHint: 'Xác nhận',
        },
        {
          stepNumber: 3,
          subIndex: 0,
          totalSubActions: 1,
          rawStepText: 'Xác nhận hiển thị "Đăng ký thành công!"',
          subInstruction: 'Xác nhận hiển thị "Đăng ký thành công!"',
          type: 'ASSERT_TEXT',
          expectedText: 'Đăng ký thành công!',
        },
      ],
      outputDir,
      casePrefix: 'masked_e2e',
      headless: true,
    });

    assert.strictEqual(result.status, 'PASSED');
    assert.strictEqual(result.completedSteps, 3);
    assert.strictEqual(result.totalSteps, 3);
    assert.ok(result.logs.every((l) => l.status === 'OK'));
    assert.ok(result.logs[0].domHash, 'Mỗi bước hoàn thành phải ghi lại DOM hash');
  } finally {
    server.close();
  }
});
