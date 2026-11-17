import * as http from 'http';

/**
 * Trang E-commerce thực tế thu nhỏ (Real-Trap Vietnamese E-commerce SPA)
 * Được thiết kế chứa đầy đủ các "bẫy giao diện thực tế" đã làm gãy Browser Use / Stagehand:
 * 1. Có 2 form Đăng nhập trùng tên trong DOM (1 bản Mobile ẩn + 1 bản Desktop hiển thị).
 * 2. Các ô Input không dùng <label for> hay placeholder mà đặt chữ ở thẻ <div> bên cạnh (Spatial Label).
 * 3. Nút chọn màu ("Trắng", "Đen") là thẻ <div> thuần túy bắt sự kiện qua Event Delegation ở #app.
 * 4. Chữ "Xin chào, khach01" bị tách làm 2 thẻ <span>Xin chào, </span><strong>khach01</strong>.
 * 5. Mọi thao tác (Đăng nhập, Tìm kiếm, Đặt hàng) đều gọi fetch() bất đồng bộ trễ 450ms kèm vòng xoay .spinner.
 * 6. Hỗ trợ tham số ?trap=disabled_cart để giả lập tình huống màu "Đen" hết hàng làm khóa nút "Thêm vào giỏ" (test FAILED ở bước 8).
 */
export function startRealTrapEcommerceServer(port = 3456): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);

      // Các API bất đồng bộ có độ trễ thực tế (400ms)
      if (url.pathname.startsWith('/api/')) {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            if (url.pathname === '/api/login') {
              const data = JSON.parse(body || '{}');
              if (data.username === 'khach01' && data.password === '123456') {
                res.end(JSON.stringify({ ok: true, user: 'khach01' }));
              } else {
                res.end(
                  JSON.stringify({
                    ok: false,
                    error: 'Tài khoản hoặc mật khẩu không chính xác!',
                  })
                );
              }
              return;
            }
            if (url.pathname === '/api/search') {
              res.end(
                JSON.stringify({
                  ok: true,
                  items: [
                    {
                      id: 'kb-01',
                      name: 'Bàn phím cơ Keychron K8 Pro Wireless RGB',
                      price: '2.190.000đ',
                    },
                    {
                      id: 'kb-02',
                      name: 'Bàn phím cơ Akko 3098B Multi-modes',
                      price: '1.850.000đ',
                    },
                  ],
                })
              );
              return;
            }
            if (url.pathname === '/api/order') {
              res.end(
                JSON.stringify({
                  ok: true,
                  orderId: 'DH-88921',
                  message: 'Đặt hàng thành công',
                })
              );
              return;
            }
            res.end(JSON.stringify({ ok: true }));
          }, 400);
        });
        return;
      }

      // Trả về giao diện SPA
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getSpaHtml());
    });

    server.listen(port, () => resolve(server));
  });
}

function getSpaHtml(): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <title>GearVN Demo Store - Kiểm thử Tự động</title>
  <style>
    * { box-sizing: border-box; font-family: 'Segoe UI', system-ui, sans-serif; }
    body { margin: 0; background: #f3f4f6; color: #111827; }
    header {
      position: sticky; top: 0; z-index: 100;
      background: #1e293b; color: #fff; padding: 14px 28px;
      display: flex; align-items: center; justify-content: space-between;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }
    .brand { font-size: 20px; font-weight: 800; color: #38bdf8; }
    .header-right { display: flex; align-items: center; gap: 20px; }
    .cart-trigger {
      background: #334155; padding: 8px 16px; border-radius: 6px;
      cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 8px;
    }
    .badge { background: #ef4444; color: white; padding: 2px 8px; border-radius: 99px; font-size: 12px; }
    .container { max-width: 960px; margin: 32px auto; padding: 0 20px; }
    .card-box { background: #fff; border-radius: 12px; padding: 28px; box-shadow: 0 4px 14px rgba(0,0,0,0.06); }
    .form-row { margin-bottom: 16px; }
    .spatial-label { font-size: 14px; font-weight: 600; margin-bottom: 6px; color: #374151; }
    .jsx-input {
      width: 100%; padding: 10px 14px; border: 1px solid #d1d5db;
      border-radius: 8px; font-size: 15px;
    }
    .custom-btn {
      display: inline-block; background: #2563eb; color: #fff;
      padding: 11px 22px; border-radius: 8px; font-weight: 700;
      cursor: pointer; text-align: center; border: none; font-size: 15px;
      user-select: none;
    }
    .custom-btn.disabled {
      background: #9ca3af !important; color: #e5e7eb !important;
      cursor: not-allowed !important; pointer-events: none;
    }
    .search-bar { display: flex; gap: 10px; margin-bottom: 24px; }
    .product-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
    .product-card {
      border: 1px solid #e5e7eb; border-radius: 10px; padding: 18px;
      background: #fff; transition: transform 0.15s;
    }
    .product-card .card-title {
      font-size: 17px; font-weight: 700; color: #1d4ed8; cursor: pointer; margin-bottom: 8px;
    }
    .swatch-list { display: flex; gap: 12px; margin: 12px 0 20px 0; }
    .swatch-option {
      padding: 8px 18px; border: 2px solid #cbd5e1; border-radius: 8px;
      cursor: pointer; font-weight: 600;
    }
    .swatch-option.selected { border-color: #2563eb; background: #eff6ff; color: #1d4ed8; }
    .spinner {
      position: fixed; inset: 0; background: rgba(255,255,255,0.65);
      display: none; align-items: center; justify-content: center;
      z-index: 9999; font-weight: 700; font-size: 18px; color: #1d4ed8;
    }
    .error-message {
      background: #fef2f2; border: 1px solid #f87171; color: #b91c1c;
      padding: 10px 14px; border-radius: 8px; margin-bottom: 14px; font-weight: 600;
    }
    .toast-success {
      position: fixed; bottom: 24px; right: 24px;
      background: #059669; color: #fff; padding: 14px 22px;
      border-radius: 10px; font-weight: 700; font-size: 16px;
      box-shadow: 0 8px 20px rgba(0,0,0,0.2); z-index: 5000;
    }
  </style>
</head>
<body>
  <!-- BẪY DOM 1: Form Mobile ẩn có cùng chữ "Tài khoản", "Mật khẩu", "Đăng nhập" -->
  <div id="mobile-hidden-trap" style="display: none;">
    <input placeholder="Tài khoản" value="" />
    <input type="password" placeholder="Mật khẩu" value="" />
    <button>Đăng nhập</button>
  </div>

  <div id="global-spinner" class="spinner">Đang xử lý dữ liệu...</div>

  <header>
    <div class="brand">GEARVN AUTOTEST</div>
    <div class="header-right">
      <div id="user-greeting">Chưa đăng nhập</div>
      <div class="cart-trigger" data-action="open-cart">
        <span>Giỏ hàng</span>
        <span class="badge" id="cart-count">0</span>
      </div>
    </div>
  </header>

  <div class="container" id="app"></div>

  <script>
    const params = new URLSearchParams(window.location.search);
    const trapMode = params.get('trap'); // 'disabled_cart'

    const state = {
      view: 'login',
      user: null,
      loginError: '',
      products: [],
      selectedProduct: null,
      selectedColor: null,
      cart: [],
      orderSuccess: false,
    };

    const spinner = document.getElementById('global-spinner');
    function setLoading(flag) {
      spinner.style.display = flag ? 'flex' : 'none';
    }

    function showToast(msg) {
      const t = document.createElement('div');
      t.className = 'toast-success';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 3500);
    }

    function render() {
      const app = document.getElementById('app');
      const greeting = document.getElementById('user-greeting');
      const cartCount = document.getElementById('cart-count');
      cartCount.textContent = String(state.cart.length);

      // BẪY DOM 2: Chữ "Xin chào, khach01" bị tách làm 2 thẻ <span> và <strong>
      if (state.user) {
        greeting.innerHTML = '<span>Xin chào, </span><strong>' + state.user + '</strong>';
      } else {
        greeting.textContent = 'Chưa đăng nhập';
      }

      if (state.view === 'login') {
        // BẪY DOM 3: Ô input không có placeholder/name chuẩn, chỉ có Spatial Label ở thẻ div phía trên
        app.innerHTML = \`
          <div class="card-box" style="max-width: 440px; margin: 0 auto;">
            <h2 style="margin-top:0">Đăng nhập hệ thống</h2>
            \${state.loginError ? '<div class="error-message">' + state.loginError + '</div>' : ''}
            <div class="form-row">
              <div class="spatial-label">Tài khoản</div>
              <input id="inp-u" class="jsx-input" type="text" autocomplete="off" />
            </div>
            <div class="form-row">
              <div class="spatial-label">Mật khẩu</div>
              <input id="inp-p" class="jsx-input" type="password" autocomplete="off" />
            </div>
            <div class="custom-btn" data-action="submit-login" style="width:100%">Đăng nhập</div>
          </div>
        \`;
        return;
      }

      if (state.view === 'catalog') {
        const listHtml = state.products.map((p, idx) => \`
          <div class="product-card" data-idx="\${idx}">
            <div class="card-title" data-action="select-product" data-id="\${p.id}">\${p.name}</div>
            <div style="color:#dc2626; font-weight:700; font-size:16px;">\${p.price}</div>
            <div style="color:#6b7280; font-size:13px; margin-top:6px;">Hàng chính hãng - Bảo hành 24 tháng</div>
          </div>
        \`).join('');

        app.innerHTML = \`
          <div class="card-box">
            <div class="search-bar">
              <input id="inp-search" class="jsx-input" type="text" placeholder="Tìm kiếm sản phẩm..." />
              <button class="custom-btn" data-action="do-search">Tìm kiếm</button>
            </div>
            <div class="product-grid">
              \${listHtml || '<div style="color:#6b7280">Hãy nhập từ khóa để tìm kiếm sản phẩm.</div>'}
            </div>
          </div>
        \`;
        return;
      }

      if (state.view === 'detail' && state.selectedProduct) {
        const isDisabledTrap = trapMode === 'disabled_cart' && state.selectedColor === 'Đen';
        app.innerHTML = \`
          <div class="card-box">
            <h2 style="margin-top:0">\${state.selectedProduct.name}</h2>
            <p style="font-size:20px; color:#dc2626; font-weight:800">\${state.selectedProduct.price}</p>
            <div>
              <div class="group-label" style="font-weight:700; margin-bottom:8px;">Màu sắc</div>
              <!-- BẪY DOM 4: Nút chọn màu là thẻ <div> thuần túy không có role="button" -->
              <div class="swatch-list">
                <div class="swatch-option \${state.selectedColor === 'Trắng' ? 'selected' : ''}" data-action="pick-color" data-color="Trắng">Trắng</div>
                <div class="swatch-option \${state.selectedColor === 'Đen' ? 'selected' : ''}" data-action="pick-color" data-color="Đen">Đen</div>
                <div class="swatch-option \${state.selectedColor === 'Đỏ' ? 'selected' : ''}" data-action="pick-color" data-color="Đỏ">Đỏ</div>
              </div>
            </div>
            \${isDisabledTrap ? '<div class="error-message">Phiên bản màu Đen hiện đang tạm hết hàng!</div>' : ''}
            <button
              class="custom-btn \${isDisabledTrap ? 'disabled' : ''}"
              \${isDisabledTrap ? 'disabled aria-disabled="true"' : ''}
              data-action="add-to-cart"
            >Thêm vào giỏ</button>
          </div>
        \`;
        return;
      }

      if (state.view === 'cart') {
        app.innerHTML = \`
          <div class="card-box">
            <h2 style="margin-top:0">Giỏ hàng của bạn</h2>
            \${state.cart.map(item => \`
              <div style="padding:12px 0; border-bottom:1px solid #e5e7eb; display:flex; justify-content:space-between;">
                <div><strong>\${item.name}</strong> - Màu: <span style="color:#2563eb; font-weight:700">\${item.color}</span></div>
                <div style="font-weight:700; color:#dc2626">\${item.price}</div>
              </div>
            \`).join('')}
            <div style="margin-top:20px; text-align:right;">
              <button class="custom-btn" data-action="go-checkout">Mua hàng</button>
            </div>
          </div>
        \`;
        return;
      }

      if (state.view === 'checkout') {
        app.innerHTML = \`
          <div class="card-box" style="max-width:540px; margin:0 auto;">
            <h2 style="margin-top:0">Thông tin giao hàng</h2>
            <div class="form-row">
              <div class="spatial-label">SĐT người nhận</div>
              <input id="inp-phone" class="jsx-input" type="text" />
            </div>
            <div class="form-row">
              <div class="spatial-label">Địa chỉ nhận hàng</div>
              <input id="inp-addr" class="jsx-input" type="text" />
            </div>
            <button class="custom-btn" data-action="place-order" style="width:100%">Đặt hàng</button>
          </div>
        \`;
        return;
      }

      if (state.view === 'order-done') {
        app.innerHTML = \`
          <div class="card-box" style="text-align:center; padding:40px;">
            <h2 style="color:#059669; font-size:26px;">Đặt hàng thành công</h2>
            <p>Cảm ơn <strong>\${state.user}</strong>! Đơn hàng #DH-88921 đang được chuẩn bị giao tới <strong>\${state.orderAddr}</strong> (SĐT: <strong>\${state.orderPhone}</strong>).</p>
          </div>
        \`;
        return;
      }
    }

    // Event Delegation trên toàn trang (giống cách React/Vue gắn listener ở root)
    document.body.addEventListener('click', async (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.getAttribute('data-action');

      if (action === 'submit-login') {
        const u = document.getElementById('inp-u').value.trim();
        const p = document.getElementById('inp-p').value.trim();
        setLoading(true);
        const res = await fetch('/api/login', {
          method: 'POST',
          body: JSON.stringify({ username: u, password: p }),
        }).then(r => r.json());
        setLoading(false);

        if (res.ok) {
          state.user = res.user;
          state.loginError = '';
          state.view = 'catalog';
          render();
        } else {
          state.loginError = res.error;
          render();
        }
      }

      if (action === 'do-search') {
        const q = document.getElementById('inp-search').value.trim();
        setLoading(true);
        const res = await fetch('/api/search?q=' + encodeURIComponent(q)).then(r => r.json());
        setLoading(false);
        state.products = res.items;
        render();
      }

      if (action === 'select-product') {
        const id = target.getAttribute('data-id');
        state.selectedProduct = state.products.find(x => x.id === id) || state.products[0];
        state.selectedColor = 'Trắng';
        state.view = 'detail';
        render();
      }

      if (action === 'pick-color') {
        state.selectedColor = target.getAttribute('data-color');
        render();
      }

      if (action === 'add-to-cart') {
        if (target.disabled || target.classList.contains('disabled')) return;
        state.cart.push({
          ...state.selectedProduct,
          color: state.selectedColor || 'Đen',
        });
        showToast('Đã thêm sản phẩm vào giỏ hàng!');
        render();
      }

      if (action === 'open-cart') {
        state.view = 'cart';
        render();
      }

      if (action === 'go-checkout') {
        state.view = 'checkout';
        render();
      }

      if (action === 'place-order') {
        const phone = document.getElementById('inp-phone').value.trim();
        const addr = document.getElementById('inp-addr').value.trim();
        setLoading(true);
        const res = await fetch('/api/order', {
          method: 'POST',
          body: JSON.stringify({ phone, addr }),
        }).then(r => r.json());
        setLoading(false);
        if (res.ok) {
          state.orderPhone = phone;
          state.orderAddr = addr;
          state.view = 'order-done';
          showToast('Đặt hàng thành công');
          render();
        }
      }
    });

    // Hỗ trợ nhấn phím Enter trong ô tìm kiếm
    document.body.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && e.target && e.target.id === 'inp-search') {
        const q = e.target.value.trim();
        setLoading(true);
        const res = await fetch('/api/search?q=' + encodeURIComponent(q)).then(r => r.json());
        setLoading(false);
        state.products = res.items;
        render();
      }
    });

    render();
  </script>
</body>
</html>`;
}
