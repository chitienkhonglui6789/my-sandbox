import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium, Page } from 'playwright';
import {
  LLMBridge,
  askGeminiVisionSoM,
  buildVisionSoMPrompt,
  VisionSoMProvider,
} from '../src/llm-bridge';
import {
  buildCanvasGridMarks,
  detectCanvasWebGLSurfaces,
  executeTieredResolution,
  generateSetOfMarks,
  isNamelessIconCandidate,
  isValidPngBuffer,
  readPngDimensions,
  resolveMarkIdToBoundingBox,
  routeResolutionTier,
  TIER_THRESHOLDS,
  toXAIDecisionFromTieredResult,
} from '../src/vision-som';
import { AtomicAction, DOMCandidate } from '../src/types';

function createMockServer(
  html: string
): Promise<{ server: http.Server; url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({
        server,
        url,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function createMockCandidate(
  id: number,
  text: string,
  rect: { x: number; y: number; width: number; height: number },
  extra: Partial<DOMCandidate> = {}
): DOMCandidate {
  const tag = extra.tag || 'button';
  return {
    candidateId: id,
    tag,
    text,
    disabled: false,
    obscured: false,
    rect,
    selectorPath: `${tag}#cand-${id}`,
    fingerprint: {
      tag,
      text,
      stableClasses: ['btn'],
      selectorPath: `${tag}#cand-${id}`,
    },
    ...extra,
  };
}

function createMockAction(targetHint: string, type: AtomicAction['type'] = 'CLICK'): AtomicAction {
  return {
    stepNumber: 1,
    subIndex: 1,
    totalSubActions: 1,
    rawStepText: `Bấm "${targetHint}"`,
    subInstruction: `Bấm "${targetHint}"`,
    type,
    targetHint,
  };
}

/**
 * Helper đọc chênh lệch pixel RGBA giữa 2 ảnh PNG tại các tọa độ tâm chỉ định bằng detached canvas.
 * Không làm biến đổi DOM trang đích.
 */
async function measurePngPatchDiffs(
  page: Page,
  rawPngBase64: string,
  annotatedPngBase64: string,
  points: Array<{ x: number; y: number; radius: number }>
): Promise<Array<{ x: number; y: number; changedPixels: number; totalPixels: number; maxChannelDelta: number }>> {
  return page.evaluate(
    async (payload) => {
      const binA = atob(payload.rawPngBase64);
      const bytesA = new Uint8Array(binA.length);
      for (let i = 0; i < binA.length; i++) bytesA[i] = binA.charCodeAt(i);
      const bmpA = await createImageBitmap(new Blob([bytesA], { type: 'image/png' }));

      const binB = atob(payload.annotatedPngBase64);
      const bytesB = new Uint8Array(binB.length);
      for (let i = 0; i < binB.length; i++) bytesB[i] = binB.charCodeAt(i);
      const bmpB = await createImageBitmap(new Blob([bytesB], { type: 'image/png' }));

      const w = bmpA.width;
      const h = bmpA.height;

      const cA = document.createElement('canvas');
      cA.width = w;
      cA.height = h;
      const ctxA = cA.getContext('2d')!;
      ctxA.drawImage(bmpA, 0, 0);
      bmpA.close();

      const cB = document.createElement('canvas');
      cB.width = w;
      cB.height = h;
      const ctxB = cB.getContext('2d')!;
      ctxB.drawImage(bmpB, 0, 0);
      bmpB.close();

      const dataA = ctxA.getImageData(0, 0, w, h).data;
      const dataB = ctxB.getImageData(0, 0, w, h).data;

      const results: Array<{
        x: number;
        y: number;
        changedPixels: number;
        totalPixels: number;
        maxChannelDelta: number;
      }> = [];

      for (let p = 0; p < payload.points.length; p++) {
        const pt = payload.points[p];
        const cx = Math.round(pt.x);
        const cy = Math.round(pt.y);
        const r = pt.radius;
        let changed = 0;
        let total = 0;
        let maxDelta = 0;

        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const px = cx + dx;
            const py = cy + dy;
            if (px < 0 || py < 0 || px >= w || py >= h) continue;
            total++;
            const idx = (py * w + px) * 4;
            const dR = Math.abs(dataA[idx] - dataB[idx]);
            const dG = Math.abs(dataA[idx + 1] - dataB[idx + 1]);
            const dB = Math.abs(dataA[idx + 2] - dataB[idx + 2]);
            const delta = Math.max(dR, dG, dB);
            if (delta > maxDelta) maxDelta = delta;
            if (delta > 15) changed++;
          }
        }

        results.push({
          x: cx,
          y: cy,
          changedPixels: changed,
          totalPixels: total,
          maxChannelDelta: maxDelta,
        });
      }

      return results;
    },
    { rawPngBase64, annotatedPngBase64, points }
  );
}

// =========================================================================
// 1. SET-OF-MARKS (SoM) GENERATOR: PLAYWRIGHT REAL RENDER + ZERO DOM MUTATION
// =========================================================================
test('Prompt 14 - SoM Generator: vẽ badge [1],[2],[3] trên detached canvas, pixel tâm đổi rõ rệt, 0 DOM mutation, map chính xác Bounding Box gốc', async () => {
  const html = `<!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>SoM Visual Indexing Test</title>
      <style>
        body { margin: 0; padding: 0; background: #f4f6f8; font-family: Arial, sans-serif; }
        .btn { position: absolute; width: 160px; height: 48px; border: 1px solid #cbd5e1; background: #ffffff; color: #1e293b; font-size: 16px; border-radius: 6px; }
        #btn-1 { left: 100px; top: 100px; }
        #btn-2 { left: 360px; top: 180px; }
        #btn-3 { left: 620px; top: 280px; }
      </style>
    </head>
    <body>
      <button id="btn-1" class="btn">Đăng nhập</button>
      <button id="btn-2" class="btn">Đăng ký</button>
      <button id="btn-3" class="btn">Trợ giúp</button>
    </body>
  </html>`;

  const { url, close } = await createMockServer(html);
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript(() => {
      (window as any).__name = (globalThis as any).__name = (fn: any) => fn;
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Đọc Bounding Box thực tế từ DOM + cài MutationObserver kiểm tra 0 DOM mutation
    const pageInfo = await page.evaluate(() => {
      (window as any).__somMutationCount = 0;
      const obs = new MutationObserver((records) => {
        (window as any).__somMutationCount += records.length;
      });
      obs.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });

      const ids = ['btn-1', 'btn-2', 'btn-3'];
      const rects = ids.map((id) => {
        const el = document.getElementById(id)!;
        const r = el.getBoundingClientRect();
        return {
          id,
          text: el.innerText.trim(),
          rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        };
      });

      return {
        rects,
        nodeCountBefore: document.querySelectorAll('*').length,
        bodyHtmlBefore: document.body.innerHTML,
      };
    });

    const candidates: DOMCandidate[] = pageInfo.rects.map((item, idx) =>
      createMockCandidate(idx + 1, item.text, item.rect, {
        elemId: item.id,
        selectorPath: `button#${item.id}`,
      })
    );

    const som = await generateSetOfMarks(page, candidates);

    // 1. Kiểm tra PNG hợp lệ và đúng kích thước viewport
    assert.equal(isValidPngBuffer(som.rawScreenshotBuffer), true, 'Raw screenshot phải là PNG hợp lệ');
    assert.equal(isValidPngBuffer(som.annotatedScreenshotBuffer), true, 'Annotated screenshot phải là PNG hợp lệ');
    const dims = readPngDimensions(som.annotatedScreenshotBuffer);
    assert.deepEqual(dims, { width: 1280, height: 720 }, 'Kích thước PNG phải khớp viewport 1280x720');
    assert.notEqual(
      Buffer.compare(som.rawScreenshotBuffer, som.annotatedScreenshotBuffer),
      0,
      'Ảnh sau khi vẽ SoM phải khác ảnh gốc'
    );
    assert.equal(som.marks.length, 3, 'Phải tạo đúng 3 badge [1], [2], [3]');
    assert.equal(som.usedCanvasGrid, false);

    // 2. Xác nhận 0% DOM mutation & không để lại bất kỳ node rác nào trên trang đích
    const domAfter = await page.evaluate(() => ({
      mutationCount: (window as any).__somMutationCount as number,
      nodeCountAfter: document.querySelectorAll('*').length,
      bodyHtmlAfter: document.body.innerHTML,
      canvasCountInDom: document.querySelectorAll('canvas').length,
    }));
    assert.equal(domAfter.mutationCount, 0, 'Không được gây bất kỳ DOM mutation nào trên trang đích');
    assert.equal(domAfter.nodeCountAfter, pageInfo.nodeCountBefore, 'Số lượng DOM node trước và sau phải bằng nhau');
    assert.equal(domAfter.bodyHtmlAfter, pageInfo.bodyHtmlBefore, 'HTML của trang đích không được thay đổi');
    assert.equal(domAfter.canvasCountInDom, 0, 'Detached canvas tuyệt đối không được gắn vào DOM');

    // 3. Xác nhận pixel tại chính giữa Bounding Box của cả 3 ứng viên đều có thay đổi badge nổi bật,
    //    trong khi vùng nền trống xa không bị ảnh hưởng
    const samplePoints = [
      ...som.marks.map((m) => ({ x: m.center.x, y: m.center.y, radius: 6 })),
      { x: 1180, y: 650, radius: 4 }, // Vùng nền trống xa các nút
    ];
    const diffs = await measurePngPatchDiffs(
      page,
      som.rawScreenshotBuffer.toString('base64'),
      som.annotatedImageBase64,
      samplePoints
    );

    for (let i = 0; i < 3; i++) {
      assert.ok(
        diffs[i].changedPixels > 40,
        `Tâm Bounding Box của Mark [${i + 1}] phải có pixel badge rõ rệt (changedPixels=${diffs[i].changedPixels})`
      );
      assert.ok(
        diffs[i].maxChannelDelta >= 80,
        `Badge Mark [${i + 1}] phải có độ tương phản cao (maxDelta=${diffs[i].maxChannelDelta})`
      );
    }
    assert.equal(
      diffs[3].changedPixels,
      0,
      'Vùng nền trống bên ngoài các Bounding Box không được bị biến đổi pixel'
    );

    // 4. Tra cứu ngược chính xác ID -> Bounding Box hình học gốc (0% hallucination)
    for (let i = 0; i < 3; i++) {
      const markId = i + 1;
      const lookup = resolveMarkIdToBoundingBox(som, markId);
      assert.equal(lookup.valid, true);
      assert.equal(lookup.rejectedHallucination, false);
      assert.deepEqual(lookup.boundingBox, candidates[i].rect, `Mark [${markId}] phải map về đúng rect gốc`);
      assert.equal(lookup.candidate?.candidateId, candidates[i].candidateId);
      assert.deepEqual(lookup.clickPoint, {
        x: candidates[i].rect.x + candidates[i].rect.width / 2,
        y: candidates[i].rect.y + candidates[i].rect.height / 2,
      });
    }
  } finally {
    await browser.close();
    await close();
  }
});

// =========================================================================
// 2. CANVAS / WEBGL FALLBACK -> L3 VISION SoM + GRID RESOLUTION
// =========================================================================
test('Prompt 14 - Canvas/WebGL Fallback: trang chỉ có <canvas> (0 DOM con) tự động định tuyến L3 Vision SoM và click đúng Bounding Box lưới', async () => {
  const html = `<!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>WebGL Canvas App</title>
      <style>
        body { margin: 0; padding: 40px; background: #0f172a; }
        #webgl-stage { display: block; border: 2px solid #334155; }
      </style>
    </head>
    <body>
      <canvas id="webgl-stage" data-engine="webgl" width="600" height="360"></canvas>
      <script>
        const canvas = document.getElementById('webgl-stage');
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, 600, 360);
        // Vẽ nút ảo "Xuất báo cáo" nằm ở ô giữa (R2C2 -> Mark [5] trong lưới 3x3)
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(220, 140, 160, 80);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Xuất báo cáo', 300, 186);

        window.__canvasClicks = [];
        canvas.addEventListener('click', (ev) => {
          window.__canvasClicks.push({
            clientX: ev.clientX,
            clientY: ev.clientY,
            isTrusted: ev.isTrusted,
          });
        });
      </script>
    </body>
  </html>`;

  const { url, close } = await createMockServer(html);
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 640 } });
    await context.addInitScript(() => {
      (window as any).__name = (globalThis as any).__name = (fn: any) => fn;
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Kiểm tra bộ phát hiện bề mặt Canvas/WebGL
    const surface = await detectCanvasWebGLSurfaces(page);
    assert.equal(surface.hasCanvasOrWebGL, true, 'Phải phát hiện thẻ <canvas>');
    assert.equal(surface.isCanvasOnlySurface, true, 'Trang chỉ có canvas và 0 phần tử DOM tương tác');
    assert.equal(surface.canvasSurfaces.length, 1);
    assert.equal(surface.canvasSurfaces[0].childElementCount, 0);
    assert.equal(surface.canvasSurfaces[0].isWebGLHint, true);

    let capturedPrompt = '';
    let capturedMarkCount = 0;
    let capturedImageBase64Len = 0;

    const mockVisionProvider: VisionSoMProvider = async (req) => {
      capturedPrompt = req.prompt;
      capturedMarkCount = req.markCount;
      capturedImageBase64Len = req.imageBase64.length;
      return {
        id: 5,
        reason: 'Ô lưới SoM [5] phủ chính xác nút Xuất báo cáo ở trung tâm canvas',
        provider: 'mock-offline-vision',
      };
    };

    const result = await executeTieredResolution({
      action: createMockAction('Xuất báo cáo', 'CLICK'),
      candidates: [], // 0 phần tử DOM con!
      page,
      visionProvider: mockVisionProvider,
      somOptions: { canvasGridRows: 3, canvasGridCols: 3 },
    });

    assert.equal(result.resolved, true, 'L3 Vision SoM phải giải quyết thành công trên Canvas');
    assert.equal(result.tier, 'L3', 'Canvas với 0 DOM con bắt buộc định tuyến tầng L3');
    assert.equal(result.triggerReason, 'CANVAS_OR_WEBGL_SURFACE');
    assert.equal(result.apiCalled, true);
    assert.equal(result.rejectedHallucination, false);
    assert.equal(result.somMarkId, 5);
    assert.equal(result.somOverlay?.usedCanvasGrid, true);
    assert.equal(capturedMarkCount, 9, 'Lưới 3x3 trên canvas phải sinh đủ 9 SoM marks');
    assert.ok(capturedImageBase64Len > 1000, 'Ảnh SoM PNG base64 phải hợp lệ');
    assert.ok(
      capturedPrompt.includes('Để thực hiện hành động [CLICK] trên mục tiêu [Xuất báo cáo], hãy chọn ID số mấy?'),
      'Prompt gửi Vision AI phải đúng chuẩn Prompt 14'
    );

    const expectedMark5 = result.somOverlay!.markMap.get(5)!;
    assert.deepEqual(result.resolvedBox, expectedMark5.rect, 'Resolved box phải khớp tuyệt đối ô lưới [5] gốc');
    assert.deepEqual(result.clickPoint, expectedMark5.center);

    // Xác minh telemetry sẵn sàng cho XAI Audit Trail
    assert.equal(result.telemetry.tier, 'L3');
    assert.equal(result.telemetry.somMarkId, 5);
    assert.equal(result.telemetry.estimatedCostUsd, TIER_THRESHOLDS.L3_ESTIMATED_COST_USD);
    assert.deepEqual(result.telemetry.resolvedBox, expectedMark5.rect);

    // Thực thi click vật lý vào tâm Bounding Box đã giải quyết và kiểm chứng sự kiện isTrusted trên <canvas>
    await page.mouse.click(result.clickPoint!.x, result.clickPoint!.y);
    const canvasClicks = await page.evaluate(() => (window as any).__canvasClicks);
    assert.equal(canvasClicks.length, 1, 'Canvas phải nhận đúng 1 sự kiện click vật lý');
    assert.equal(canvasClicks[0].isTrusted, true, 'Sự kiện click trên canvas phải là isTrusted=true');
    assert.ok(
      Math.abs(canvasClicks[0].clientX - expectedMark5.center.x) <= 2 &&
        Math.abs(canvasClicks[0].clientY - expectedMark5.center.y) <= 2,
      'Tọa độ click thực tế phải trùng khớp tâm ô SoM [5]'
    );
  } finally {
    await browser.close();
    await close();
  }
});

// =========================================================================
// 3. TIERED L1 / L2 / L3 ROUTING BOUNDARY TESTS (NGƯỠNG, ĐỘ TRỄ, CHI PHÍ)
// =========================================================================
test('Prompt 14 - Routing L1 Fast-Path: Score 96%, Delta 35% -> L1 (apiCalled=false, cost=$0, latency < 2ms)', async () => {
  const cand = createMockCandidate(1, 'Xác nhận đặt hàng', { x: 100, y: 200, width: 180, height: 44 });

  // Kiểm tra cả thang điểm 0..100 lẫn thang 0..1
  const dPercent = routeResolutionTier({ top1Score: 96, marginDelta: 35, antonymBlocked: false });
  assert.equal(dPercent.tier, 'L1');
  assert.equal(dPercent.triggerReason, 'L1_DOM_HEURISTIC_FAST_PATH');
  assert.equal(dPercent.requiresVisionSoM, false);
  assert.equal(dPercent.estimatedCostUsd, 0);

  const dNorm = routeResolutionTier({ top1Score: 0.96, marginDelta: 0.35, antonymBlocked: false });
  assert.equal(dNorm.tier, 'L1');

  // Kiểm tra ranh giới đúng ngưỡng L1: 95% / 30% -> L1; dưới 95% hoặc delta < 30% -> rơi xuống L2
  assert.equal(routeResolutionTier({ top1Score: 95, marginDelta: 30 }).tier, 'L1');
  assert.equal(routeResolutionTier({ top1Score: 94.9, marginDelta: 35 }).tier, 'L2');
  assert.equal(routeResolutionTier({ top1Score: 96, marginDelta: 29.9 }).tier, 'L2');

  let providerInvoked = false;
  const execRes = await executeTieredResolution({
    action: createMockAction('Xác nhận đặt hàng'),
    top1Score: 96,
    marginDelta: 35,
    top1Candidate: cand,
    antonymBlocked: false,
    visionProvider: async () => {
      providerInvoked = true;
      return { id: 1, reason: 'should not be called' };
    },
  });

  assert.equal(execRes.resolved, true);
  assert.equal(execRes.tier, 'L1');
  assert.equal(execRes.apiCalled, false);
  assert.equal(providerInvoked, false, 'Tầng L1 tuyệt đối không được gọi Vision API');
  assert.equal(execRes.estimatedCostUsd, 0);
  assert.ok(execRes.latencyMs < 2, `Độ trễ L1 phải < 2ms, thực tế: ${execRes.latencyMs}ms`);
  assert.deepEqual(execRes.resolvedBox, cand.rect);

  // Kiểm tra L1 Autonomous (tự chấm điểm DOM candidates không cần pre-score)
  const other1 = createMockCandidate(2, 'Trợ giúp', { x: 320, y: 200, width: 120, height: 44 });
  const other2 = createMockCandidate(3, 'Chính sách bảo mật', { x: 480, y: 200, width: 160, height: 44 });
  const autoL1 = await executeTieredResolution({
    action: createMockAction('Xác nhận đặt hàng'),
    candidates: [other1, cand, other2],
  });
  assert.equal(autoL1.resolved, true);
  assert.equal(autoL1.tier, 'L1');
  assert.equal(autoL1.candidate?.candidateId, 1);
  assert.equal(autoL1.apiCalled, false);
  assert.equal(autoL1.estimatedCostUsd, 0);
  assert.ok(autoL1.latencyMs < 2, `Độ trễ L1 autonomous phải < 2ms, thực tế: ${autoL1.latencyMs}ms`);
});

test('Prompt 14 - Routing L2 Typo & Antonym Healing: Typo 88%, Delta 25% -> L2 (apiCalled=false, cost=$0, latency < 8ms) & Antonym Barrier chặn L1', async () => {
  const signInCand = createMockCandidate(1, 'Sign In', { x: 120, y: 120, width: 120, height: 40 });
  const signUpCand = createMockCandidate(2, 'Sign Up', { x: 260, y: 120, width: 120, height: 40 });
  const signOutCand = createMockCandidate(3, 'Sign Out', { x: 400, y: 120, width: 120, height: 40 });

  // 1. Pre-scored boundary: Typo healed to 88%, Delta 25% -> L2
  let apiCalledFlag = false;
  const preScoredL2 = await executeTieredResolution({
    action: createMockAction('sign ni'),
    top1Score: 88,
    marginDelta: 25,
    top1Candidate: signInCand,
    isTypoHealed: true,
    damerauDistance: 1,
    damerauSimilarity: 0.88,
    visionProvider: async () => {
      apiCalledFlag = true;
      return { id: 1, reason: 'should not be called' };
    },
  });

  assert.equal(preScoredL2.resolved, true);
  assert.equal(preScoredL2.tier, 'L2');
  assert.equal(preScoredL2.triggerReason, 'L2_TYPO_ANTONYM_HEALING');
  assert.equal(preScoredL2.apiCalled, false);
  assert.equal(apiCalledFlag, false);
  assert.equal(preScoredL2.estimatedCostUsd, 0);
  assert.ok(preScoredL2.latencyMs < 8, `Độ trễ L2 phải < 8ms, thực tế: ${preScoredL2.latencyMs}ms`);

  // 2. Autonomous L2: Typo "sign ni" tự động chữa lành thành "Sign In", loại bỏ "Sign Out" qua Antonym Barrier
  const autoL2 = await executeTieredResolution({
    action: createMockAction('sign ni'),
    candidates: [signOutCand, signUpCand, signInCand],
  });

  assert.equal(autoL2.resolved, true);
  assert.equal(autoL2.tier, 'L2', 'Chữa lỗi chính tả Damerau-Levenshtein phải đi qua tầng L2');
  assert.equal(autoL2.candidate?.candidateId, 1, 'Phải chọn đúng Sign In và bỏ qua Sign Out / Sign Up');
  assert.equal(autoL2.apiCalled, false);
  assert.equal(autoL2.telemetry.damerauDistance, 1);
  assert.ok(autoL2.latencyMs < 8, `Độ trễ L2 autonomous phải < 8ms, thực tế: ${autoL2.latencyMs}ms`);

  // 3. Antonym Barrier chặn cứng: Không bao giờ cho phép vào L1 dù điểm cao nếu bị Antonym Barrier chặn
  const blockedDecision = routeResolutionTier({
    top1Score: 98,
    marginDelta: 40,
    antonymBlocked: true,
  });
  assert.notEqual(blockedDecision.tier, 'L1', 'Antonym Barrier phải cấm vào L1 Fast-Path');
  assert.equal(blockedDecision.tier, 'L2');
  assert.equal(blockedDecision.triggerReason, 'ANTONYM_BARRIER_BLOCKED');
  assert.equal(blockedDecision.requiresVisionSoM, false);

  const antonymTrapRes = await executeTieredResolution({
    action: createMockAction('Sign In'),
    candidates: [signOutCand],
  });
  assert.equal(antonymTrapRes.resolved, false);
  assert.equal(antonymTrapRes.antonymBlocked, true);
  assert.equal(antonymTrapRes.flag, 'ANTYNOM_VIOLATION');
  assert.equal(antonymTrapRes.apiCalled, false);
});

test('Prompt 14 - Routing L3 Ambiguous Dispute Zone (Delta 10% < 20%) & Nameless Icon Failure -> Kích hoạt Vision SoM', async () => {
  // 1. Ambiguous Delta = 10% (< 20%) -> L3 Vision SoM
  const ambigDecision = routeResolutionTier({
    top1Score: 88,
    top2Score: 78,
    marginDelta: 10,
  });
  assert.equal(ambigDecision.tier, 'L3');
  assert.equal(ambigDecision.triggerReason, 'AMBIGUOUS_DISPUTE_ZONE');
  assert.equal(ambigDecision.requiresVisionSoM, true);

  // 2. Nameless Icon button failing L1/L2 -> L3 Vision SoM
  const iconBtn1 = createMockCandidate(1, '', { x: 20, y: 20, width: 36, height: 36 }, {
    selectorPath: 'button.icon-menu > svg',
  });
  const iconBtn2 = createMockCandidate(2, '', { x: 80, y: 20, width: 36, height: 36 }, {
    selectorPath: 'button.icon-settings > svg',
  });
  assert.equal(isNamelessIconCandidate(iconBtn1), true);
  assert.equal(isNamelessIconCandidate(iconBtn2), true);

  const iconDecision = routeResolutionTier({
    top1Score: 0,
    marginDelta: 0,
    candidates: [iconBtn1, iconBtn2],
  });
  assert.equal(iconDecision.tier, 'L3');
  assert.equal(iconDecision.triggerReason, 'NAMELESS_ICON_LOW_CONFIDENCE');
  assert.equal(iconDecision.requiresVisionSoM, true);

  // 3. E2E Playwright Chromium: trang chứa 2 nút icon thuần SVG không text + 2 nút tranh chấp
  const html = `<!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body { margin: 24px; font-family: Arial, sans-serif; }
        .row { display: flex; gap: 20px; margin-bottom: 24px; }
        .icon-btn { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid #94a3b8; background: #fff; }
        .pay-btn { padding: 10px 18px; border: 1px solid #3b82f6; background: #eff6ff; }
      </style>
    </head>
    <body>
      <div class="row">
        <button id="icon-menu" class="icon-btn"><svg width="20" height="20" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" stroke="#111" stroke-width="2"/></svg></button>
        <button id="icon-gear" class="icon-btn"><svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" stroke="#111" stroke-width="2" fill="none"/></svg></button>
      </div>
      <div class="row">
        <button id="pay-momo" class="pay-btn">Thanh toán qua MoMo</button>
        <button id="pay-vnpay" class="pay-btn">Thanh toán qua VNPAY</button>
      </div>
    </body>
  </html>`;

  const { url, close } = await createMockServer(html);
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 600 } });
    await context.addInitScript(() => {
      (window as any).__name = (globalThis as any).__name = (fn: any) => fn;
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const rects = await page.evaluate(() => {
      const ids = ['icon-menu', 'icon-gear', 'pay-momo', 'pay-vnpay'];
      const out: Record<string, { x: number; y: number; width: number; height: number }> = {};
      for (let i = 0; i < ids.length; i++) {
        const r = document.getElementById(ids[i])!.getBoundingClientRect();
        out[ids[i]] = { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      return out;
    });

    // Ca A: Nameless icons -> L3 Vision SoM chọn Mark [2] (#icon-gear)
    const iconCandidates = [
      createMockCandidate(10, '', rects['icon-menu'], { elemId: 'icon-menu', selectorPath: 'button#icon-menu' }),
      createMockCandidate(11, '', rects['icon-gear'], { elemId: 'icon-gear', selectorPath: 'button#icon-gear' }),
    ];
    const iconRes = await executeTieredResolution({
      action: createMockAction('Mở cài đặt'),
      candidates: iconCandidates,
      page,
      visionProvider: async () => ({ id: 2, reason: 'Icon bánh răng [2] là nút Cài đặt' }),
    });
    assert.equal(iconRes.resolved, true);
    assert.equal(iconRes.tier, 'L3');
    assert.equal(iconRes.triggerReason, 'NAMELESS_ICON_LOW_CONFIDENCE');
    assert.equal(iconRes.somMarkId, 2);
    assert.equal(iconRes.candidate?.elemId, 'icon-gear');
    assert.deepEqual(iconRes.resolvedBox, rects['icon-gear']);

    // Ca B: Ambiguous dispute zone (Delta = 0% < 20%) -> L3 Vision SoM chọn Mark [2] (#pay-vnpay)
    const payCandidates = [
      createMockCandidate(20, 'Thanh toán qua MoMo', rects['pay-momo'], { elemId: 'pay-momo', selectorPath: 'button#pay-momo' }),
      createMockCandidate(21, 'Thanh toán qua VNPAY', rects['pay-vnpay'], { elemId: 'pay-vnpay', selectorPath: 'button#pay-vnpay' }),
    ];
    const ambigRes = await executeTieredResolution({
      action: createMockAction('Thanh toán'),
      candidates: payCandidates,
      page,
      visionProvider: async () => ({ id: 2, reason: 'Chọn nút Thanh toán VNPAY [2]' }),
    });
    assert.equal(ambigRes.resolved, true);
    assert.equal(ambigRes.tier, 'L3');
    assert.equal(ambigRes.triggerReason, 'AMBIGUOUS_DISPUTE_ZONE');
    assert.equal(ambigRes.somMarkId, 2);
    assert.equal(ambigRes.candidate?.elemId, 'pay-vnpay');
    assert.deepEqual(ambigRes.resolvedBox, rects['pay-vnpay']);

    // Xác minh chuyển đổi sang XAI Audit Trail (Stage 2 readiness)
    const xai = toXAIDecisionFromTieredResult(ambigRes);
    assert.equal(xai.matchSource, 'L3_VISION_SOM');
    assert.equal(xai.criticVerdict, 'APPROVED');
    assert.ok(xai.reasoning?.includes('Tier=L3'));
  } finally {
    await browser.close();
    await close();
  }
});

// =========================================================================
// 4. ANTI-HALLUCINATION GUARD & GEMINI MULTIMODAL BRIDGE CONTRACT TESTS
// =========================================================================
test('Prompt 14 - Anti-Hallucination Guard: từ chối an toàn Mark ID ngoài phạm vi, âm, số thực, hoặc tọa độ pixel giả', async () => {
  const dummyBase64 = Buffer.from('fake-png-bytes').toString('base64');

  // Out-of-range ID (99 khi chỉ có 3 marks)
  const outOfRange = await askGeminiVisionSoM(dummyBase64, 'CLICK', 'Đăng nhập', 3, {
    provider: async () => JSON.stringify({ id: 99, reason: 'Hallucinated ID 99' }),
  });
  assert.equal(outOfRange.valid, false);
  assert.equal(outOfRange.id, null);
  assert.equal(outOfRange.rejectedHallucination, true);
  assert.equal(outOfRange.rawReturnedId, 99);

  // Zero & negative ID
  const zeroRes = await askGeminiVisionSoM(dummyBase64, 'CLICK', 'Đăng nhập', 3, {
    provider: async () => ({ id: 0, reason: 'Zero ID' }),
  });
  assert.equal(zeroRes.valid, false);
  assert.equal(zeroRes.rejectedHallucination, true);

  const negRes = await askGeminiVisionSoM(dummyBase64, 'CLICK', 'Đăng nhập', 3, {
    provider: async () => ({ id: -2, reason: 'Negative ID' }),
  });
  assert.equal(negRes.valid, false);
  assert.equal(negRes.rejectedHallucination, true);

  // Float ID
  const floatRes = await askGeminiVisionSoM(dummyBase64, 'CLICK', 'Đăng nhập', 3, {
    provider: async () => JSON.stringify({ id: 1.5, reason: 'Float ID' }),
  });
  assert.equal(floatRes.valid, false);
  assert.equal(floatRes.rejectedHallucination, true);

  // Pixel-coordinate hallucination string
  const coordRes = await askGeminiVisionSoM(dummyBase64, 'CLICK', 'Đăng nhập', 3, {
    provider: async () => '{"id": "x=420, y=310", "reason": "guessed coordinates"}',
  });
  assert.equal(coordRes.valid, false);
  assert.equal(coordRes.id, null);
  assert.equal(coordRes.rejectedHallucination, true);

  // End-to-end executeTieredResolution từ chối ID ảo giác và trả về resolvedBox = null
  const syntheticMarks = buildCanvasGridMarks({ x: 0, y: 0, width: 300, height: 300 }, { rows: 2, cols: 2 });
  const markMap = new Map(syntheticMarks.map((m) => [m.id, m]));
  const indexById: Record<number, typeof syntheticMarks[number]> = {};
  for (const m of syntheticMarks) indexById[m.id] = m;

  const hallucinatedExec = await executeTieredResolution({
    action: createMockAction('Biểu đồ doanh thu'),
    isCanvasOrWebGL: true,
    somOverlay: {
      rawScreenshotBuffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      annotatedScreenshotBuffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      annotatedImageBase64: dummyBase64,
      marks: syntheticMarks,
      markMap,
      indexById,
      viewport: { width: 300, height: 300, imageWidth: 300, imageHeight: 300 },
      usedCanvasGrid: true,
      renderTimeMs: 1,
    },
    visionProvider: async () => ({ id: 42, reason: 'Hallucinated out-of-range mark' }),
  });

  assert.equal(hallucinatedExec.resolved, false);
  assert.equal(hallucinatedExec.resolvedBox, null);
  assert.equal(hallucinatedExec.somMarkId, null);
  assert.equal(hallucinatedExec.rejectedHallucination, true);
  assert.equal(hallucinatedExec.flag, 'SOM_HALLUCINATION_REJECTED');
});

test('Prompt 14 - LLMBridge.askGeminiVisionSoM: kiểm tra đúng chuẩn payload Gemini Multimodal inlineData & fallback offline khi thiếu API key', async () => {
  const sampleBase64 = Buffer.from('sample-som-png-data').toString('base64');
  let capturedUrl = '';
  let capturedBody: any = null;

  const mockFetch: typeof fetch = (async (input: any, init?: any) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body || '{}'));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: '{"id": 2, "reason": "Nút [2] đúng với biểu tượng cài đặt"}' }],
            },
          },
        ],
      }),
    } as any;
  }) as any;

  const res = await LLMBridge.askGeminiVisionSoM(sampleBase64, 'CLICK', 'Cài đặt', 4, {
    apiKey: 'unit-test-fake-key',
    model: 'gemini-2.0-flash-lite',
    fetchFn: mockFetch,
  });

  assert.equal(res.valid, true);
  assert.equal(res.id, 2);
  assert.equal(res.apiCalled, true);
  assert.equal(res.provider, 'gemini-multimodal');
  assert.ok(capturedUrl.includes('gemini-2.0-flash-lite:generateContent?key=unit-test-fake-key'));

  const parts = capturedBody?.contents?.[0]?.parts;
  assert.ok(Array.isArray(parts) && parts.length === 2, 'Payload Gemini phải có đúng 2 parts (text + inlineData)');
  assert.equal(
    parts[0].text,
    buildVisionSoMPrompt('CLICK', 'Cài đặt', 4),
    'Text part phải khớp prompt chuẩn'
  );
  assert.ok(
    parts[0].text.includes('Để thực hiện hành động [CLICK] trên mục tiêu [Cài đặt], hãy chọn ID số mấy? Chỉ trả về JSON {"id": <number>, "reason": "..."}')
  );
  assert.deepEqual(parts[1], {
    inlineData: {
      mimeType: 'image/png',
      data: sampleBase64,
    },
  });

  // Kiểm tra graceful offline fallback khi không có GEMINI_API_KEY và không có provider
  const prevStatic = LLMBridge.getVisionSoMProvider();
  try {
    LLMBridge.setVisionSoMProvider(null);
    const offlineRes = await LLMBridge.askGeminiVisionSoM(sampleBase64, 'CLICK', 'Cài đặt', 4, {
      apiKey: '',
    });
    assert.equal(offlineRes.valid, false);
    assert.equal(offlineRes.id, null);
    assert.equal(offlineRes.apiCalled, false);
    assert.equal(offlineRes.provider, 'none');
  } finally {
    LLMBridge.setVisionSoMProvider(prevStatic);
  }
});

test('Prompt 14 - Canvas Custom Regions & L3 Post-Vision Antonym Veto Guardrail', async () => {
  // 1. Custom Canvas Regions
  const customMarks = buildCanvasGridMarks(
    { x: 0, y: 0, width: 600, height: 400 },
    {
      canvasSelector: 'canvas#chart',
      customRegions: [
        { label: 'Bar Q1', rect: { x: 40, y: 120, width: 80, height: 240 } },
        { label: 'Bar Q2', rect: { x: 180, y: 80, width: 80, height: 280 } },
      ],
    }
  );
  assert.equal(customMarks.length, 2);
  assert.equal(customMarks[0].source, 'CANVAS_REGION');
  assert.equal(customMarks[0].label, 'Bar Q1');
  assert.deepEqual(customMarks[1].center, { x: 220, y: 220 });

  // 2. Lớp bảo vệ kép Antonym Barrier sau L3 Vision SoM:
  //    Nếu Vision AI nhầm lẫn chọn nút "Sign Out" khi lệnh là "Sign In", phải phủ quyết ANTYNOM_VIOLATION
  const signOutCand = createMockCandidate(9, 'Sign Out', { x: 500, y: 20, width: 100, height: 36 });
  const fakeMark = {
    id: 1,
    rect: signOutCand.rect,
    center: { x: 550, y: 38 },
    badgeCenter: { x: 550, y: 38 },
    color: '#E53935',
    source: 'DOM_CANDIDATE' as const,
    label: 'Sign Out',
    candidate: signOutCand,
  };
  const dummyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
  const vetoRes = await executeTieredResolution({
    action: createMockAction('Sign In'),
    top1Score: 50,
    marginDelta: 5,
    somOverlay: {
      rawScreenshotBuffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      annotatedScreenshotBuffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      annotatedImageBase64: dummyPng,
      marks: [fakeMark],
      markMap: new Map([[1, fakeMark]]),
      indexById: { 1: fakeMark },
      viewport: { width: 800, height: 600, imageWidth: 800, imageHeight: 600 },
      usedCanvasGrid: false,
      renderTimeMs: 1,
    },
    visionProvider: async () => ({ id: 1, reason: 'Vision hallucinated Sign Out' }),
  });

  assert.equal(vetoRes.resolved, false, 'Post-Vision Antonym Veto phải chặn đứng hành động');
  assert.equal(vetoRes.antonymBlocked, true);
  assert.equal(vetoRes.resolvedBox, null);
  assert.equal(vetoRes.flag, 'ANTYNOM_VIOLATION');
});

test('Prompt 14 - Regressions: Diacritic-insensitive aria/placeholder/value L1, Mixed DOM+Canvas SoM, và JSON coordinate hallucination thiếu "id"', async () => {
  // Regression 1: Diacritic-insensitive L1 trên ariaLabel, placeholder, nearLabel, value
  const ariaSearchBtn = createMockCandidate(1, '', { x: 20, y: 20, width: 44, height: 44 }, {
    ariaLabel: 'Tìm kiếm',
    elemId: 'btn-search',
  });
  const otherBtn = createMockCandidate(2, 'Cài đặt', { x: 80, y: 20, width: 100, height: 44 });

  const ariaL1 = await executeTieredResolution({
    action: createMockAction('tim kiem'),
    candidates: [ariaSearchBtn, otherBtn],
  });
  assert.equal(ariaL1.resolved, true);
  assert.equal(ariaL1.tier, 'L1', 'Khớp không dấu trên aria-label phải vào thẳng L1 thay vì rơi xuống L3');
  assert.equal(ariaL1.candidate?.elemId, 'btn-search');
  assert.equal(ariaL1.apiCalled, false);
  assert.ok(ariaL1.latencyMs < 2, `L1 aria-label latency phải < 2ms, thực tế: ${ariaL1.latencyMs}ms`);

  const passInput = createMockCandidate(3, '', { x: 20, y: 90, width: 220, height: 36 }, {
    tag: 'input',
    placeholder: 'Nhập mật khẩu',
    elemId: 'pwd',
  });
  const userInput = createMockCandidate(4, '', { x: 20, y: 140, width: 220, height: 36 }, {
    tag: 'input',
    placeholder: 'Tên tài khoản',
    elemId: 'user',
  });
  const placeholderL1 = await executeTieredResolution({
    action: createMockAction('nhap mat khau', 'FILL'),
    candidates: [passInput, userInput],
  });
  assert.equal(placeholderL1.resolved, true);
  assert.equal(placeholderL1.tier, 'L1', 'Khớp không dấu trên placeholder phải vào thẳng L1');
  assert.equal(placeholderL1.candidate?.elemId, 'pwd');
  assert.equal(placeholderL1.apiCalled, false);

  const submitValueBtn = createMockCandidate(5, '', { x: 20, y: 200, width: 140, height: 40 }, {
    tag: 'input',
    type: 'submit',
    value: 'Gửi biểu mẫu',
    elemId: 'submit-form',
  });
  const valueL1 = await executeTieredResolution({
    action: createMockAction('gui bieu mau'),
    candidates: [submitValueBtn, otherBtn],
  });
  assert.equal(valueL1.resolved, true);
  assert.equal(valueL1.tier, 'L1', 'Khớp không dấu trên value phải vào thẳng L1');
  assert.equal(valueL1.candidate?.elemId, 'submit-form');

  // Regression 3: JSON object ảo giác tọa độ thiếu khóa "id"/"markId" phải bị đánh dấu rejectedHallucination=true,
  //               phân biệt rõ với {"id": null} hợp lệ (rejectedHallucination=false)
  const dummyBase64 = Buffer.from('fake-png-bytes').toString('base64');

  const coordObjJson = await askGeminiVisionSoM(dummyBase64, 'CLICK', 'Nút A', 4, {
    provider: async () => '{"x": 420, "y": 310}',
  });
  assert.equal(coordObjJson.valid, false);
  assert.equal(coordObjJson.id, null);
  assert.equal(
    coordObjJson.rejectedHallucination,
    true,
    'JSON {"x": 420, "y": 310} thiếu "id" phải bị coi là hallucination (rejectedHallucination=true)'
  );

  const coordObjDirect = await askGeminiVisionSoM(dummyBase64, 'CLICK', 'Nút A', 4, {
    provider: async () => ({ x: 420, y: 310 } as any),
  });
  assert.equal(coordObjDirect.valid, false);
  assert.equal(coordObjDirect.id, null);
  assert.equal(coordObjDirect.rejectedHallucination, true);

  const explicitNullJson = await askGeminiVisionSoM(dummyBase64, 'CLICK', 'Nút A', 4, {
    provider: async () => '{"id": null, "reason": "Không thấy mục tiêu"}',
  });
  assert.equal(explicitNullJson.valid, false);
  assert.equal(explicitNullJson.id, null);
  assert.equal(
    explicitNullJson.rejectedHallucination,
    false,
    'Phản hồi tường minh {"id": null} không bị coi là hallucination'
  );

  // Regression 2: Mixed DOM + <canvas> candidates trong generateSetOfMarks không được âm thầm bỏ rơi <canvas>
  const mixedHtml = `<!DOCTYPE html>
  <html>
    <head><meta charset="utf-8" /></head>
    <body style="margin:20px;">
      <button id="btn-save" style="width:120px;height:40px;">Lưu</button>
      <canvas id="mixed-canvas" width="200" height="120" style="display:block;margin-top:20px;background:#1e293b;"></canvas>
    </body>
  </html>`;

  const { url, close } = await createMockServer(mixedHtml);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    await context.addInitScript(() => {
      (window as any).__name = (globalThis as any).__name = (fn: any) => fn;
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const rects = await page.evaluate(() => {
      const b = document.getElementById('btn-save')!.getBoundingClientRect();
      const c = document.getElementById('mixed-canvas')!.getBoundingClientRect();
      return {
        btn: { x: b.x, y: b.y, width: b.width, height: b.height },
        canvas: { x: c.x, y: c.y, width: c.width, height: c.height },
      };
    });

    const btnCand = createMockCandidate(1, 'Lưu', rects.btn, {
      tag: 'button',
      elemId: 'btn-save',
      selectorPath: 'button#btn-save',
    });
    const canvasCand = createMockCandidate(2, '', rects.canvas, {
      tag: 'canvas',
      elemId: 'mixed-canvas',
      selectorPath: 'canvas#mixed-canvas',
    });

    const somMixed = await generateSetOfMarks(page, [btnCand, canvasCand], {
      canvasGridRows: 2,
      canvasGridCols: 2,
    });

    assert.equal(somMixed.usedCanvasGrid, true, 'Tập ứng viên hỗn hợp có <canvas> phải sinh lưới SoM cho canvas');
    assert.equal(somMixed.marks.length, 5, 'Phải có 1 DOM mark (#btn-save) + 4 Canvas Grid marks (2x2) = 5 marks');
    assert.equal(somMixed.marks[0].source, 'DOM_CANDIDATE');
    assert.equal(somMixed.marks[0].candidate?.elemId, 'btn-save');
    for (let idx = 1; idx < 5; idx++) {
      assert.equal(somMixed.marks[idx].source, 'CANVAS_GRID');
      assert.equal(somMixed.marks[idx].canvasSelector, 'canvas#mixed-canvas');
    }
  } finally {
    await browser.close();
    await close();
  }
});
