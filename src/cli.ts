import * as fs from 'fs';
import * as path from 'path';
import { runStrictTestScenario } from './runner';
import { startRealTrapEcommerceServer } from './demo-server';
import { TestRunResult } from './types';

const SCENARIO_12_STEPS_VI = `
(1) Điền tài khoản \`khach01\` ->
(2) Điền mật khẩu \`123456\` ->
(3) Bấm Đăng nhập ->
(4) Kiểm tra hiện chữ "Xin chào, khach01" ->
(5) Tìm kiếm "Bàn phím cơ" ->
(6) Chọn sản phẩm đầu tiên ->
(7) Chọn màu "Đen" ->
(8) Bấm Thêm vào giỏ ->
(9) Mở Giỏ hàng ->
(10) Bấm Mua hàng ->
(11) Điền SĐT \`0987654321\`, địa chỉ \`123 Cầu Giấy\` rồi bấm Đặt hàng ->
(12) Kiểm tra hiện thông báo "Đặt hàng thành công"
`.trim();

const SCENARIO_WRONG_PASSWORD_VI = `
(1) Điền tài khoản \`khach01\` ->
(2) Điền mật khẩu \`sai_mat_khau_999\` ->
(3) Bấm Đăng nhập ->
(4) Kiểm tra hiện chữ "Xin chào, khach01" ->
(5) Tìm kiếm "Bàn phím cơ" ->
(6) Chọn sản phẩm đầu tiên
`.trim();

const SCENARIO_15_STEPS_REAL_WEB = `
(1) Điền tài khoản \`standard_user\` ->
(2) Điền mật khẩu \`secret_sauce\` ->
(3) Bấm Đăng nhập ->
(4) Kiểm tra hiện chữ "Products" ->
(5) Chọn sản phẩm đầu tiên ->
(6) Bấm Thêm vào giỏ ->
(7) Bấm Quay lại ->
(8) Chọn sản phẩm thứ 2 ->
(9) Bấm Thêm vào giỏ ->
(10) Mở Giỏ hàng ->
(11) Kiểm tra hiện chữ "Your Cart" ->
(12) Bấm Mua hàng ->
(13) Điền họ tên \`Nguyen Van A\`, SĐT \`0987654321\`, địa chỉ \`100000\` rồi bấm Tiếp tục ->
(14) Bấm Đặt hàng ->
(15) Kiểm tra hiện thông báo "Thank you for your order!"
`.trim();

const SCENARIO_LIVE_YOUTUBE_15_STEPS = `
(1) Tìm kiếm "Playwright automation tutorial" ->
(2) Kiểm tra hiện chữ "Playwright" ->
(3) Bấm Video ->
(4) Chọn video đầu tiên ->
(5) Kiểm tra hiện chữ "Playwright" ->
(6) Tìm kiếm "TypeScript tutorial" ->
(7) Kiểm tra hiện chữ "TypeScript" ->
(8) Bấm Video ->
(9) Chọn video đầu tiên ->
(10) Kiểm tra hiện chữ "TypeScript" ->
(11) Tìm kiếm "VTV24" ->
(12) Kiểm tra hiện chữ "VTV24" ->
(13) Bấm Video ->
(14) Chọn video đầu tiên ->
(15) Kiểm tra hiện chữ "VTV24"
`.trim();

const SCENARIO_LIVE_SAUCEDEMO_VI = `
(1) Điền tài khoản \`standard_user\` ->
(2) Điền mật khẩu \`secret_sauce\` ->
(3) Bấm Đăng nhập ->
(4) Kiểm tra hiện chữ "Products" ->
(5) Chọn sản phẩm đầu tiên ->
(6) Bấm Thêm vào giỏ ->
(7) Mở Giỏ hàng ->
(8) Bấm Mua hàng ->
(9) Điền họ tên \`Nguyen Van A\`, SĐT \`0987654321\`, địa chỉ \`100000\` rồi bấm Tiếp tục ->
(10) Bấm Đặt hàng ->
(11) Kiểm tra hiện thông báo "Thank you for your order!"
`.trim();

function printFormattedResult(title: string, result: TestRunResult): void {
  console.log('\n================================================================================');
  console.log(`KẾT QUẢ CHẠY KIỂM THỬ: ${title}`);
  console.log('================================================================================');
  console.log(`URL        : ${result.url}`);
  console.log(`TRẠNG THÁI : ${result.status}`);
  console.log(`TÓM TẮT    : ${result.summary}`);
  if (result.status === 'FAILED') {
    console.log(`MÃ LỖI     : ${result.reasonCode}`);
    console.log(`CHI TIẾT   : ${result.reasonDetail}`);
  }
  console.log(`ẢNH CHỤP   : ${result.screenshotPath}`);
  console.log(`THỜI GIAN  : ${result.totalDurationMs} ms`);
  console.log('--------------------------------------------------------------------------------');
  console.log('NHẬT KÝ TỪNG BƯỚC (STEP LOGS):');
  for (const l of result.logs) {
    const icon = l.status === 'OK' ? '[OK]' : '[FAILED]';
    console.log(
      `  Bước (${l.step}) ${icon} ${l.instruction}\n         └─ ${l.detail} (${l.durationMs}ms)`
    );
  }
  if (result.status === 'FAILED' && result.failedStep) {
    console.log(
      `  [!] Đã hủy bỏ ngay các bước từ (${result.failedStep + 1}) đến (${result.totalSteps}).`
    );
  }
  console.log('================================================================================\n');
}

async function main() {
  const args = process.argv.slice(2);
  const caseIdx = args.indexOf('--case');
  const caseName = caseIdx >= 0 ? args[caseIdx + 1] : '';

  if (caseName === 'youtube') {
    const ytRes = await runStrictTestScenario({
      url: 'https://www.youtube.com',
      scenario: SCENARIO_LIVE_YOUTUBE_15_STEPS,
      casePrefix: 'youtube15',
    });
    printFormattedResult(
      'CASE YOUTUBE 15 BƯỚC LIÊN TIẾP (https://www.youtube.com)',
      ytRes
    );
    process.exit(ytRes.status === 'PASSED' ? 0 : 1);
  }

  if (caseName === '15steps') {
    const res15 = await runStrictTestScenario({
      url: 'https://www.saucedemo.com',
      scenario: SCENARIO_15_STEPS_REAL_WEB,
    });
    printFormattedResult(
      'CASE 15 BƯỚC LIÊN TIẾP TRÊN WEB THỰC TẾ (https://www.saucedemo.com)',
      res15
    );
    process.exit(res15.status === 'PASSED' ? 0 : 1);
  }

  const customUrlIdx = args.indexOf('--url');
  const customScenarioIdx = args.indexOf('--scenario');
  const fileIdx = args.indexOf('--file');

  // Chế độ 1: Đọc từ file kịch bản tiếng Việt (.txt hoặc .json)
  if (fileIdx >= 0 && args[fileIdx + 1]) {
    const filePath = path.resolve(process.cwd(), args[fileIdx + 1]);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');

      // 1.1 Xử lý file JSON chuẩn hóa theo quy chuẩn kịch bản
      if (filePath.toLowerCase().endsWith('.json')) {
        try {
          const json = JSON.parse(content);
          let url = json.url || '';
          if (customUrlIdx >= 0 && args[customUrlIdx + 1]) {
            url = args[customUrlIdx + 1];
          }

          let scenario = '';
          let actions: any[] | undefined = undefined;

          if (typeof json.scenario === 'string') {
            scenario = json.scenario;
          } else if (Array.isArray(json.steps)) {
            if (json.steps.length > 0 && typeof json.steps[0] === 'string') {
              scenario = json.steps.join('\n');
            } else if (json.steps.length > 0 && typeof json.steps[0] === 'object') {
              actions = json.steps.map((st: any, idx: number) => ({
                stepNumber: st.stepNumber || st.step || idx + 1,
                subIndex: st.subIndex || 1,
                totalSubActions: st.totalSubActions || 1,
                rawStepText:
                  st.rawStepText ||
                  st.instruction ||
                  st.text ||
                  `${st.type || st.action} ${st.target || st.targetHint || ''}`,
                subInstruction:
                  st.subInstruction ||
                  st.instruction ||
                  st.text ||
                  `${st.type || st.action} ${st.target || st.targetHint || ''}`,
                type: (st.type || st.action || 'CLICK').toUpperCase(),
                targetHint: st.targetHint || st.target,
                contextHint: st.contextHint,
                value: st.value,
                itemIndex: st.itemIndex || st.index,
                expectedText: st.expectedText || st.expected,
                expectedUrlPart: st.expectedUrlPart || st.urlPart,
                scrollDirection: st.scrollDirection,
                scrollAmount: st.scrollAmount,
                keyName: st.keyName,
                waitMs: st.waitMs,
              }));
            }
          } else if (Array.isArray(json.actions)) {
            actions = json.actions;
          }

          if (url && (scenario || actions)) {
            const title = json.name || json.title || path.basename(filePath);
            const casePrefix = path.basename(filePath, path.extname(filePath));
            const res = await runStrictTestScenario({
              url,
              scenario,
              actions,
              casePrefix,
            });
            printFormattedResult(`FILE KỊCH BẢN CHUẨN JSON: ${title}`, res);
            process.exit(res.status === 'PASSED' ? 0 : 1);
          } else {
            console.error('Lỗi: File JSON không hợp lệ! Cần có trường "url" và "steps" (hoặc "actions").');
            process.exit(1);
          }
        } catch (e: any) {
          console.error(`Lỗi đọc file JSON: ${e?.message}`);
          process.exit(1);
        }
      }

      // 1.2 Xử lý file text (.txt)
      const lines = content.split(/\r?\n/);
      let url = '';
      const scenarioLines: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
        if (/^url\s*[:=]/i.test(trimmed)) {
          url = trimmed.replace(/^url\s*[:=]\s*/i, '').trim();
        } else if (/^(?:kịch\s+bản|scenario|cac\s+buoc|các\s+bước)\s*[:=]?/i.test(trimmed)) {
          // Bỏ qua dòng tiêu đề
        } else {
          scenarioLines.push(trimmed);
        }
      }

      if (!url && scenarioLines.length > 0 && /^https?:\/\//i.test(scenarioLines[0])) {
        url = scenarioLines.shift()!;
      }

      const scenario = scenarioLines.join('\n');
      if (url && scenario) {
        const res = await runStrictTestScenario({ url, scenario });
        printFormattedResult(`FILE KỊCH BẢN: ${path.basename(filePath)}`, res);
        process.exit(res.status === 'PASSED' ? 0 : 1);
      } else {
        console.error('Lỗi: File kịch bản không hợp lệ! Cần có dòng "URL: https://..." và các bước kiểm thử.');
        process.exit(1);
      }
    } else {
      console.error(`Không tìm thấy file kịch bản: ${filePath}`);
      process.exit(1);
    }
  }

  // Chế độ 2: Chạy trực tiếp từ tham số dòng lệnh (--url & --scenario)
  if (customUrlIdx >= 0 && customScenarioIdx >= 0) {
    const url = args[customUrlIdx + 1];
    const scenario = args[customScenarioIdx + 1];
    const res = await runStrictTestScenario({ url, scenario });
    printFormattedResult('CUSTOM SCENARIO', res);
    process.exit(res.status === 'PASSED' ? 0 : 1);
  }

  // Khởi chạy Local Real-Trap E-commerce Server ở cổng 3456
  const server = await startRealTrapEcommerceServer(3456);
  const allResults: { caseName: string; result: TestRunResult }[] = [];

  try {
    // 1. Kịch bản 12 bước Tiếng Việt chuẩn đề bài -> PASSED (pass_step_12.png)
    const passRes = await runStrictTestScenario({
      url: 'http://localhost:3456',
      scenario: SCENARIO_12_STEPS_VI,
    });
    printFormattedResult('CASE 1: KỊCH BẢN 12 BƯỚC TIẾNG VIỆT (PASSED 12/12)', passRes);
    allResults.push({ caseName: '12_steps_passed', result: passRes });

    // 2. Kịch bản 12 bước gặp lỗi nút "Thêm vào giỏ" bị khóa (disabled) ở Bước 8 -> FAILED (fail_step_8.png)
    const failDisabledRes = await runStrictTestScenario({
      url: 'http://localhost:3456/?trap=disabled_cart',
      scenario: SCENARIO_12_STEPS_VI,
    });
    printFormattedResult(
      'CASE 2: BẮT LỖI NÚT BỊ KHÓA DISABLED TẠI BƯỚC 8 (FAILED_STEP_8)',
      failDisabledRes
    );
    allResults.push({ caseName: 'step_8_disabled_failed', result: failDisabledRes });

    // 3. Kịch bản sai mật khẩu -> Dừng ngay tại Bước 4 Kiểm tra chữ "Xin chào, khach01" -> FAILED (fail_step_4.png)
    const failAssertRes = await runStrictTestScenario({
      url: 'http://localhost:3456',
      scenario: SCENARIO_WRONG_PASSWORD_VI,
    });
    printFormattedResult(
      'CASE 3: BẮT LỖI SAI NỘI DUNG KIỂM TRA TẠI BƯỚC 4 (FAILED_STEP_4)',
      failAssertRes
    );
    allResults.push({ caseName: 'step_4_assertion_failed', result: failAssertRes });

    // 4. Kịch bản chạy trực tiếp trên URL Internet thực tế: https://www.saucedemo.com
    const liveRes = await runStrictTestScenario({
      url: 'https://www.saucedemo.com',
      scenario: SCENARIO_LIVE_SAUCEDEMO_VI,
      casePrefix: 'saucedemo',
    });
    printFormattedResult(
      'CASE 4: CHẠY TRỰC TIẾP TRÊN WEB THỰC TẾ (https://www.saucedemo.com)',
      liveRes
    );
    allResults.push({ caseName: 'live_saucedemo', result: liveRes });

    // Ghi tổng hợp báo cáo JSON ra output/report.json
    const reportPath = path.join(process.cwd(), 'output', 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(allResults, null, 2), 'utf-8');
    console.log(`Đã lưu toàn bộ báo cáo JSON tại: ${reportPath}`);
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
