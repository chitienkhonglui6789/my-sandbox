# TỔNG QUAN TIẾN ĐỘ DỰ ÁN (PROJECT PROGRESS & DEVELOPER HANDOVER)
*Dự án: Enterprise Zero-Selector Web AutoTest Engine*  
*Cập nhật lần cuối: 17/11/2026*

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
│   ├── dom-distiller.ts       # Bộ chưng cất DOM (xuyên Iframe, Shadow DOM, Hit-test 3 điểm, nhãn không gian)
│   ├── settlement-barrier.ts  # Cơ chế nín thở thông minh (MutationObserver + Network idle, lọc sạch Tracker/Ads)
│   ├── element-resolver.ts    # Bộ giải quyết phần tử (Heuristic Fast-Path + Trace Cache + LLM Fallback)
│   ├── step-parser.ts         # Bộ phân tích ngôn ngữ tự nhiên tiếng Việt ra AtomicAction
│   ├── runner.ts              # Engine điều phối Playwright, chụp ảnh bằng chứng, chống click trượt
│   ├── ui-server.ts           # Web Server zero-dependency phục vụ giao diện tại port 5000
│   ├── cli.ts                 # Giao diện dòng lệnh (--all, --file, --case, --url)
│   ├── demo-server.ts         # Mock Server nội bộ giả lập 4 bẫy test (Wrong pass, Disabled button, Overlays...)
│   ├── llm-bridge.ts          # Cầu nối AI 4 tầng (AGY CLI, Gemini API, Ollama, N-gram)
│   └── run-100.ts             # Bộ chạy nghiệm thu hàng loạt kịch bản
```

### Bảng chức năng từng file trong `src/`:

| File | Vai trò kỹ thuật chính |
| :--- | :--- |
| **`types.ts`** | Chứa data contracts: 20 `ActionType`, `AtomicAction`, `DOMCandidate`, `StepLog`, `TestRunResult`. |
| **`dom-distiller.ts`** | Quét toàn bộ DOM trên màn hình, đâm xuyên qua iFrame, Open Shadow DOM, gom thẻ bài viết/sản phẩm (`cardSelectors`), tự tiêm helper `__name` chống crash esbuild. |
| **`settlement-barrier.ts`**| Đợi DOM ổn định sau mỗi thao tác. Bỏ qua các request polling vô tận (Google Analytics, TikTok Pixel, Sentry...). |
| **`element-resolver.ts`** | Tính điểm tương đồng Jaccard giữa câu lệnh và DOM. Điểm >= 75 chấp nhận ngay (0ms). Dưới 75 mới gọi tầng AI tự chữa lành. Lưu vết vào `trace_dataset.json`. |
| **`step-parser.ts`** | Chuyển đổi câu lệnh tiếng Việt thành các hành động nguyên tử (AtomicAction). |
| **`runner.ts`** | Khởi chạy Chromium chế độ Stealth (chống chặn bot), thực thi thao tác, vẽ khung đỏ/xanh lên ảnh chụp bằng chứng. |
| **`ui-server.ts`** | HTTP Server Node.js (cổng 5000), cung cấp API `/api/run`, phục vụ file ảnh `/output/:name` và giao diện Web SPA. |

---

## 3. CÁC CÔNG VIỆC QUAN TRỌNG ĐÃ HOÀN THÀNH

1. **Khắc phục triệt để lỗi crash DOM trong iFrame**:
   - Vấn đề: `tsx/esbuild` khi đóng gói hàm thường tiêm helper `__name`. Khi truyền hàm vào `frame.evaluate()`, trình duyệt báo lỗi `ReferenceError: __name is not defined`, làm mất sạch phần tử DOM trên trang.
   - Giải pháp: Tự động tiêm `var __name = globalThis.__name = window.__name = ...` vào mọi frame trước khi đánh giá DOM trong `dom-distiller.ts`.
2. **Mở rộng nhận diện danh sách bài viết báo chí thực tế**:
   - Bổ sung `article`, `.item-news`, `.title-news`, `.news-item`, `.story`, `.dt-news__item` và tự động sắp xếp theo tọa độ vật lý từ trên xuống dưới.
3. **Chuẩn hóa TypeScript 100%**:
   - Cập nhật toàn bộ 20 `ActionType` và các trường tương ứng (`scrollDirection`, `scrollAmount`, `keyName`, `waitMs`, `expectedUrlPart`, `filePath`...) trong `src/types.ts`.
   - Kết quả: `tsc --noEmit` hoàn tất với **0 lỗi**.
4. **Kiểm nghiệm thực tế trên các trang web lớn**:
   - **VnExpress.net**: Đạt 4/4 bước (Kiểm tra chữ -> Cuộn 600px -> Bấm tin tức đầu tiên -> Kiểm tra URL).
   - **DanTri.com.vn**: Đạt 4/4 bước (Kiểm tra chữ -> Cuộn 600px -> Bấm Kinh doanh -> Kiểm tra URL).
   - **GearVN.com**: Đạt 4/4 bước (Tìm kiếm chuột -> Cuộn 600px -> Bấm sản phẩm đầu -> Kiểm tra URL).
   - **GitHub.com**: Đạt 4/4 bước (Kiểm tra chữ -> Cuộn 500px -> Bấm Pricing -> Kiểm tra URL).
   - **SauceDemo.com**: Đạt 11/11 bước (Đăng nhập -> Mua hàng -> Điền thông tin -> Hoàn tất).
   - **4 Trap Scenarios cục bộ**: Bắt đúng 100% các bẫy nút bị khóa (`ELEMENT_DISABLED`), sai mật khẩu (`ASSERTION_MISMATCH`).
5. **Hỗ trợ nạp kịch bản chuẩn hóa qua file JSON (theo QUY_CHUAN_KICH_BAN.md)**:
   - Hỗ trợ trực tiếp cờ `--file <ten_file.json>` trong `src/cli.ts` và tự động phân luồng.
   - Tương thích 2 định dạng chuẩn:
     - **Định dạng DSL mảng chuỗi (`steps: string[]`)**: Các bước đánh số `(1) Điền "..." vào ô "..."`.
     - **Định dạng AST mảng đối tượng (`steps: object[]` / `actions: AtomicAction[]`)**: Chứa trực tiếp `type`, `targetHint`, `value`, `itemIndex`, `expectedText`...
   - Khắc phục triệt để logic phân tích `FILL` trong `src/step-parser.ts` để nhận diện chuẩn xác cú pháp `Điền "[giá_trị]" vào ô "[tên_ô]"`.
   - **Nghiệm thu thực tế**: Kịch bản E-commerce SauceDemo 18 bước (vượt yêu cầu 15 bước) chạy hoàn tất 18/18 bước (100% PASSED) với bằng chứng ảnh `output/canonical_json_pass_step_18.png` chỉ trong 6.6s.
6. **Kiểm thử nghiệm thu luồng E-commerce thực tế đúng 15 bước (End-to-End)**:
   - File thực thi: [kich_ban_real_15_buoc.json](file:///e:/SourceCode/autotest/kich_ban_real_15_buoc.json).
   - Kết quả: **15/15 bước PASSED (100%)**, thời gian 13.5s, đáp ứng toàn diện 4 tầng Oracle theo [QUY_CHUAN_DANH_GIA.md](file:///e:/SourceCode/autotest/QUY_CHUAN_DANH_GIA.md).
   - Bằng chứng ảnh chụp màn hình: [output/kich_ban_real_15_buoc_pass_step_15.png](file:///e:/SourceCode/autotest/output/kich_ban_real_15_buoc_pass_step_15.png).
7. **Tích hợp thành công Trí tuệ Nhân tạo Đa phương thức (AI-First Multimodal & Forensic Autopsy)**:
   - Kết nối Google Gemini API thông qua `.env` và module [src/llm-bridge.ts](file:///e:/SourceCode/autotest/src/llm-bridge.ts).
   - Kích hoạt **AI Semantic Oracle**: Đối soát ngữ nghĩa bằng mắt thần Multimodal thay vì so khớp chuỗi mù quáng.
   - Kích hoạt **AI Forensic Autopsy**: Tự động giải phẫu hiện trường khi kịch bản gãy, phân loại chuẩn `PRODUCT_DEFECT`, `TEST_DEFECT`, `INFRA_DEFECT` và xuất khuyến nghị hành động cho Dev/QA.
   - Đã nghiệm thu thực tế:
     - Kịch bản 15 bước E-commerce AI-First: PASSED 15/15 bước.
     - Kịch bản Bẫy nút Disabled: AI chẩn đoán chính xác do chọn màu Đen hết hàng.
     - Kịch bản Bẫy Sai mật khẩu: AI đọc hiểu thông báo lỗi trên màn hình và đề xuất cập nhật DB.
8. **Triển khai Trụ cột 4 (Damerau-Levenshtein Distance) & Trụ cột 5 (Antonym Barrier Matrix)**:
   - File triển khai: [src/element-resolver.ts](file:///e:/SourceCode/autotest/src/element-resolver.ts), [tests/element-resolver.test.ts](file:///e:/SourceCode/autotest/tests/element-resolver.test.ts).
   - Thuật toán Damerau-Levenshtein hỗ trợ 4 phép biến đổi (Xóa, Chèn, Thay thế, Hoán vị 2 ký tự liền kề), tính khoảng cách chuẩn hóa $\text{Sim} = 1 - (\text{dist} / \max(\text{len}_1, \text{len}_2))$, tự phục hồi Self-Healing khi $\text{Sim} \ge 0.75$.
   - Bảng ma trận từ đối lập nghiêm ngặt (Antonym Barrier Matrix) cho cả tiếng Anh và tiếng Việt: ngăn chặn tuyệt đối bấm nhầm các nút nguy hiểm (`Sign In` vs `Sign Out`, `Delete` vs `Save`, `Remove` vs `Add`, `Cancel` vs `Confirm`, `Accept` vs `Reject`, `Enable` vs `Disable`, `Agree` vs `Decline`).
   - Tích hợp vòng phản biện Actor-Critic Guardrail: tự động phủ quyết (Veto) đề xuất nếu vi phạm Antonym Barrier.
   - **Nghiệm thu 14/14 Unit Tests PASSED 100%**:
     - `sign ni` -> `Sign In` thành công ($d = 1$, transposition).
     - `Sign In` và `sign ni` bị chặn tuyệt đối không map vào `Sign Out` (`ANTYNOM_VIOLATION`).
     - `delte` -> `Delete` thành công ($d = 1$).
     - `submti` -> `Submit` thành công ($d = 1$).
     - `delte` bị chặn tuyệt đối không map vào `Save`.
   - Toàn bộ 4 bài test bẫy hệ thống (`npm run test`) tiếp tục đạt 100% kết quả chuẩn xác.
9. **Triển khai Trụ cột 1 (Quiescence & Network Inflight) & Trụ cột 2 (Auto-Wait & Dynamic Retry Loop)**:
   - File triển khai: [src/runner.ts](file:///e:/SourceCode/autotest/src/runner.ts), [src/settlement-barrier.ts](file:///e:/SourceCode/autotest/src/settlement-barrier.ts), [tests/quiescence-retry.test.ts](file:///e:/SourceCode/autotest/tests/quiescence-retry.test.ts).
   - **Xóa bỏ triệt để mọi lệnh `waitForTimeout` tĩnh** trong toàn bộ mã nguồn `src/`.
   - **Hiện thực hóa hàm `waitForUIQuiescence(page, timeoutMs = 7000)`** kiểm soát 3 chỉ số sinh tồn của ứng dụng:
     1. *Network Inflight Requests*: Đợi cho đến khi số lượng request mạng đang bay bằng 0 duy trì liên tục trong tối thiểu 300ms.
     2. *DOM Mutation*: Lắng nghe mọi biến đổi thêm, xóa, sửa thuộc tính (`attributes: true`) và đảm bảo cây DOM hoàn toàn tĩnh trong 200ms cuối.
     3. *Spinner / Skeleton*: Tự động phát hiện và đợi các loader phổ biến (`[aria-busy="true"]`, `.spinner`, `.loading`, `.skeleton`, `[data-loading]`, `[role="progressbar"]`, ...) biến mất hoặc ẩn đi (`display: none` / `visibility: hidden`).
   - **Cơ chế Exponential Backoff Retry Loop**:
     - Khi tìm kiếm element hoặc thực hiện hành động thất bại, tự động thử lại tối đa 3 lần với khoảng chờ tăng dần: `500ms -> 1500ms -> 3000ms`.
     - Mỗi chu kỳ retry kích hoạt lại `waitForUIQuiescence` để đảm bảo UI lắng đọng hoàn toàn trước khi quét lại DOM.
   - **Nghiệm thu 5/5 Unit Tests PASSED 100%**:
     - `Hằng số Exponential Backoff Retry`: [500, 1500, 3000].
     - `Inflight Network Requests`: Chờ request API kết thúc và duy trì tĩnh 300ms.
     - `DOM Mutation`: Bắt trúng biến đổi thuộc tính và duy trì tĩnh 200ms.
     - `Spinner / Skeleton`: Đợi biến mất toàn bộ các biểu tượng loading.
     - `Dynamic Retry Loop`: Tự phục hồi thành công khi phần tử render trễ trên SPA thực tế.
   - Toàn bộ 4 kịch bản bẫy (`npm run test`) tiếp tục đạt kết quả chính xác 100%.
10. **Triển khai Trụ cột 3 (Safety Margin $\Delta_{\text{margin}} \ge 20\%$) & Trụ cột 6 (Kiến trúc Actor-Critic Pipeline)**:
    - File triển khai: [src/llm-bridge.ts](file:///e:/SourceCode/autotest/src/llm-bridge.ts), [src/element-resolver.ts](file:///e:/SourceCode/autotest/src/element-resolver.ts), [src/types.ts](file:///e:/SourceCode/autotest/src/types.ts), [src/runner.ts](file:///e:/SourceCode/autotest/src/runner.ts), [tests/actor-critic-margin.test.ts](file:///e:/SourceCode/autotest/tests/actor-critic-margin.test.ts).
    - **Cơ chế Safety Margin ($\Delta_{\text{margin}}$)**:
      - Tính toán $\Delta_{\text{margin}} = (\text{Top1\_Score} - \text{Top2\_Score}) / 100$.
      - Khi $\Delta_{\text{margin}} < 0.20$ (chênh lệch dưới 20%) HOẶC $\text{Top1\_Score} < 0.85$ (85%): Hệ thống tự động đánh dấu trạng thái `AMBIGUOUS` và kích hoạt quy trình đa thể thức Actor-Critic Multimodal Resolution kèm ảnh chụp màn hình.
      - Khi $\Delta_{\text{margin}} \ge 0.20$ VÀ $\text{Top1\_Score} \ge 0.85$: Kích hoạt Fast-Path chấp nhận ngay tức thì (0ms) với `criticVerdict: 'APPROVED'`.
    - **Kiến trúc Actor-Critic Pipeline 2 Tầng**:
      - *Bước 1 (Actor)*: LLM phân tích DOM + Bounding Box + Screenshot để đề xuất candidate (`candidateId`, `confidence`, `reasoning`).
      - *Bước 2 (Critic)*: Gửi lại đề xuất cho Critic Model thẩm định câu hỏi an toàn ("Phần tử có chính xác là mục tiêu không? Có nguy cơ click nhầm nút đối lập hoặc sai ngữ cảnh không?").
      - *Phủ quyết (Veto)*: Nếu Critic trả về `REJECTED`, Runner lập tức hủy hành động tương tác, gắn mã lỗi và cờ cảnh báo `AMBIGUOUS_TARGET`.
      - *Vòng khóa bảo vệ kép*: Đối soát Antonym Barrier trực tiếp trên đề xuất của Actor để triệt tiêu mọi ảo giác (Hallucination).
    - **Nghiệm thu 11/11 Unit Tests PASSED 100%** trong [tests/actor-critic-margin.test.ts](file:///e:/SourceCode/autotest/tests/actor-critic-margin.test.ts):
      - Kiểm tra Safety Margin với trường hợp rõ ràng, trường hợp sát nút (< 20%), trường hợp điểm thấp (< 85%), và trường hợp hòa điểm (tie).
      - Fast-path bypass khi biên an toàn vững chắc ($\Delta \ge 20\%$, Score $\ge 85\%$).
      - Critic Veto: Phủ quyết đề xuất sai mục tiêu, hủy tương tác và gắn cờ `AMBIGUOUS_TARGET`.
      - Critic Approved: Phê duyệt đề xuất chính xác, trả về kết quả `matchSource: 'LLM'`.
      - Antonym Barrier bên trong Actor-Critic: Chặn đứng đề xuất nút đối nghịch và gắn cờ `ANTYNOM_VIOLATION`.
      - Ambiguous Dead Tie: Tự động thất bại an toàn khi không thể phân định giữa 2 ứng viên bằng điểm nhau.
      - Parser Actor & Critic: Đọc hiểu và bóc tách định dạng JSON linh hoạt kèm Markdown fenced code blocks.
11. **Triển khai Trụ cột 7 (Native Browser Dialog Interceptor: Alert, Confirm, Prompt, BeforeUnload)**:
    - File triển khai: [src/runner.ts](file:///e:/SourceCode/autotest/src/runner.ts), [src/types.ts](file:///e:/SourceCode/autotest/src/types.ts), [src/step-parser.ts](file:///e:/SourceCode/autotest/src/step-parser.ts), [src/settlement-barrier.ts](file:///e:/SourceCode/autotest/src/settlement-barrier.ts), [tests/native-dialog.test.ts](file:///e:/SourceCode/autotest/tests/native-dialog.test.ts).
    - **Lắng nghe toàn cục thường trực (`page.on('dialog')`)**:
      - Tự động ghi lại metadata: `type` (`alert`, `confirm`, `prompt`, `beforeunload`), `message`, `defaultValue`, `timestamp`, `actionTaken`, `promptInput`, `warning`, `stepNumber`.
      - **Chiến lược giải phóng luồng thông minh**:
        - `alert`: Tự động gọi `dialog.accept()`, ghi log execution `[NATIVE ALERT]`.
        - `confirm`: Nếu bước kịch bản tiếp theo mang tính khẳng định ("Xác nhận", "Đồng ý", "OK") -> gọi `dialog.accept()`. Nếu là "Hủy" hoặc không nhắc tới -> gọi `dialog.accept()` mặc định để giải phóng luồng, đồng thời gắn cảnh báo `AI WARNING` vào báo cáo kiểm thử. Hỗ trợ cờ `allowDismissOnCancel` khi cần dismiss.
        - `prompt`: Tự động trích xuất giá trị từ kịch bản hoặc giá trị mặc định để điền rồi `dialog.accept()`.
        - `beforeunload`: Tự động gọi `dialog.accept()`, ngăn chặn hoàn toàn việc trình duyệt bị kẹt khi điều hướng trang.
    - **Hỗ trợ hành động chuẩn `HANDLE_DIALOG` theo QUY_CHUAN_KICH_BAN.md**:
      - Bổ sung parser cho câu lệnh `Chấp nhận hộp thoại` (`ACCEPT`) và `Hủy hộp thoại` (`DISMISS`) trong [src/step-parser.ts](file:///e:/SourceCode/autotest/src/step-parser.ts).
      - Hiện thực hóa khối lệnh xử lý `HANDLE_DIALOG` trong [src/runner.ts](file:///e:/SourceCode/autotest/src/runner.ts).
    - **Cung cấp API truy xuất lịch sử dialog**:
      - Cung cấp: `getCapturedDialogs(page)`, `getLastCapturedDialog(page)`, `clearCapturedDialogs(page)`, `attachDialogInterceptor(page)`.
      - Tích hợp 0ms Fast-Path cho `ASSERT_TEXT`: Kiểm tra nhanh trong lịch sử dialog, cho phép xác thực chính xác thông điệp từ native alert nằm ngoài cây DOM.
    - **Nghiệm thu 9/9 Unit Tests PASSED 100%** trong [tests/native-dialog.test.ts](file:///e:/SourceCode/autotest/tests/native-dialog.test.ts):
      - Alert tự động accept và ghi nhận message.
      - Confirm tự động accept khi kịch bản khẳng định.
      - Confirm tự động accept mặc định kèm cảnh báo khi không nhắc tới hoặc hủy.
      - Confirm dismiss khi bật allowDismissOnCancel.
      - Prompt tự động điền giá trị từ kịch bản.
      - BeforeUnload tự động accept giải phóng điều hướng.
      - API truy xuất & làm sạch lịch sử dialog.
      - Parser DSL `HANDLE_DIALOG` (ACCEPT / DISMISS).
      - E2E Strict Scenario với Native Alert và Assertion thông điệp.

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
*Tài liệu này được duy trì liên tục để phục vụ chuyển giao công việc giữa các kỹ sư phát triển.*
