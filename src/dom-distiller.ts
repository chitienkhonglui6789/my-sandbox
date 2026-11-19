import { Page } from 'playwright';
import { DOMCandidate } from './types';
import {
  detectSafeViewportBand,
  isRectInSafeViewportBand,
  SafeViewportBand,
} from './occlusion-engine';
import {
  classifySvgSignature,
  computeSvgTopologyScore,
  evaluateAriaState,
  evaluateSpatialBoundary,
  extractNamelessSvgCandidates,
  inferSvgTargetIntent,
  SvgIconCandidateInput,
} from './svg-icon-topology';

/**
 * HYBRID DOM DISTILLER (ENTERPRISE EDITION)
 * Trích xuất toàn diện mọi phần tử tương tác trên trang web thực tế:
 * 1. Đâm xuyên qua toàn bộ Open Shadow DOM (Custom Web Components).
 * 2. Đâm xuyên qua toàn bộ iFrames (Cổng thanh toán VNPay/OnePay, Modal nhúng, Chatbot).
 * 3. Prompt 10: Hit-testing đa điểm 5 điểm (Tâm + 4 góc an toàn cách mép 5px) & Safe Viewport Band
 *    giúp không bỏ sót phần tử bị che 1 phần và giữ tọa độ click vật lý an toàn.
 * 4. Prompt 12: Làm giàu phần tử Icon SVG không nhãn (0 text, 0 aria, 0 title) qua Structural Signature Bank,
 *    Spatial Boundary Proximity & ARIA State Dynamic Mapping (chống trùng lặp <button><span><svg/></span></button>
 *    và lọc bỏ spacer fill="none" stroke="none").
 * 5. Spatial Label Resolution: Tự động gom nhãn không gian theo khoảng cách tọa độ.
 * 6. Bắt các thẻ <div> / <span> giả nút bấm, ô swatch màu sắc, chip lọc.
 * 7. Card Indexing: Nhận diện danh sách thẻ lặp lại (Cards) để chọn "sản phẩm/video đầu tiên".
 */
export async function distillPageDOM(
  page: Page,
  queryHint?: string,
  contextHint?: string
): Promise<DOMCandidate[]> {
  const frames = page.frames();
  const allCandidates: DOMCandidate[] = [];
  let nextGlobalId = 1;

  // Prompt 10: Quét dải Viewport an toàn [H_top + 20px, ViewportHeight - H_bottom - 20px]
  const safeBand: SafeViewportBand | null = await detectSafeViewportBand(page).catch(() => null);

  for (let fIdx = 0; fIdx < frames.length; fIdx++) {
    const frame = frames[fIdx];
    try {
      // Đảm bảo helper __name của tsx/esbuild luôn sẵn sàng trước khi eval
      await frame.evaluate('var __name = globalThis.__name = window.__name = globalThis.__name || function(fn) { return fn; };');
    } catch {
      // Frame có thể đã đóng hoặc chuyển hướng
    }
    try {
      const candidates = await frame.evaluate(
        distillFrameEvaluator,
        {
          hint: queryHint,
          ctxHint: contextHint,
          startId: nextGlobalId,
          frameIndex: fIdx,
        }
      );
      for (const c of candidates) {
        c.frameIndex = fIdx;
        c.frameUrl = frame.url();
        if (fIdx === 0 && safeBand) {
          c.inSafeViewportBand = isRectInSafeViewportBand(c.rect, safeBand);
        }
        allCandidates.push(c);
        nextGlobalId = Math.max(nextGlobalId, c.candidateId + 1);
      }
    } catch {
      // Bỏ qua nếu frame đã bị hủy hoặc bảo mật cross-origin hạn chế
    }
  }

  // Prompt 12: Làm giàu các ứng viên Icon SVG không nhãn (0 text, 0 ariaLabel, 0 title)
  const namelessSvgCandidates = allCandidates.filter((c) => Boolean(c.svgMarkup));
  if (namelessSvgCandidates.length > 0) {
    const hasMainFrameNameless = namelessSvgCandidates.some((c) => c.frameIndex === 0);
    const extractedMainSvgs: SvgIconCandidateInput[] = hasMainFrameNameless
      ? await extractNamelessSvgCandidates(page).catch(() => [])
      : [];
    const usedExtractedIdx = new Set<number>();
    const intent = queryHint ? inferSvgTargetIntent(queryHint).intent : 'unknown';

    for (const cand of namelessSvgCandidates) {
      let matchedSvgInput: SvgIconCandidateInput | null = null;

      if (cand.frameIndex === 0 && extractedMainSvgs.length > 0) {
        // Ưu tiên khớp theo elemId
        if (cand.elemId) {
          const idxById = extractedMainSvgs.findIndex(
            (s, i) => !usedExtractedIdx.has(i) && s.elemId === cand.elemId
          );
          if (idxById >= 0) {
            usedExtractedIdx.add(idxById);
            matchedSvgInput = extractedMainSvgs[idxById];
          }
        }
        // Khớp theo tọa độ hình học Bounding Box (sai số <= 6px)
        if (!matchedSvgInput) {
          let bestIdx = -1;
          let bestDist = Infinity;
          for (let i = 0; i < extractedMainSvgs.length; i++) {
            if (usedExtractedIdx.has(i)) continue;
            const s = extractedMainSvgs[i];
            const dist =
              Math.abs(s.rect.x - cand.rect.x) +
              Math.abs(s.rect.y - cand.rect.y) +
              Math.abs(s.rect.width - cand.rect.width) +
              Math.abs(s.rect.height - cand.rect.height);
            if (dist <= 24 && dist < bestDist) {
              bestDist = dist;
              bestIdx = i;
            }
          }
          if (bestIdx >= 0) {
            usedExtractedIdx.add(bestIdx);
            matchedSvgInput = extractedMainSvgs[bestIdx];
          }
        }
      }

      const svgSource = matchedSvgInput ? matchedSvgInput.svg : cand.svgMarkup!;
      const signature = classifySvgSignature(svgSource);
      const spatial = evaluateSpatialBoundary(
        matchedSvgInput ? matchedSvgInput.rect : cand.rect,
        matchedSvgInput?.sidebars || [],
        {
          intent,
          viewport: matchedSvgInput?.viewport,
          nearSearchInput: matchedSvgInput?.nearSearchInput,
          insideDialog: matchedSvgInput?.insideDialog,
          insideHeader: matchedSvgInput?.insideHeader,
        }
      );
      const ariaInfo = matchedSvgInput?.aria || {
        ariaExpanded: cand.ariaExpanded ?? null,
        ariaControls: cand.ariaControls ?? null,
      };
      const ariaEval = evaluateAriaState(ariaInfo, queryHint || '');
      const breakdown = computeSvgTopologyScore({
        signature,
        spatial,
        aria: ariaEval,
        targetHint: queryHint || '',
      });

      const labelParts = [signature.virtualLabel, ...ariaEval.virtualLabelBoost].filter(
        (s) => s && s.trim().length > 0
      );
      const virtualLabel = Array.from(new Set(labelParts.join(' ').split(/\s+/))).join(' ');

      cand.svgIconFamily = signature.family;
      cand.svgContext = spatial.contextTag;
      cand.virtualLabel = virtualLabel || undefined;
      cand.svgScore = queryHint ? breakdown.score : signature.confidence;
      cand.ariaExpanded = (ariaInfo.ariaExpanded as string | undefined) || cand.ariaExpanded;
      cand.ariaControls = (ariaInfo.ariaControls as string | undefined) || cand.ariaControls;
      cand.svgTopologyData = matchedSvgInput
        ? {
            ...matchedSvgInput,
            candidateId: cand.candidateId,
            selector: cand.selectorPath,
          }
        : {
            candidateId: cand.candidateId,
            selector: cand.selectorPath,
            tag: cand.tag,
            elemId: cand.elemId,
            rect: cand.rect,
            svg: cand.svgMarkup!,
            sidebars: [],
            aria: ariaInfo,
          };
    }
  }

  return allCandidates;
}

/**
 * Hàm đánh giá DOM chạy trực tiếp bên trong từng Frame của trình duyệt
 */
function distillFrameEvaluator({
  hint,
  ctxHint,
  startId,
  frameIndex,
}: {
  hint?: string;
  ctxHint?: string;
  startId: number;
  frameIndex: number;
}): DOMCandidate[] {
  const results: DOMCandidate[] = [];
  let nextId = startId;

  const norm = (s: string | null | undefined): string =>
    (s || '').replace(/\s+/g, ' ').trim();

  // Xóa đánh dấu cũ trong frame
  document
    .querySelectorAll('[data-autotest-id]')
    .forEach((el) => el.removeAttribute('data-autotest-id'));

  // 1. Nhận diện các Product / Video Cards / News Articles (danh sách sản phẩm, tin tức, kết quả)
  const cardSelectors = [
    'ytd-video-renderer',
    'ytd-rich-item-renderer',
    'ytd-compact-video-renderer',
    'article.product_pod',
    '.product-card',
    '.product-item',
    '.inventory_item',
    '[data-testid*="product"]',
    '[class*="product-card"]',
    '[class*="product-item"]',
    '[class*="item-card"]',
    'article',
    '.item-news',
    '.news-item',
    '.article-item',
    '.story',
    '.dt-news__item',
    '[class*="article-"]',
    '[class*="item-news"]',
    '[class*="news-item"]',
  ];
  const detectedCards: Element[] = [];
  for (const sel of cardSelectors) {
    const found = Array.from(document.querySelectorAll(sel)).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 60 && r.height > 60;
    });
    if (found.length > 0) {
      // Sắp xếp các card theo thứ tự hiển thị vật lý: từ trên xuống dưới, từ trái sang phải
      found.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        if (Math.abs(ra.top - rb.top) > 15) {
          return ra.top - rb.top;
        }
        return ra.left - rb.left;
      });
      detectedCards.push(...found);
      break;
    }
  }

  // Hàm hit-test đâm xuyên Open Shadow DOM tại tọa độ (px, py)
  function deepElementFromPoint(px: number, py: number): Element | null {
    let topEl = document.elementFromPoint(px, py);
    let guard = 0;
    while (topEl && (topEl as HTMLElement).shadowRoot && guard < 10) {
      const inner = (topEl as HTMLElement).shadowRoot!.elementFromPoint(px, py);
      if (!inner || inner === topEl) break;
      topEl = inner;
      guard++;
    }
    return topEl;
  }

  // Hàm kiểm tra phần tử có thực sự hiển thị về mặt vật lý không (Prompt 10: 5-Point Multi-Sampling Hit-Test)
  function isPhysicallyVisible(el: Element): {
    visible: boolean;
    rect: DOMRect;
    obscured: boolean;
    obscuredBy?: string;
    occlusionStatus?: 'EXPOSED' | 'PARTIALLY_OCCLUDED' | 'FULLY_OCCLUDED';
    safeClickPoint?: { x: number; y: number };
  } {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 2 || rect.height <= 2) {
      return { visible: false, rect, obscured: false };
    }
    const style = window.getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      parseFloat(style.opacity || '1') === 0
    ) {
      return { visible: false, rect, obscured: false };
    }

    // Kiểm tra toàn bộ tổ tiên xem có nằm trong vùng ẩn
    let parent: Element | null = el.parentElement;
    while (parent && parent !== document.body) {
      const pStyle = window.getComputedStyle(parent);
      if (
        pStyle.display === 'none' ||
        pStyle.visibility === 'hidden' ||
        parseFloat(pStyle.opacity || '1') === 0
      ) {
        return { visible: false, rect, obscured: false };
      }
      parent = parent.parentElement;
    }

    // Prompt 10: 5-Point Multi-Sampling Hit-Test (Tâm + 4 góc an toàn cách mép 5px, clamp cho phần tử nhỏ)
    const overlapsViewport =
      rect.bottom > 0 &&
      rect.top < window.innerHeight &&
      rect.right > 0 &&
      rect.left < window.innerWidth;

    if (overlapsViewport) {
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const insetX = Math.min(5, Math.max(1, rect.width * 0.25));
      const insetY = Math.min(5, Math.max(1, rect.height * 0.25));

      const samplePoints: [number, number][] = [
        [cx, cy],
        [rect.left + insetX, rect.top + insetY],
        [rect.right - insetX, rect.top + insetY],
        [rect.left + insetX, rect.bottom - insetY],
        [rect.right - insetX, rect.bottom - insetY],
      ];

      let testedCount = 0;
      let exposedCount = 0;
      let centerExposed = false;
      let firstExposedCorner: { x: number; y: number } | null = null;
      let firstObscuringDesc = '';

      for (let i = 0; i < samplePoints.length; i++) {
        const [px, py] = samplePoints[i];
        if (px < 0 || py < 0 || px >= window.innerWidth || py >= window.innerHeight) {
          continue;
        }
        testedCount++;
        const topEl = deepElementFromPoint(px, py);
        if (!topEl) {
          exposedCount++;
          if (i === 0) centerExposed = true;
          else if (!firstExposedCorner) firstExposedCorner = { x: px, y: py };
          continue;
        }

        const isRelated =
          el === topEl ||
          el.contains(topEl) ||
          topEl.contains(el) ||
          (el.tagName === 'INPUT' && topEl.tagName === 'LABEL');

        if (isRelated) {
          exposedCount++;
          if (i === 0) centerExposed = true;
          else if (!firstExposedCorner) firstExposedCorner = { x: px, y: py };
        } else if (!firstObscuringDesc) {
          const topClass = norm(topEl.className?.toString());
          const topTag = topEl.tagName.toLowerCase();
          firstObscuringDesc = `${topTag}${topClass ? '.' + topClass.split(' ').join('.') : ''}`;
        }
      }

      if (testedCount > 0) {
        if (exposedCount === 0) {
          return {
            visible: true,
            rect,
            obscured: true,
            obscuredBy: firstObscuringDesc,
            occlusionStatus: 'FULLY_OCCLUDED',
          };
        }
        if (centerExposed && exposedCount === testedCount) {
          return {
            visible: true,
            rect,
            obscured: false,
            occlusionStatus: 'EXPOSED',
            safeClickPoint: { x: Math.round(cx), y: Math.round(cy) },
          };
        }
        // Bị che 1 phần nhưng tâm hoặc >= 1 góc lộ diện -> KHÔNG bỏ sót, dịch chuyển tọa độ click an toàn!
        const safePt = centerExposed
          ? { x: Math.round(cx), y: Math.round(cy) }
          : { x: Math.round(firstExposedCorner!.x), y: Math.round(firstExposedCorner!.y) };
        return {
          visible: true,
          rect,
          obscured: false,
          obscuredBy: firstObscuringDesc || undefined,
          occlusionStatus: 'PARTIALLY_OCCLUDED',
          safeClickPoint: safePt,
        };
      }
    }

    return { visible: true, rect, obscured: false };
  }

  // Hàm tìm nhãn không gian (Spatial Label) cho ô input không theo chuẩn
  function findSpatialLabel(el: HTMLElement, rect: DOMRect): string {
    // Ưu tiên 1: Phần tử anh em đứng ngay trước trong cùng nhóm form
    if (el.previousElementSibling && norm(el.previousElementSibling.textContent)) {
      const sibText = norm(el.previousElementSibling.textContent);
      if (sibText.length <= 60) return sibText;
    }

    const id = el.getAttribute('id');
    if (id) {
      const explicitLabel = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (explicitLabel && norm(explicitLabel.textContent)) {
        return norm(explicitLabel.textContent);
      }
    }

    const wrappingLabel = el.closest('label');
    if (wrappingLabel && norm(wrappingLabel.textContent)) {
      return norm(wrappingLabel.textContent);
    }

    // Kiểm tra thẻ cha trực tiếp hoặc cha 2 cấp
    let p = el.parentElement;
    for (let depth = 0; depth < 2 && p; depth++) {
      const clone = p.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('input, button, select, textarea, script, style').forEach((n) => n.remove());
      const pText = norm(clone.textContent);
      if (pText && pText.length <= 60) {
        return pText;
      }
      p = p.parentElement;
    }

    // Quét theo tọa độ hình học: tìm thẻ text nằm ngay phía trên hoặc bên trái ô input
    const textCandidates = Array.from(
      document.querySelectorAll('label, span, div, p, td, th')
    );
    let bestText = '';
    let bestDist = 9999;

    for (const cand of textCandidates) {
      if (cand.contains(el) || el.contains(cand)) continue;
      const t = norm(cand.textContent);
      if (!t || t.length > 50) continue;
      const r = cand.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      const isAbove =
        r.bottom <= rect.top + 6 &&
        rect.top - r.bottom <= 45 &&
        Math.abs(r.left - rect.left) <= 100;

      const isLeft =
        r.right <= rect.left + 8 &&
        rect.left - r.right <= 180 &&
        Math.abs(r.top - rect.top) <= 24;

      if (isAbove || isLeft) {
        const dist = Math.hypot(r.left - rect.left, r.top - rect.top);
        if (dist < bestDist) {
          bestDist = dist;
          bestText = t;
        }
      }
    }

    return bestText;
  }

  // Hàm tìm ngữ cảnh nhóm (VD: "Màu sắc:", "Phân loại:")
  function findGroupContext(el: HTMLElement): string | undefined {
    let p = el.parentElement;
    for (let i = 0; i < 3 && p && p !== document.body; i++) {
      const labelEl = p.querySelector(
        '.group-label, .variant-label, .swatch-title, label, strong, b, h4, h5'
      );
      if (labelEl && !labelEl.contains(el)) {
        const t = norm(labelEl.textContent);
        if (t && t.length <= 40) return t;
      }
      const prev = p.previousElementSibling;
      if (prev) {
        const pt = norm(prev.textContent);
        if (pt && pt.length <= 40) return pt;
      }
      p = p.parentElement;
    }
    return undefined;
  }

  // Hàm kiểm tra phần tử có bị khóa (disabled) không
  function checkDisabledState(el: HTMLElement): { disabled: boolean; reason?: string } {
    const anyEl = el as HTMLInputElement | HTMLButtonElement;
    if (anyEl.disabled === true) {
      return { disabled: true, reason: 'Thuộc tính HTML disabled=true' };
    }
    if (el.getAttribute('aria-disabled') === 'true') {
      return { disabled: true, reason: 'Thuộc tính aria-disabled="true"' };
    }
    if (el.hasAttribute('data-disabled') || el.getAttribute('data-disabled') === 'true') {
      return { disabled: true, reason: 'Thuộc tính data-disabled="true"' };
    }
    const cls = (el.className?.toString() || '').toLowerCase();
    if (
      /\b(disabled|is-disabled|btn-disabled|out-of-stock|sold-out|locked)\b/.test(cls)
    ) {
      return { disabled: true, reason: `Class CSS khóa tương tác (${cls})` };
    }
    return { disabled: false };
  }

  // Hàm đâm xuyên qua toàn bộ Open Shadow DOM (Custom Web Components)
  function getAllElementsIncludingShadow(root: Document | ShadowRoot): Element[] {
    const elements: Element[] = [];
    const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let current = treeWalker.nextNode() as Element | null;
    while (current) {
      elements.push(current);
      if (current.shadowRoot) {
        elements.push(...getAllElementsIncludingShadow(current.shadowRoot));
      }
      current = treeWalker.nextNode() as Element | null;
    }
    return elements;
  }

  const hintLower = (hint || '').toLowerCase();
  const allElements = getAllElementsIncludingShadow(document);
  const seenSvgs = new Set<Element>();

  for (const rawEl of allElements) {
    if (!(rawEl instanceof HTMLElement)) continue;
    const tag = rawEl.tagName.toLowerCase();
    if (['script', 'style', 'meta', 'link', 'head', 'html', 'body', 'svg', 'path'].includes(tag)) {
      continue;
    }

    const role = rawEl.getAttribute('role') || undefined;
    const type = (rawEl as HTMLInputElement).type || undefined;
    const placeholder = rawEl.getAttribute('placeholder') || undefined;
    const name = rawEl.getAttribute('name') || undefined;
    const elemId = rawEl.id || undefined;
    const href = rawEl.getAttribute('href') || undefined;
    const ariaLabel = rawEl.getAttribute('aria-label') || undefined;
    const ariaExpanded = rawEl.getAttribute('aria-expanded') || undefined;
    const ariaControls = rawEl.getAttribute('aria-controls') || undefined;
    const titleAttr = rawEl.getAttribute('title') || undefined;
    const style = window.getComputedStyle(rawEl);

    const isStandardInteractive =
      ['input', 'textarea', 'select', 'button', 'a'].includes(tag) ||
      ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'menuitem', 'tab', 'option'].includes(
        role || ''
      ) ||
      rawEl.hasAttribute('onclick') ||
      rawEl.getAttribute('tabindex') === '0';

    const directText = norm(
      Array.from(rawEl.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join(' ')
    );
    const fullText = norm(rawEl.innerText || rawEl.textContent);

    const hasPointerCursor = style.cursor === 'pointer';
    const svgChild = rawEl.querySelector('svg');
    const isNestedInsideInteractive =
      !isStandardInteractive &&
      Boolean(rawEl.parentElement?.closest('button, a, [role="button"], [role="menuitem"], [onclick], [tabindex="0"]'));

    // Chống nhân bản ứng viên cho <button style="cursor:pointer"><span><svg/></span></button>
    if (isNestedInsideInteractive && svgChild && !fullText) {
      continue;
    }

    const isSmallLeafWithText =
      fullText.length > 0 &&
      fullText.length <= 60 &&
      rawEl.children.length <= 2;

    const isCustomPointerSvgTrigger =
      !isNestedInsideInteractive &&
      hasPointerCursor &&
      rawEl.children.length <= 2 &&
      Boolean(svgChild);

    const matchesHintKeyword =
      hintLower.length > 0 &&
      fullText.length > 0 &&
      fullText.length <= 80 &&
      (fullText.toLowerCase() === hintLower ||
        directText.toLowerCase().includes(hintLower));

    const isCustomInteractive =
      (hasPointerCursor && isSmallLeafWithText) ||
      isCustomPointerSvgTrigger ||
      matchesHintKeyword ||
      /\b(btn|button|swatch|color-option|variant|cart|checkout|search-btn|card-title|option|dropdown-item|ant-select|select-option|menu-item|item-option|combobox|select2)\b/i.test(
        rawEl.className?.toString() || ''
      );

    if (!isStandardInteractive && !isCustomInteractive) {
      continue;
    }

    // Bỏ qua thẻ bao ngoài nếu bên trong đã có button/a/input con cụ thể hơn
    if (
      !['input', 'textarea', 'select', 'button', 'a'].includes(tag) &&
      rawEl.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="menuitem"], [onclick], [tabindex="0"]').length >= 1
    ) {
      continue;
    }

    const vis = isPhysicallyVisible(rawEl);
    if (!vis.visible) continue;

    // Prompt 12: Nhận diện ứng viên Icon SVG không nhãn (0 visible text, 0 aria-label, 0 title)
    let svgMarkup: string | undefined;
    if (svgChild && !seenSvgs.has(svgChild)) {
      const cloneForText = rawEl.cloneNode(true) as HTMLElement;
      cloneForText
        .querySelectorAll('svg, .sr-only, .visually-hidden, .screen-reader-text')
        .forEach((n) => n.remove());
      const nonSvgText = norm(cloneForText.textContent);
      if (!nonSvgText && !ariaLabel && !titleAttr) {
        seenSvgs.add(svgChild);
        svgMarkup = svgChild.outerHTML;
      }
    }

    const candidateId = nextId++;
    rawEl.setAttribute('data-autotest-id', String(candidateId));

    const isInputButton =
      tag === 'input' && ['submit', 'button', 'reset'].includes(type || '');

    const nearLabel =
      ['input', 'textarea', 'select'].includes(tag) && !isInputButton
        ? findSpatialLabel(rawEl, vis.rect)
        : undefined;

    const groupContext = findGroupContext(rawEl);
    const dis = checkDisabledState(rawEl);

    let isCardItem = false;
    let cardIndex: number | undefined;
    for (let idx = 0; idx < detectedCards.length; idx++) {
      if (detectedCards[idx].contains(rawEl)) {
        const isPrimaryTrigger =
          rawEl.id === 'video-title' ||
          rawEl.id === 'video-title-link' ||
          tag === 'a' ||
          tag === 'button' ||
          /\b(title|name|product-link|inventory_item_name|card-link|item-news|headline|thumb)\b/i.test(
            rawEl.className?.toString() || ''
          ) ||
          rawEl === detectedCards[idx];
        if (isPrimaryTrigger) {
          isCardItem = true;
          cardIndex = idx + 1;
        }
        break;
      }
    }

    const stableClasses = (rawEl.className?.toString() || '')
      .split(/\s+/)
      .filter((c) => c && !/^(active|focus|hover|jsx-\d+|css-[a-z0-9]+)$/i.test(c))
      .slice(0, 4);

    const selectorPath = `[data-autotest-id="${candidateId}"]`;

    const inputBtnVal = isInputButton ? norm((rawEl as HTMLInputElement).value) : '';
    const displayText =
      fullText ||
      inputBtnVal ||
      ariaLabel ||
      rawEl.getAttribute('title') ||
      rawEl.getAttribute('data-testid') ||
      '';

    results.push({
      candidateId,
      tag,
      type,
      role,
      text: displayText.slice(0, 120),
      value: (rawEl as HTMLInputElement).value || undefined,
      placeholder,
      name,
      elemId,
      href,
      ariaLabel,
      nearLabel,
      groupContext,
      isCardItem,
      cardIndex,
      disabled: dis.disabled,
      disabledReason: dis.reason,
      obscured: vis.obscured,
      obscuredBy: vis.obscuredBy,
      occlusionStatus: vis.occlusionStatus,
      safeClickPoint: vis.safeClickPoint,
      svgMarkup,
      ariaExpanded,
      ariaControls,
      rect: {
        x: Math.round(vis.rect.left),
        y: Math.round(vis.rect.top),
        width: Math.round(vis.rect.width),
        height: Math.round(vis.rect.height),
      },
      selectorPath,
      fingerprint: {
        tag,
        id: elemId,
        name,
        type,
        role,
        placeholder,
        ariaLabel,
        nearLabel,
        text: displayText.slice(0, 80),
        stableClasses,
        selectorPath,
      },
    });

    // Nếu phần tử là thẻ <select> native, trích xuất luôn các thẻ <option> con
    if (tag === 'select') {
      const selectEl = rawEl as HTMLSelectElement;
      Array.from(selectEl.options).forEach((opt) => {
        const optText = norm(opt.textContent);
        if (!optText) return;
        const optCandId = nextId++;
        opt.setAttribute('data-autotest-id', String(optCandId));
        const optSelPath = `[data-autotest-id="${optCandId}"]`;
        results.push({
          candidateId: optCandId,
          tag: 'option',
          text: optText.slice(0, 120),
          value: opt.value,
          nearLabel,
          disabled: dis.disabled || opt.disabled,
          obscured: vis.obscured,
          rect: {
            x: Math.round(vis.rect.left),
            y: Math.round(vis.rect.top),
            width: Math.round(vis.rect.width),
            height: Math.round(vis.rect.height),
          },
          selectorPath: optSelPath,
          fingerprint: {
            tag: 'option',
            text: optText.slice(0, 80),
            stableClasses: [],
            selectorPath: optSelPath,
          },
        });
      });
    }
  }

  return results;
}
