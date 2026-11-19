import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { runStrictTestScenario } from '../src/runner';
import { getHtmlContent, server } from '../src/ui-server';

function createMockServer(html: string): Promise<{ server: http.Server; url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const s = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address() as any;
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({
        server: s,
        url,
        close: () => new Promise<void>((r) => s.close(() => r())),
      });
    });
  });
}

test('Prompt 08 - UI Dashboard: getHtmlContent() chứa đầy đủ thành phần XAI & Modal', () => {
  const html = getHtmlContent();

  // 1. Badge "AI Healed"
  assert.ok(html.includes('badge-ai-healed'), 'Thiếu class CSS badge-ai-healed');
  assert.ok(html.includes('AI Healed'), 'Thiếu chữ hiển thị AI Healed');

  // 2. Clickable steps & Modal
  assert.ok(html.includes('timeline-item clickable'), 'Thiếu class timeline-item clickable cho tương tác nhấp');
  assert.ok(html.includes('openStepModal'), 'Thiếu hàm openStepModal');
  assert.ok(html.includes('closeStepModal'), 'Thiếu hàm closeStepModal');
  assert.ok(html.includes('id="stepModal"'), 'Thiếu modal HTML skeleton id="stepModal"');

  // 3. Bounding Box & Screenshot Viewer
  assert.ok(html.includes('bounding-box-overlay'), 'Thiếu class bounding-box-overlay khoanh vùng phần tử');
  assert.ok(html.includes('bounding-box-tag'), 'Thiếu nhãn tọa độ bounding-box-tag');

  // 4. XAI Decision Audit Trail Metrics & Reasoning
  assert.ok(html.includes('xai-grid'), 'Thiếu lưới chỉ số xai-grid');
  assert.ok(html.includes('Chosen Element'), 'Thiếu mục Chosen Element');
  assert.ok(html.includes('Healed Intent'), 'Thiếu mục Healed Intent');
  assert.ok(html.includes('Damerau Distance'), 'Thiếu mục Damerau Distance');
  assert.ok(html.includes('Confidence Score'), 'Thiếu mục Confidence Score');
  assert.ok(html.includes('Safety Margin (Delta)'), 'Thiếu mục Safety Margin');
  assert.ok(html.includes('Critic Verdict'), 'Thiếu mục Critic Verdict');
  assert.ok(html.includes('Quiescence Wait'), 'Thiếu mục Quiescence Wait');
  assert.ok(html.includes('DOM State Hash'), 'Thiếu mục DOM State Hash');
  assert.ok(html.includes('xai-reasoning-box'), 'Thiếu hộp chuỗi suy luận xai-reasoning-box');

  // 5. Forensic Autopsy & Report Link
  assert.ok(html.includes('autopsy-card'), 'Thiếu thẻ khám nghiệm tử thi autopsy-card');
  assert.ok(html.includes('/api/report'), 'Thiếu endpoint /api/report trong giao diện');
});

test('Prompt 08 - XAI Audit Trail: report.json được tạo và lưu trữ đầy đủ cấu trúc Trụ cột 15', async () => {
  const mockPage = `<!DOCTYPE html>
  <html>
    <head><meta charset="utf-8"><title>XAI Test Page</title></head>
    <body style="padding: 20px;">
      <h1>Hệ Thống Đăng Nhập XAI</h1>
      <input id="username" type="text" placeholder="Tên đăng nhập" style="width:200px; height:30px; display:block; margin-bottom:10px;" />
      <button id="btn-submit" style="padding:10px 20px; font-size:16px;">Xác Nhận</button>
      <div id="result" style="display:none; margin-top:10px;">Thành công!</div>
      <script>
        document.getElementById('btn-submit').addEventListener('click', () => {
          document.getElementById('result').style.display = 'block';
        });
      </script>
    </body>
  </html>`;

  const { url, close } = await createMockServer(mockPage);

  try {
    const res = await runStrictTestScenario({
      url,
      scenario: `(1) Điền "tester01" vào "Tên đăng nhập"
(2) Bấm "Xác Nhận"
(3) Kiểm tra hiện chữ "Thành công!"`,
      headless: true,
      casePrefix: `xai_test_${Date.now()}`,
    });

    assert.equal(res.status, 'PASSED', 'Kịch bản kiểm thử phải thành công');
    assert.ok(res.reportPath, 'reportPath phải được đính kèm vào kết quả TestRunResult');
    assert.ok(fs.existsSync(res.reportPath), `File báo cáo không tồn tại: ${res.reportPath}`);

    const reportContent = fs.readFileSync(res.reportPath, 'utf-8');
    const reportData = JSON.parse(reportContent);

    // Kiểm tra cấu trúc mảng steps
    assert.ok(Array.isArray(reportData.steps), 'reportData.steps phải là mảng');
    assert.equal(reportData.steps.length, 3, 'Phải có đúng 3 bước');

    // Kiểm tra từng trường theo yêu cầu Prompt 08:
    // fields: stepNumber, action, targetHint, decision, quiescenceWaitMs, screenshotPath, domHash, boundingBox
    const step1 = reportData.steps[0];
    assert.equal(step1.stepNumber, 1);
    assert.equal(step1.action, 'FILL');
    assert.equal(step1.targetHint, 'Tên đăng nhập');
    assert.ok(step1.decision, 'step1 phải có decision');
    assert.ok(step1.decision.chosenElement, 'step1.decision phải có chosenElement');
    assert.ok(typeof step1.decision.confidence === 'number', 'step1.decision.confidence phải là số');
    assert.ok(step1.decision.criticVerdict, 'step1.decision.criticVerdict phải có');
    assert.ok(step1.decision.reasoning, 'step1.decision.reasoning phải có');
    assert.ok(typeof step1.quiescenceWaitMs === 'number', 'step1.quiescenceWaitMs phải là số');
    assert.ok(step1.screenshotPath, 'step1.screenshotPath phải có');
    assert.ok(step1.domHash, 'step1.domHash SHA-256 phải có');
    assert.ok(step1.boundingBox, 'step1.boundingBox phải có');
    assert.ok(typeof step1.boundingBox.x === 'number', 'boundingBox.x phải là số');

    // Bước 2: CLICK
    const step2 = reportData.steps[1];
    assert.equal(step2.stepNumber, 2);
    assert.equal(step2.action, 'CLICK');
    assert.equal(step2.targetHint, 'Xác Nhận');
    assert.ok(step2.decision, 'step2 phải có decision');
    assert.ok(step2.boundingBox, 'step2 phải có boundingBox');

    // Bước 3: ASSERT_TEXT
    const step3 = reportData.steps[2];
    assert.equal(step3.stepNumber, 3);
    assert.equal(step3.action, 'ASSERT_TEXT');
    assert.ok(step3.domHash, 'step3 phải ghi nhận domHash');

    // Kiểm tra mảng aiAuditTrail
    assert.ok(Array.isArray(reportData.aiAuditTrail), 'reportData.aiAuditTrail phải là mảng');
  } finally {
    await close();
  }
});

test('Prompt 08 - XAI Audit Trail: Tự phục hồi lỗi chính tả (Typo) ghi nhận damerauDistance trong Decision', async () => {
  const mockPage = `<!DOCTYPE html>
  <html>
    <head><meta charset="utf-8"><title>Typo Test Page</title></head>
    <body style="padding: 20px;">
      <h1>Trang Kiểm Tra Typo Healing</h1>
      <button id="btn-save" style="padding:10px 20px; font-size:16px;">Save Draft</button>
      <div id="save-status" style="display:none; margin-top:10px;">Đã lưu bản nháp!</div>
      <script>
        document.getElementById('btn-save').addEventListener('click', () => {
          document.getElementById('save-status').style.display = 'block';
        });
      </script>
    </body>
  </html>`;

  const { url, close } = await createMockServer(mockPage);

  try {
    // Cố tình gõ sai chính tả: "Saev Draft" thay vì "Save Draft"
    const res = await runStrictTestScenario({
      url,
      scenario: `(1) Bấm "Saev Draft"
(2) Kiểm tra hiện chữ "Đã lưu bản nháp!"`,
      headless: true,
      casePrefix: `xai_typo_${Date.now()}`,
    });

    assert.equal(res.status, 'PASSED', 'Kịch bản phải tự phục hồi và PASS');
    const reportData = JSON.parse(fs.readFileSync(res.reportPath!, 'utf-8'));

    const clickStep = reportData.steps[0];
    assert.ok(clickStep.decision, 'Click step phải có decision audit trail');
    assert.ok(
      clickStep.decision.damerauDistance > 0,
      `damerauDistance phải > 0, thực tế nhận: ${clickStep.decision.damerauDistance}`
    );
    assert.ok(clickStep.decision.healedIntent, 'Phải có healedIntent');
  } finally {
    await close();
  }
});

test('Prompt 08 - Forensic Autopsy: Thất bại ghi nhận mã lỗi và khám nghiệm tử thi trong report.json', async () => {
  const mockPage = `<!DOCTYPE html>
  <html>
    <head><meta charset="utf-8"><title>Fail Autopsy Test</title></head>
    <body style="padding: 20px;">
      <h1>Trang Test Thất Bại</h1>
      <button id="btn-actual">Nút Thực Tế</button>
    </body>
  </html>`;

  const { url, close } = await createMockServer(mockPage);

  try {
    const res = await runStrictTestScenario({
      url,
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
      headless: true,
      casePrefix: `xai_fail_${Date.now()}`,
      deadlockThreshold: 1,
    });

    assert.equal(res.status, 'FAILED', 'Kịch bản phải ghi nhận FAILED');
    assert.ok(res.reportPath && fs.existsSync(res.reportPath), 'report.json phải được tạo ngay cả khi thất bại');

    const reportData = JSON.parse(fs.readFileSync(res.reportPath, 'utf-8'));
    const failedStep = reportData.steps[0];
    assert.equal(failedStep.status, 'FAILED');
    assert.ok(failedStep.autopsy, 'failedStep phải có thông tin khám nghiệm tử thi (autopsy)');
    assert.ok(failedStep.autopsy.failureCode, 'autopsy phải có failureCode');
    assert.ok(failedStep.autopsy.rootCause, 'autopsy phải có rootCause');
    assert.ok(failedStep.autopsy.suggestedRemediation, 'autopsy phải có suggestedRemediation');
  } finally {
    await close();
  }
});

test('Prompt 08 - UI Server API: /api/report và / trả về hợp lệ', async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const res = await fetch(`${baseUrl}/api/report`);
    assert.ok(res.status === 200 || res.status === 404, `Status phải là 200 hoặc 404, nhận: ${res.status}`);
    const data = await res.json();
    if (res.status === 200) {
      assert.ok(data.steps || data.summary || data.status, 'Dữ liệu report phải có cấu trúc hợp lệ');
    }

    const homeRes = await fetch(`${baseUrl}/`);
    assert.equal(homeRes.status, 200);
    const htmlText = await homeRes.text();
    assert.ok(htmlText.includes('AutoTest Studio'));
    assert.ok(htmlText.includes('badge-ai-healed'));
  } finally {
    if (typeof (server as any).closeAllConnections === 'function') {
      (server as any).closeAllConnections();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
