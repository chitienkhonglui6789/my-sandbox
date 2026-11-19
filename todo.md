# DANH SÁCH PROMPT THỰC THI (TODO.MD)
> **Tài liệu tham chiếu chuẩn:**
> - [QUY_CHUAN_AI_RESOLVER.md](file:///e:/SourceCode/autotest/QUY_CHUAN_AI_RESOLVER.md) (15 Trụ cột hành vi AI theo chuẩn Big Tech)
> - [QUY_CHUAN_DANH_GIA.md](file:///e:/SourceCode/autotest/QUY_CHUAN_DANH_GIA.md) (4-Oracle Taxonomy & Phân loại Verdict)
> - [QUY_CHUAN_KICH_BAN.md](file:///e:/SourceCode/autotest/QUY_CHUAN_KICH_BAN.md) (Đặc tả Canonical DSL & AST JSON)

---

## 📋 TỔNG QUAN LỘ TRÌNH

- [x] **Prompt 01**: Damerau-Levenshtein Distance & Antonym Barrier Table
- [x] **Prompt 02**: UI Quiescence Watcher (Network Inflight & DOM Mutation Observer)
- [x] **Prompt 03**: Kiến trúc Actor-Critic & Safety Margin ($\Delta_{\text{margin}} \ge 20\%$)
- [x] **Prompt 04**: Native Dialog Interceptor (Alert, Confirm, Prompt, BeforeUnload)
- [x] **Prompt 05**: Multi-Tab Manager & Context Switcher
- [x] **Prompt 06**: Virtualized Scroll Engine & Floating Portal Dropdown Protocol
- [x] **Prompt 07**: Post-Fill Masked Input Integrity & Deadlock Watchdog Circuit Breaker
- [x] **Prompt 08**: XAI Decision Audit Trail Logging & Cập nhật Dashboard Web UI
- [x] **Prompt 09**: Real-World Stress Benchmark Suite & Validation Toàn diện
- [x] **Prompt 10**: Root-Level Element Occlusion & Spatial Hit-Testing Engine (Trụ cột 2 & 10 Mở rộng)
- [x] **Prompt 11**: Hanging Interactive Overlays & Implicit Dismissal Protocol (Trụ cột 18)
- [x] **Prompt 12**: Nameless SVG Icon Topology & Spatial Boundary Resolution (Trụ cột 16)
- [x] **Prompt 13**: Adaptive Notification Oracle & Multi-Tier Toast Evasion (Trụ cột 17)
- [x] **Prompt 14**: Dual-Stream Multimodal Vision & Set-of-Marks Routing Pipeline (Trụ cột 3 & 6 Mở rộng)

---

## ✅ CÁC PROMPT ĐÃ HOÀN THÀNH (01 -> 14)
> Toàn bộ 14 prompt cốt lõi & mở rộng đã hoàn thành 100% (144/144 test cases PASS, 0 lỗi TypeScript):
- **Prompt 01**: Damerau-Levenshtein & Antonym Barrier (`tests/element-resolver.test.ts` - 14/14 PASS)
- **Prompt 02**: UI Quiescence Watcher & Inflight Network (`tests/quiescence-retry.test.ts` - 5/5 PASS)
- **Prompt 03**: Actor-Critic & Safety Margin $\Delta \ge 20\%$ (`tests/actor-critic-margin.test.ts` - 11/11 PASS)
- **Prompt 04**: Native Dialog Interceptor (`tests/native-dialog.test.ts` - 9/9 PASS)
- **Prompt 05**: Multi-Tab Manager & Context Switcher (`tests/multi-tab.test.ts` - 6/6 PASS)
- **Prompt 06**: Virtual Scroll & Floating Dropdown (`tests/virtual-scroll-dropdown.test.ts` - 12/12 PASS)
- **Prompt 07**: Masked Input & Deadlock Watchdog (`tests/masked-watchdog.test.ts` - 9/9 PASS)
- **Prompt 08**: XAI Audit Trail & Web UI Dashboard (`tests/xai-audit-trail.test.ts` - 5/5 PASS)
- **Prompt 09**: Real-World Stress Benchmark Suite (`tests/stress-ai-suite.test.ts` - 8/8 PASS)
- **Prompt 10**: Root-Level Element Occlusion & Spatial Hit-Testing Engine (`tests/occlusion-hit-test.test.ts` - 15/15 PASS)
- **Prompt 11**: Hanging Interactive Overlays & Implicit Dismissal Protocol (`tests/implicit-dismissal.test.ts` - 12/12 PASS)
- **Prompt 12**: Nameless SVG Icon Topology & Spatial Boundary Resolution (`tests/nameless-svg.test.ts` - 19/19 PASS)
- **Prompt 13**: Adaptive Notification Oracle & Multi-Tier Toast Evasion (`tests/notification-oracle.test.ts` - 10/10 PASS)
- **Prompt 14**: Dual-Stream Multimodal Vision & Set-of-Marks Routing Pipeline (`tests/multimodal-vision.test.ts` - 9/9 PASS)

---

## 📚 CHI TIẾT ĐẶC TẢ CÁC PROMPT MỞ RỘNG (10 -> 14 - ĐÃ HOÀN THÀNH)

---

### PROMPT 10: Root-Level Element Occlusion & Spatial Hit-Testing Engine
- **Trạng thái:** `[x] Đã hoàn thành`
- **Tập tin mục tiêu:** [src/dom-distiller.ts](file:///e:/SourceCode/autotest/src/dom-distiller.ts), [src/runner.ts](file:///e:/SourceCode/autotest/src/runner.ts), [tests/occlusion-hit-test.test.ts](file:///e:/SourceCode/autotest/tests/occlusion-hit-test.test.ts)
- **Mục tiêu:** Xóa bỏ hoàn toàn tình trạng click trượt do phần tử bị che khuất (Sticky Header/Footer, Backdrop, Overlays) mà không dùng JS synthetic click bypass; bảo đảm 100% sự kiện vật lý tin cậy (`isTrusted: true`).

```markdown
### [PROMPT 10]
Hãy nâng cấp `src/dom-distiller.ts` và `src/runner.ts` để xử lý triệt để hiện tượng Phần tử bị che khuất (Element Occlusion) theo chuẩn Playwright Actionability và Chromium Compositor Hit-Testing:

1. Safe Viewport Band Engine (Dải cuộn an toàn):
   - Tự động quét phát hiện các thanh cố định: Sticky Header (`H_top`), Sticky Footer (`H_bottom`), Floating Action Bar.
   - Thiết lập dải Viewport an toàn: `[H_top + 20px, ViewportHeight - H_bottom - 20px]`.
   - Khi cuộn đưa phần tử vào tầm nhìn, luôn căn phần tử vào chính giữa dải an toàn (`scrollIntoViewIfNeeded({ block: 'center' })`), ngăn chặn triệt để việc phần tử bị dính sát mép trên/dưới và bị header/footer nuốt mất click.

2. 5-Point Multi-Sampling Physical Hit-Tester:
   - Trước khi click, thực hiện hit-test đa điểm: Tâm $(c_x, c_y)$ và 4 góc an toàn cách mép 5px:
     - Điểm 1: Tâm $(x + w/2, y + h/2)$
     - Điểm 2: Góc trên-trái $(x + 5, y + 5)$
     - Điểm 3: Góc trên-phải $(x + w - 5, y + 5)$
     - Điểm 4: Góc dưới-trái $(x + 5, y + h - 5)$
     - Điểm 5: Góc dưới-phải $(x + w - 5, y + h - 5)$
   - Nếu tâm bị che nhưng có ít nhất 1 góc lộ diện (không bị che bởi layer khác): Tự động dịch chuyển tọa độ click vật lý vào góc hở an toàn.

3. Sutherland-Hodgman Polygon Sub-region Centroid (Trọng tâm vùng hở):
   - Khi phần tử bị che một phần bởi Banner hoặc Sticky Bar:
     - Tính toán phép trừ hình học giữa Bounding Box của mục tiêu và Bounding Box của vật cản.
     - Xác định diện tích vùng con còn lộ diện (Exposed Clickable Sub-Region).
     - Nếu diện tích lộ diện $\ge 40\%$ (đủ kích thước chạm chuẩn $24\text{px} \times 24\text{px}$), tính toán trọng tâm (Centroid) của vùng hở và điều hướng chuột click vào đó.
     - Nếu bị che hoàn toàn ($100\%$ Occluded), chuyển sang kích hoạt Thang cứu nguy dẹp vật cản (Prompt 11 & Prompt 13).

4. Viết unit & integration tests trong `tests/occlusion-hit-test.test.ts`:
   - Test phần tử nằm dưới Sticky Header được tự động cuộn vào vùng an toàn.
   - Test nút bị che 50% góc phải vẫn được click thành công tại góc trái hở.
   - Test hit-test 5 điểm bắt trúng vật cản và dịch chuyển tọa độ chính xác.
```

---

### PROMPT 11: Hanging Interactive Overlays & Implicit Dismissal Protocol (Trụ cột 18)
- **Trạng thái:** `[x] Đã hoàn thành`
- **Tập tin mục tiêu:** [src/runner.ts](file:///e:/SourceCode/autotest/src/runner.ts), [src/settlement-barrier.ts](file:///e:/SourceCode/autotest/src/settlement-barrier.ts), [tests/implicit-dismissal.test.ts](file:///e:/SourceCode/autotest/tests/implicit-dismissal.test.ts)
- **Mục tiêu:** Xóa bỏ hoàn toàn nhu cầu viết các bước thủ công "click ra ngoài khoảng trống" hoặc "click cancel trên modal". Khi người dùng chọn xong checkbox trong dropdown hoặc xem xong modal, hệ thống tự động nhận diện và dọn dẹp lớp phủ treo khi bước kế tiếp hướng tới phần tử bên ngoài.

```markdown
### [PROMPT 11]
Hãy cập nhật `src/runner.ts` và `src/settlement-barrier.ts` để hiện thực hóa Trụ cột 18 (Lớp Phủ Tương Tác Treo & Giao Thức Giải Phóng Ngầm Định - Implicit Dismissal Protocol) theo chuẩn W3C Light Dismiss API:

1. Active Overlay Stack & Context-Boundary Crossing Detection:
   - Hệ thống duy trì bộ giám sát các layer nổi đang mở: `[role="listbox"]`, `.ant-select-dropdown`, `.MuiPopover-root`, `.select__menu`, `.modal`, `[role="dialog"]`.
   - Khi bước kịch bản tiếp theo yêu cầu thao tác trên phần tử $E_{\text{next}}$ nằm ngoài subtree của overlay đang mở:
     - Nhận diện trạng thái "Vượt ranh giới ngữ cảnh" (Context-Boundary Crossing).
     - Lập tức kích hoạt quy trình giải phóng ngầm định (Implicit Dismissal) trước khi tương tác với $E_{\text{next}}$.

2. W3C Light Dismiss & Auto-Escape Keyboard Trigger (Cấp 1):
   - Tự động phát tín hiệu phím `page.keyboard.press('Escape')`.
   - Nín thở Quiescence 150ms để kiểm tra overlay có unmount hoặc ẩn đi hay không.
   - Bảo đảm 100% giá trị đã chọn trong checkbox list / multi-select dropdown không bị mất.

3. Re-Toggle Trigger & Safe Neutral Click Calculation (Cấp 2 & 3):
   - Nếu component custom không lắng nghe phím Escape:
     - Cấp 2: Click lại chính nút Trigger container ban đầu đã mở dropdown để đảo trạng thái (Toggle close).
     - Cấp 3: Tính toán tọa độ trung tính an toàn $P_{\text{neutral}}$ trên `<body>` (nằm ngoài Bounding Box của toàn bộ các phần tử tương tác, dropdown portal, sticky bar, ad banner) và dispatch click để kích hoạt hook `onClickOutside` tự nhiên.

4. Modal Safe Dismiss & Antonym Guardrail (Cấp 4):
   - Khi bị chặn bởi Modal/Dialog mà bước tiếp theo thuộc về trang cha bên dưới:
     - Tự động tìm lối thoát an toàn theo thứ tự: Nút đóng góc trên (`[aria-label="Close"]`, icon `✕`, `.close`) $\rightarrow$ Phím `Escape` $\rightarrow$ Nút từ chối an toàn (`Hủy`, `Cancel`, `Bỏ qua`, `Đóng`) $\rightarrow$ Click lớp nền mờ ngoài modal (`maskClosable: true`).
     - **Antonym Barrier Guardrail**: Nghiêm cấm tuyệt đối việc tự ý click vào các nút khẳng định (`Lưu`, `Xác nhận`, `OK`, `Submit`) để thoát modal.

5. Viết unit & integration tests trong `tests/implicit-dismissal.test.ts`:
   - Kịch bản Multi-Select Dropdown: Chọn 3 checkbox, bước tiếp theo điền Email ngay lập tức mà KHÔNG cần bước "click ra ngoài". Engine tự động gửi Escape đóng dropdown và điền Email thành công.
   - Kịch bản Modal: Mở modal xem thông tin, bước tiếp theo click nút ở trang cha. Engine tự động đóng modal an toàn.
   - Test Safe Neutral Click tính toán tọa độ trống chính xác trên trang phức tạp.
```

---

### PROMPT 12: Nameless SVG Icon Topology & Spatial Boundary Resolution (Trụ cột 16)
- **Trạng thái:** `[x] Đã hoàn thành`
- **Tập tin mục tiêu:** [src/dom-distiller.ts](file:///e:/SourceCode/autotest/src/dom-distiller.ts), [src/element-resolver.ts](file:///e:/SourceCode/autotest/src/element-resolver.ts), [tests/nameless-svg.test.ts](file:///e:/SourceCode/autotest/tests/nameless-svg.test.ts)
- **Mục tiêu:** Định danh chuẩn xác các nút Icon chỉ chứa thẻ `<svg>`, 0 innerText, 0 nhãn trợ năng (như nút thu gọn/mở sidebar, menu hamburger, icon đóng, kính lúp tìm kiếm) mà không bị điểm tương đồng văn bản = 0.

```markdown
### [PROMPT 12]
Hãy nâng cấp `src/dom-distiller.ts` và `src/element-resolver.ts` để hiện thực hóa Trụ cột 16 (Định Danh Nút Icon SVG Không Nhãn) theo chuẩn Google SVG Path Fingerprinting và Microsoft Boundary Proximity:

1. Vector Path Geometry Normalizer & Structural Signature Bank:
   - Chuẩn hóa tọa độ lệnh vẽ `d` trong thẻ `<svg>` về khung quy chuẩn $[0, 24] \times [0, 24]$ độc lập với `viewBox`.
   - Xây dựng ngân hàng chữ ký hình học vector (Structural Signature Bank) cho các họ icon phổ biến:
     - Hamburger Menu (3 vạch ngang song song: `M4 6h16`, `M4 12h16`, `M4 18h16`).
     - Chevron-Left / Chevron-Right / Fold / Collapse (mũi tên gập thu gọn/mở rộng).
     - Sidebar Layout Column Icon (khung chữ nhật chia cột trái).
     - Close (dấu nhân ✕), Search (kính lúp), Settings (bánh răng).
   - Tự động gán nhãn ngữ nghĩa ảo (`virtualLabel`) cho các phần tử khớp với ngân hàng chữ ký.

2. Spatial Boundary Proximity Topology:
   - Tính toán khoảng cách hình học giữa button SVG và đường ranh giới tiếp giáp của thanh Sidebar (`<aside>`, `nav`, `[role="navigation"]`).
   - Nếu nút nằm sát biên tiếp giáp ($\le 25\text{px}$) hoặc nằm ở góc trên-trái (`x < 80px, y < 80px`), tự động gắn thẻ ngữ cảnh `Context: "Sidebar Boundary Control"`.

3. ARIA State Dynamic Mapping:
   - Khai thác thuộc tính `aria-expanded="true/false"` và `aria-controls="sidebar-id"` để khẳng định nút có vai trò đóng/mở thanh điều hướng.

4. Synthetic Hover Tooltip Trap:
   - Nếu nút vẫn rỗng nhãn, kích hoạt hover giả lập (`mouseenter`) để đọc popup tooltip (`role="tooltip"`, `title`, `data-tooltip`, `.sr-only`) sinh ra nhãn trợ năng ngầm.

5. Công thức Chấm điểm 4 Trọng số:
   $$\text{Score}_{\text{SVG}} = 0.4 \cdot S_{\text{vector}} + 0.3 \cdot S_{\text{spatial}} + 0.2 \cdot S_{\text{aria\_state}} + 0.1 \cdot S_{\text{tooltip}}$$
   - Đạt $\text{Score} \ge 85\%$ và $\Delta_{\text{margin}} \ge 20\%$ cho phép tự động click an toàn.

6. Viết unit & integration tests trong `tests/nameless-svg.test.ts`:
   - Test nút thu gọn sidebar chỉ có SVG (0 text, 0 aria) map thành công với câu lệnh "Bấm thu gọn menu" hoặc "Đóng sidebar".
   - Test nút hamburger menu SVG map thành công với câu lệnh "Mở menu".
   - Test nút tìm kiếm SVG (kính lúp) map thành công với câu lệnh "Tìm kiếm".
```

---

### PROMPT 13: Adaptive Notification Oracle & Multi-Tier Toast Evasion (Trụ cột 17)
- **Trạng thái:** `[x] Đã hoàn thành`
- **Tập tin mục tiêu:** [src/settlement-barrier.ts](file:///e:/SourceCode/autotest/src/settlement-barrier.ts), [src/runner.ts](file:///e:/SourceCode/autotest/src/runner.ts), [tests/notification-oracle.test.ts](file:///e:/SourceCode/autotest/tests/notification-oracle.test.ts)
- **Mục tiêu:** Xóa bỏ triệt để việc bắt dính thông báo sai (False Positives trên thông báo thành công / cảnh báo lành tính) và tự động né tránh các thông báo nổi che lấp nút bấm.

```markdown
### [PROMPT 13]
Hãy cập nhật `src/settlement-barrier.ts` và `src/runner.ts` để hiện thực hóa Trụ cột 17 (Bộ Lọc Thông Báo Thích Ứng & Vượt Vật Cản Toast) theo chuẩn IEEE 29119:

1. IEEE 29119 Severity Classification Taxonomy:
   - Tự động phân cấp thông báo xuất hiện trên màn hình thành 4 mức độ:
     - `SUCCESS` (Xanh lục `#52c41a`, `.toast-success`, checkmark ✓): Khẳng định hành động trước thành công $\rightarrow$ Ghi nhận bằng chứng PASS, cấm đánh trượt.
     - `INFO` (Xanh dương `#1890ff`, `.toast-info`, mẹo/tips): Bỏ qua.
     - `WARNING` (Màu vàng `#faad14`, `.toast-warning`, khuyến cáo): Ghi log cảnh báo màu vàng, CẤM ĐÁNH TRƯỢT kịch bản.
     - `ERROR` (Màu đỏ `#ff4d4f`, `.toast-error`, HTTP 500, crash): Kích hoạt `PRODUCT_DEFECT` (trừ khi kịch bản đang test ca phủ định).

2. Expected vs Unexpected Notification Oracle:
   - Đối soát thông báo với bước kiểm thử hiện tại: Nếu kịch bản đang kiểm tra câu báo lỗi (ví dụ: `Kiểm tra chữ "Mật khẩu không đúng"`), sự xuất hiện của thông báo đỏ là ĐẠT KỲ VỌNG (`EXPECTED: PASS`).

3. 4-Tier Toast Evasion Ladder (Thang cứu nguy khi Toast che khuất nút bấm):
   - Cấp 1 (Auto-Dismiss): Tự động tìm và click nút đóng `✕` trên toast hoặc gửi phím `Escape`.
   - Cấp 2 (Spatial Evasion): Quét vùng diện tích hở $\ge 40\%$ của mục tiêu ngoài biên Toast để click lệch tâm an toàn.
   - Cấp 3 (Smart TTL Drain): Nín thở chờ thời gian sống của Toast tiêu biến tự nhiên (thường 2.0s - 3.5s) rồi thao tác trên màn hình sạch.
   - Cấp 4 (Pointer-Events Isolation): Áp dụng `pointer-events: none` tạm thời trên container toast để click xuyên thấu trong test harness.

4. Viết unit & integration tests trong `tests/notification-oracle.test.ts`:
   - Test thông báo "Cập nhật thành công" (Success) không bị báo lỗi.
   - Test cảnh báo "Mật khẩu yếu" (Warning) chỉ ghi warning log, kịch bản vẫn tiếp tục chạy.
   - Test nút Submit bị Toast nổi che mất: Hệ thống tự động đóng toast hoặc click vùng hở thành công.
```

---

### PROMPT 14: Dual-Stream Multimodal Vision & Set-of-Marks Routing Pipeline
- **Trạng thái:** `[x] Đã hoàn thành`
- **Tập tin mục tiêu:** [src/llm-bridge.ts](file:///e:/SourceCode/autotest/src/llm-bridge.ts), [src/element-resolver.ts](file:///e:/SourceCode/autotest/src/element-resolver.ts), [src/runner.ts](file:///e:/SourceCode/autotest/src/runner.ts), [tests/multimodal-vision.test.ts](file:///e:/SourceCode/autotest/tests/multimodal-vision.test.ts)
- **Mục tiêu:** Tích hợp thị giác máy tính vào xử lý các giao diện Canvas/WebGL, biểu đồ, icon phức tạp mà không tốn chi phí và không bị ảo giác lệch tọa độ pixel.

```markdown
### [PROMPT 14]
Hãy nâng cấp `src/llm-bridge.ts`, `src/element-resolver.ts` và `src/runner.ts` để hiện thực hóa Trụ cột 3 & 6 Mở rộng (Kiến trúc Thị giác Đa thể thức Dual-Stream & Kỹ thuật Set-of-Marks):

1. Set-of-Marks (SoM) Visual Indexing:
   - Chụp ảnh Viewport bằng Playwright.
   - Sử dụng canvas nội bộ để vẽ các badge số màu sắc nổi bật `[1]`, `[2]`, `[3]`... lên chính giữa Bounding Box của từng ứng viên tương tác.
   - Gửi ảnh đã gắn nhãn SoM cho Gemini Multimodal API kèm câu hỏi: "Để thực hiện hành động [Action] trên mục tiêu [TargetHint], hãy chọn ID số mấy?".
   - AI chỉ cần trả về con số ID (ví dụ: `14`), hệ thống lấy trực tiếp Bounding Box hình học gốc của ứng viên đó để click $\rightarrow$ Triệt tiêu 100% ảo giác đoán mò tọa độ pixel.

2. Tiered 3-Level Routing Pipeline (Tối ưu Chi phí & Độ trễ):
   - Cấp L1 (0ms): DOM Heuristic Fast-Path (Score $\ge 95\%$, Delta $\ge 30\%$) $\rightarrow$ Xử lý 80% trường hợp với chi phí $0, độ trễ < 2ms.
   - Cấp L2 (<5ms): Damerau-Levenshtein Typo Healing & Antonym Barrier $\rightarrow$ Xử lý 15% trường hợp với chi phí $0, độ trễ < 8ms.
   - Cấp L3 (Vision SoM Fallback): Chỉ kích hoạt khi:
     - Giao diện là thẻ `<canvas>` hoặc WebGL (0 phần tử DOM con).
     - Nút icon thuần túy không có text và L1/L2 không đạt ngưỡng tin cậy.
     - Vùng mờ tranh chấp ($\Delta_{\text{margin}} < 20\%$).
     $\rightarrow$ Chỉ chiếm 5% trường hợp, tiết kiệm 95% chi phí API và bảo toàn tốc độ chạy test suite.

3. Viết unit & integration tests trong `tests/multimodal-vision.test.ts`:
   - Test Set-of-Marks generator vẽ nhãn ID chính xác trên ảnh.
   - Test fallback kích hoạt Vision SoM khi gặp phần tử Canvas/WebGL.
   - Test định tuyến L1/L2/L3 chuyển tầng chính xác theo điều kiện ngưỡng.
```
