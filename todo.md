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
- [ ] **Prompt 05**: Multi-Tab Manager & Context Switcher
- [ ] **Prompt 06**: Virtualized Scroll Engine & Floating Portal Dropdown Protocol
- [ ] **Prompt 07**: Post-Fill Masked Input Integrity & Deadlock Watchdog Circuit Breaker
- [ ] **Prompt 08**: XAI Decision Audit Trail Logging & Cập nhật Dashboard Web UI
- [ ] **Prompt 09**: Real-World Stress Benchmark Suite & Validation Toàn diện

---

## 🚀 CHI TIẾT TỪNG PROMPT THỰC THI

### PROMPT 01: Damerau-Levenshtein Distance & Antonym Barrier Table
- **Trạng thái:** `[x] Đã hoàn thành (14/14 Unit Tests Passed)`
- **Tập tin mục tiêu:** [src/element-resolver.ts](file:///e:/SourceCode/autotest/src/element-resolver.ts), [tests/element-resolver.test.ts](file:///e:/SourceCode/autotest/tests/element-resolver.test.ts)
- **Mục tiêu:** Xử lý lỗi gõ sai ký tự (typo/transposition) và chặn tuyệt đối click nhầm các nút có ngữ nghĩa đối lập nguy hiểm.

```markdown
### [PROMPT 01]
Hãy cập nhật file `src/element-resolver.ts` để hiện thực hóa Trụ cột 4 (Fuzzy Intent & Damerau-Levenshtein) và Trụ cột 5 (Antonym Barrier) theo đúng tài liệu QUY_CHUAN_AI_RESOLVER.md:

1. Triển khai thuật toán Damerau-Levenshtein distance (hỗ trợ xóa, chèn, thay thế và hoán vị 2 ký tự liền kề như "ni" <-> "in"):
   - Tính toán khoảng cách chuẩn hóa: Sim = 1 - (distance / max(len(s1), len(s2))).
   - Cho phép tự phục hồi (Self-Healing) khi Sim >= 0.75 (hoặc distance <= 2 với từ ngắn).

2. Xây dựng bảng từ khóa đối lập (Antonym Barrier Matrix):
   - Các cặp từ đối lập nghiêm ngặt: 
     - ("sign in", "sign out"), ("login", "logout"), ("log in", "log out")
     - ("delete", "save"), ("remove", "add"), ("cancel", "confirm")
     - ("accept", "reject"), ("enable", "disable"), ("agree", "decline")
   - Bất kể điểm Levenshtein hay Embedding cao đến đâu, nếu Target Text và Candidate thuộc hai cực đối lập của ma trận thì lập tức bị loại bỏ (Score = 0) và gắn cờ vi phạm ANTYNOM_VIOLATION.

3. Viết unit test kiểm chứng:
   - "sign ni" phải map thành công vào "Sign In" (distance = 1, transposition).
   - "Sign In" tuyệt đối không được map vào "Sign Out".
   - "delte" phải map thành công vào "Delete".
   - "submti" phải map thành công vào "Submit".
```

---

### PROMPT 02: UI Quiescence Watcher (Network Inflight & DOM Mutation)
- **Trạng thái:** `[x] Đã hoàn thành (5/5 Unit Tests Passed)`
- **Tập tin mục tiêu:** [src/runner.ts](file:///e:/SourceCode/autotest/src/runner.ts), [src/settlement-barrier.ts](file:///e:/SourceCode/autotest/src/settlement-barrier.ts), [tests/quiescence-retry.test.ts](file:///e:/SourceCode/autotest/tests/quiescence-retry.test.ts)
- **Mục tiêu:** Chấm dứt tình trạng click trượt do mạng lag, SPA rendering chậm, hoặc hiệu ứng animation chưa kết thúc.

```markdown
### [PROMPT 02]
Hãy cập nhật `src/runner.ts` để hiện thực hóa Trụ cột 1 (Quiescence & Network Inflight) và Trụ cột 2 (Auto-Wait & Dynamic Retry Loop) theo QUY_CHUAN_AI_RESOLVER.md:

1. Triển khai hàm `waitForUIQuiescence(page, timeoutMs = 7000)` thay thế toàn bộ các lệnh `waitForTimeout` tĩnh:
   - Theo dõi số lượng request mạng đang bay (Inflight Network Requests): Đợi cho đến khi Inflight = 0 duy trì liên tục trong tối thiểu 300ms.
   - Lắng nghe DOM Mutation: Đảm bảo không có node nào được thêm/xóa/sửa thuộc tính trong 200ms cuối.
   - Kiểm tra Spinner/Skeleton: Đợi các selector phổ biến (`[aria-busy="true"]`, `.spinner`, `.loading`, `.skeleton`, `[data-loading]`) biến mất khỏi DOM hoặc ẩn đi (`display: none` / `visibility: hidden`).

2. Vòng lặp Exponential Backoff Retry:
   - Khi tìm kiếm element hoặc thực hiện hành động thất bại, không fail ngay mà thử lại tối đa 3 lần với khoảng chờ tăng dần: 500ms -> 1500ms -> 3000ms.
   - Mỗi lần retry phải kích hoạt lại `waitForUIQuiescence`.
```

---

### PROMPT 03: Kiến trúc Actor-Critic & Safety Margin ($\Delta_{\text{margin}} \ge 20\%$)
- **Trạng thái:** `[x] Đã hoàn thành (11/11 Unit Tests Passed)`
- **Tập tin mục tiêu:** [src/llm-bridge.ts](file:///e:/SourceCode/autotest/src/llm-bridge.ts), [src/element-resolver.ts](file:///e:/SourceCode/autotest/src/element-resolver.ts), [tests/actor-critic-margin.test.ts](file:///e:/SourceCode/autotest/tests/actor-critic-margin.test.ts)
- **Mục tiêu:** Chống ảo giác (hallucination), kiểm duyệt chéo trước khi thực thi hành động nhấp chuột.

```markdown
### [PROMPT 03]
Hãy nâng cấp `src/llm-bridge.ts` và `src/element-resolver.ts` để hiện thực hóa Trụ cột 6 (Kiến trúc Actor-Critic) và Trụ cột 3 (Safety Margin) theo QUY_CHUAN_AI_RESOLVER.md:

1. Cơ chế Safety Margin (Delta Margin):
   - Khi lọc danh sách ứng viên (candidates), tính toán: Delta = Top1_Score - Top2_Score.
   - Nếu Delta < 0.20 (20%) hoặc Top1_Score < 0.85: Hệ thống đánh dấu trạng thái "AMBIGUOUS" và kích hoạt quy trình đa thể thức (Multimodal Resolution kèm ảnh chụp).

2. Pipeline Actor-Critic:
   - Bước 1 (Actor): LLM phân tích DOM + Screenshot để đề xuất phần tử mục tiêu (Selector / Index / Bounding Box) kèm lý do (Reasoning) và điểm tự tin (Confidence).
   - Bước 2 (Critic): Trước khi Runner click, hệ thống gửi lại vị trí đề xuất cho Critic Model (hoặc Critic Prompt) với câu hỏi: "Dựa trên kịch bản yêu cầu hành động [Action] trên [TargetHint], nút được chọn tại tọa độ này có chính xác là mục tiêu không? Có nguy cơ click nhầm nút đối lập hoặc sai ngữ cảnh không?".
   - Nếu Critic = REJECTED -> Hủy hành động, ghi nhận cảnh báo AMBIGUOUS_TARGET.
```

---

### PROMPT 04: Native Dialog Interceptor (Alert, Confirm, Prompt, BeforeUnload)
- **Trạng thái:** `[x] Đã hoàn thành (9/9 Unit Tests Passed)`
- **Tập tin mục tiêu:** [src/runner.ts](file:///e:/SourceCode/autotest/src/runner.ts), [tests/native-dialog.test.ts](file:///e:/SourceCode/autotest/tests/native-dialog.test.ts)
- **Mục tiêu:** Ngăn chặn tình trạng kịch bản bị treo cứng vô thời hạn khi trình duyệt bật cửa sổ hộp thoại hệ điều hành.

```markdown
### [PROMPT 04]
Hãy cập nhật `src/runner.ts` để hiện thực hóa Trụ cột 7 (Xử lý Native Browser Dialogs) theo QUY_CHUAN_AI_RESOLVER.md:

1. Thiết lập lắng nghe toàn cục `page.on('dialog', async dialog => ...)` ngay khi khởi tạo trang:
   - Tự động ghi lại loại dialog (`alert`, `confirm`, `prompt`, `beforeunload`), nội dung thông điệp (`dialog.message()`), và giá trị mặc định.
   - Chiến lược giải phóng:
     - `alert`: Tự động gọi `dialog.accept()` và lưu nội dung vào log execution.
     - `confirm`: Nếu bước kịch bản tiếp theo mang tính khẳng định (ví dụ: "Xác nhận", "Đồng ý", "OK") -> `dialog.accept()`; nếu là "Hủy" hoặc không nhắc tới -> gọi `dialog.accept()` mặc định để giải phóng luồng, đồng thời đính kèm cảnh báo vào báo cáo.
     - `prompt`: Tự động điền giá trị từ kịch bản hoặc chuỗi rỗng rồi `accept()`.
     - `beforeunload`: Tự động `dialog.accept()` để không cản trở quá trình điều hướng trang.

2. Cung cấp API truy xuất lịch sử dialog đã bắt được trong phiên test để phục vụ kiểm tra Assertion (ví dụ: kiểm tra alert hiển thị đúng câu thông báo).
```

---

### PROMPT 05: Multi-Tab Manager & Context Switcher
- **Trạng thái:** `[ ] Chưa thực hiện`
- **Tập tin mục tiêu:** [src/runner.ts](file:///e:/SourceCode/autotest/src/runner.ts)
- **Mục tiêu:** Tự động điều hướng và đồng bộ hóa ngữ cảnh khi click link mở tab mới (`target="_blank"`) hoặc popup đăng nhập SSO.

```markdown
### [PROMPT 05]
Hãy cập nhật `src/runner.ts` để hiện thực hóa Trụ cột 8 (Điều phối Multi-Tab & Multi-Window) theo QUY_CHUAN_AI_RESOLVER.md:

1. Lắng nghe sự kiện tab mới ở cấp độ Browser Context:
   - `context.on('page', async newPage => ...)`: Khi một tab hoặc cửa sổ mới xuất hiện (do click link có `target="_blank"`, `window.open`, hoặc popup OAuth/Payment):
     - Tự động đợi tab mới sẵn sàng (`newPage.waitForLoadState('domcontentloaded')`).
     - Tự động chuyển con trỏ hoạt động chính (`activePage`) sang tab mới.
     - Đưa thông báo vào log: `[TAB SWITCH] Chuyển ngữ cảnh sang Tab mới: ${await newPage.title()} (${newPage.url()})`.

2. Quản lý vòng đời tab:
   - Cho phép runner đóng tab con và quay về tab gốc (`parentPage`) khi luồng phụ kết thúc.
   - Bảo đảm khi chụp màn hình và phân tích element luôn thao tác trên tab đang active.
```

---

### PROMPT 06: Virtualized Scroll Engine & Floating Portal Dropdown
- **Trạng thái:** `[ ] Chưa thực hiện`
- **Tập tin mục tiêu:** [src/runner.ts](file:///e:/SourceCode/autotest/src/runner.ts), [src/element-resolver.ts](file:///e:/SourceCode/autotest/src/element-resolver.ts)
- **Mục tiêu:** Xử lý danh sách vô tận (Infinite Scroll / Virtual DOM) và các component Dropdown hiện đại (React-Select, Ant Design, Material-UI).

```markdown
### [PROMPT 06]
Hãy nâng cấp `src/runner.ts` và `src/element-resolver.ts` để hiện thực hóa Trụ cột 10 (Virtual List Incremental Scroll) và Trụ cột 11 (Custom Portal Dropdown Protocol) theo QUY_CHUAN_AI_RESOLVER.md:

1. Virtualized List Incremental Scroll:
   - Khi phần tử mục tiêu không tìm thấy trong viewport hiện tại:
     - Không fail ngay; thực hiện cuộn phân đoạn (Step Scroll): Cuộn xuống 350px mỗi lần (tối đa 5 lần = 1750px).
     - Sau mỗi lần cuộn, đợi 200ms để DOM ảo mount node mới rồi quét lại danh sách candidates.
     - Nếu phát hiện thấy element xuất hiện, gọi `element.scrollIntoViewIfNeeded()` trước khi tương tác.

2. Custom Select / Floating Dropdown Protocol (React-Select, Antd, MUI):
   - Nhận diện khi một select không phải là `<select>` thuần mà là Custom Trigger div/button:
     - Pha 1: Click vào container trigger để mở popup menu.
     - Pha 2: Chờ menu overlay xuất hiện tại cuối body (`body > [role="listbox"]`, `body > .ant-select-dropdown`, `.MuiAutocomplete-popper`).
     - Pha 3: Tìm option bên trong overlay portal theo text cần chọn và click.
```

---

### PROMPT 07: Masked Input Integrity & Deadlock Watchdog Circuit Breaker
- **Trạng thái:** `[ ] Chưa thực hiện`
- **Tập tin mục tiêu:** [src/runner.ts](file:///e:/SourceCode/autotest/src/runner.ts)
- **Mục tiêu:** Đảm bảo nhập đúng dữ liệu vào các ô định dạng đặc biệt (SĐT, tiền tệ, ngày tháng) và tự động ngắt mạch khi giao diện bị kẹt vòng lặp vô tận.

```markdown
### [PROMPT 07]
Hãy cập nhật `src/runner.ts` để hiện thực hóa Trụ cột 12 (Masked Input Post-Fill Verification) và Trụ cột 14 (Deadlock Watchdog) theo QUY_CHUAN_AI_RESOLVER.md:

1. Post-Fill Masked Input Integrity Verification:
   - Sau khi thực hiện action `FILL` (ví dụ: số điện thoại, thẻ tín dụng, ngày sinh):
     - Đọc lại thuộc tính `value` thực tế của input trên trình duyệt.
     - Chuẩn hóa loại bỏ các ký tự định dạng tự sinh (dấu gạch ngang, khoảng trắng, dấu ngoặc).
     - Nếu giá trị thực tế không chứa đủ chuỗi số cần nhập (do thư viện mask nuốt ký tự khi dùng `element.fill()`):
       - Tự động chuyển sang cơ chế fallback: Focus vào ô, nhấn Ctrl+A, Backspace, sau đó dùng `page.keyboard.pressSequentially(value, { delay: 60 })` để gõ từng phím như người thật.

2. Deadlock Watchdog Circuit Breaker (Bộ ngắt mạch chống treo):
   - Sau mỗi bước kiểm thử, tính mã hash SHA-256 tóm tắt của DOM cây (hoặc URL + Text content chính).
   - Nếu trong 3 chu kỳ thao tác liên tiếp, mã hash hoàn toàn không thay đổi và hành động thất bại liên tục:
     - Kích hoạt ngắt mạch khẩn cấp (CIRCUIT_BREAKER_TRIGGERED).
     - Chụp ảnh màn hình, lưu log, và kích hoạt `LLMBridge.diagnoseFailureWithAI` (Forensic Autopsy) để chẩn đoán nguyên nhân UI bị kẹt thay vì tiếp tục chạy vô nghĩa.
```

---

### PROMPT 08: XAI Decision Audit Trail Logging & Cập nhật Dashboard Web UI
- **Trạng thái:** `[ ] Chưa thực hiện`
- **Tập tin mục tiêu:** [src/runner.ts](file:///e:/SourceCode/autotest/src/runner.ts), [src/ui-server.ts](file:///e:/SourceCode/autotest/src/ui-server.ts)
- **Mục tiêu:** Minh bạch hóa toàn bộ chuỗi quyết định của AI, cho phép kỹ sư xem trực quan lý do AI chọn element trên giao diện Web UI.

```markdown
### [PROMPT 08]
Hãy cập nhật `src/runner.ts` và `src/ui-server.ts` để hiện thực hóa Trụ cột 15 (Explainable AI - XAI Audit Trail) theo QUY_CHUAN_AI_RESOLVER.md:

1. Cấu trúc hóa Decision Audit Trail trong `output/report.json`:
   - Bổ sung trường `aiAuditTrail` vào từng step trong kết quả chạy:
     ```json
     {
       "stepNumber": 3,
       "action": "CLICK",
       "targetHint": "sign ni",
       "decision": {
         "chosenElement": "button#login-btn",
         "healedIntent": "Sign In",
         "damerauDistance": 1,
         "confidence": 0.94,
         "deltaMargin": 0.35,
         "criticVerdict": "APPROVED",
         "reasoning": "Phần tử chứa nhãn 'Sign In' khớp với 'sign ni' sau khi hoán vị ký tự; không vi phạm Antonym Barrier."
       },
       "quiescenceWaitMs": 340,
       "screenshotPath": "screenshots/step_3_pass.png"
     }
     ```

2. Nâng cấp Web UI Dashboard (`src/ui-server.ts`):
   - Hiển thị huy hiệu (Badge) "AI Healed" bên cạnh các bước được AI tự phục hồi lỗi chính tả.
   - Khi nhấp vào một bước, hiển thị modal chi tiết gồm:
     - Ảnh chụp màn hình kèm Bounding Box khoanh vùng phần tử.
     - Chuỗi suy luận XAI (Reasoning, Damerau distance, Safety Margin).
     - Báo cáo mổ tử thi AI (Forensic Autopsy) nếu bước đó thất bại.
```

---

### PROMPT 09: Real-World Stress Benchmark Suite & Validation Toàn diện
- **Trạng thái:** `[ ] Chưa thực hiện`
- **Tập tin mục tiêu:** `tests/stress-ai-suite.json` (tạo mới), `package.json`
- **Mục tiêu:** Tạo bộ kiểm thử nghiệm thu thực tế với các bẫy khó nhất để đo lường độ chính xác và tính tự phục hồi của hệ thống.

```markdown
### [PROMPT 09]
Hãy tạo kịch bản kiểm thử nghiệm thu `tests/stress-ai-suite.json` và script chạy benchmark để xác thực toàn diện 15 trụ cột theo QUY_CHUAN_AI_RESOLVER.md:

1. Xây dựng kịch bản với đầy đủ các bài toán hóc búa:
   - Bài test 1: Bẫy chính tả & Hoán vị ký tự (`sign ni`, `submti`, `usernmae`).
   - Bài test 2: Bẫy Antonym Barrier (Giao diện có 2 nút cạnh nhau: `Delete Account` và `Save Draft`, kịch bản yêu cầu bấm lưu; đảm bảo AI không bao giờ click nút Delete).
   - Bài test 3: Bẫy mạng chậm (Trang web có spinner loading dữ liệu mất 3 giây, kiểm chứng Quiescence Watcher).
   - Bài test 4: Bẫy Masked Input (Điền số điện thoại định dạng `(090) 123-4567`).
   - Bài test 5: Bẫy Native Dialog (Trang web bắn `window.confirm("Bạn có chắc chắn?")`, Runner tự động xử lý).
   - Bài test 6: Bẫy Virtualized List (Tìm kiếm và click một mục nằm ở vị trí cuộn sâu).

2. Thực thi benchmark và xuất báo cáo nghiệm thu:
   - Chạy toàn bộ suite bằng lệnh CLI.
   - Xuất bảng thống kê: Số bước thực thi, số bước tự phục hồi (Self-Healed), tỷ lệ False Positive (phải = 0%), thời gian trung bình mỗi step.
   - Xác nhận hệ thống đạt 100% tiêu chuẩn theo QUY_CHUAN_AI_RESOLVER.md.
```
