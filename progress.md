# TỔNG QUAN TIẾN ĐỘ DỰ ÁN (PROJECT PROGRESS & DEVELOPER HANDOVER)
*Dự án: Enterprise Zero-Selector Web AutoTest Engine*  
*Cập nhật lần cuối: 19/11/2026*

---

## 1. MỤC TIÊU & BỐI CẢNH DỰ ÁN

### 1.1. Vấn đề giải quyết
* Các công cụ tự động hóa truyền thống (Selenium, Cypress, Playwright thuần) bị **"chết dính" vào code**: Dev đổi ID, class CSS, cấu trúc DOM là test vỡ ngay lập tức.
* Đòi hỏi kỹ năng lập trình, F12 soi mã nguồn, viết selector phức tạp, khiến tester trái ngành (học vẽ, âm nhạc, kinh tế...) không thể tiếp cận.

### 1.2. Giải pháp của hệ thống này
* **Zero-Selector (Không dùng Selector cố định)**: Định vị phần tử như mắt người thật thông qua tọa độ không gian (Spatial Geometry), văn bản hiển thị (`innerText`), nhãn trợ năng (`aria-label`, `placeholder`), và độ tương đồng ngữ nghĩa tiếng Việt (Jaccard Similarity + Levenshtein).
* **Kiểm thử từng bước nghiêm ngặt (Strict Step-by-Step)**: Mỗi bước phải xác nhận hoàn thành 100% bằng chứng (Hit-testing, Action Settlement) thì mới sang bước tiếp. Lỗi ở bước nào dừng ngay tại bước đó và chụp ảnh khoanh vùng đỏ/xanh rõ ràng.
* **Giao diện 1-Click trực quan**: Web UI tại `http://localhost:5000` (khởi động bằng `GIAO_DIEN.bat`), có sẵn các mẫu test thực tế (VnExpress, Dân Trí, GearVN, GitHub, SauceDemo) kèm bằng chứng ảnh trực tiếp.

---

## 2. KIẾN TRÚC MÃ NGUỒN (CODEBASE ARCHITECTURE)

Hệ thống được tổ chức dạng module độc lập trong thư mục `src/`, đạt chuẩn TypeScript 100% (`tsc --noEmit` 0 lỗi):

```text
autotest/
├── GIAO_DIEN.bat              # Script 1-click mở Web UI http://localhost:5000
├── CHAY_TEST.bat              # Script 1-click chạy kịch bản từ kich_ban.txt
├── kich_ban.txt               # File mẫu kịch bản tiếng Việt cho tester
├── QUY_CHUAN_KICH_BAN.md      # Tài liệu đặc tả 20 hành động chuẩn hóa (Canonical DSL)
├── QUY_CHUAN_DANH_GIA.md       # Tiêu chuẩn thẩm định kết quả PASS/FAIL chuẩn Big Tech & IEEE 29119
├── QUY_CHUAN_AI_RESOLVER.md    # Tiêu chuẩn Cơ chế Ra quyết định, Xử lý Trễ Màn hình & Phòng thủ Ảo giác của AI
├── todo.md                     # Danh sách các Prompt thực thi triển khai kỹ thuật theo từng module
├── progress.md                # Tài liệu này (Bàn giao & Tiến độ kỹ thuật)
├── output/                    # Thư mục chứa trace_dataset.json và ảnh chụp kết quả
├── src/
│   ├── types.ts               # Định nghĩa kiểu dữ liệu chuẩn (ActionType, AtomicAction, DOMCandidate, StepLog...)
│   ├── dom-distiller.ts       # Bộ chưng cất DOM (Iframe, Shadow DOM, Hit-test 5 điểm, Occlusion & Nameless SVG)
│   ├── occlusion-engine.ts    # Engine xử lý che khuất gốc (Safe Viewport Band, 5-Point Hit-Test, Sutherland-Hodgman)
│   ├── implicit-dismissal.ts  # Giao thức giải phóng lớp phủ treo 4 tầng (W3C Light Dismiss, Neutral Click, Antonym Guardrail)
│   ├── svg-icon-topology.ts   # Định danh nút Icon SVG không nhãn (Path [0,24] Normalizer, Signature Bank, Boundary Proximity)
│   ├── notification-oracle.ts # Bộ lọc thông báo IEEE 29119 (4 mức độ Severity) & Thang né tránh Toast 4 tầng
│   ├── vision-som.ts          # Đường ống định tuyến thị giác Dual-Stream L1/L2/L3 & Set-of-Marks (SoM) Canvas
│   ├── settlement-barrier.ts  # Cơ chế nín thở thông minh (MutationObserver + Network idle + Implicit Dismissal + Toast Evasion)
│   ├── element-resolver.ts    # Bộ giải quyết phần tử (Heuristic Fast-Path + SVG Topology + Vision SoM L1/L2/L3 + Trace Cache)
│   ├── step-parser.ts         # Bộ phân tích ngôn ngữ tự nhiên tiếng Việt ra AtomicAction
│   ├── runner.ts              # Engine điều phối Playwright (Safe Band Click, Implicit Dismissal, Toast Oracle, Vision SoM)
│   ├── ui-server.ts           # Web Server zero-dependency phục vụ giao diện tại port 5000
│   ├── cli.ts                 # Giao diện dòng lệnh (--all, --file, --case, --url)
│   ├── demo-server.ts         # Mock Server nội bộ giả lập 4 bẫy test (Wrong pass, Disabled button, Overlays...)
│   ├── llm-bridge.ts          # Cầu nối AI 4 tầng (AGY CLI, Gemini Multimodal Vision SoM API, Ollama, N-gram)
│   └── run-100.ts             # Bộ chạy nghiệm thu hàng loạt kịch bản
```

### Bảng chức năng từng file trong `src/`:

| File | Vai trò kỹ thuật chính |
| :--- | :--- |
| **`types.ts`** | Chứa data contracts: 20 `ActionType`, `AtomicAction`, `DOMCandidate`, `StepLog`, `TestRunResult` và siêu dữ liệu Occlusion/Dismissal/SVG/Toast/SoM. |
| **`dom-distiller.ts`** | Đã nâng cấp: Quét toàn bộ DOM (iFrame, Open Shadow DOM), gắn thông tin Safe Viewport Band / 5-Point Hit-Test (`occlusion-engine.ts`) và trích xuất ứng viên Nameless SVG (`svg-icon-topology.ts`). |
| **`occlusion-engine.ts`** | Xử lý triệt để phần tử bị che khuất (Prompt 10): Safe Viewport Band `[H_top+20, VH-H_bottom-20]`, Hit-Tester 5 điểm, Sutherland-Hodgman Polygon Centroid ($\ge 40\%$, $\ge 24\times 24\text{px}$) và click vật lý `isTrusted: true`. |
| **`implicit-dismissal.ts`** | Giao thức giải phóng lớp phủ tương tác treo (Prompt 11 - Trụ cột 18): ActiveOverlayTracker, Context-Boundary Crossing, W3C Light Dismiss (`Escape`), Re-Toggle Trigger, Safe Neutral Click & Modal Tier 4 với Antonym Barrier Guardrail. |
| **`svg-icon-topology.ts`** | Định danh nút Icon SVG không nhãn (Prompt 12 - Trụ cột 16): Chuẩn hóa vector `[0,24]x[0,24]`, Structural Signature Bank, Spatial Boundary Proximity ($\le 25\text{px}$), ARIA state, Hover Tooltip Trap và công thức 4 trọng số. |
| **`notification-oracle.ts`** | Bộ lọc thông báo thích ứng & né tránh Toast (Prompt 13 - Trụ cột 17): Phân loại IEEE 29119 (`SUCCESS`/`INFO`/`WARNING`/`ERROR`), Expected vs Unexpected Oracle và thang cứu nguy Toast 4 tầng. |
| **`vision-som.ts`** | Kiến trúc Dual-Stream Vision & Set-of-Marks (Prompt 14): Vẽ badge `[1],[2]...` qua canvas cô lập không làm bẩn DOM, định tuyến L1/L2/L3 tiết kiệm 95% chi phí API và chống ảo giác tọa độ. |
| **`settlement-barrier.ts`**| Đã nâng cấp: Đợi DOM/Network tĩnh (lọc Tracker/Ads), tích hợp Implicit Dismissal Protocol (Prompt 11) và Adaptive Notification Oracle / Toast Evasion (Prompt 13). |
| **`element-resolver.ts`** | Đã nâng cấp: Kết hợp Heuristic Fast-Path, Damerau-Levenshtein, Antonym Barrier, Nameless SVG Topology (Prompt 12) và Dual-Stream Vision SoM L1/L2/L3 Routing (Prompt 14). |
| **`llm-bridge.ts`** | Đã nâng cấp: Cầu nối AI đa tầng, bổ sung `askGeminiVisionSoM` cho Gemini Multimodal API kèm chống ảo giác Mark ID và provider giả lập offline. |
| **`step-parser.ts`** | Chuyển đổi câu lệnh tiếng Việt thành các hành động nguyên tử (AtomicAction). |
| **`runner.ts`** | Đã nâng cấp: Điều phối Playwright vật lý tích hợp trọn bộ Prompt 10–14 (Safe Band Click, Implicit Dismissal trước thao tác, Adaptive Toast Oracle, Vision SoM fallback & XAI Audit). |
| **`ui-server.ts`** | HTTP Server Node.js (cổng 5000), cung cấp API `/api/run`, phục vụ file ảnh `/output/:name` và giao diện Web SPA. |

---

## 3. TÓM TẮT TIẾN ĐỘ ĐÃ HOÀN THÀNH (PROMPT 01 -> 14)
> Toàn bộ 14 Prompt cốt lõi & mở rộng đã nghiệm thu 100% (144/144 test cases PASS, 0 lỗi TypeScript):

| Hạng mục Prompt | Mô tả Kỹ thuật Triển khai | Test Suite & Kết Quả |
| :--- | :--- | :--- |
| **Prompt 01: Typo & Antonym Barrier** | Damerau-Levenshtein ($Sim \ge 0.75$) + Ma trận chặn từ đối lập (`Sign In` vs `Sign Out`) | `tests/element-resolver.test.ts` (14/14 PASS) |
| **Prompt 02: Quiescence Watcher** | Inflight network = 0 (300ms) + DOM mutation = 0 (200ms) + Spinner check + Backoff retry | `tests/quiescence-retry.test.ts` (5/5 PASS) |
| **Prompt 03: Actor-Critic & Safety Margin** | $\Delta_{\text{margin}} \ge 20\%$ & Top1 $\ge 85\%$ fast-path, Actor-Critic Veto guardrail | `tests/actor-critic-margin.test.ts` (11/11 PASS) |
| **Prompt 04: Native Dialogs** | Persistent `page.on('dialog')` (alert, confirm, prompt, beforeunload) + 0ms Fast-Path | `tests/native-dialog.test.ts` (9/9 PASS) |
| **Prompt 05: Multi-Tab Manager** | `context.on('page')` + Active page switching + Child tab lifecycle & fallback | `tests/multi-tab.test.ts` (6/6 PASS) |
| **Prompt 06: Virtual Scroll & Dropdown** | Step scroll 350px/lần + Custom portal dropdown (Antd, MUI, React-Select) | `tests/virtual-scroll-dropdown.test.ts` (12/12 PASS) |
| **Prompt 07: Masked Input & Circuit Breaker** | Post-fill integrity + Keystroke fallback (`pressSequentially`) + SHA-256 DOM hash Watchdog | `tests/masked-watchdog.test.ts` (9/9 PASS) |
| **Prompt 08: XAI Audit Trail & Dashboard** | `aiAuditTrail` trong `report.json` + Web UI modal với Bounding Box + Forensic Autopsy | `tests/xai-audit-trail.test.ts` (5/5 PASS) |
| **Prompt 09: Stress Benchmark Suite** | 6 bẫy hóc búa (Typo, Antonym, Quiescence, Mask, Dialog, Virtual List) | `tests/stress-ai-suite.test.ts` (8/8 PASS, 0% FP) |
| **Prompt 10: Element Occlusion & Hit-Testing** | Safe Viewport Band + 5-Point Hit-Tester + Sutherland-Hodgman Centroid ($\ge 40\%$, `isTrusted: true`) | `tests/occlusion-hit-test.test.ts` (15/15 PASS) |
| **Prompt 11: Implicit Dismissal Protocol** | Active Overlay Stack + Context-Boundary Crossing + 4-Tier Dismiss (W3C Escape, Re-Toggle, Neutral Click, Modal Guardrail) | `tests/implicit-dismissal.test.ts` (12/12 PASS) |
| **Prompt 12: Nameless SVG Icon Topology** | Vector `[0,24]` Normalizer + Signature Bank + Sidebar Boundary Proximity + ARIA/Tooltip 4-Weight Scoring | `tests/nameless-svg.test.ts` (19/19 PASS) |
| **Prompt 13: Adaptive Notification & Toast Evasion** | IEEE 29119 4-Severity Taxonomy + Expected/Unexpected Oracle + 4-Tier Toast Evasion Ladder | `tests/notification-oracle.test.ts` (10/10 PASS) |
| **Prompt 14: Dual-Stream Vision & Set-of-Marks** | In-memory Canvas SoM Badges (`[1]..[N]`) + Gemini Multimodal Anti-Hallucination + L1/L2/L3 Cost Routing | `tests/multimodal-vision.test.ts` (9/9 PASS) |

---

## 4. CHIẾN LƯỢC PHÁT TRIỂN TIẾP THEO (DEVELOPER HANDOVER)

### 4.1. Nhiệm vụ 1: Xây dựng Bộ Converter (Ngôn ngữ tự do ➔ Kịch bản chuẩn)
* **Mục tiêu**: Người dùng gõ văn nói, tiếng lóng, viết tắt tự do. Bộ Converter sẽ chuyển hóa thành kịch bản chuẩn đánh số `(1), (2), (3)...`.
* **Tài liệu tham chiếu**: Đọc toàn bộ đặc tả trong **[QUY_CHUAN_KICH_BAN.md](file:///e:/SourceCode/autotest/QUY_CHUAN_KICH_BAN.md)**.
* **Vị trí tích hợp**: Tích hợp vào trước khi gọi `runStrictTestScenario()` trong:
  * `src/ui-server.ts` (API `/api/run`)
  * `src/cli.ts` (Khi đọc từ `--file` hoặc `--scenario`)

### 4.2. Nhiệm vụ 2: Bổ sung bộ xử lý cho các hành động mở rộng
Trong `src/runner.ts`, hiện đã hỗ trợ: `CLICK`, `FILL`, `SEARCH`, `SELECT_ITEM`, `SCROLL`, `PRESS_KEY`, `WAIT`, `ASSERT_TEXT`, `ASSERT_URL`, `NAVIGATE_BACK`, `RELOAD`, `SWITCH_TAB`, `HANDLE_DIALOG`.
Cần bổ sung các khối lệnh Playwright cho:
1. `SELECT_OPTION`: Gọi `page.locator(sel).selectOption(value)`.
2. `CHECK` / `UNCHECK`: Gọi `page.locator(sel).check()` / `.uncheck()`.
3. `UPLOAD_FILE`: Gọi `page.locator(sel).setInputFiles(filePath)`.
4. `ASSERT_NOT_TEXT`: Kiểm tra `text` không xuất hiện trên DOM snapshot.
5. `ASSERT_DISABLED`: Kiểm tra `candidate.disabled === true`.

---

## 5. HƯỚNG DẪN KHỞI CHẠY DÀNH CHO DEVELOPER

### Cài đặt môi trường:
* Node.js v20+ trở lên.
* Trình duyệt Playwright Chromium: `npx playwright install chromium`.

### Các lệnh điều khiển thông dụng:
```bash
# 1. Bật Giao diện Web UI (Port 5000)
npm run ui

# 2. Kiểm tra lỗi kiểu dữ liệu TypeScript (Phải luôn 0 lỗi)
node node_modules/typescript/bin/tsc --noEmit

# 3. Chạy kiểm thử từ file kịch bản
npm run test:cli -- --file kich_ban.txt --url https://dantri.com.vn

# 4. Chạy toàn bộ 4 bài test bẫy nội bộ (Baseline Trap Suite)
npm run test

# 5. Chạy test trên SauceDemo (E-commerce chuẩn quốc tế)
npm run test:cli -- --case saucedemo
```

---

## 6. SỔ TAY KỸ THUẬT & CÁC MẸO FIX LỖI QUAN TRỌNG (ENGINEERING GOTCHAS & LESSONS LEARNED)
*Tổng hợp các bẫy kỹ thuật thực tế đã giải quyết dứt điểm để các phiên phát triển sau không bao giờ lặp lại:*

1. **Lỗi `ReferenceError: __name is not defined` trong `page.evaluate()` / `frame.evaluate()`**:
   - *Nguyên nhân*: `tsx/esbuild` tự động tiêm helper `__name` để giữ tên hàm khi đóng gói. Trong ngữ cảnh browser context hoặc isolated iframe, biến này không tồn tại khiến script bị crash trắng DOM.
   - *Cách xử lý dứt điểm*: Luôn tiêm `context.addInitScript(() => { (window as any).__name = (globalThis as any).__name = (fn) => fn; })` và tiêm `var __name = ...` vào mọi frame trước khi evaluate trong [src/dom-distiller.ts](file:///e:/SourceCode/autotest/src/dom-distiller.ts) và [src/runner.ts](file:///e:/SourceCode/autotest/src/runner.ts).

2. **Lỗi hộp thoại `beforeunload` không kích hoạt trong Chromium**:
   - *Nguyên nhân*: Tiêu chuẩn bảo mật HTML & Chromium chỉ kích hoạt dialog `beforeunload` khi trang có `transient user activation` (người dùng đã tương tác thật: click, gõ phím) VÀ có nguồn gốc HTTP/HTTPS hợp lệ (không kích hoạt trên `about:blank` hoặc trang tĩnh chưa tương tác).
   - *Cách xử lý dứt điểm*: Trong test giả lập, bắt buộc phải có thao tác tương tác người dùng (`page.click` / `page.fill`) và chạy qua HTTP Server thật trước khi điều hướng.

3. **Lỗi xung đột nhiều listener `page.on('dialog')` gây `Dialog is already handled`**:
   - *Nguyên nhân*: Nếu nhiều module (như `settlement-barrier` và `runner`) cùng đăng ký `page.on('dialog')` và cùng gọi `dialog.accept()`, Playwright sẽ ném ngoại lệ `Error: Cannot accept dialog which is already handled`.
   - *Cách xử lý dứt điểm*: Tập trung toàn bộ quyền xử lý dialog vào một module duy nhất `NativeDialogInterceptor`. Trong [src/settlement-barrier.ts](file:///e:/SourceCode/autotest/src/settlement-barrier.ts), kiểm tra nếu đã có `__nativeDialogInterceptor` thì lập tức nhường quyền, không can thiệp.

4. **Tối ưu hóa thời gian chạy `ASSERT_TEXT` đối với hộp thoại Native (0ms Fast-Path)**:
   - *Nguyên nhân*: Chữ trong `alert()`, `confirm()`, `prompt()` là Native OS UI, hoàn toàn không nằm trong cây DOM (`document.body.innerText`). Nếu gọi `barrier.verifyExpectedText` trước, hệ thống sẽ polling cây DOM liên tục 16 giây gây lag nghiêm trọng.
   - *Cách xử lý dứt điểm*: Luôn kiểm tra nhanh trong `dialogInterceptor.findDialog(...)` trước (0ms). Nếu có thông điệp khớp thì xác nhận PASS ngay lập tức mà không phải chờ đợi timeout DOM.

5. **Quy tắc chạy test nhanh khi phát triển (Tránh nghẽn hàng đợi)**:
   - Chỉ chạy bài test unit tương ứng với prompt đang làm (ví dụ: `npm run test:dialog`). Tuyệt đối không chạy lệnh `npm run test` (`--all`) trong các bước trung gian vì lệnh này khởi động toàn bộ suite và gọi API Gemini bên ngoài gây tốn 40 - 60s không cần thiết.

6. **Race condition giữa hành động Click mở Tab mới và sự kiện `context.on('page')`**:
   - *Nguyên nhân*: Khi click link `<a target="_blank">` hoặc nút gọi `window.open()`, sự kiện `context.on('page')` được gửi qua IPC bất đồng bộ giữa Playwright và Chromium. Nếu runner lập tức kiểm tra danh sách `pendingTransitions` ngay tại thời điểm thao tác click vừa xong (0ms delay), event loop chưa kịp phân phối sự kiện, dẫn đến mảng transition rỗng và runner tưởng không có tab mới nên bỏ qua việc chờ, gây sai lệch `activePage`.
   - *Cách xử lý dứt điểm*: Trong `waitForPendingTransitions()`, luôn chèn một khoảng nghỉ ngắn (150ms - 200ms) trước khi kiểm tra độ dài `pendingTransitions` để Node.js I/O loop đón trọn vẹn event `page`. Đồng thời cung cấp phương thức `waitForPageCount(expectedCount, timeoutMs)` để đảm bảo chắc chắn số tab đã tăng lên trước khi bước kế tiếp bắt đầu.

7. **Bẫy tham chiếu trang đã đóng (Dangling Page Pointer) khi Tab con tự đóng**:
   - *Nguyên nhân*: Trong luồng thực tế (e.g. cổng thanh toán, popup OAuth, hoặc web gọi `window.close()`), tab con có thể đóng bất cứ lúc nào. Nếu runner tiếp tục giữ tham chiếu đến instance `page` cũ, Playwright sẽ ném ngoại lệ nghiêm trọng: `Error: Target page, context or browser has been closed`.
   - *Cách xử lý dứt điểm*: Luôn lắng nghe `newPage.on('close')` ngay khi tab mới xuất hiện. Khi tab active bị đóng, tự động chuyển `activePage` về `parentPage` (hoặc tab mở gần nhất). Ngoài ra, trong phương thức `getActivePage()`, luôn có lớp bảo vệ `if (this.activePage.isClosed())` để tự động fallback về tab còn sống, không bao giờ để lộ con trỏ rác.

8. **Đồng bộ hóa Barrier và Dialog Interceptor xuyên suốt Multi-Tab**:
   - *Nguyên nhân*: Mỗi tab trình duyệt sở hữu DOM Tree, Network Request Stack và Dialog Event hoàn toàn cô lập. Nếu chỉ tiêm `NativeDialogInterceptor` và `ActionSettlementBarrier` trên tab ban đầu, các alert xuất hiện trên tab con sẽ bị bỏ sót, khiến trình duyệt bị treo cứng vĩnh viễn (hang execution loop).
   - *Cách xử lý dứt điểm*: Trong listener `context.on('page')`, ngay khi tab con được khởi tạo, tự động tiêm `attachDialogInterceptor(newPage)` và `getOrCreateBarrier(newPage)`. Đồng thời cung cấp API `tabManager.getAllCapturedDialogs()` gom toàn bộ dialogs của mọi tab theo thứ tự thời gian (`timestamp`), giúp Fast-Path `ASSERT_TEXT` đối soát chính xác thông điệp dù nó xuất hiện ở tab nào.

9. **Thứ tự ưu tiên trong `FLOATING_PORTAL_SELECTORS` và hiện tượng Overlap Selector**:
   - *Nguyên nhân*: Các framework như Ant Design (`.ant-select-dropdown`), Material-UI (`.MuiAutocomplete-popper`) thường đồng thời gắn thuộc tính `role="listbox"` vào container portal của chúng. Nếu selector `body > [role="listbox"]` được kiểm tra trước, kết quả trả về `matchedPortalSelector` sẽ là `body > [role="listbox"]` thay vì `.ant-select-dropdown` hay `.MuiAutocomplete-popper`.
   - *Cách xử lý dứt điểm*: Khi kiểm tra selector portal hoặc viết assertion đối soát, luôn cho phép khớp linh hoạt giữa selector ngữ nghĩa ARIA chuẩn (`[role="listbox"]`) và class đặc thù của framework (`ant-select-dropdown` / `MuiAutocomplete-popper`).

10. **Bẫy Event Loop bị treo do HTTP Mock Server không được đóng khi Assertion thất bại trong Unit Test**:
    - *Nguyên nhân*: Trong các bài test tạo mock HTTP server (`http.createServer().listen(0)`), nếu đặt `server.close()` và `browser.close()` ở cuối hàm test mà không bọc trong `try ... finally`, bất kỳ assertion nào ném lỗi (`AssertionError`) sẽ làm ngắt luồng trước khi gọi `server.close()`. Node.js event loop tiếp tục giữ cổng socket mở vô thời hạn, khiến tiến trình test bị treo cứng và không bao giờ thoát (hanging process).
    - *Cách xử lý dứt điểm*: Luôn bọc toàn bộ mã test sử dụng mock HTTP server trong khối `try { ... } finally { await browser.close(); await close(); }` để đảm bảo tài nguyên mạng luôn được giải phóng 100% trong mọi tình huống.

11. **Bẫy Container Cuộn Ảo (Scrollable Container) thay vì cuộn cửa sổ Window**:
    - *Nguyên nhân*: Trong các component bảng ảo hóa (Virtual Table, React-Window) hoặc dropdown danh sách dài, thanh cuộn nằm trên phần tử cha (`div` có CSS `overflow-y: auto / scroll`) chứ không phải trên `window`. Nếu chỉ gọi `window.scrollBy(0, 350)`, container ảo bên trong hoàn toàn không xê dịch và các node mới không bao giờ được mount vào DOM.
    - *Cách xử lý dứt điểm*: Trong `executeVirtualListScrollSearch()`, phát hiện thông minh các container có `overflow-y: scroll / auto` và `scrollHeight > clientHeight` nằm trong tầm nhìn, đồng thời kích hoạt `container.scrollBy({ top: px })` song song với `window.scrollBy({ top: px })`.

---
*Tài liệu này được duy trì liên tục để phục vụ chuyển giao công việc giữa các kỹ sư phát triển.*
