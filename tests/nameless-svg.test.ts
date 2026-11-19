import test from 'node:test';
import assert from 'node:assert';
import * as http from 'http';
import { chromium, Browser } from 'playwright';
import {
  SVG_CANONICAL_SIZE,
  SVG_SCORE_WEIGHTS,
  SVG_AUTO_CLICK_MIN_SCORE,
  SVG_AUTO_CLICK_MIN_MARGIN,
  parseSvgPathData,
  parseSvgMarkup,
  normalizeSvgGeometry,
  classifySvgSignature,
  evaluateSpatialBoundary,
  evaluateAriaState,
  computeSvgTopologyScore,
  resolveNamelessSvgCandidates,
  probeHoverTooltip,
  extractNamelessSvgCandidates,
  resolveNamelessSvgOnPage,
  SidebarContainerInfo,
  SvgIconCandidateInput,
} from '../src/svg-icon-topology';

// ============================================================================
// HELPER: MOCK HTTP SERVER + PLAYWRIGHT PAGE WITH __name GUARD & SAFE CLEANUP
// ============================================================================

async function withMockHtmlPage<T>(
  html: string,
  fn: (ctx: { page: import('playwright').Page; url: string }) => Promise<T>
): Promise<T> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}`;

  const closeServer = async (): Promise<void> => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // Prevent tsx/esbuild __name ReferenceError inside browser page.evaluate()
    await context.addInitScript(() => {
      (window as any).__name = (globalThis as any).__name = (fnRef: any) => fnRef;
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return await fn({ page, url });
  } finally {
    if (browser) {
      await browser.close();
    }
    await closeServer();
  }
}

// ============================================================================
// 1. UNIT TESTS: VECTOR PATH PARSER & VIEWBOX-INDEPENDENT NORMALIZER [0, 24]
// ============================================================================

test('Prompt 12 - ViewBox Independence: Same icon in 1024x1024, 32x32, 24x24, 16x16 normalizes identically to [0,24]x[0,24]', () => {
  const svg24 = `<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>`;
  const svg16 = `<svg viewBox="0 0 16 16"><path d="M2.666667 4h10.666667M2.666667 8h10.666667M2.666667 12h10.666667"/></svg>`;
  const svg32 = `<svg viewBox="0 0 32 32"><path d="M5.333333 8h21.333333M5.333333 16h21.333333M5.333333 24h21.333333"/></svg>`;
  const svg1024 = `<svg viewBox="0 0 1024 1024"><path d="M170.6667 256h682.6667M170.6667 512h682.6667M170.6667 768h682.6667"/></svg>`;

  const n24 = normalizeSvgGeometry(svg24);
  const n16 = normalizeSvgGeometry(svg16);
  const n32 = normalizeSvgGeometry(svg32);
  const n1024 = normalizeSvgGeometry(svg1024);

  assert.strictEqual(n24.canonicalSize, SVG_CANONICAL_SIZE);
  assert.strictEqual(n24.subpaths.length, 3);
  assert.strictEqual(n16.subpaths.length, 3);
  assert.strictEqual(n32.subpaths.length, 3);
  assert.strictEqual(n1024.subpaths.length, 3);

  for (const norm of [n16, n32, n1024]) {
    assert.ok(Math.abs(norm.overallBBox.minX - n24.overallBBox.minX) < 0.02, 'minX phải khớp sau chuẩn hóa');
    assert.ok(Math.abs(norm.overallBBox.maxX - n24.overallBBox.maxX) < 0.02, 'maxX phải khớp sau chuẩn hóa');
    assert.ok(Math.abs(norm.overallBBox.minY - n24.overallBBox.minY) < 0.02, 'minY phải khớp sau chuẩn hóa');
    assert.ok(Math.abs(norm.overallBBox.maxY - n24.overallBBox.maxY) < 0.02, 'maxY phải khớp sau chuẩn hóa');

    for (let i = 0; i < 3; i++) {
      assert.ok(
        Math.abs(norm.subpaths[i].bbox.cy - n24.subpaths[i].bbox.cy) < 0.02,
        `Bar ${i} cy phải giống hệt nhau giữa các viewBox`
      );
      assert.ok(
        Math.abs(norm.subpaths[i].bbox.width - n24.subpaths[i].bbox.width) < 0.02,
        `Bar ${i} width phải giống hệt nhau giữa các viewBox`
      );
    }
  }

  // Missing viewBox fallback also normalizes cleanly into [0, 24] x [0, 24] and classifies properly
  const svgNoViewBox = `<svg><path d="M100 150h400M100 300h400M100 450h400"/></svg>`;
  const nNoVb = normalizeSvgGeometry(svgNoViewBox);
  assert.ok(nNoVb.overallBBox.minX >= 0 && nNoVb.overallBBox.maxX <= 24);
  assert.ok(nNoVb.overallBBox.minY >= 0 && nNoVb.overallBBox.maxY <= 24);
  assert.strictEqual(classifySvgSignature(nNoVb).family, 'hamburger');
});

test('Prompt 12 - SVG Path Parser: Supports all SVG path commands (M/m, L/l, H/h, V/v, C/c, S/s, Q/q, T/t, A/a, Z/z)', () => {
  // Compact arc flags (Heroicons Search): "A7.5 7.5 0 105.196 5.196"
  const heroSearch = parseSvgPathData(
    'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z'
  );
  assert.strictEqual(heroSearch.length, 2, 'Phải tách đúng 2 subpath (tay cầm + vòng cung tròn)');
  assert.strictEqual(heroSearch[1].hasArcs, true);
  assert.strictEqual(heroSearch[1].closed, true);

  // Cubic + Smooth Cubic + Quad + Smooth Quad + H + V + Z
  const complexPath = parseSvgPathData(
    'M2 2 H10 V10 C12 10 14 12 14 14 S18 18 20 18 Q21 20 22 22 T23 23 L2 23 Z'
  );
  assert.strictEqual(complexPath.length, 1);
  assert.strictEqual(complexPath[0].closed, true);
  assert.strictEqual(complexPath[0].hasCurves, true);
  assert.ok(complexPath[0].points.length >= 25, 'Phải lấy mẫu đủ điểm trên đường cong Bezier');
});

// ============================================================================
// 2. UNIT TESTS: GEOMETRIC STRUCTURAL SIGNATURE BANK (ALL 6 FAMILIES)
// ============================================================================

test('Prompt 12 - Signature Bank: Hamburger Menu across path, <line>, <rect>, and Material filled variants', () => {
  const variants = [
    `<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>`,
    `<svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
    `<svg viewBox="0 0 1024 1024"><rect x="128" y="213" width="768" height="85"/><rect x="128" y="469" width="768" height="85"/><rect x="128" y="725" width="768" height="85"/></svg>`,
    `<svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>`,
  ];

  for (const markup of variants) {
    const sig = classifySvgSignature(markup);
    assert.strictEqual(sig.family, 'hamburger', `Phải nhận diện hamburger cho: ${markup}`);
    assert.ok(sig.confidence >= 0.95);
    assert.ok(sig.virtualLabel.includes('menu'));
    assert.ok(sig.virtualLabel.includes('mở menu'));
  }
});

test('Prompt 12 - Signature Bank: Chevron-Left / Chevron-Right / Double Chevron / Fold Collapse', () => {
  const leftVariants = [
    `<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>`, // Lucide ChevronLeft
    `<svg viewBox="0 0 24 24"><path d="M11 17l-5-5 5-5"/><path d="M18 17l-5-5 5-5"/></svg>`, // Double chevron left
    `<svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>`, // Material filled chevron left
    `<svg viewBox="0 0 24 24"><path d="M3 19V5"/><path d="m13 6-6 6 6 6"/><path d="M7 12h14"/></svg>`, // ArrowLeftToLine
  ];

  for (const markup of leftVariants) {
    const sig = classifySvgSignature(markup);
    assert.strictEqual(sig.family, 'chevron_left', `Phải nhận diện chevron_left cho: ${markup}`);
    assert.ok(sig.confidence >= 0.95);
    assert.ok(sig.virtualLabel.includes('thu gọn'));
    assert.ok(sig.virtualLabel.includes('collapse'));
  }

  const rightSvg = `<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>`;
  const rightSig = classifySvgSignature(rightSvg);
  assert.strictEqual(rightSig.family, 'chevron_right');
  assert.ok(rightSig.virtualLabel.includes('mở rộng'));
  assert.ok(rightSig.virtualLabel.includes('expand'));
});

test('Prompt 12 - Signature Bank: Sidebar Layout Column Icon across <rect>+<line>, PanelLeftClose, rounded <path>', () => {
  const variants = [
    `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`,
    `<svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg>`,
    `<svg viewBox="0 0 24 24"><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M9 3v18"/></svg>`,
    `<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="18" rx="2"/><rect x="4" y="5" width="5" height="14" rx="1"/></svg>`,
  ];

  for (const markup of variants) {
    const sig = classifySvgSignature(markup);
    assert.strictEqual(sig.family, 'sidebar_layout', `Phải nhận diện sidebar_layout cho: ${markup}`);
    assert.ok(sig.confidence >= 0.95);
    assert.ok(sig.virtualLabel.includes('sidebar'));
    assert.ok(sig.virtualLabel.includes('thu gọn'));
  }
});

test('Prompt 12 - Signature Bank: Close (X), Search (Magnifying Glass), Settings (Gear)', () => {
  // Close variants
  const closeVariants = [
    `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    `<svg viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>`,
    `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
  ];
  for (const m of closeVariants) {
    const sig = classifySvgSignature(m);
    assert.strictEqual(sig.family, 'close', `Phải nhận diện close cho: ${m}`);
    assert.ok(sig.virtualLabel.includes('đóng'));
    assert.ok(sig.virtualLabel.includes('close'));
  }

  // Search variants (Lucide, Heroicons compact arc, Material filled)
  const searchVariants = [
    `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    `<svg viewBox="0 0 24 24"><path d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>`,
    `<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`,
  ];
  for (const m of searchVariants) {
    const sig = classifySvgSignature(m);
    assert.strictEqual(sig.family, 'search', `Phải nhận diện search cho: ${m}`);
    assert.ok(sig.virtualLabel.includes('tìm kiếm'));
    assert.ok(sig.virtualLabel.includes('kính lúp'));
  }

  // Settings (Gear) variants: Lucide, Material, radial-spokes
  const settingsVariants = [
    `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    `<svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`,
    `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.9" y1="4.9" x2="7.1" y2="7.1"/><line x1="16.9" y1="16.9" x2="19.1" y2="19.1"/><line x1="19.1" y1="4.9" x2="16.9" y2="7.1"/><line x1="7.1" y1="16.9" x2="4.9" y2="19.1"/></svg>`,
  ];
  for (const m of settingsVariants) {
    const sig = classifySvgSignature(m);
    assert.strictEqual(sig.family, 'settings', `Phải nhận diện settings cho: ${m.slice(0, 80)}`);
    assert.ok(sig.virtualLabel.includes('cài đặt'));
    assert.ok(sig.virtualLabel.includes('settings'));
  }
});

// ============================================================================
// 3. UNIT TESTS: SPATIAL BOUNDARY PROXIMITY & ARIA STATE DYNAMIC MAPPING
// ============================================================================

test('Prompt 12 - Spatial Boundary Proximity: <= 25px of Sidebar edge & top-left corner (x<80, y<80)', () => {
  const sidebars: SidebarContainerInfo[] = [
    {
      tag: 'aside',
      id: 'app-sidebar',
      className: 'ant-layout-sider',
      rect: { x: 0, y: 0, width: 240, height: 800 },
    },
  ];

  // Button 8px outside sidebar right edge -> Sidebar Boundary Control
  const nearRight = evaluateSpatialBoundary(
    { x: 248, y: 24, width: 32, height: 32 },
    sidebars,
    { intent: 'collapse' }
  );
  assert.strictEqual(nearRight.distanceToSidebarEdge, 8);
  assert.strictEqual(nearRight.isNearSidebarBoundary, true);
  assert.strictEqual(nearRight.contextTag, 'Sidebar Boundary Control');
  assert.ok(nearRight.spatialScore >= 0.90);

  // Button at top-left (x=16, y=14) with NO sidebar mounted -> still Sidebar Boundary Control
  const topLeft = evaluateSpatialBoundary(
    { x: 16, y: 14, width: 36, height: 36 },
    [],
    { intent: 'menu_open' }
  );
  assert.strictEqual(topLeft.isTopLeftCorner, true);
  assert.strictEqual(topLeft.contextTag, 'Sidebar Boundary Control');
  assert.ok(topLeft.spatialScore >= 0.88);

  // Button far in main content area -> NOT Sidebar Boundary Control
  const farAway = evaluateSpatialBoundary(
    { x: 640, y: 400, width: 32, height: 32 },
    sidebars,
    { intent: 'collapse' }
  );
  assert.strictEqual(farAway.isNearSidebarBoundary, false);
  assert.strictEqual(farAway.isTopLeftCorner, false);
  assert.notStrictEqual(farAway.contextTag, 'Sidebar Boundary Control');
  assert.ok(farAway.spatialScore < 0.40);
});

test('Prompt 12 - ARIA State Dynamic Mapping: Disambiguates collapse vs expand via aria-expanded & aria-controls', () => {
  const ariaOpen = evaluateAriaState(
    { ariaExpanded: 'true', ariaControls: 'main-sidebar' },
    'Bấm thu gọn menu'
  );
  assert.strictEqual(ariaOpen.observed, true);
  assert.strictEqual(ariaOpen.disambiguatedAction, 'collapse');
  assert.strictEqual(ariaOpen.conflict, false);
  assert.strictEqual(ariaOpen.S_aria_state, 1.0);

  // Opposite state (aria-expanded="false") conflicts with collapse intent
  const ariaClosedForCollapse = evaluateAriaState(
    { ariaExpanded: 'false', ariaControls: 'main-sidebar' },
    'Bấm thu gọn menu'
  );
  assert.strictEqual(ariaClosedForCollapse.conflict, true);
  assert.strictEqual(ariaClosedForCollapse.S_aria_state, 0.0);

  // Same closed state boosts expand intent
  const ariaClosedForExpand = evaluateAriaState(
    { ariaExpanded: 'false', ariaControls: 'main-sidebar' },
    'Mở rộng sidebar'
  );
  assert.strictEqual(ariaClosedForExpand.conflict, false);
  assert.strictEqual(ariaClosedForExpand.disambiguatedAction, 'expand');
  assert.strictEqual(ariaClosedForExpand.S_aria_state, 1.0);
});

test('Prompt 12 - 4-Weight Scoring Formula (0.4/0.3/0.2/0.1) & Calibration Verification', () => {
  assert.deepStrictEqual(SVG_SCORE_WEIGHTS, { vector: 0.4, spatial: 0.3, aria: 0.2, tooltip: 0.1 });

  const sig = classifySvgSignature(`<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>`);
  const spatial = evaluateSpatialBoundary(
    { x: 244, y: 16, width: 32, height: 32 },
    [{ tag: 'aside', rect: { x: 0, y: 0, width: 240, height: 800 } }],
    { intent: 'collapse' }
  );

  // Case A: All 4 signals observed and confirming -> exact 4-weight formula
  const fullAria = evaluateAriaState(
    { ariaExpanded: 'true', ariaControls: 'sidebar' },
    'Bấm thu gọn menu'
  );
  const fullScore = computeSvgTopologyScore({
    signature: sig,
    spatial,
    aria: fullAria,
    tooltip: { found: true, tooltipText: 'Thu gọn menu', source: 'role-tooltip', score: 1.0 },
    targetHint: 'Bấm thu gọn menu',
  });
  const expectedExact =
    Math.round(
      (0.4 * fullScore.components.S_vector +
        0.3 * fullScore.components.S_spatial +
        0.2 * fullScore.components.S_aria_state +
        0.1 * fullScore.components.S_tooltip) *
        10000
    ) / 10000;
  assert.strictEqual(fullScore.score, expectedExact);
  assert.strictEqual(fullScore.score, fullScore.rawWeightedScore);
  assert.ok(fullScore.score >= 0.95);

  // Case B: Pure 0-text, 0-ARIA, 0-tooltip button at sidebar boundary STILL achieves >= 0.85
  const noAria = evaluateAriaState(undefined, 'Bấm thu gọn menu');
  const zeroAriaScore = computeSvgTopologyScore({
    signature: sig,
    spatial,
    aria: noAria,
    targetHint: 'Bấm thu gọn menu',
  });
  assert.ok(
    zeroAriaScore.score >= SVG_AUTO_CLICK_MIN_SCORE,
    `0-ARIA sidebar icon (${zeroAriaScore.score}) phải >= 0.85`
  );
  assert.ok(
    fullScore.score > zeroAriaScore.score,
    'Nút có xác nhận ARIA + Tooltip phải đạt điểm cao hơn nút 0-ARIA'
  );

  // Case C: Conflicting ARIA (aria-expanded="false" when asked to collapse) drops below 0.85!
  const conflictAria = evaluateAriaState(
    { ariaExpanded: 'false', ariaControls: 'sidebar' },
    'Bấm thu gọn menu'
  );
  const conflictScore = computeSvgTopologyScore({
    signature: sig,
    spatial,
    aria: conflictAria,
    targetHint: 'Bấm thu gọn menu',
  });
  assert.ok(
    conflictScore.score < SVG_AUTO_CLICK_MIN_SCORE,
    `ARIA xung đột (${conflictScore.score}) phải bị chặn dưới ngưỡng 0.85`
  );
});

test('Prompt 12 - Safety Margin Dispute (Unit): Two identical nameless SVG icons fail Delta_margin < 20%', () => {
  const sidebar: SidebarContainerInfo[] = [
    { tag: 'aside', rect: { x: 0, y: 0, width: 240, height: 800 } },
  ];
  const sameChevron = `<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>`;
  const candidates: SvgIconCandidateInput[] = [
    {
      candidateId: 1,
      selector: '#collapse-1',
      tag: 'button',
      rect: { x: 244, y: 20, width: 32, height: 32 },
      svg: sameChevron,
      sidebars: sidebar,
    },
    {
      candidateId: 2,
      selector: '#collapse-2',
      tag: 'button',
      rect: { x: 244, y: 64, width: 32, height: 32 },
      svg: sameChevron,
      sidebars: sidebar,
    },
  ];

  const res = resolveNamelessSvgCandidates(candidates, 'Bấm thu gọn menu');
  assert.strictEqual(res.status, 'AMBIGUOUS_MARGIN');
  assert.strictEqual(res.safeToClick, false, 'Không được tự ý bấm mù khi 2 nút SVG trùng lặp');
  assert.strictEqual(res.selectedCandidate, null);
  assert.ok(res.deltaMargin < SVG_AUTO_CLICK_MIN_MARGIN, `Delta (${res.deltaMargin}) phải < 0.20`);
});

// ============================================================================
// 4. REAL PLAYWRIGHT CHROMIUM INTEGRATION TESTS
// ============================================================================

test('Prompt 12 - Playwright Integration 1: 0-text 0-aria 0-title Sidebar Collapse SVG maps to "Bấm thu gọn menu" & "Đóng sidebar"', async () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { margin: 0; font-family: sans-serif; display: flex; }
          aside.ant-layout-sider { width: 240px; height: 100vh; background: #001529; color: #fff; position: relative; transition: width 0.1s; }
          aside.collapsed { width: 64px; }
          main { flex: 1; padding: 16px; position: relative; }
          header { display: flex; align-items: center; gap: 16px; height: 56px; border-bottom: 1px solid #eee; }
          button.icon-btn { width: 36px; height: 36px; border: 1px solid #ddd; background: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
          #btn-collapse { position: absolute; top: 16px; left: 6px; }
          #btn-carousel-prev { position: absolute; top: 420px; left: 480px; }
          .search-wrap { margin-left: auto; display: flex; align-items: center; gap: 4px; }
        </style>
      </head>
      <body>
        <aside id="left-sidebar" class="ant-layout-sider">
          <div style="padding:16px">Dashboard</div>
        </aside>
        <main>
          <!-- Pure nameless Sidebar Collapse button: 0 innerText, 0 aria-label, 0 aria-expanded, 0 title -->
          <button id="btn-collapse" class="icon-btn" onclick="document.getElementById('left-sidebar').classList.toggle('collapsed'); window.__collapsedClicked = true;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 18l-6-6 6-6"></path>
            </svg>
          </button>

          <header>
            <div class="search-wrap">
              <input type="search" placeholder="Tìm sản phẩm..." />
              <button id="btn-search" class="icon-btn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </button>
              <button id="btn-settings" class="icon-btn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
              </button>
            </div>
          </header>

          <!-- Distractor chevron-left inside a far-away carousel in middle of page -->
          <button id="btn-carousel-prev" class="icon-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 18l-6-6 6-6"></path>
            </svg>
          </button>
        </main>
      </body>
    </html>
  `;

  await withMockHtmlPage(html, async ({ page }) => {
    const res1 = await resolveNamelessSvgOnPage(page, 'Bấm thu gọn menu', {
      enableHoverTooltipProbe: false,
    });
    assert.strictEqual(res1.status, 'RESOLVED', `Expected RESOLVED, got: ${res1.reasoning}`);
    assert.strictEqual(res1.safeToClick, true);
    assert.strictEqual(res1.selectedCandidate?.elemId, 'btn-collapse');
    assert.strictEqual(res1.vectorFamily, 'chevron_left');
    assert.strictEqual(res1.context, 'Sidebar Boundary Control');
    assert.ok(res1.topScore >= 0.85, `Score (${res1.topScore}) phải >= 0.85`);
    assert.ok(
      res1.deltaMargin >= 0.20,
      `Delta margin (${res1.deltaMargin}) so với chevron carousel phải >= 0.20`
    );

    const res2 = await resolveNamelessSvgOnPage(page, 'Đóng sidebar', {
      enableHoverTooltipProbe: false,
    });
    assert.strictEqual(res2.status, 'RESOLVED', `Expected RESOLVED for "Đóng sidebar", got: ${res2.reasoning}`);
    assert.strictEqual(res2.safeToClick, true);
    assert.strictEqual(res2.selectedCandidate?.elemId, 'btn-collapse');
    assert.ok(res2.topScore >= 0.85);
    assert.ok(res2.deltaMargin >= 0.20);

    // Physical click on resolved target verifies sidebar collapses
    await page.click(res2.selectedCandidate!.selector);
    const clicked = await page.evaluate(() => (window as any).__collapsedClicked);
    const isCollapsed = await page.evaluate(() =>
      document.getElementById('left-sidebar')?.classList.contains('collapsed')
    );
    assert.strictEqual(clicked, true);
    assert.strictEqual(isCollapsed, true);
  });
});

test('Prompt 12 - Playwright Integration 2: Hamburger SVG maps to "Mở menu" & Search SVG maps to "Tìm kiếm"', async () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { margin: 0; font-family: sans-serif; }
          header { height: 60px; display: flex; align-items: center; padding: 0 16px; gap: 16px; border-bottom: 1px solid #ddd; }
          button.icon-btn { width: 36px; height: 36px; border: 1px solid #ccc; background: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
          .search-box { margin-left: auto; display: flex; align-items: center; gap: 6px; }
        </style>
      </head>
      <body>
        <header>
          <!-- Nameless Hamburger Menu SVG at top-left (x=16, y=12) -->
          <button id="btn-hamburger" class="icon-btn" onclick="window.__menuOpened = true;">
            <svg width="24" height="24" viewBox="0 0 1024 1024" stroke="currentColor" stroke-width="64">
              <path d="M170.67 256h682.67M170.67 512h682.67M170.67 768h682.67"></path>
            </svg>
          </button>

          <div class="search-box">
            <input type="search" placeholder="Nhập từ khóa..." />
            <!-- Nameless Search Magnifying Glass SVG (0 text, 0 aria, 0 title) -->
            <button id="btn-search" class="icon-btn" onclick="window.__searchTriggered = true;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </button>
          </div>

          <!-- Nameless Close X SVG -->
          <button id="btn-close" class="icon-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </header>
      </body>
    </html>
  `;

  await withMockHtmlPage(html, async ({ page }) => {
    // 1. "Mở menu" -> Hamburger button (even in 1024x1024 viewBox!)
    const menuRes = await resolveNamelessSvgOnPage(page, 'Mở menu', {
      enableHoverTooltipProbe: false,
    });
    assert.strictEqual(menuRes.status, 'RESOLVED', `Expected RESOLVED for "Mở menu", got: ${menuRes.reasoning}`);
    assert.strictEqual(menuRes.safeToClick, true);
    assert.strictEqual(menuRes.selectedCandidate?.elemId, 'btn-hamburger');
    assert.strictEqual(menuRes.vectorFamily, 'hamburger');
    assert.strictEqual(menuRes.context, 'Sidebar Boundary Control');
    assert.ok(menuRes.topScore >= 0.85);
    assert.ok(menuRes.deltaMargin >= 0.20);

    await page.click(menuRes.selectedCandidate!.selector);
    assert.strictEqual(await page.evaluate(() => (window as any).__menuOpened), true);

    // 2. "Tìm kiếm" -> Search magnifying glass button
    const searchRes = await resolveNamelessSvgOnPage(page, 'Tìm kiếm', {
      enableHoverTooltipProbe: false,
    });
    assert.strictEqual(searchRes.status, 'RESOLVED', `Expected RESOLVED for "Tìm kiếm", got: ${searchRes.reasoning}`);
    assert.strictEqual(searchRes.safeToClick, true);
    assert.strictEqual(searchRes.selectedCandidate?.elemId, 'btn-search');
    assert.strictEqual(searchRes.vectorFamily, 'search');
    assert.ok(searchRes.topScore >= 0.85);
    assert.ok(searchRes.deltaMargin >= 0.20);

    await page.click(searchRes.selectedCandidate!.selector);
    assert.strictEqual(await page.evaluate(() => (window as any).__searchTriggered), true);
  });
});

test('Prompt 12 - Playwright Integration 3: Synthetic Hover Tooltip Trap reveals [role="tooltip"] & breaks tie', async () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { margin: 0; font-family: sans-serif; display: flex; }
          aside { width: 220px; height: 100vh; background: #1e293b; }
          .toolbar { padding: 8px; display: flex; flex-direction: column; gap: 12px; position: relative; }
          button.icon-btn { width: 36px; height: 36px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
          #dynamic-tooltip {
            position: fixed;
            display: none;
            background: #111827;
            color: #fff;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            pointer-events: none;
          }
        </style>
      </head>
      <body>
        <aside class="sidebar"></aside>
        <div class="toolbar">
          <!-- Two visually identical nameless sidebar-layout SVG buttons near sidebar boundary!
               Only hover tooltip distinguishes them: #btn-tip-collapse reveals "Thu gọn menu",
               while #btn-tip-settings reveals "Cài đặt hệ thống". -->
          <button id="btn-tip-collapse" class="icon-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"></rect>
              <line x1="9" y1="3" x2="9" y2="21"></line>
            </svg>
          </button>

          <button id="btn-tip-settings" class="icon-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"></rect>
              <line x1="9" y1="3" x2="9" y2="21"></line>
            </svg>
          </button>

          <button id="btn-sr-only" class="icon-btn" data-tooltip="Đóng hộp thoại">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div id="dynamic-tooltip" role="tooltip"></div>

        <script>
          const tip = document.getElementById('dynamic-tooltip');
          const bindTooltip = (id, text) => {
            const btn = document.getElementById(id);
            btn.addEventListener('mouseenter', () => {
              const r = btn.getBoundingClientRect();
              tip.textContent = text;
              tip.style.left = r.left + 'px';
              tip.style.top = (r.bottom + 6) + 'px';
              tip.style.display = 'block';
            });
            btn.addEventListener('mouseleave', () => {
              tip.style.display = 'none';
              tip.textContent = '';
            });
          };
          bindTooltip('btn-tip-collapse', 'Thu gọn menu');
          bindTooltip('btn-tip-settings', 'Cài đặt hệ thống');
        </script>
      </body>
    </html>
  `;

  await withMockHtmlPage(html, async ({ page }) => {
    // Direct probeHoverTooltip check on dynamic [role="tooltip"]
    const tip1 = await probeHoverTooltip(page, '#btn-tip-collapse', {
      targetHint: 'Bấm thu gọn menu',
      waitMs: 300,
    });
    assert.strictEqual(tip1.found, true, 'Phải bắt được tooltip động khi hover');
    assert.strictEqual(tip1.source, 'role-tooltip');
    assert.strictEqual(tip1.tooltipText, 'Thu gọn menu');
    assert.ok(tip1.score >= 0.90, `S_tooltip (${tip1.score}) phải >= 0.90`);

    // Static data-tooltip harvesting check
    const tip3 = await probeHoverTooltip(page, '#btn-sr-only', {
      targetHint: 'Đóng hộp thoại',
      waitMs: 120,
    });
    assert.strictEqual(tip3.found, true);
    assert.strictEqual(tip3.source, 'data-tooltip');
    assert.strictEqual(tip3.tooltipText, 'Đóng hộp thoại');
    assert.ok(tip3.score >= 0.90);

    // End-to-end tie-breaking: without hover tooltip, the 2 identical sidebar icons are ambiguous;
    // with hover tooltip trap enabled, #btn-tip-collapse wins cleanly with Delta_margin >= 0.20!
    const withoutHover = await resolveNamelessSvgOnPage(page, 'Bấm thu gọn menu', {
      enableHoverTooltipProbe: false,
    });
    assert.strictEqual(withoutHover.safeToClick, false, 'Trước khi hover, 2 nút giống hệt nhau phải bị đánh dấu tranh chấp');

    const withHover = await resolveNamelessSvgOnPage(page, 'Bấm thu gọn menu', {
      enableHoverTooltipProbe: true,
      hoverWaitMs: 300,
    });
    assert.strictEqual(withHover.status, 'RESOLVED', `Hover tooltip phải phá thế hòa, thực tế: ${withHover.reasoning}`);
    assert.strictEqual(withHover.safeToClick, true);
    assert.strictEqual(withHover.selectedCandidate?.elemId, 'btn-tip-collapse');
    assert.ok(withHover.topScore >= 0.85);
    assert.ok(withHover.deltaMargin >= 0.20, `Delta (${withHover.deltaMargin}) sau hover tooltip phải >= 0.20`);
    assert.strictEqual(withHover.selectedCandidate?.tooltip?.tooltipText, 'Thu gọn menu');
  });
});

test('Prompt 12 - Playwright Integration 4: Live DOM Safety Margin Dispute refuses blind click on duplicate ambiguous SVG icons', async () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { margin: 0; padding: 20px; display: flex; gap: 16px; }
          button { width: 40px; height: 40px; border: 1px solid #999; background: #fff; cursor: pointer; }
        </style>
      </head>
      <body>
        <button id="dup-search-1">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </button>
        <button id="dup-search-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </button>
      </body>
    </html>
  `;

  await withMockHtmlPage(html, async ({ page }) => {
    const candidates = await extractNamelessSvgCandidates(page);
    assert.strictEqual(candidates.length, 2, 'Phải trích xuất đúng 2 ứng viên SVG không nhãn');

    const res = await resolveNamelessSvgOnPage(page, 'Tìm kiếm', {
      enableHoverTooltipProbe: true,
      hoverWaitMs: 120,
    });
    assert.strictEqual(res.status, 'AMBIGUOUS_MARGIN');
    assert.strictEqual(res.safeToClick, false);
    assert.strictEqual(res.selectedCandidate, null);
    assert.ok(res.topScore >= 0.85);
    assert.ok(res.deltaMargin < 0.20, `Delta (${res.deltaMargin}) phải < 0.20 nên phải chặn bấm mù`);
  });
});

test('Prompt 12 - Playwright Integration 5: ARIA State (aria-expanded & aria-controls) disambiguates collapse vs expand live', async () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { margin: 0; display: flex; }
          aside { width: 220px; height: 100vh; background: #0f172a; }
          .controls { padding: 8px; display: flex; flex-direction: column; gap: 12px; }
          button { width: 36px; height: 36px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; }
        </style>
      </head>
      <body>
        <aside id="primary-sidebar" role="navigation"></aside>
        <div class="controls">
          <!-- Currently expanded -> clicking will collapse -->
          <button id="btn-sidebar-open" aria-expanded="true" aria-controls="primary-sidebar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"></rect>
              <line x1="9" y1="3" x2="9" y2="21"></line>
            </svg>
          </button>
          <!-- Currently collapsed -> clicking will expand -->
          <button id="btn-sidebar-closed" aria-expanded="false" aria-controls="primary-sidebar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"></rect>
              <line x1="9" y1="3" x2="9" y2="21"></line>
            </svg>
          </button>
        </div>
      </body>
    </html>
  `;

  await withMockHtmlPage(html, async ({ page }) => {
    const collapseRes = await resolveNamelessSvgOnPage(page, 'Bấm thu gọn menu', {
      enableHoverTooltipProbe: false,
    });
    assert.strictEqual(collapseRes.status, 'RESOLVED', `Expected RESOLVED for collapse, got: ${collapseRes.reasoning}`);
    assert.strictEqual(collapseRes.safeToClick, true);
    assert.strictEqual(collapseRes.selectedCandidate?.elemId, 'btn-sidebar-open');
    assert.strictEqual(collapseRes.selectedCandidate?.aria.disambiguatedAction, 'collapse');
    assert.ok(collapseRes.topScore >= 0.90);
    assert.ok(collapseRes.deltaMargin >= 0.20, `Delta (${collapseRes.deltaMargin}) phải >= 0.20`);

    const expandRes = await resolveNamelessSvgOnPage(page, 'Mở rộng sidebar', {
      enableHoverTooltipProbe: false,
    });
    assert.strictEqual(expandRes.status, 'RESOLVED', `Expected RESOLVED for expand, got: ${expandRes.reasoning}`);
    assert.strictEqual(expandRes.safeToClick, true);
    assert.strictEqual(expandRes.selectedCandidate?.elemId, 'btn-sidebar-closed');
    assert.strictEqual(expandRes.selectedCandidate?.aria.disambiguatedAction, 'expand');
    assert.ok(expandRes.topScore >= 0.90);
    assert.ok(expandRes.deltaMargin >= 0.20, `Delta (${expandRes.deltaMargin}) phải >= 0.20`);
  });
});

test('Prompt 12 - Playwright Integration 6: probeHoverTooltip supports BoundingRect, title, data-tip, aria-describedby, and .sr-only', async () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { margin: 0; padding: 20px; display: flex; gap: 16px; }
          button { width: 40px; height: 40px; border: 1px solid #aaa; background: #fff; }
          .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
        </style>
      </head>
      <body>
        <button id="btn-title" title="Cài đặt hệ thống">
          <svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>
        </button>
        <button id="btn-datatip" data-tip="Tìm kiếm nhanh">
          <svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>
        </button>
        <button id="btn-desc" aria-describedby="desc-close">
          <svg width="20" height="20" viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
        </button>
        <span id="desc-close" style="display:none">Đóng cửa sổ</span>
        <button id="btn-sr">
          <span class="sr-only">Mở menu điều hướng</span>
          <svg width="20" height="20" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
      </body>
    </html>
  `;

  await withMockHtmlPage(html, async ({ page }) => {
    // Test BoundingRect overload on #btn-title
    const box = await page.locator('#btn-title').boundingBox();
    assert.ok(box);
    const rTitle = await probeHoverTooltip(page, box!, { targetHint: 'Cài đặt', waitMs: 80 });
    assert.strictEqual(rTitle.found, true);
    assert.strictEqual(rTitle.source, 'title');
    assert.strictEqual(rTitle.tooltipText, 'Cài đặt hệ thống');
    assert.ok(rTitle.score >= 0.85);

    const rDataTip = await probeHoverTooltip(page, '#btn-datatip', { targetHint: 'Tìm kiếm', waitMs: 80 });
    assert.strictEqual(rDataTip.found, true);
    assert.strictEqual(rDataTip.source, 'data-tip');
    assert.strictEqual(rDataTip.tooltipText, 'Tìm kiếm nhanh');
    assert.ok(rDataTip.score >= 0.85);

    const rDesc = await probeHoverTooltip(page, '#btn-desc', { targetHint: 'Đóng', waitMs: 80 });
    assert.strictEqual(rDesc.found, true);
    assert.strictEqual(rDesc.source, 'aria-describedby');
    assert.strictEqual(rDesc.tooltipText, 'Đóng cửa sổ');
    assert.ok(rDesc.score >= 0.85);

    const rSr = await probeHoverTooltip(page, '#btn-sr', { targetHint: 'Mở menu', waitMs: 80 });
    assert.strictEqual(rSr.found, true);
    assert.strictEqual(rSr.source, 'sr-only');
    assert.strictEqual(rSr.tooltipText, 'Mở menu điều hướng');
    assert.ok(rSr.score >= 0.85);
  });
});

// ============================================================================
// 5. REGRESSION TESTS (VERIFIER-AI FINDINGS #16)
// ============================================================================

test('Prompt 12 - Regression 1: Invisible SVG spacer primitives (fill="none" stroke="none" / Tabler) do not break signature bank', () => {
  // Tabler Hamburger with explicit fill="none" stroke="none" spacer
  const tablerExplicit = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
      <path d="M4 6l16 0"/>
      <path d="M4 12l16 0"/>
      <path d="M4 18l16 0"/>
    </svg>
  `;
  const norm1 = normalizeSvgGeometry(tablerExplicit);
  assert.strictEqual(norm1.subpaths.length, 3, 'Spacer fill="none" stroke="none" phải bị lọc bỏ');
  const sig1 = classifySvgSignature(norm1);
  assert.strictEqual(sig1.family, 'hamburger');
  assert.ok(sig1.confidence >= 0.95);

  // Tabler ChevronLeft where spacer inherits fill="none" from <svg> and only specifies stroke="none"
  const tablerInherited = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path stroke="none" d="M0 0h24v24H0z"/>
      <path d="M15 6l-6 6l6 6"/>
    </svg>
  `;
  const norm2 = normalizeSvgGeometry(tablerInherited);
  assert.strictEqual(norm2.subpaths.length, 1, 'Spacer thừa kế fill="none" + stroke="none" phải bị lọc bỏ');
  assert.strictEqual(classifySvgSignature(norm2).family, 'chevron_left');

  // Material/Boxicons style transparent <rect> spacer with Search icon
  const rectSpacerSearch = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect width="24" height="24" fill="none" stroke="none"/>
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  `;
  const norm3 = normalizeSvgGeometry(rectSpacerSearch);
  assert.strictEqual(norm3.subpaths.length, 2);
  assert.strictEqual(classifySvgSignature(norm3).family, 'search');
});

test('Prompt 12 - Regression 2: Sidebar bottom edge trigger (.ant-layout-sider centered bottom button) gets Sidebar Boundary Control', () => {
  const antSider: SidebarContainerInfo[] = [
    {
      tag: 'aside',
      className: 'ant-layout-sider',
      rect: { x: 0, y: 0, width: 240, height: 760 },
    },
  ];

  // Centered horizontally inside 240px sider (104px from left & right edges, 724px from top edge),
  // sitting 4px above the bottom edge (760 - 756 = 4px <= 25px)
  const bottomTrigger = evaluateSpatialBoundary(
    { x: 104, y: 724, width: 32, height: 32 },
    antSider,
    { intent: 'collapse' }
  );
  assert.strictEqual(bottomTrigger.distanceToSidebarEdge, 4, 'Khoảng cách tới mép dưới sidebar phải bằng 4px');
  assert.strictEqual(bottomTrigger.isNearSidebarBoundary, true);
  assert.strictEqual(bottomTrigger.contextTag, 'Sidebar Boundary Control');
  assert.ok(bottomTrigger.spatialScore >= 0.95);
});

test('Prompt 12 - Regression 3 (Playwright): <button><span class="anticon"><svg/></span></button> deduplication + bottom sider trigger + Tabler spacer live DOM', async () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { margin: 0; display: flex; font-family: sans-serif; }
          aside.ant-layout-sider {
            width: 240px;
            height: 760px;
            background: #001529;
            position: relative;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }
          header { padding: 12px; display: flex; gap: 12px; }
          button { cursor: pointer; background: #fff; border: 1px solid #cbd5e1; display: inline-flex; align-items: center; justify-content: center; }
          .anticon { display: inline-flex; }
          #btn-bottom-collapse { width: 36px; height: 36px; margin: 0 auto 6px auto; }
          #btn-tabler-menu { position: fixed; top: 14px; left: 14px; width: 36px; height: 36px; }
          #btn-labeled-home { position: fixed; top: 14px; left: 300px; height: 36px; padding: 0 12px; gap: 6px; }
        </style>
      </head>
      <body>
        <aside class="ant-layout-sider">
          <div style="height: 60px;"></div>
          <!-- Ant Design bottom-centered collapse trigger wrapped in <span class="anticon"> -->
          <button id="btn-bottom-collapse">
            <span class="anticon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                <path d="M15 6l-6 6l6 6"></path>
              </svg>
            </span>
          </button>
        </aside>

        <!-- Tabler Hamburger inside <button><span class="anticon"><svg> with invisible spacer -->
        <button id="btn-tabler-menu">
          <span class="anticon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
              <path d="M4 6l16 0"></path>
              <path d="M4 12l16 0"></path>
              <path d="M4 18l16 0"></path>
            </svg>
          </span>
        </button>

        <!-- Labeled button containing <span class="anticon"><svg/></span> must NOT leak inner span as nameless SVG -->
        <button id="btn-labeled-home">
          <span class="anticon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 6h16M4 12h16M4 18h16"></path>
            </svg>
          </span>
          Trang chủ
        </button>
      </body>
    </html>
  `;

  await withMockHtmlPage(html, async ({ page }) => {
    const extracted = await extractNamelessSvgCandidates(page);
    assert.strictEqual(
      extracted.length,
      2,
      `Phải trích xuất đúng 2 nút không nhãn (không trùng <span> con và không lọt nút có chữ), thực tế: ${extracted.map((c) => `${c.tag}#${c.elemId}`).join(', ')}`
    );
    assert.ok(extracted.every((c) => c.tag === 'button'), 'Tất cả ứng viên phải là <button>, không phải <span> con');

    // Bottom-edge Ant Design sider trigger resolves "Bấm thu gọn menu" with Sidebar Boundary Control
    const collapseRes = await resolveNamelessSvgOnPage(page, 'Bấm thu gọn menu', {
      enableHoverTooltipProbe: false,
    });
    assert.strictEqual(collapseRes.status, 'RESOLVED', `Expected RESOLVED, got: ${collapseRes.reasoning}`);
    assert.strictEqual(collapseRes.safeToClick, true);
    assert.strictEqual(collapseRes.selectedCandidate?.elemId, 'btn-bottom-collapse');
    assert.strictEqual(collapseRes.context, 'Sidebar Boundary Control');
    assert.strictEqual(collapseRes.vectorFamily, 'chevron_left');
    assert.ok(collapseRes.topScore >= 0.85);
    assert.ok(collapseRes.deltaMargin >= 0.20);

    // Tabler Hamburger wrapped in <button><span class="anticon"><svg> with invisible spacer resolves "Mở menu"
    const menuRes = await resolveNamelessSvgOnPage(page, 'Mở menu', {
      enableHoverTooltipProbe: false,
    });
    assert.strictEqual(menuRes.status, 'RESOLVED', `Expected RESOLVED for Tabler menu, got: ${menuRes.reasoning}`);
    assert.strictEqual(menuRes.safeToClick, true);
    assert.strictEqual(menuRes.selectedCandidate?.elemId, 'btn-tabler-menu');
    assert.strictEqual(menuRes.vectorFamily, 'hamburger');
    assert.ok(menuRes.topScore >= 0.85);
    assert.ok(menuRes.deltaMargin >= 0.20);
  });
});


