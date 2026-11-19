import test from 'node:test';
import assert from 'node:assert';
import * as http from 'http';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import {
  ImplicitDismissalManager,
  ActiveOverlayTracker,
  detectActiveOverlays,
  detectContextBoundaryCrossing,
  calculateSafeNeutralPoint,
  computeSafeNeutralPointFromGeometry,
  isForbiddenModalDismissButton,
  isSafeModalDismissButton,
  classifyModalButton,
  dismissHangingOverlays,
  rectContainsPoint,
  Rect,
} from '../src/implicit-dismissal';

// ============================================================================
// HELPER: MOCK HTTP SERVER + SAFE PLAYWRIGHT CONTEXT LAUNCHER
// ============================================================================

function createMockServer(): Promise<{
  server: http.Server;
  baseUrl: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url || '/';

      if (url === '/overlay-detection.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Overlay Detection Test</title>
  <style>
    body { margin: 0; padding: 20px; font-family: sans-serif; }
    .hidden-modal { display: none; position: fixed; inset: 0; }
    .ant-select-dropdown-hidden { display: none; }
    .visible-dd { position: absolute; top: 80px; left: 20px; width: 220px; height: 140px; background: #fff; border: 1px solid #ccc; z-index: 100; }
    .visible-modal-wrap { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 500; display: flex; align-items: center; justify-content: center; }
    .visible-modal-box { width: 380px; height: 220px; background: #fff; padding: 20px; border-radius: 8px; }
    #native-pop { padding: 16px; border: 1px solid #333; background: #fef9c3; }
  </style>
</head>
<body>
  <button id="pop-trigger" popovertarget="native-pop">Mở Popover</button>
  <div id="native-pop" popover="auto">Nội dung Popover W3C</div>

  <!-- Hidden overlays: MUST be filtered out -->
  <div class="modal hidden-modal" id="hidden-modal" role="dialog" aria-modal="true">Ẩn</div>
  <div class="ant-select-dropdown ant-select-dropdown-hidden" id="hidden-dd" role="listbox">Ẩn</div>
  <div role="listbox" aria-hidden="true" style="position:absolute;top:10px;left:10px;width:100px;height:100px;">Ẩn ARIA</div>

  <!-- Visible dropdown -->
  <div class="ant-select-dropdown visible-dd" id="open-dd" role="listbox">
    <div role="option">Item 1</div>
  </div>

  <!-- Visible modal (higher z-index) -->
  <div class="modal show visible-modal-wrap" id="open-modal-wrap">
    <div class="modal-dialog visible-modal-box" id="open-modal-dialog" role="dialog" aria-modal="true">
      <h3>Modal Thông Tin</h3>
      <button id="in-modal-btn">Nút Trong Modal</button>
    </div>
  </div>

  <button id="bg-btn">Nút Trang Cha</button>
</body>
</html>`);
        return;
      }

      if (url === '/multiselect-escape.html') {
        // Multi-Select Dropdown: chọn 3 checkbox, giữ mở menu, lắng nghe phím Escape để đóng & bảo toàn 100% giá trị đã chọn
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Multi-Select Escape Light Dismiss</title>
  <style>
    body { margin: 0; padding: 30px; font-family: sans-serif; }
    .form-row { margin-bottom: 18px; position: relative; }
    .ant-select-selector { width: 280px; padding: 8px 12px; border: 1px solid #94a3b8; border-radius: 6px; cursor: pointer; background: #fff; }
    .ant-select-dropdown {
      position: absolute; top: 96px; left: 30px; width: 320px; background: #ffffff;
      border: 2px solid #2563eb; border-radius: 6px; padding: 10px; z-index: 2000;
      box-shadow: 0 8px 24px rgba(0,0,0,0.18);
    }
    .dd-option { display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; }
    #email { width: 280px; padding: 10px; border: 1px solid #64748b; border-radius: 4px; }
  </style>
</head>
<body>
  <h2>Đăng Ký Nhận Tin</h2>
  <div class="form-row">
    <div id="skills-trigger" class="ant-select-selector" role="combobox" aria-haspopup="listbox" aria-expanded="false">
      Chọn kỹ năng (Multi-Select)
    </div>
  </div>
  <div class="form-row">
    <label for="email">Email liên hệ</label><br/>
    <input id="email" name="email" type="email" placeholder="Nhập email..." />
  </div>
  <div id="selected-summary" data-values="">Đã chọn: </div>

  <script>
    window.__selectedSkills = [];
    window.__escapeCount = 0;
    var trigger = document.getElementById('skills-trigger');
    var portal = null;

    function syncSummary() {
      var el = document.getElementById('selected-summary');
      el.setAttribute('data-values', window.__selectedSkills.join(','));
      el.textContent = 'Đã chọn: ' + window.__selectedSkills.join(', ');
    }

    function openPortal() {
      if (portal) return;
      trigger.setAttribute('aria-expanded', 'true');
      portal = document.createElement('div');
      portal.id = 'skills-portal';
      portal.className = 'ant-select-dropdown';
      portal.setAttribute('role', 'listbox');
      portal.setAttribute('aria-multiselectable', 'true');
      var opts = ['TypeScript', 'Playwright', 'AI Testing', 'Docker'];
      opts.forEach(function(opt, idx) {
        var row = document.createElement('label');
        row.className = 'dd-option';
        row.setAttribute('role', 'option');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 'cb-skill-' + (idx + 1);
        cb.value = opt;
        cb.checked = window.__selectedSkills.includes(opt);
        cb.addEventListener('change', function() {
          if (cb.checked) {
            if (!window.__selectedSkills.includes(opt)) window.__selectedSkills.push(opt);
          } else {
            window.__selectedSkills = window.__selectedSkills.filter(function(v) { return v !== opt; });
          }
          syncSummary();
        });
        row.appendChild(cb);
        row.appendChild(document.createTextNode(' ' + opt));
        portal.appendChild(row);
      });
      document.body.appendChild(portal);
    }

    function closePortal() {
      if (portal) {
        portal.remove();
        portal = null;
        trigger.setAttribute('aria-expanded', 'false');
      }
    }

    trigger.addEventListener('click', function() {
      if (portal) closePortal(); else openPortal();
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && portal) {
        window.__escapeCount++;
        closePortal();
      }
    });
  </script>
</body>
</html>`);
        return;
      }

      if (url === '/dropdown-retoggle.html') {
        // Custom dropdown BỎ QUA phím Escape và BỎ QUA click ngoài, chỉ đóng khi bấm lại nút Trigger (Tier 2)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Tier 2 Re-Toggle Trigger Dropdown</title>
  <style>
    body { margin: 0; padding: 30px; font-family: sans-serif; }
    .select__control { width: 260px; padding: 10px; border: 2px solid #0284c7; cursor: pointer; background: #f0f9ff; }
    .select__menu {
      position: absolute; top: 105px; left: 30px; width: 280px; background: #fff;
      border: 2px solid #0284c7; padding: 10px; z-index: 1500;
    }
    .opt-row { display: block; padding: 6px 0; cursor: pointer; }
    #email-t2 { margin-top: 24px; width: 260px; padding: 10px; }
  </style>
</head>
<body>
  <h2>Custom Multi-Select (Ignore Escape, Re-Toggle Trigger Only)</h2>
  <div id="retoggle-trigger" class="select__control" role="combobox" aria-expanded="false">Chọn danh mục</div>
  <div><input id="email-t2" type="email" placeholder="Email Tier 2" /></div>

  <script>
    window.__t2Selected = [];
    window.__t2TriggerClicks = 0;
    var trig = document.getElementById('retoggle-trigger');
    var menu = null;

    trig.addEventListener('click', function() {
      window.__t2TriggerClicks++;
      if (menu) {
        menu.remove();
        menu = null;
        trig.setAttribute('aria-expanded', 'false');
        return;
      }
      trig.setAttribute('aria-expanded', 'true');
      menu = document.createElement('div');
      menu.id = 'retoggle-menu';
      menu.className = 'select__menu';
      menu.setAttribute('role', 'listbox');
      ['Frontend', 'Backend', 'QA Automation'].forEach(function(label, i) {
        var lbl = document.createElement('label');
        lbl.className = 'opt-row';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 't2-cb-' + (i + 1);
        cb.checked = window.__t2Selected.includes(label);
        cb.addEventListener('change', function() {
          if (cb.checked) {
            if (!window.__t2Selected.includes(label)) window.__t2Selected.push(label);
          } else {
            window.__t2Selected = window.__t2Selected.filter(function(x) { return x !== label; });
          }
        });
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(' ' + label));
        menu.appendChild(lbl);
      });
      document.body.appendChild(menu);
    });
    // CỐ TÌNH KHÔNG LẮNG NGHE PHÍM ESCAPE VÀ KHÔNG LẮNG NGHE CLICK NGOÀI
  </script>
</body>
</html>`);
        return;
      }

      if (url === '/dropdown-neutral-click.html') {
        // Custom dropdown BỎ QUA phím Escape VÀ click lại trigger không đóng; CHỈ đóng qua onClickOutside thật (Tier 3)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Tier 3 Safe Neutral Click Dropdown</title>
  <style>
    body { margin: 0; padding: 80px 30px 90px 30px; font-family: sans-serif; min-height: 700px; }
    .sticky-header { position: fixed; top: 0; left: 0; right: 0; height: 56px; background: #1e293b; color: #fff; padding: 14px; z-index: 900; }
    .sticky-footer { position: fixed; bottom: 0; left: 0; right: 0; height: 56px; background: #0f172a; color: #fff; padding: 14px; z-index: 900; }
    .ad-banner { position: fixed; top: 80px; right: 16px; width: 240px; height: 320px; background: #fde68a; border: 2px solid #f59e0b; padding: 12px; z-index: 800; }
    .trigger-box { width: 260px; padding: 10px; border: 2px solid #7c3aed; cursor: pointer; background: #f5f3ff; }
    .MuiAutocomplete-popper {
      position: absolute; top: 145px; left: 30px; width: 280px; background: #fff;
      border: 2px solid #7c3aed; padding: 10px; z-index: 1500;
    }
    .trap-btn { margin: 8px 6px; padding: 10px 14px; background: #ef4444; color: #fff; border: none; cursor: pointer; }
    #email-t3 { margin-top: 24px; width: 260px; padding: 10px; }
  </style>
</head>
<body>
  <header class="sticky-header" id="sticky-top">Sticky Header Bar</header>
  <div class="ad-banner" data-ad="true" id="right-ad">Quảng Cáo Khuyến Mãi (Cấm Click)</div>

  <div id="t3-trigger" class="trigger-box" role="combobox" aria-expanded="false">Chọn nhãn (ClickOutside Only)</div>
  <div>
    <button class="trap-btn" id="trap-1">Nút Bẫy 1</button>
    <button class="trap-btn" id="trap-2">Nút Bẫy 2</button>
  </div>
  <div><input id="email-t3" type="email" placeholder="Email Tier 3" /></div>

  <footer class="sticky-footer" id="sticky-bottom">Sticky Footer Bar</footer>

  <script>
    window.__t3Selected = [];
    window.__t3TrapClicks = 0;
    window.__t3OutsideClickTrusted = false;
    window.__t3OutsideClickPoint = null;

    document.querySelectorAll('.trap-btn, #right-ad, #sticky-top, #sticky-bottom').forEach(function(el) {
      el.addEventListener('click', function() { window.__t3TrapClicks++; });
    });

    var trig = document.getElementById('t3-trigger');
    var popper = null;

    trig.addEventListener('click', function(e) {
      e.stopPropagation();
      // CỐ TÌNH KHÔNG TOGGLE CLOSE KHI CLICK LẠI TRIGGER
      if (popper) return;
      trig.setAttribute('aria-expanded', 'true');
      popper = document.createElement('div');
      popper.id = 't3-popper';
      popper.className = 'MuiAutocomplete-popper';
      popper.setAttribute('role', 'listbox');
      ['Alpha', 'Beta', 'Gamma'].forEach(function(name, i) {
        var row = document.createElement('label');
        row.style.display = 'block';
        row.style.padding = '5px 0';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 't3-cb-' + (i + 1);
        cb.checked = window.__t3Selected.includes(name);
        cb.addEventListener('change', function() {
          if (cb.checked) {
            if (!window.__t3Selected.includes(name)) window.__t3Selected.push(name);
          } else {
            window.__t3Selected = window.__t3Selected.filter(function(v) { return v !== name; });
          }
        });
        row.appendChild(cb);
        row.appendChild(document.createTextNode(' ' + name));
        popper.appendChild(row);
      });
      document.body.appendChild(popper);
    });

    // CHỈ đóng khi nhận click thật bên ngoài trigger và popper (onClickOutside)
    document.addEventListener('click', function(e) {
      if (!popper) return;
      if (popper.contains(e.target) || trig.contains(e.target)) return;
      window.__t3OutsideClickTrusted = Boolean(e.isTrusted);
      window.__t3OutsideClickPoint = { x: e.clientX, y: e.clientY };
      popper.remove();
      popper = null;
      trig.setAttribute('aria-expanded', 'false');
    });
  </script>
</body>
</html>`);
        return;
      }

      if (url.startsWith('/modal-scenario.html')) {
        // Hỗ trợ các mode khác nhau qua query param: ?mode=close-icon | escape | cancel-btn | backdrop-only | mandatory
        const modeMatch = url.match(/mode=([a-z-]+)/);
        const mode = modeMatch ? modeMatch[1] : 'close-icon';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Modal Scenario: ${mode}</title>
  <style>
    body { margin: 0; padding: 30px; font-family: sans-serif; }
    #parent-action-btn { padding: 12px 20px; background: #16a34a; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
    .modal-wrap {
      position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); z-index: 2000;
      display: flex; align-items: center; justify-content: center;
    }
    .modal-dialog {
      position: relative; width: 420px; background: #fff; border-radius: 10px; padding: 24px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.3);
    }
    .modal-close {
      position: absolute; top: 12px; right: 12px; width: 32px; height: 32px;
      border: 1px solid #cbd5e1; background: #f8fafc; cursor: pointer; border-radius: 4px; font-size: 16px;
    }
    .modal-footer { margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end; }
    .modal-footer button { padding: 8px 14px; cursor: pointer; }
  </style>
</head>
<body>
  <h2>Trang Cha Chính</h2>
  <button id="parent-action-btn">Thao Tác Trang Cha</button>
  <div id="parent-status">Chưa bấm</div>

  <div class="modal show modal-wrap" id="info-modal-wrap">
    <div class="modal-dialog" id="info-modal-box" role="dialog" aria-modal="true">
      ${mode === 'close-icon' ? '<button class="modal-close" aria-label="Close" id="modal-x-btn">✕</button>' : ''}
      <h3>Thông Tin Chi Tiết</h3>
      <p>Vui lòng xem lại thông tin trước khi rời khỏi hộp thoại.</p>
      <div class="modal-footer">
        ${mode === 'close-icon' || mode === 'escape' || mode === 'cancel-btn' ? '<button id="btn-cancel">Hủy</button>' : ''}
        <button id="btn-save">Lưu</button>
        <button id="btn-confirm">Xác nhận</button>
        <button id="btn-ok">OK</button>
        <button id="btn-delete">Xóa</button>
      </div>
    </div>
  </div>

  <script>
    var mode = ${JSON.stringify(mode)};
    window.__forbiddenClicks = { save: 0, confirm: 0, ok: 0, del: 0 };
    window.__safeDismissSource = null;
    window.__parentClicked = false;

    var wrap = document.getElementById('info-modal-wrap');
    var box = document.getElementById('info-modal-box');

    function closeModal(src) {
      window.__safeDismissSource = src;
      if (wrap) {
        wrap.remove();
        wrap = null;
      }
    }

    document.getElementById('parent-action-btn').addEventListener('click', function() {
      window.__parentClicked = true;
      document.getElementById('parent-status').textContent = 'Đã bấm trang cha!';
    });

    document.getElementById('btn-save').addEventListener('click', function() { window.__forbiddenClicks.save++; closeModal('FORBIDDEN_SAVE'); });
    document.getElementById('btn-confirm').addEventListener('click', function() { window.__forbiddenClicks.confirm++; closeModal('FORBIDDEN_CONFIRM'); });
    document.getElementById('btn-ok').addEventListener('click', function() { window.__forbiddenClicks.ok++; closeModal('FORBIDDEN_OK'); });
    document.getElementById('btn-delete').addEventListener('click', function() { window.__forbiddenClicks.del++; closeModal('FORBIDDEN_DELETE'); });

    var xBtn = document.getElementById('modal-x-btn');
    if (xBtn) {
      xBtn.addEventListener('click', function() { closeModal('CLOSE_ICON'); });
    }

    var cancelBtn = document.getElementById('btn-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() { closeModal('CANCEL_BUTTON'); });
    }

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && wrap && mode === 'escape') {
        closeModal('ESCAPE');
      }
    });

    if (wrap) {
      wrap.addEventListener('click', function(e) {
        if (e.target === wrap && mode === 'backdrop-only') {
          closeModal('BACKDROP');
        }
      });
    }
  </script>
</body>
</html>`);
        return;
      }

      if (url === '/cluttered-neutral.html') {
        // Trang đông đặc phần tử tương tác, sticky header/footer/sidebar, ad banner và floating portal
        // Chừa lại một khoảng trống body an toàn để kiểm chứng calculateSafeNeutralPoint
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Dense Cluttered Layout</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; font-family: sans-serif; width: 1280px; height: 720px; background: #f8fafc; }
    .sticky-header { position: fixed; top: 0; left: 0; width: 1280px; height: 64px; background: #0f172a; color: #fff; padding: 18px; z-index: 900; }
    .sticky-footer { position: fixed; bottom: 0; left: 0; width: 1280px; height: 64px; background: #0f172a; color: #fff; padding: 18px; z-index: 900; }
    .sticky-sidebar { position: fixed; top: 64px; left: 0; width: 220px; height: 592px; background: #1e293b; color: #fff; padding: 16px; z-index: 850; }
    .ad-banner { position: fixed; top: 64px; right: 0; width: 260px; height: 592px; background: #fef08a; border-left: 2px solid #eab308; padding: 16px; z-index: 850; }
    .floating-portal { position: fixed; top: 80px; left: 240px; width: 320px; height: 220px; background: #fff; border: 2px solid #2563eb; padding: 12px; z-index: 1200; }
    .interactive-cluster { position: absolute; top: 320px; left: 240px; width: 520px; height: 320px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .interactive-cluster button, .interactive-cluster input, .interactive-cluster a { display: flex; align-items: center; justify-content: center; border: 1px solid #94a3b8; background: #e2e8f0; text-decoration: none; color: #0f172a; }
    /* Khoảng trống an toàn duy nhất nằm ở vùng [580..1000] x [80..300] và [780..1000] x [310..640] */
  </style>
</head>
<body>
  <header class="sticky-header" id="hdr">Sticky Header</header>
  <nav class="sticky-sidebar" id="sbar">Sticky Sidebar</nav>
  <aside class="ad-banner" data-ad="true" id="ad-right">Right Ad Banner</aside>
  <div class="ant-select-dropdown floating-portal" role="listbox" id="portal-box">
    <div role="option">Portal Option 1</div>
    <div role="option">Portal Option 2</div>
  </div>
  <div class="interactive-cluster">
    <button id="c-btn-1">Btn 1</button>
    <a href="#x" id="c-lnk-1">Link 1</a>
    <input id="c-inp-1" value="Input 1" />
    <button id="c-btn-2">Btn 2</button>
    <div role="button" tabindex="0" id="c-rb-1">Role Btn</div>
    <textarea id="c-ta-1">Textarea</textarea>
    <select id="c-sel-1"><option>Opt</option></select>
    <button id="c-btn-3">Btn 3</button>
    <button id="c-btn-4">Btn 4</button>
  </div>
  <footer class="sticky-footer" id="ftr">Sticky Footer</footer>

  <script>
    window.__trappedClicks = 0;
    window.__bodyNeutralClicks = 0;
    window.__lastBodyClickTrusted = false;

    document.querySelectorAll('#hdr, #sbar, #ad-right, #portal-box, #ftr, .interactive-cluster *').forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        window.__trappedClicks++;
      });
    });

    document.body.addEventListener('click', function(e) {
      window.__bodyNeutralClicks++;
      window.__lastBodyClickTrusted = Boolean(e.isTrusted);
    });
  </script>
</body>
</html>`);
        return;
      }

      if (url === '/nested-modal-dropdown.html') {
        // Modal chứa Multi-Select Dropdown VÀ một ô input Email bên trong Modal, kèm một nút trên trang cha bên ngoài Modal
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Nested Dropdown Inside Modal</title>
  <style>
    body { margin: 0; padding: 30px; font-family: sans-serif; }
    .modal-wrap { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 500; display: flex; align-items: center; justify-content: center; }
    .modal-box { position: relative; width: 460px; background: #fff; padding: 24px; border-radius: 8px; }
    .modal-close { position: absolute; top: 10px; right: 10px; cursor: pointer; }
    .ant-select-selector { width: 240px; padding: 8px; border: 1px solid #3b82f6; cursor: pointer; }
    .ant-select-dropdown { position: fixed; top: 260px; left: 450px; width: 240px; background: #fff; border: 2px solid #3b82f6; padding: 8px; z-index: 1500; }
    #modal-email { margin-top: 20px; width: 240px; padding: 8px; }
  </style>
</head>
<body>
  <button id="parent-outside-btn">Nút Trang Cha</button>
  <div id="nested-status">Init</div>

  <div class="modal show modal-wrap" id="nested-modal-wrap">
    <div class="modal-dialog modal-box" id="nested-modal-box" role="dialog" aria-modal="true">
      <button class="modal-close" aria-label="Close" id="nested-close-x">✕</button>
      <h3>Form Trong Modal</h3>
      <div id="nested-dd-trigger" class="ant-select-selector" role="combobox" aria-expanded="false">Chọn vai trò</div>
      <div><input id="modal-email" type="email" placeholder="Email trong modal" /></div>
    </div>
  </div>

  <script>
    window.__nestedRoles = [];
    var trig = document.getElementById('nested-dd-trigger');
    var dd = null;

    trig.addEventListener('click', function() {
      if (dd) return;
      trig.setAttribute('aria-expanded', 'true');
      dd = document.createElement('div');
      dd.id = 'nested-dd-portal';
      dd.className = 'ant-select-dropdown';
      dd.setAttribute('role', 'listbox');
      ['Admin', 'Editor'].forEach(function(r, i) {
        var l = document.createElement('label');
        l.style.display = 'block';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 'nested-cb-' + (i + 1);
        cb.addEventListener('change', function() {
          if (cb.checked && !window.__nestedRoles.includes(r)) window.__nestedRoles.push(r);
        });
        l.appendChild(cb);
        l.appendChild(document.createTextNode(' ' + r));
        dd.appendChild(l);
      });
      document.body.appendChild(dd);
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && dd) {
        dd.remove();
        dd = null;
        trig.setAttribute('aria-expanded', 'false');
      }
    });

    document.getElementById('nested-close-x').addEventListener('click', function() {
      var w = document.getElementById('nested-modal-wrap');
      if (w) w.remove();
    });

    document.getElementById('parent-outside-btn').addEventListener('click', function() {
      document.getElementById('nested-status').textContent = 'ParentClicked';
    });
  </script>
</body>
</html>`);
        return;
      }

      if (url === '/native-popover-dialog.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <title>W3C Native Popover & HTML Dialog</title>
  <style>
    body { margin: 0; padding: 30px; font-family: sans-serif; }
    #native-pop { padding: 16px; border: 2px solid #2563eb; background: #eff6ff; top: 90px; left: 30px; }
    #native-dlg { width: 360px; padding: 20px; border: 1px solid #334155; border-radius: 8px; }
    #native-dlg::backdrop { background: rgba(15, 23, 42, 0.5); }
    #outside-target { margin-top: 220px; padding: 10px 18px; }
  </style>
</head>
<body>
  <button id="open-pop-btn" popovertarget="native-pop">Mở W3C Popover</button>
  <div id="native-pop" popover="auto">
    <p>Popover chuẩn W3C Light Dismiss</p>
    <button id="pop-inner-btn">Nút Trong Popover</button>
  </div>

  <button id="open-dlg-btn">Mở Native Dialog</button>
  <dialog id="native-dlg">
    <h3>Native HTML5 Dialog</h3>
    <p>Bấm Escape hoặc nút Đóng để thoát</p>
    <button id="dlg-save">Save</button>
    <button id="dlg-close">Đóng</button>
  </dialog>

  <div><button id="outside-target">Nút Mục Tiêu Ngoài</button></div>

  <script>
    window.__dlgSaveClicked = 0;
    document.getElementById('open-dlg-btn').addEventListener('click', function() {
      document.getElementById('native-dlg').showModal();
    });
    document.getElementById('dlg-save').addEventListener('click', function() {
      window.__dlgSaveClicked++;
      document.getElementById('native-dlg').close();
    });
    document.getElementById('dlg-close').addEventListener('click', function() {
      document.getElementById('native-dlg').close();
    });
  </script>
</body>
</html>`);
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((resClose) => {
            server.close(() => resClose());
          }),
      });
    });
  });
}

async function createInstrumentedBrowser(): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  // Phòng chống crash tsx/esbuild __name trong mọi page.evaluate (Gotcha #1)
  await context.addInitScript(() => {
    (window as any).__name = (globalThis as any).__name = (fn: any) => fn;
  });
  const page = await context.newPage();
  return { browser, context, page };
}

// ============================================================================
// PART A: UNIT TESTS (ANTONYM GUARDRAIL & SAFE NEUTRAL POINT GEOMETRY)
// ============================================================================

test('Unit 1: STRICT Antonym Barrier Guardrail chặn toàn bộ nút khẳng định/phá hủy và cho phép nút hủy/đóng an toàn', () => {
  const forbiddenLabels = [
    'Lưu',
    'Luu',
    'Lưu thay đổi',
    'Lưu và Đóng',
    'Save',
    'Save Changes',
    'Save & Close',
    'Xác nhận',
    'Xac nhan',
    'Confirm',
    'OK',
    'Ok',
    'OK!',
    'Submit',
    'Gửi',
    'Gui',
    'Gửi đi',
    'Đồng ý',
    'Dong y',
    'Xóa',
    'Xoá',
    'Xoa',
    'Delete',
    'Tiếp tục',
    'Tiep tuc',
    'Apply',
    'Áp dụng',
    'Accept',
    'Chấp nhận',
    'Yes',
    'Có',
    'Confirm Delete',
    'Xác nhận xóa',
  ];

  for (const label of forbiddenLabels) {
    assert.strictEqual(
      isForbiddenModalDismissButton(label),
      true,
      `Phải CHẶN tuyệt đối nút khẳng định/phá hủy: "${label}"`
    );
    assert.strictEqual(
      isSafeModalDismissButton(label),
      false,
      `Không được coi nút cấm "${label}" là an toàn`
    );
    assert.strictEqual(classifyModalButton(label), 'FORBIDDEN');
  }

  // Kiểm tra descriptor objects (ariaLabel cấm, type="submit" không có nhãn, hoặc class close giả mạo nhãn Lưu)
  assert.strictEqual(isForbiddenModalDismissButton({ text: '', ariaLabel: 'Save changes' }), true);
  assert.strictEqual(isForbiddenModalDismissButton({ text: '', type: 'submit' }), true);
  assert.strictEqual(isForbiddenModalDismissButton({ text: 'Lưu', className: 'modal-close' }), true);
  assert.strictEqual(isForbiddenModalDismissButton({ text: 'OK', className: 'btn-close' }), true);

  const safeLabels = [
    'Hủy',
    'Hủy bỏ',
    'Huy',
    'Cancel',
    'Bỏ qua',
    'Bo qua',
    'Đóng',
    'Đóng lại',
    'Close',
    'Dismiss',
    'Không',
    'Không đồng ý',
    'No',
    '✕',
    '×',
  ];

  for (const label of safeLabels) {
    assert.strictEqual(
      isForbiddenModalDismissButton(label),
      false,
      `Không được chặn nhầm nút thoát an toàn: "${label}"`
    );
    assert.strictEqual(
      isSafeModalDismissButton(label),
      true,
      `Phải công nhận nút thoát an toàn: "${label}"`
    );
    assert.strictEqual(classifyModalButton(label), 'SAFE_DISMISS');
  }

  // Descriptor với aria-label Close/Đóng (icon-only close button)
  assert.strictEqual(isForbiddenModalDismissButton({ text: '', ariaLabel: 'Close' }), false);
  assert.strictEqual(isSafeModalDismissButton({ text: '', ariaLabel: 'Close' }), true);
  assert.strictEqual(isForbiddenModalDismissButton({ text: '', ariaLabel: 'Đóng' }), false);
  assert.strictEqual(isSafeModalDismissButton({ text: '', ariaLabel: 'Đóng' }), true);
});

test('Unit 2: Pure Geometry computeSafeNeutralPointFromGeometry tìm đúng tọa độ trống trên bố cục dày đặc', () => {
  const viewport = { width: 1280, height: 720 };
  const forbiddenRects: Rect[] = [
    // Sticky header
    { x: 0, y: 0, width: 1280, height: 64 },
    // Sticky footer
    { x: 0, y: 656, width: 1280, height: 64 },
    // Left sidebar
    { x: 0, y: 64, width: 260, height: 592 },
    // Right ad banner
    { x: 960, y: 64, width: 320, height: 592 },
    // Portal dropdown (chiếm nửa trên vùng giữa)
    { x: 260, y: 64, width: 420, height: 300 },
    // Form buttons (chiếm nửa dưới vùng giữa, chừa khe trống [680..960] x [64..656])
    { x: 260, y: 364, width: 420, height: 292 },
  ];

  const res = computeSafeNeutralPointFromGeometry(viewport, forbiddenRects);
  assert.strictEqual(res.found, true, 'Phải tìm được tọa độ trống trong khe hở [680..960]');
  assert.ok(res.point, 'Phải trả về tọa độ point hợp lệ');
  assert.ok(res.clearancePx > 20, `Khoảng thoáng phải đủ rộng (thực tế: ${res.clearancePx}px)`);

  for (const r of forbiddenRects) {
    assert.strictEqual(
      rectContainsPoint(r, res.point!, 0),
      false,
      `Tọa độ P_neutral (${res.point!.x}, ${res.point!.y}) không được giao cắt vùng cấm ${JSON.stringify(r)}`
    );
  }

  // Trường hợp viewport bị phủ kín 100% -> phải trả về found: false
  const blockedRes = computeSafeNeutralPointFromGeometry(viewport, [
    { x: 0, y: 0, width: 1280, height: 720 },
  ]);
  assert.strictEqual(blockedRes.found, false);
  assert.strictEqual(blockedRes.point, null);

  // Kiểm tra nhanh ActiveOverlayTracker ghi nhận & ánh xạ trigger
  const tracker = new ActiveOverlayTracker();
  tracker.recordTrigger({ selector: '#my-dd-trigger', rect: { x: 10, y: 10, width: 120, height: 32 }, timestamp: Date.now() });
  assert.strictEqual(tracker.getLastTrigger()?.selector, '#my-dd-trigger');
  tracker.associateTrigger('ov-99', { selector: '#explicit-trig', timestamp: Date.now() });
  assert.strictEqual(tracker.getTriggerForOverlay('ov-99')?.selector, '#explicit-trig');
  assert.strictEqual(tracker.getTriggerForOverlay('ov-unknown')?.selector, '#my-dd-trigger');
  tracker.clear();
  assert.strictEqual(tracker.getLastTrigger(), null);
});

// ============================================================================
// PART B: REAL PLAYWRIGHT CHROMIUM INTEGRATION TESTS
// ============================================================================

test('Integration 3: Active Overlay Stack Detection lọc sạch phần tử ẩn và bắt đúng Dropdown, Modal & W3C Popover', async () => {
  const { baseUrl, close } = await createMockServer();
  const { browser, page } = await createInstrumentedBrowser();

  try {
    await page.goto(`${baseUrl}/overlay-detection.html`, { waitUntil: 'domcontentloaded' });

    // Ban đầu có 2 overlay hiển thị (open-dd z=100 và open-modal-dialog z=500), 3 overlay ẩn bị lọc bỏ
    const initialOverlays = await detectActiveOverlays(page);
    assert.strictEqual(
      initialOverlays.length,
      2,
      `Kỳ vọng đúng 2 overlay hiển thị (lọc 3 overlay ẩn), thực tế: ${initialOverlays.length}`
    );
    assert.strictEqual(initialOverlays[0].kind, 'dropdown');
    assert.strictEqual(initialOverlays[1].kind, 'modal');
    assert.strictEqual(initialOverlays[1].ariaModal, true);
    assert.strictEqual(initialOverlays[1].hasBackdrop, true);

    // Mở thêm W3C Native Popover ([popover]:popover-open nằm trên CSS Top Layer)
    await page.evaluate(() => {
      const pop = document.getElementById('native-pop') as any;
      if (pop && typeof pop.showPopover === 'function') {
        pop.showPopover();
      }
    });

    const withPopover = await detectActiveOverlays(page);
    const popOverlay = withPopover.find((o) => o.isPopoverOpen);
    assert.ok(popOverlay, 'Phải phát hiện được W3C native [popover]:popover-open');
    assert.strictEqual(popOverlay!.kind, 'popover');
    assert.strictEqual(popOverlay!.isTopLayer, true);
    assert.strictEqual(
      withPopover[withPopover.length - 1].overlayId,
      popOverlay!.overlayId,
      'Top-Layer Popover phải nằm ở đỉnh ngăn xếp overlay'
    );

    // Kiểm tra Context-Boundary Crossing khi mục tiêu là nút bên ngoài trang cha
    const crossing = await detectContextBoundaryCrossing(page, { selector: '#bg-btn' });
    assert.strictEqual(crossing.crossed, true);
    assert.strictEqual(crossing.checkMethod, 'DOM_SUBTREE');
    assert.strictEqual(crossing.targetInsideTopOverlay, false);
  } finally {
    await browser.close();
    await close();
  }
});

test('Integration 4: Multi-Select Dropdown (Tier 1 Escape) - Chọn 3 checkbox rồi điền Email ngoài không cần bước click ngoài, bảo toàn 100% giá trị', async () => {
  const { baseUrl, close } = await createMockServer();
  const { browser, page } = await createInstrumentedBrowser();

  try {
    await page.goto(`${baseUrl}/multiselect-escape.html`, { waitUntil: 'domcontentloaded' });
    const manager = new ImplicitDismissalManager(page);

    // Bước 1: Mở Multi-Select Dropdown và ghi nhận trigger
    const trigRect = await page.locator('#skills-trigger').boundingBox();
    manager.recordTrigger({
      selector: '#skills-trigger',
      rect: trigRect || undefined,
      timestamp: Date.now(),
    });
    await page.click('#skills-trigger');
    await manager.syncActiveOverlays();

    assert.strictEqual(manager.tracker.getStack().length, 1, 'Dropdown portal phải đang mở');

    // Bước 2: Chọn liên tiếp 3 checkbox bên trong dropdown -> KHÔNG được tự động đóng dropdown
    for (const cbSel of ['#cb-skill-1', '#cb-skill-2', '#cb-skill-3']) {
      const checkBeforeCb = await manager.ensureDismissedBeforeAction({ selector: cbSel });
      assert.strictEqual(
        checkBeforeCb.needed,
        false,
        `Mục tiêu ${cbSel} nằm TRONG dropdown nên tuyệt đối không được đóng dropdown`
      );
      await page.click(cbSel);
    }

    // Bước 3: Bước kế tiếp lập tức điền Email NGOÀI dropdown (KHÔNG có bước thủ công click ra ngoài)
    const dismissal = await manager.ensureDismissedBeforeAction({ selector: '#email' });
    assert.strictEqual(dismissal.needed, true, 'Phải phát hiện vượt ranh giới ngữ cảnh khi điền #email');
    assert.strictEqual(dismissal.dismissed, true, 'Phải tự động đóng dropdown treo');
    assert.strictEqual(dismissal.tierUsed, 'TIER_1_ESCAPE', 'Phải đóng thành công ngay tại Tier 1 (Escape)');
    assert.strictEqual(dismissal.remainingOverlays.length, 0, 'Không còn overlay nào đang mở');

    // Điền Email trực tiếp (vì dropdown đã đóng sạch, không còn che khuất ô Email)
    await page.fill('#email', 'engineer@autotest.io');

    // Kiểm tra: Email điền đúng VÀ 100% cả 3 giá trị checkbox đã chọn được bảo toàn!
    const state = await page.evaluate(() => ({
      emailVal: (document.getElementById('email') as HTMLInputElement).value,
      selected: (window as any).__selectedSkills as string[],
      escapeCount: (window as any).__escapeCount as number,
    }));

    assert.strictEqual(state.emailVal, 'engineer@autotest.io');
    assert.deepStrictEqual(state.selected, ['TypeScript', 'Playwright', 'AI Testing']);
    assert.strictEqual(state.escapeCount, 1);
  } finally {
    await browser.close();
    await close();
  }
});

test('Integration 5: Custom Dropdown bỏ qua Escape -> Leo thang Tier 2 (Re-Toggle Trigger) đóng menu và bảo toàn 3 giá trị', async () => {
  const { baseUrl, close } = await createMockServer();
  const { browser, page } = await createInstrumentedBrowser();

  try {
    await page.goto(`${baseUrl}/dropdown-retoggle.html`, { waitUntil: 'domcontentloaded' });
    const manager = new ImplicitDismissalManager(page);

    const trigRect = await page.locator('#retoggle-trigger').boundingBox();
    manager.recordTrigger({
      selector: '#retoggle-trigger',
      rect: trigRect || undefined,
      timestamp: Date.now(),
    });
    await page.click('#retoggle-trigger');
    await manager.syncActiveOverlays();

    // Chọn cả 3 checkbox bên trong dropdown
    await page.click('#t2-cb-1');
    await page.click('#t2-cb-2');
    await page.click('#t2-cb-3');

    // Bước tiếp theo hướng tới #email-t2 bên ngoài dropdown
    const dismissal = await manager.ensureDismissedBeforeAction({ selector: '#email-t2' });
    assert.strictEqual(dismissal.dismissed, true, 'Tier 2 phải đóng được dropdown sau khi Escape bị bỏ qua');
    assert.strictEqual(dismissal.tierUsed, 'TIER_2_RETOGGLE_TRIGGER');
    assert.strictEqual(dismissal.attempts[0].tier, 'TIER_1_ESCAPE');
    assert.strictEqual(dismissal.attempts[0].succeeded, false);
    assert.strictEqual(dismissal.attempts[1].tier, 'TIER_2_RETOGGLE_TRIGGER');
    assert.strictEqual(dismissal.attempts[1].succeeded, true);

    await page.fill('#email-t2', 'tier2@autotest.io');

    const state = await page.evaluate(() => ({
      email: (document.getElementById('email-t2') as HTMLInputElement).value,
      selected: (window as any).__t2Selected as string[],
      triggerClicks: (window as any).__t2TriggerClicks as number,
    }));

    assert.strictEqual(state.email, 'tier2@autotest.io');
    assert.deepStrictEqual(state.selected, ['Frontend', 'Backend', 'QA Automation']);
    assert.strictEqual(state.triggerClicks, 2, 'Trigger được click 1 lần để mở và 1 lần bởi Tier 2 để đóng');
  } finally {
    await browser.close();
    await close();
  }
});

test('Integration 6: Custom Dropdown bỏ qua Escape & Trigger Re-Click -> Leo thang Tier 3 (Safe Neutral Click) kích hoạt onClickOutside thật', async () => {
  const { baseUrl, close } = await createMockServer();
  const { browser, page } = await createInstrumentedBrowser();

  try {
    await page.goto(`${baseUrl}/dropdown-neutral-click.html`, { waitUntil: 'domcontentloaded' });
    const manager = new ImplicitDismissalManager(page);

    const trigRect = await page.locator('#t3-trigger').boundingBox();
    manager.recordTrigger({
      selector: '#t3-trigger',
      rect: trigRect || undefined,
      timestamp: Date.now(),
    });
    await page.click('#t3-trigger');
    await manager.syncActiveOverlays();

    // Chọn 3 checkbox trong popper
    await page.click('#t3-cb-1');
    await page.click('#t3-cb-2');
    await page.click('#t3-cb-3');

    // Bước tiếp theo hướng tới #email-t3 -> Escape thất bại -> Re-Toggle thất bại -> Tier 3 Safe Neutral Click thành công
    const dismissal = await manager.ensureDismissedBeforeAction({ selector: '#email-t3' });
    assert.strictEqual(dismissal.dismissed, true, 'Tier 3 phải đóng được popper qua onClickOutside');
    assert.strictEqual(dismissal.tierUsed, 'TIER_3_SAFE_NEUTRAL_CLICK');
    assert.strictEqual(dismissal.attempts.length, 3);
    assert.strictEqual(dismissal.attempts[0].tier, 'TIER_1_ESCAPE');
    assert.strictEqual(dismissal.attempts[1].tier, 'TIER_2_RETOGGLE_TRIGGER');
    assert.strictEqual(dismissal.attempts[2].tier, 'TIER_3_SAFE_NEUTRAL_CLICK');
    assert.strictEqual(dismissal.attempts[2].succeeded, true);

    await page.fill('#email-t3', 'tier3@autotest.io');

    const state = await page.evaluate(() => ({
      email: (document.getElementById('email-t3') as HTMLInputElement).value,
      selected: (window as any).__t3Selected as string[],
      trapClicks: (window as any).__t3TrapClicks as number,
      trusted: (window as any).__t3OutsideClickTrusted as boolean,
    }));

    assert.strictEqual(state.email, 'tier3@autotest.io');
    assert.deepStrictEqual(state.selected, ['Alpha', 'Beta', 'Gamma']);
    assert.strictEqual(state.trapClicks, 0, 'Safe Neutral Click tuyệt đối không được click nhầm nút bẫy, sticky bar hay ad banner');
    assert.strictEqual(state.trusted, true, 'Click chuột vật lý phải sinh sự kiện isTrusted === true');
  } finally {
    await browser.close();
    await close();
  }
});

test('Integration 7: Modal Scenario A (Tier 4a - Close Icon ✕) đóng modal an toàn, không bao giờ bấm Lưu/OK', async () => {
  const { baseUrl, close } = await createMockServer();
  const { browser, page } = await createInstrumentedBrowser();

  try {
    await page.goto(`${baseUrl}/modal-scenario.html?mode=close-icon`, { waitUntil: 'domcontentloaded' });
    const manager = new ImplicitDismissalManager(page);

    const dismissal = await manager.ensureDismissedBeforeAction({ selector: '#parent-action-btn' });
    assert.strictEqual(dismissal.dismissed, true);
    assert.strictEqual(dismissal.tierUsed, 'TIER_4A_MODAL_CLOSE_BUTTON');

    await page.click('#parent-action-btn');

    const state = await page.evaluate(() => ({
      forbidden: (window as any).__forbiddenClicks,
      source: (window as any).__safeDismissSource,
      parentClicked: (window as any).__parentClicked,
    }));

    assert.strictEqual(state.source, 'CLOSE_ICON');
    assert.strictEqual(state.parentClicked, true);
    assert.deepStrictEqual(state.forbidden, { save: 0, confirm: 0, ok: 0, del: 0 });
  } finally {
    await browser.close();
    await close();
  }
});

test('Integration 8: Modal Scenario B (Tier 4b Escape & Tier 4c Safe Cancel "Hủy") tuân thủ Antonym Guardrail', async () => {
  const { baseUrl, close } = await createMockServer();
  const { browser, page } = await createInstrumentedBrowser();

  try {
    // Subcase 1: Không có nút ✕, đóng bằng Escape (Tier 4b)
    await page.goto(`${baseUrl}/modal-scenario.html?mode=escape`, { waitUntil: 'domcontentloaded' });
    const res4b = await dismissHangingOverlays(page, {
      nextTarget: { selector: '#parent-action-btn' },
      onlyIfCrossed: true,
    });
    assert.strictEqual(res4b.dismissed, true);
    assert.strictEqual(res4b.tierUsed, 'TIER_4B_MODAL_ESCAPE');
    const st4b = await page.evaluate(() => ({
      forbidden: (window as any).__forbiddenClicks,
      source: (window as any).__safeDismissSource,
    }));
    assert.strictEqual(st4b.source, 'ESCAPE');
    assert.deepStrictEqual(st4b.forbidden, { save: 0, confirm: 0, ok: 0, del: 0 });

    // Subcase 2: Không có ✕, bỏ qua Escape, có "Lưu"/"Xác nhận"/"OK"/"Xóa" VÀ "Hủy" -> Tier 4c chỉ bấm "Hủy"
    await page.goto(`${baseUrl}/modal-scenario.html?mode=cancel-btn`, { waitUntil: 'domcontentloaded' });
    const res4c = await dismissHangingOverlays(page, {
      nextTarget: { selector: '#parent-action-btn' },
      onlyIfCrossed: true,
    });
    assert.strictEqual(res4c.dismissed, true);
    assert.strictEqual(res4c.tierUsed, 'TIER_4C_MODAL_SAFE_CANCEL_BUTTON');
    assert.strictEqual(res4c.blockedByGuardrail, true);
    assert.ok(res4c.blockedButtons.includes('Lưu'));
    assert.ok(res4c.blockedButtons.includes('OK'));
    assert.ok(res4c.blockedButtons.includes('Xác nhận'));
    assert.ok(res4c.blockedButtons.includes('Xóa'));

    await page.click('#parent-action-btn');
    const st4c = await page.evaluate(() => ({
      forbidden: (window as any).__forbiddenClicks,
      source: (window as any).__safeDismissSource,
      parentClicked: (window as any).__parentClicked,
    }));
    assert.strictEqual(st4c.source, 'CANCEL_BUTTON');
    assert.strictEqual(st4c.parentClicked, true);
    assert.deepStrictEqual(st4c.forbidden, { save: 0, confirm: 0, ok: 0, del: 0 });
  } finally {
    await browser.close();
    await close();
  }
});

test('Integration 9: Modal Scenario C & D (CHỈ có "Lưu"/"OK"/"Xác nhận"/"Xóa") - Guardrail tuyệt đối không bấm nút cấm; đóng bằng Backdrop (4d) hoặc dừng an toàn', async () => {
  const { baseUrl, close } = await createMockServer();
  const { browser, page } = await createInstrumentedBrowser();

  try {
    // Subcase C: Chỉ có các nút khẳng định/phá hủy + maskClosable=true -> Tier 4d bấm backdrop ngoài hộp thoại
    await page.goto(`${baseUrl}/modal-scenario.html?mode=backdrop-only`, { waitUntil: 'domcontentloaded' });
    const res4d = await dismissHangingOverlays(page, {
      nextTarget: { selector: '#parent-action-btn' },
      onlyIfCrossed: true,
    });
    assert.strictEqual(res4d.dismissed, true, 'Phải đóng modal thành công qua Tier 4d Backdrop');
    assert.strictEqual(res4d.tierUsed, 'TIER_4D_MODAL_BACKDROP_CLICK');
    assert.strictEqual(res4d.blockedByGuardrail, true);
    assert.ok(res4d.blockedButtons.includes('Lưu'));
    assert.ok(res4d.blockedButtons.includes('OK'));

    await page.click('#parent-action-btn');
    const st4d = await page.evaluate(() => ({
      forbidden: (window as any).__forbiddenClicks,
      source: (window as any).__safeDismissSource,
      parentClicked: (window as any).__parentClicked,
    }));
    assert.strictEqual(st4d.source, 'BACKDROP');
    assert.strictEqual(st4d.parentClicked, true);
    assert.deepStrictEqual(st4d.forbidden, { save: 0, confirm: 0, ok: 0, del: 0 });

    // Subcase D: Mandatory modal (CHỈ có Lưu/OK, bỏ qua Escape, maskClosable=false) -> Phải dừng an toàn, CẤM bấm Lưu/OK
    await page.goto(`${baseUrl}/modal-scenario.html?mode=mandatory`, { waitUntil: 'domcontentloaded' });
    const resMandatory = await dismissHangingOverlays(page, {
      nextTarget: { selector: '#parent-action-btn' },
      onlyIfCrossed: true,
    });
    assert.strictEqual(resMandatory.dismissed, false, 'Modal bắt buộc không có lối thoát an toàn phải giữ nguyên chứ không bấm bừa');
    assert.strictEqual(resMandatory.blockedByGuardrail, true);
    assert.ok(resMandatory.blockedButtons.includes('Lưu'));
    assert.ok(resMandatory.blockedButtons.includes('OK'));

    const stMandatory = await page.evaluate(() => (window as any).__forbiddenClicks);
    assert.deepStrictEqual(
      stMandatory,
      { save: 0, confirm: 0, ok: 0, del: 0 },
      'Tuyệt đối không được bấm bất kỳ nút khẳng định/phá hủy nào dù không còn lối thoát'
    );
  } finally {
    await browser.close();
    await close();
  }
});

test('Integration 10: Safe Neutral Click DOM Integration trên bố cục dày đặc không giao cắt bất kỳ phần tử tương tác, portal, sticky bar hay ad banner nào', async () => {
  const { baseUrl, close } = await createMockServer();
  const { browser, page } = await createInstrumentedBrowser();

  try {
    await page.goto(`${baseUrl}/cluttered-neutral.html`, { waitUntil: 'domcontentloaded' });

    const neutral = await calculateSafeNeutralPoint(page);
    assert.strictEqual(neutral.found, true, `Phải tìm được P_neutral hợp lệ: ${neutral.reason}`);
    assert.ok(neutral.point, 'Phải trả về tọa độ P_neutral');
    assert.ok(neutral.forbiddenRectCount >= 10, 'Phải nhận diện đầy đủ các vùng cấm trên trang');

    // Kiểm tra hình học trực tiếp với toàn bộ vùng cấm trên DOM thực tế
    const forbiddenBoxes = await page.evaluate(() => {
      const sels = '#hdr, #sbar, #ad-right, #portal-box, #ftr, .interactive-cluster *';
      return Array.from(document.querySelectorAll(sels)).map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.id || el.tagName, x: r.x, y: r.y, width: r.width, height: r.height };
      });
    });

    for (const box of forbiddenBoxes) {
      assert.strictEqual(
        rectContainsPoint(box, neutral.point!, 0),
        false,
        `P_neutral (${neutral.point!.x}, ${neutral.point!.y}) đè vào phần tử cấm "${box.id}"`
      );
    }

    // Thực hiện click chuột vật lý tại P_neutral và xác minh chỉ trúng vùng trống trên <body>
    await page.mouse.click(neutral.point!.x, neutral.point!.y);

    const clickResult = await page.evaluate(() => ({
      trapped: (window as any).__trappedClicks as number,
      bodyClicks: (window as any).__bodyNeutralClicks as number,
      trusted: (window as any).__lastBodyClickTrusted as boolean,
    }));

    assert.strictEqual(clickResult.trapped, 0, 'Không được kích hoạt bất kỳ phần tử bẫy nào');
    assert.strictEqual(clickResult.bodyClicks, 1, 'Phải bắn sự kiện click sạch trên <body>');
    assert.strictEqual(clickResult.trusted, true, 'Sự kiện phải là physical mouse click (isTrusted: true)');
  } finally {
    await browser.close();
    await close();
  }
});

test('Integration 11: Ngăn xếp lớp phủ lồng nhau (Dropdown trong Modal) chỉ đóng Dropdown khi bước kế tiếp vẫn ở trong Modal, và đóng Modal khi thoát ra trang cha', async () => {
  const { baseUrl, close } = await createMockServer();
  const { browser, page } = await createInstrumentedBrowser();

  try {
    await page.goto(`${baseUrl}/nested-modal-dropdown.html`, { waitUntil: 'domcontentloaded' });
    const manager = new ImplicitDismissalManager(page);

    // Mở Dropdown bên trong Modal và chọn 2 vai trò
    await page.click('#nested-dd-trigger');
    await manager.syncActiveOverlays();
    assert.strictEqual(manager.tracker.getStack().length, 2, 'Phải có 2 lớp phủ trong ngăn xếp: [Modal, Dropdown]');

    await page.click('#nested-cb-1');
    await page.click('#nested-cb-2');

    // Bước tiếp theo: Điền #modal-email (NẰM NGOÀI Dropdown nhưng VẪN TRONG Modal)
    const step1Dismiss = await manager.ensureDismissedBeforeAction({ selector: '#modal-email' });
    assert.strictEqual(step1Dismiss.dismissed, true);
    assert.strictEqual(step1Dismiss.dismissedCount, 1, 'Chỉ được đóng đúng 1 lớp là Dropdown');
    assert.strictEqual(step1Dismiss.tierUsed, 'TIER_1_ESCAPE');
    assert.strictEqual(step1Dismiss.remainingOverlays.length, 1, 'Modal phải vẫn mở để người dùng tiếp tục thao tác bên trong');
    assert.strictEqual(step1Dismiss.remainingOverlays[0].kind, 'modal');

    await page.fill('#modal-email', 'inside-modal@autotest.io');

    // Bước tiếp theo: Click #parent-outside-btn (NẰM NGOÀI Modal trên trang cha) -> Lúc này mới tự động đóng Modal
    const step2Dismiss = await manager.ensureDismissedBeforeAction({ selector: '#parent-outside-btn' });
    assert.strictEqual(step2Dismiss.dismissed, true);
    assert.strictEqual(step2Dismiss.tierUsed, 'TIER_4A_MODAL_CLOSE_BUTTON');
    assert.strictEqual(step2Dismiss.remainingOverlays.length, 0);

    await page.click('#parent-outside-btn');
    const finalStatus = await page.evaluate(() => ({
      status: document.getElementById('nested-status')?.textContent,
      roles: (window as any).__nestedRoles as string[],
    }));
    assert.strictEqual(finalStatus.status, 'ParentClicked');
    assert.deepStrictEqual(finalStatus.roles, ['Admin', 'Editor']);
  } finally {
    await browser.close();
    await close();
  }
});

test('Integration 12: W3C Native Popover Light Dismiss, Native HTML <dialog> & Geometry-based Context-Boundary Crossing', async () => {
  const { baseUrl, close } = await createMockServer();
  const { browser, page } = await createInstrumentedBrowser();

  try {
    await page.goto(`${baseUrl}/native-popover-dialog.html`, { waitUntil: 'domcontentloaded' });
    const manager = new ImplicitDismissalManager(page);

    // 1. W3C Native Popover ([popover="auto"]): mở bằng popovertarget
    await page.click('#open-pop-btn');
    const popOverlays = await manager.syncActiveOverlays();
    assert.strictEqual(popOverlays.length, 1);
    assert.strictEqual(popOverlays[0].isPopoverOpen, true);
    assert.strictEqual(popOverlays[0].kind, 'popover');

    // Kiểm tra Context-Boundary Crossing bằng tọa độ point (không truyền selector)
    const outsideBox = await page.locator('#outside-target').boundingBox();
    assert.ok(outsideBox);
    const geomCross = await detectContextBoundaryCrossing(page, {
      point: { x: outsideBox!.x + outsideBox!.width / 2, y: outsideBox!.y + outsideBox!.height / 2 },
    });
    assert.strictEqual(geomCross.crossed, true);
    assert.strictEqual(geomCross.checkMethod, 'GEOMETRY_POINT');

    // Tier 1 Escape kích hoạt W3C Light Dismiss natively
    const popDismiss = await manager.ensureDismissedBeforeAction({ selector: '#outside-target' });
    assert.strictEqual(popDismiss.dismissed, true);
    assert.strictEqual(popDismiss.tierUsed, 'TIER_1_ESCAPE');
    assert.strictEqual(popDismiss.remainingOverlays.length, 0);

    // 2. Native HTML <dialog> (showModal()): đóng an toàn qua Tier 4b Escape mà không bấm Save
    await page.click('#open-dlg-btn');
    const dlgOverlays = await manager.syncActiveOverlays();
    assert.strictEqual(dlgOverlays.length, 1);
    assert.strictEqual(dlgOverlays[0].isNativeDialog, true);
    assert.strictEqual(dlgOverlays[0].kind, 'modal');

    const dlgDismiss = await manager.ensureDismissedBeforeAction({ selector: '#outside-target' });
    assert.strictEqual(dlgDismiss.dismissed, true);
    assert.strictEqual(dlgDismiss.tierUsed, 'TIER_4B_MODAL_ESCAPE');
    assert.strictEqual(dlgDismiss.remainingOverlays.length, 0);

    const saveClicks = await page.evaluate(() => (window as any).__dlgSaveClicked as number);
    assert.strictEqual(saveClicks, 0, 'Tuyệt đối không được click nút Save trong native <dialog>');
    assert.strictEqual(manager.getDismissalHistory().length, 2);
  } finally {
    await browser.close();
    await close();
  }
});

