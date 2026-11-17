import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { runStrictTestScenario } from './runner';

const PORT = 5000;
const OUTPUT_DIR = path.join(process.cwd(), 'output');

const TEMPLATES: Record<string, { url: string; scenario: string }> = {
  dantri: {
    url: 'https://dantri.com.vn',
    scenario: `(1) Kiểm tra hiện chữ "Dân trí"\n(2) Cuộn xuống 600px\n(3) Bấm "Kinh doanh"\n(4) Kiểm tra URL chứa "kinh-doanh"`,
  },
  vnexpress: {
    url: 'https://vnexpress.net',
    scenario: `(1) Kiểm tra hiện chữ "VnExpress"\n(2) Cuộn xuống 600px\n(3) Bấm vào tin tức đầu tiên\n(4) Kiểm tra URL chứa "vnexpress.net"`,
  },
  gearvn: {
    url: 'https://gearvn.com',
    scenario: `(1) Tìm kiếm "chuột logitech"\n(2) Cuộn xuống 600px\n(3) Bấm vào sản phẩm đầu tiên\n(4) Kiểm tra URL chứa "gearvn.com"`,
  },
  github: {
    url: 'https://github.com',
    scenario: `(1) Kiểm tra hiện chữ "GitHub"\n(2) Cuộn xuống 500px\n(3) Bấm Pricing\n(4) Kiểm tra URL chứa "pricing"`,
  },
  saucedemo: {
    url: 'https://www.saucedemo.com',
    scenario: `(1) Điền tài khoản \`standard_user\`\n(2) Điền mật khẩu \`secret_sauce\`\n(3) Bấm Đăng nhập\n(4) Kiểm tra hiện chữ "Products"\n(5) Chọn sản phẩm đầu tiên\n(6) Bấm Thêm vào giỏ\n(7) Mở Giỏ hàng\n(8) Bấm Mua hàng`,
  },
};

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || '/', `http://localhost:${PORT}`);

  // 1. Phục vụ ảnh chụp màn hình bằng chứng
  if (reqUrl.pathname.startsWith('/output/')) {
    const filename = path.basename(reqUrl.pathname);
    const filePath = path.join(OUTPUT_DIR, filename);
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Image not found');
    return;
  }

  // 2. API Chạy Test
  if (reqUrl.pathname === '/api/run' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const url = (data.url || '').trim();
        const scenario = (data.scenario || '').trim();
        const headless = data.headless !== false;

        if (!url || !scenario) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Vui lòng nhập đầy đủ URL và Kịch bản kiểm thử!' }));
          return;
        }

        const result = await runStrictTestScenario({
          url,
          scenario,
          headless,
          casePrefix: `ui_${Date.now()}`,
        });

        // Đổi đường dẫn ảnh tuyệt đối thành URL phục vụ trên web
        const shotFilename = path.basename(result.screenshotPath);
        const webShotUrl = `/output/${shotFilename}`;

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            ...result,
            webShotUrl,
          })
        );
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
    });
    return;
  }

  // 3. Giao diện Web đơn giản (Single Page Application)
  if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getHtmlContent());
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`===============================================================================`);
  console.log(`  🎨 GIAO DIỆN KIỂM THỬ TỰ ĐỘNG DÀNH CHO TESTER ĐANG CHẠY TẠI:`);
  console.log(`  👉  http://localhost:${PORT}`);
  console.log(`===============================================================================`);
});

function getHtmlContent(): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AutoTest Studio - Kiểm Thử Bằng Tiếng Việt</title>
  <style>
    :root {
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --success: #16a34a;
      --danger: #dc2626;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --border: #e2e8f0;
      --text: #0f172a;
      --text-muted: #64748b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 24px 16px; line-height: 1.5; }
    .container { max-width: 1040px; margin: 0 auto; }

    /* Header */
    header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    .brand { display: flex; align-items: center; gap: 12px; }
    .logo-badge { background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 800; box-shadow: 0 4px 10px rgba(37,99,235,0.3); }
    h1 { font-size: 22px; font-weight: 800; color: #1e293b; }
    .sub-title { font-size: 13px; color: var(--text-muted); }

    /* Layout Grid */
    .grid { display: grid; grid-template-columns: 1fr; gap: 24px; }
    @media (min-width: 900px) {
      .grid { grid-template-columns: 1.15fr 1fr; }
    }

    /* Cards */
    .card { background: var(--card-bg); border-radius: 16px; padding: 24px; border: 1px solid var(--border); box-shadow: 0 4px 14px rgba(0,0,0,0.03); }
    .card-title { font-size: 16px; font-weight: 700; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; color: #334155; }

    /* Form Fields */
    .field { margin-bottom: 18px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 6px; }
    input[type="text"], textarea { width: 100%; border: 1.5px solid #cbd5e1; border-radius: 10px; padding: 12px 14px; font-size: 14px; transition: border-color 0.2s; outline: none; }
    input[type="text"]:focus, textarea:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(37,99,235,0.12); }
    textarea { height: 160px; resize: vertical; font-family: inherit; font-size: 13.5px; }

    /* Quick Templates */
    .templates-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .tpl-btn { background: #f1f5f9; border: 1px solid #e2e8f0; padding: 6px 12px; border-radius: 20px; font-size: 12.5px; font-weight: 600; color: #334155; cursor: pointer; transition: all 0.15s; }
    .tpl-btn:hover { background: #e2e8f0; color: var(--primary); }

    /* Options */
    .options-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
    .checkbox-label { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13.5px; color: #475569; user-select: none; }

    /* Action Button */
    .btn-run { width: 100%; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white; border: none; padding: 14px 20px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; box-shadow: 0 4px 14px rgba(37,99,235,0.3); transition: all 0.2s; }
    .btn-run:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(37,99,235,0.4); }
    .btn-run:disabled { background: #94a3b8; cursor: not-allowed; box-shadow: none; }

    /* Results Box */
    .empty-state { text-align: center; padding: 60px 20px; color: var(--text-muted); }
    .empty-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.6; }

    /* Result Banner */
    .result-banner { padding: 14px 18px; border-radius: 12px; font-weight: 700; font-size: 15px; margin-bottom: 18px; display: flex; align-items: center; justify-content: space-between; }
    .result-banner.passed { background: #dcfce7; color: #15803d; border: 1.5px solid #86efac; }
    .result-banner.failed { background: #fee2e2; color: #b91c1c; border: 1.5px solid #fca5a5; }

    /* Step Timeline */
    .timeline { list-style: none; margin-bottom: 20px; }
    .timeline-item { padding: 10px 14px; border-radius: 8px; margin-bottom: 8px; background: #f8fafc; border-left: 4px solid #cbd5e1; font-size: 13.5px; }
    .timeline-item.ok { border-left-color: var(--success); }
    .timeline-item.fail { border-left-color: var(--danger); background: #fef2f2; }
    .item-header { display: flex; align-items: center; justify-content: space-between; font-weight: 600; margin-bottom: 4px; }
    .item-detail { font-size: 12.5px; color: var(--text-muted); }
    .fail-text { color: var(--danger); font-weight: 600; }

    /* Screenshot Preview */
    .screenshot-box { border-radius: 12px; overflow: hidden; border: 1px solid var(--border); background: #000; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
    .screenshot-box img { width: 100%; height: auto; display: block; cursor: zoom-in; }

    /* Spinner */
    .spinner { display: inline-block; width: 18px; height: 18px; border: 3px solid rgba(255,255,255,0.3); border-radius: 50%; border-top-color: white; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div class="logo-badge">⚡</div>
        <div>
          <h1>AutoTest Studio</h1>
          <div class="sub-title">Công cụ kiểm thử web tự động bằng Tiếng Việt dành cho Tester</div>
        </div>
      </div>
      <div>
        <span style="font-size: 13px; font-weight: 600; color: #16a34a; background: #dcfce7; padding: 4px 12px; border-radius: 99px;">● Sẵn sàng</span>
      </div>
    </header>

    <div class="grid">
      <!-- CỘT 1: NHẬP LIỆU -->
      <div class="card">
        <div class="card-title">📝 Thiết lập kịch bản kiểm thử</div>

        <div style="font-size: 12px; font-weight: 600; color: #64748b; margin-bottom: 8px;">CHỌN MẪU TEST NHANH:</div>
        <div class="templates-bar">
          <button class="tpl-btn" onclick="loadTemplate('dantri')">📰 Báo Dân Trí</button>
          <button class="tpl-btn" onclick="loadTemplate('vnexpress')">📰 Báo VnExpress</button>
          <button class="tpl-btn" onclick="loadTemplate('gearvn')">🛒 TMĐT GearVN</button>
          <button class="tpl-btn" onclick="loadTemplate('github')">🐙 GitHub Pricing</button>
          <button class="tpl-btn" onclick="loadTemplate('saucedemo')">🛍️ SauceDemo Store</button>
        </div>

        <div class="field">
          <label for="url">ĐƯỜNG DẪN TRANG WEB (URL):</label>
          <input type="text" id="url" placeholder="https://..." value="https://dantri.com.vn" />
        </div>

        <div class="field">
          <label for="scenario">CÁC BƯỚC THỰC HIỆN (VIẾT BẰNG TIẾNG VIỆT):</label>
          <textarea id="scenario" placeholder="(1) Điền tài khoản 'user1'&#10;(2) Bấm Đăng nhập&#10;(3) Kiểm tra hiện chữ 'Xin chào'">(1) Kiểm tra hiện chữ "Dân trí"
(2) Cuộn xuống 600px
(3) Bấm "Kinh doanh"
(4) Kiểm tra URL chứa "kinh-doanh"</textarea>
        </div>

        <div class="options-row">
          <label class="checkbox-label">
            <input type="checkbox" id="headless" checked />
            Chạy ngầm (Headless mode - nhanh và mượt)
          </label>
          <span style="font-size: 12px; color: #94a3b8;">Bỏ chọn để ngắm trình duyệt click</span>
        </div>

        <button id="runBtn" class="btn-run" onclick="runTest()">
          <span id="btnIcon">🚀</span>
          <span id="btnText">BẮT ĐẦU CHẠY KIỂM THỬ</span>
        </button>
      </div>

      <!-- CỘT 2: KẾT QUẢ VÀ BẰNG CHỨNG -->
      <div class="card">
        <div class="card-title">📊 Kết quả kiểm thử & Bằng chứng</div>

        <div id="resultContainer">
          <div class="empty-state">
            <div class="empty-icon">🖼️</div>
            <p>Chưa có lượt chạy nào.</p>
            <p style="font-size: 12.5px; margin-top: 6px;">Bấm nút <strong>"Bắt đầu chạy kiểm thử"</strong> để xem kết quả và ảnh chụp tự động!</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const TEMPLATES = ${JSON.stringify(TEMPLATES)};

    function loadTemplate(key) {
      const t = TEMPLATES[key];
      if (t) {
        document.getElementById('url').value = t.url;
        document.getElementById('scenario').value = t.scenario;
      }
    }

    async function runTest() {
      const url = document.getElementById('url').value.trim();
      const scenario = document.getElementById('scenario').value.trim();
      const headless = document.getElementById('headless').checked;
      const runBtn = document.getElementById('runBtn');
      const btnIcon = document.getElementById('btnIcon');
      const btnText = document.getElementById('btnText');
      const resContainer = document.getElementById('resultContainer');

      if (!url || !scenario) {
        alert('Vui lòng nhập đầy đủ URL và Kịch bản kiểm thử!');
        return;
      }

      // Đổi trạng thái nút bấm
      runBtn.disabled = true;
      btnIcon.innerHTML = '<span class="spinner"></span>';
      btnText.textContent = 'ĐANG THỰC THI KIỂM THỬ TRÊN TRÌNH DUYỆT...';

      resContainer.innerHTML = \`
        <div class="empty-state">
          <div class="spinner" style="width: 32px; height: 32px; border-color: #cbd5e1; border-top-color: #2563eb; margin-bottom: 14px;"></div>
          <p style="font-weight: 700; color: #1e293b;">Đang tương tác trên trang web...</p>
          <p style="font-size: 13px; margin-top: 6px; color: #64748b;">Hệ thống đang tải DOM, vượt rào chắn và thực thi tuần tự các bước.</p>
        </div>
      \`;

      try {
        const res = await fetch('/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, scenario, headless })
        });
        const data = await res.json();

        if (data.error) {
          alert('Lỗi: ' + data.error);
          return;
        }

        renderResult(data);
      } catch (err) {
        alert('Có lỗi xảy ra: ' + err.message);
      } finally {
        runBtn.disabled = false;
        btnIcon.textContent = '🚀';
        btnText.textContent = 'BẮT ĐẦU CHẠY KIỂM THỬ';
      }
    }

    function renderResult(result) {
      const isPassed = result.status === 'PASSED';
      const bannerClass = isPassed ? 'passed' : 'failed';
      const statusTitle = isPassed
        ? '✅ PASSED: Hoàn thành ' + result.completedSteps + '/' + result.totalSteps + ' bước OK!'
        : '❌ FAILED: Dừng ngay tại bước ' + (result.failedStep || (result.completedSteps + 1)) + '/' + result.totalSteps;

      let logsHtml = '<ul class="timeline">';
      for (const l of result.logs || []) {
        const itemClass = l.status === 'OK' ? 'ok' : 'fail';
        const badge = l.status === 'OK' ? '<span style="color:#16a34a">✓ OK</span>' : '<span style="color:#dc2626">✗ THẤT BẠI</span>';
        logsHtml += \`
          <li class="timeline-item \${itemClass}">
            <div class="item-header">
              <span>Bước \${l.step}: \${escapeHtml(l.instruction)}</span>
              <span>\${badge} (\${l.durationMs}ms)</span>
            </div>
            <div class="item-detail \${l.status === 'FAILED' ? 'fail-text' : ''}">\${escapeHtml(l.detail)}</div>
          </li>
        \`;
      }
      logsHtml += '</ul>';

      const html = \`
        <div class="result-banner \${bannerClass}">
          <span>\${statusTitle}</span>
          <span style="font-size: 13px; font-weight: normal;">\${result.totalDurationMs}ms</span>
        </div>

        \${result.reasonDetail ? '<div style="background:#fff1f2; border:1px solid #fecdd3; color:#9f1239; padding:10px 14px; border-radius:8px; font-size:13px; font-weight:600; margin-bottom:16px;">Chi tiết lỗi: ' + escapeHtml(result.reasonDetail) + '</div>' : ''}

        <div style="font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 8px;">NHẬT KÝ CHI TIẾT TỪNG BƯỚC:</div>
        \${logsHtml}

        <div style="font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 8px;">ẢNH BẰNG CHỨNG TRỰC QUAN (\${isPassed ? 'BƯỚC CUỐI CÙNG' : 'TẠI ĐIỂM GÃY'}):</div>
        <div class="screenshot-box">
          <a href="\${result.webShotUrl}" target="_blank" title="Nhấp để xem ảnh đầy đủ">
            <img src="\${result.webShotUrl}" alt="Ảnh bằng chứng kiểm thử" />
          </a>
        </div>
      \`;

      document.getElementById('resultContainer').innerHTML = html;
    }

    function escapeHtml(s) {
      return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  </script>
</body>
</html>`;
}
