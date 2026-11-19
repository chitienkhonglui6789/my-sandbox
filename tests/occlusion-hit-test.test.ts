import test from 'node:test';
import assert from 'node:assert';
import * as http from 'http';
import { chromium, BrowserContext } from 'playwright';
import { DOMCandidate } from '../src/types';
import {
  SAFE_BAND_MARGIN_PX,
  MIN_EXPOSED_AREA_RATIO,
  MIN_CLICKABLE_DIMENSION_PX,
  Rect,
  ObstacleMetadata,
  rectToPolygon,
  computePolygonArea,
  computePolygonCentroid,
  isPointInPolygon,
  sutherlandHodgmanClip,
  subtractRectFromPolygon,
  subtractObstaclesFromRect,
  calculateSafeViewportBand,
  isRectInSafeViewportBand,
  detectSafeViewportBand,
  scrollIntoSafeViewportBand,
  generate5SamplePoints,
  hitTest5Points,
  hitTestPoint,
  resolveSafeClickPoint,
  executeTrustedSafeClick,
} from '../src/occlusion-engine';

async function attachNameHelperInitScript(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    (window as any).__name = (globalThis as any).__name = (fn: any) => fn;
  });
}

function createOcclusionMockServer(): Promise<{
  server: http.Server;
  baseUrl: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url || '/';

      if (url === '/sticky-bars.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Sticky Header Footer Test</title>
              <style>
                * { box-sizing: border-box; }
                body { margin: 0; padding: 0; font-family: sans-serif; height: 3000px; }
                header.sticky-header {
                  position: fixed; top: 0; left: 0; right: 0; height: 80px;
                  background: #0f172a; color: #fff; z-index: 1000;
                  display: flex; align-items: center; padding: 0 24px;
                }
                footer.sticky-footer {
                  position: fixed; bottom: 0; left: 0; right: 0; height: 60px;
                  background: #1e293b; color: #fff; z-index: 1000;
                  display: flex; align-items: center; padding: 0 24px;
                }
                .floating-action-bar {
                  position: fixed; bottom: 70px; left: 50%; transform: translateX(-50%);
                  width: 320px; height: 40px; background: #2563eb; color: #fff;
                  z-index: 950; border-radius: 20px; display: flex;
                  align-items: center; justify-content: center;
                }
                #btn-under-header {
                  position: absolute; top: 600px; left: 160px;
                  width: 220px; height: 48px; font-size: 16px; cursor: pointer;
                }
                #btn-under-footer {
                  position: absolute; top: 1200px; left: 160px;
                  width: 220px; height: 48px; font-size: 16px; cursor: pointer;
                }
              </style>
            </head>
            <body>
              <header id="top-nav" class="sticky-header">Sticky Navigation Header</header>
              <button id="btn-under-header"><span>Confirm Order</span></button>
              <button id="btn-under-footer">Save Bottom Section</button>
              <div id="fab-bar" class="floating-action-bar" role="toolbar">Quick Actions</div>
              <footer id="bottom-bar" class="sticky-footer">Sticky Footer Bar</footer>

              <script>
                window.__clicks = [];
                window.__headerClicks = 0;
                window.__footerClicks = 0;
                document.getElementById('top-nav').addEventListener('click', function(e) {
                  window.__headerClicks++;
                });
                document.getElementById('bottom-bar').addEventListener('click', function(e) {
                  window.__footerClicks++;
                });
                document.getElementById('btn-under-header').addEventListener('click', function(e) {
                  window.__clicks.push({ id: 'btn-under-header', isTrusted: e.isTrusted, x: e.clientX, y: e.clientY });
                });
                document.getElementById('btn-under-footer').addEventListener('click', function(e) {
                  window.__clicks.push({ id: 'btn-under-footer', isTrusted: e.isTrusted, x: e.clientX, y: e.clientY });
                });
              </script>
            </body>
          </html>
        `);
      } else if (url === '/partial-occlusion.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Partial & Full Occlusion Test</title>
              <style>
                * { box-sizing: border-box; }
                body { margin: 0; padding: 0; font-family: sans-serif; height: 900px; }
                #btn-half-occluded {
                  position: fixed; left: 100px; top: 200px;
                  width: 200px; height: 60px; font-size: 16px;
                  background: #16a34a; color: #fff; border: none; cursor: pointer;
                }
                #right-banner {
                  position: fixed; left: 200px; top: 190px;
                  width: 180px; height: 80px; z-index: 500;
                  background: rgba(220, 38, 38, 0.9); color: #fff;
                  display: flex; align-items: center; justify-content: center;
                }
                #btn-center-blocked {
                  position: fixed; left: 100px; top: 340px;
                  width: 200px; height: 60px; font-size: 15px;
                  background: #0284c7; color: #fff; border: none; cursor: pointer;
                }
                #center-badge {
                  position: fixed; left: 185px; top: 335px;
                  width: 30px; height: 70px; z-index: 500;
                  background: #f59e0b; color: #000;
                }
                #btn-80-blocked {
                  position: fixed; left: 500px; top: 200px;
                  width: 200px; height: 60px; background: #4f46e5; color: #fff; border: none;
                }
                #toast-80 {
                  position: fixed; left: 540px; top: 195px;
                  width: 200px; height: 70px; z-index: 600;
                  background: #ef4444; color: #fff;
                }
                #btn-full-blocked {
                  position: fixed; left: 500px; top: 340px;
                  width: 200px; height: 60px; background: #7c3aed; color: #fff; border: none;
                }
                #modal-blocker {
                  position: fixed; left: 480px; top: 320px;
                  width: 260px; height: 110px; z-index: 700;
                  background: rgba(15, 23, 42, 0.92); color: #fff;
                }
              </style>
            </head>
            <body>
              <button id="btn-half-occluded"><span class="btn-label">Checkout Now</span></button>
              <div id="right-banner" class="promo-banner"><span>Promo 50%</span></div>

              <button id="btn-center-blocked"><span class="inner-text">Submit Form</span></button>
              <div id="center-badge" class="floating-badge">!</div>

              <button id="btn-80-blocked">Almost Covered</button>
              <div id="toast-80" class="toast-error" role="alert">Network Toast Overlay</div>

              <button id="btn-full-blocked">Blocked Action</button>
              <div id="modal-blocker" class="modal" role="dialog" aria-modal="true">Blocking Modal</div>

              <script>
                window.__events = [];
                ['btn-half-occluded', 'right-banner', 'btn-center-blocked', 'center-badge', 'btn-80-blocked', 'toast-80', 'btn-full-blocked', 'modal-blocker'].forEach(function(id) {
                  document.getElementById(id).addEventListener('click', function(e) {
                    window.__events.push({
                      id: id,
                      isTrusted: e.isTrusted,
                      clientX: e.clientX,
                      clientY: e.clientY
                    });
                  });
                });
              </script>
            </body>
          </html>
        `);
      } else if (url === '/shadow-occlusion.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Shadow DOM Occlusion Test</title>
              <style>
                body { margin: 0; padding: 0; font-family: sans-serif; height: 800px; }
                #shadow-right-cover {
                  position: fixed; left: 220px; top: 210px;
                  width: 140px; height: 80px; z-index: 500;
                  background: rgba(239, 68, 68, 0.85); color: #fff;
                }
              </style>
            </head>
            <body>
              <div id="shadow-host" style="position: fixed; left: 120px; top: 220px;"></div>
              <div id="shadow-right-cover" class="overlay">Right Cover</div>
              <script>
                window.__shadowClicks = [];
                var host = document.getElementById('shadow-host');
                var shadow = host.attachShadow({ mode: 'open' });
                var btn = document.createElement('button');
                btn.id = 'shadow-pay-btn';
                btn.style.cssText = 'width: 200px; height: 60px; font-size: 16px; cursor: pointer;';
                btn.innerHTML = '<span class="lbl">Shadow Pay</span>';
                btn.addEventListener('click', function(e) {
                  window.__shadowClicks.push({ isTrusted: e.isTrusted, x: e.clientX, y: e.clientY });
                });
                shadow.appendChild(btn);
              </script>
            </body>
          </html>
        `);
      } else if (url === '/css-sticky.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>CSS Position Sticky Test</title>
              <style>
                * { box-sizing: border-box; }
                body { margin: 0; padding: 0; font-family: sans-serif; height: 2800px; }
                .hero { height: 120px; background: #cbd5e1; }
                nav.css-sticky-bar {
                  position: sticky; top: 0; left: 0; width: 100%; height: 72px;
                  background: #0f172a; color: #fff; z-index: 900;
                  display: flex; align-items: center; padding: 0 20px;
                }
                .content { padding: 40px; }
                #sticky-target-btn {
                  margin-top: 500px; width: 200px; height: 48px; cursor: pointer;
                }
              </style>
            </head>
            <body>
              <div class="hero">Hero Area</div>
              <nav id="sticky-nav" class="css-sticky-bar">Sticky Bar</nav>
              <div class="content">
                <button id="sticky-target-btn">Proceed Sticky</button>
              </div>
              <script>
                window.__stickyTargetClicks = [];
                document.getElementById('sticky-target-btn').addEventListener('click', function(e) {
                  window.__stickyTargetClicks.push({ isTrusted: e.isTrusted, x: e.clientX, y: e.clientY });
                });
              </script>
            </body>
          </html>
        `);
      } else if (url === '/multi-obstacle.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Multi-Obstacle Live Occlusion</title>
              <style>
                * { box-sizing: border-box; }
                body { margin: 0; padding: 0; font-family: sans-serif; height: 900px; }
                #multi-btn {
                  position: fixed; left: 200px; top: 200px;
                  width: 200px; height: 100px; font-size: 16px;
                  background: #0d9488; color: #fff; border: none; cursor: pointer;
                }
                #obs-top {
                  position: fixed; left: 190px; top: 190px;
                  width: 220px; height: 30px; z-index: 400;
                  background: rgba(234, 88, 12, 0.9); color: #fff;
                }
                #obs-right {
                  position: fixed; left: 320px; top: 190px;
                  width: 100px; height: 120px; z-index: 410;
                  background: rgba(185, 28, 28, 0.9); color: #fff;
                }
              </style>
            </head>
            <body>
              <button id="multi-btn" data-autotest-id="42">Multi Obstacle Target</button>
              <div id="obs-top" class="overlay">Top Strip</div>
              <div id="obs-right" class="overlay">Right Strip</div>
              <script>
                window.__multiClicks = [];
                ['multi-btn', 'obs-top', 'obs-right'].forEach(function(id) {
                  document.getElementById(id).addEventListener('click', function(e) {
                    window.__multiClicks.push({ id: id, isTrusted: e.isTrusted, x: e.clientX, y: e.clientY });
                  });
                });
              </script>
            </body>
          </html>
        `);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        server,
        baseUrl,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

// ============================================================================
// PART A: PURE UNIT TESTS (5-POINT SAMPLING, SAFE BAND, SUTHERLAND-HODGMAN)
// ============================================================================

test('Unit 1: generate5SamplePoints computes exact center + 5px inset corners and clamps tiny boxes', () => {
  const normalBox: Rect = { x: 100, y: 200, width: 120, height: 40 };
  const pts = generate5SamplePoints(normalBox);

  assert.strictEqual(pts.length, 5);
  assert.deepStrictEqual(pts[0], { name: 'center', x: 160, y: 220 });
  assert.deepStrictEqual(pts[1], { name: 'top-left', x: 105, y: 205 });
  assert.deepStrictEqual(pts[2], { name: 'top-right', x: 215, y: 205 });
  assert.deepStrictEqual(pts[3], { name: 'bottom-left', x: 105, y: 235 });
  assert.deepStrictEqual(pts[4], { name: 'bottom-right', x: 215, y: 235 });

  // Tiny 8x6 element: 5px inset would invert corners if not clamped
  const tinyBox: Rect = { x: 10, y: 20, width: 8, height: 6 };
  const tinyPts = generate5SamplePoints(tinyBox);
  assert.deepStrictEqual(tinyPts[0], { name: 'center', x: 14, y: 23 });
  for (const pt of tinyPts.slice(1)) {
    assert.ok(pt.x > tinyBox.x && pt.x < tinyBox.x + tinyBox.width, `x=${pt.x} must lie inside tiny box`);
    assert.ok(pt.y > tinyBox.y && pt.y < tinyBox.y + tinyBox.height, `y=${pt.y} must lie inside tiny box`);
  }
  assert.ok(tinyPts[1].x < tinyPts[2].x, 'top-left x must stay left of top-right x');
  assert.ok(tinyPts[1].y < tinyPts[3].y, 'top-left y must stay above bottom-left y');
});

test('Unit 2: calculateSafeViewportBand computes [H_top + 20, VH - H_bottom - 20] with headers, footers & FABs', () => {
  const obstacles: ObstacleMetadata[] = [
    {
      tag: 'header',
      descriptor: 'header#top',
      rect: { x: 0, y: 0, width: 1280, height: 80 },
      position: 'fixed',
      zIndex: '1000',
      category: 'sticky-header',
    },
    {
      tag: 'footer',
      descriptor: 'footer#bottom',
      rect: { x: 0, y: 660, width: 1280, height: 60 },
      position: 'fixed',
      zIndex: '1000',
      category: 'sticky-footer',
    },
    {
      tag: 'button',
      descriptor: 'button.corner-fab',
      rect: { x: 1200, y: 600, width: 56, height: 56 },
      position: 'fixed',
      zIndex: '1000',
      category: 'floating-action-bar',
    },
  ];

  const band = calculateSafeViewportBand(1280, 720, obstacles, SAFE_BAND_MARGIN_PX);
  assert.strictEqual(band.headerHeight, 80);
  assert.strictEqual(band.footerHeight, 60);
  assert.strictEqual(band.safeTop, 100);
  assert.strictEqual(band.safeBottom, 640);
  assert.strictEqual(band.safeCenterY, 370);
  assert.strictEqual(band.safeHeight, 540);
  assert.strictEqual(band.stickyHeaders.length, 1);
  assert.strictEqual(band.stickyFooters.length, 1);
  assert.strictEqual(band.floatingActionBars.length, 1);

  assert.strictEqual(isRectInSafeViewportBand({ x: 100, y: 30, width: 120, height: 40 }, band), false);
  assert.strictEqual(isRectInSafeViewportBand({ x: 100, y: 630, width: 120, height: 40 }, band), false);
  assert.strictEqual(isRectInSafeViewportBand({ x: 100, y: 350, width: 120, height: 40 }, band), true);

  // Centered bottom floating action bar expands H_bottom
  const centeredFab: ObstacleMetadata = {
    tag: 'div',
    descriptor: 'div.floating-action-bar',
    rect: { x: 480, y: 610, width: 320, height: 40 },
    position: 'fixed',
    zIndex: '950',
    category: 'floating-action-bar',
  };
  const bandWithCenteredFab = calculateSafeViewportBand(1280, 720, [...obstacles, centeredFab], 20);
  assert.strictEqual(bandWithCenteredFab.footerHeight, 110);
  assert.strictEqual(bandWithCenteredFab.safeBottom, 590);
});

test('Unit 3: sutherlandHodgmanClip clips polygons accurately (CW & CCW invariant)', () => {
  const subject = rectToPolygon({ x: 0, y: 0, width: 100, height: 100 });
  const clipCW = rectToPolygon({ x: 50, y: 25, width: 100, height: 50 });
  const clipCCW = [...clipCW].reverse();

  const clippedCW = sutherlandHodgmanClip(subject, clipCW);
  const clippedCCW = sutherlandHodgmanClip(subject, clipCCW);

  assert.ok(Math.abs(computePolygonArea(clippedCW) - 2500) < 1e-3, 'Intersection area must be 50*50=2500');
  assert.ok(Math.abs(computePolygonArea(clippedCCW) - 2500) < 1e-3, 'CCW clip must produce identical area');

  const centroid = computePolygonCentroid(clippedCW)!;
  assert.ok(Math.abs(centroid.x - 75) < 1e-3);
  assert.ok(Math.abs(centroid.y - 50) < 1e-3);

  // Disjoint polygons produce empty result
  const disjoint = sutherlandHodgmanClip(subject, rectToPolygon({ x: 200, y: 200, width: 50, height: 50 }));
  assert.strictEqual(disjoint.length, 0);

  // Triangle clipped against rectangle
  const triangle = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ];
  const triClip = sutherlandHodgmanClip(triangle, rectToPolygon({ x: 0, y: 0, width: 50, height: 100 }));
  // Area of right trapezoid from x=0..50: (100 + 50)/2 * 50 = 3750
  assert.ok(Math.abs(computePolygonArea(triClip) - 3750) < 1e-2);
});

test('Unit 4: Sutherland-Hodgman partial overlap >= 40% computes exact exposed centroid', () => {
  // 50% right-side occlusion on 200x60 button
  const target: Rect = { x: 100, y: 300, width: 200, height: 60 };
  const rightObstacle: Rect = { x: 200, y: 290, width: 150, height: 80 };

  const res50 = subtractObstaclesFromRect(target, [rightObstacle]);
  assert.strictEqual(res50.status, 'EXPOSED_CLICKABLE');
  assert.ok(Math.abs(res50.exposedAreaRatio - 0.5) < 1e-4);
  assert.strictEqual(res50.meetsAreaThreshold, true);
  assert.strictEqual(res50.meetsDimensionThreshold, true);
  assert.ok(res50.centroid !== null);
  assert.ok(Math.abs(res50.centroid!.x - 150) < 1e-3, `Expected centroid x=150, got ${res50.centroid!.x}`);
  assert.ok(Math.abs(res50.centroid!.y - 330) < 1e-3, `Expected centroid y=330, got ${res50.centroid!.y}`);
  assert.strictEqual(isPointInPolygon(res50.centroid!, res50.largestExposedSubRegion!.polygon), true);

  // Exact 40% exposed threshold (80x60 exposed out of 200x60)
  const res40 = subtractObstaclesFromRect(target, [{ x: 180, y: 300, width: 120, height: 60 }]);
  assert.strictEqual(res40.status, 'EXPOSED_CLICKABLE');
  assert.ok(Math.abs(res40.exposedAreaRatio - MIN_EXPOSED_AREA_RATIO) < 1e-4);
  assert.ok(Math.abs(res40.centroid!.x - 140) < 1e-3);
  assert.ok(Math.abs(res40.centroid!.y - 330) < 1e-3);

  // Center badge occlusion (40x40 dead center on 200x100 button -> 92% exposed)
  const bigTarget: Rect = { x: 0, y: 0, width: 200, height: 100 };
  const centerBadge: Rect = { x: 80, y: 30, width: 40, height: 40 };
  const resBadge = subtractObstaclesFromRect(bigTarget, [centerBadge]);
  assert.strictEqual(resBadge.status, 'EXPOSED_CLICKABLE');
  assert.ok(Math.abs(resBadge.exposedAreaRatio - 0.92) < 1e-4);
  assert.ok(resBadge.centroid !== null);
  // Centroid must NOT lie inside the center badge
  const inBadge =
    resBadge.centroid!.x >= 80 &&
    resBadge.centroid!.x <= 120 &&
    resBadge.centroid!.y >= 30 &&
    resBadge.centroid!.y <= 70;
  assert.strictEqual(inBadge, false, 'Centroid must lie outside the occluding center badge');
});

test('Unit 5: Sutherland-Hodgman rejects < 40% exposed area and < 24x24px clickable region', () => {
  // Case A: 70% occluded -> 30% exposed (< 40%), even though exposed region is 60x60 (>= 24x24)
  const target: Rect = { x: 0, y: 0, width: 200, height: 60 };
  const resLowArea = subtractObstaclesFromRect(target, [{ x: 60, y: 0, width: 140, height: 60 }]);
  assert.strictEqual(resLowArea.status, 'INSUFFICIENT_EXPOSED_AREA');
  assert.ok(Math.abs(resLowArea.exposedAreaRatio - 0.3) < 1e-4);
  assert.strictEqual(resLowArea.meetsAreaThreshold, false);
  assert.strictEqual(resLowArea.meetsDimensionThreshold, true);
  assert.strictEqual(resLowArea.centroid, null);

  // Case B: 50% exposed (>= 40%), BUT exposed strip is 200x20 (height 20 < 24px!)
  const thinTarget: Rect = { x: 0, y: 0, width: 200, height: 40 };
  const resThin = subtractObstaclesFromRect(thinTarget, [{ x: 0, y: 20, width: 200, height: 20 }]);
  assert.strictEqual(resThin.status, 'INSUFFICIENT_EXPOSED_AREA');
  assert.ok(Math.abs(resThin.exposedAreaRatio - 0.5) < 1e-4);
  assert.strictEqual(resThin.meetsAreaThreshold, true);
  assert.strictEqual(resThin.meetsDimensionThreshold, false);
  assert.strictEqual(resThin.centroid, null);

  // Case C: Exposed region has BOTH an unclickable 200x16 strip (area 3200) AND a clickable 40x44 square (area 1760)
  // Must prioritize the clickable >= 24x24 region!
  const mixedTarget: Rect = { x: 0, y: 0, width: 200, height: 60 };
  const lObstacle: Rect = { x: 40, y: 16, width: 160, height: 44 };
  // Total area 12000; occluded 7040; exposed 4960 (41.33% >= 40%); left exposed rect is 40x60 (>= 24x24)!
  const resMixed = subtractObstaclesFromRect(mixedTarget, [lObstacle]);
  assert.strictEqual(resMixed.status, 'EXPOSED_CLICKABLE');
  assert.ok(resMixed.largestExposedSubRegion!.boundingBox.width >= MIN_CLICKABLE_DIMENSION_PX);
  assert.ok(resMixed.largestExposedSubRegion!.boundingBox.height >= MIN_CLICKABLE_DIMENSION_PX);
  assert.ok(resMixed.centroid!.x < 40, 'Centroid must land in the 40x60 left clickable sub-region');
});

test('Unit 6: Sutherland-Hodgman signals FULLY_OCCLUDED on 100% coverage (single & overlapping)', () => {
  const target: Rect = { x: 50, y: 50, width: 160, height: 48 };

  const resExact = subtractObstaclesFromRect(target, [{ x: 50, y: 50, width: 160, height: 48 }]);
  assert.strictEqual(resExact.status, 'FULLY_OCCLUDED');
  assert.strictEqual(resExact.exposedAreaRatio, 0);
  assert.strictEqual(resExact.centroid, null);

  const resOversized = subtractObstaclesFromRect(target, [{ x: 0, y: 0, width: 500, height: 500 }]);
  assert.strictEqual(resOversized.status, 'FULLY_OCCLUDED');
  assert.strictEqual(resOversized.exposedArea, 0);
  assert.strictEqual(resOversized.centroid, null);

  // Two overlapping half-obstacles whose union covers 100%
  const resUnion = subtractObstaclesFromRect(target, [
    { x: 40, y: 40, width: 100, height: 70 },
    { x: 120, y: 40, width: 110, height: 70 },
  ]);
  assert.strictEqual(resUnion.status, 'FULLY_OCCLUDED');
  assert.strictEqual(resUnion.exposedArea, 0);
  assert.strictEqual(resUnion.centroid, null);
});

test('Unit 7: Sutherland-Hodgman multi-obstacle clipping avoids double-counting & finds optimal region', () => {
  // 200x100 button (area 20,000) with overlapping top bar (200x20) + right bar (80x100)
  // Union occluded area = 200*20 + 80*100 - 80*20 = 4000 + 8000 - 1600 = 10400
  // Exposed region = bottom-left 120x80 = 9600 (48% >= 40%)
  const target: Rect = { x: 0, y: 0, width: 200, height: 100 };
  const topObs: Rect = { x: 0, y: 0, width: 200, height: 20 };
  const rightObs: Rect = { x: 120, y: 0, width: 80, height: 100 };

  const res = subtractObstaclesFromRect(target, [topObs, rightObs]);
  assert.strictEqual(res.status, 'EXPOSED_CLICKABLE');
  assert.ok(Math.abs(res.exposedArea - 9600) < 1e-2, `Expected exposed area 9600, got ${res.exposedArea}`);
  assert.ok(Math.abs(res.exposedAreaRatio - 0.48) < 1e-4);
  assert.ok(Math.abs(res.centroid!.x - 60) < 1e-3);
  assert.ok(Math.abs(res.centroid!.y - 60) < 1e-3);

  // Opposite-corner badges on 200x100: top-left 40x40 and bottom-right 40x40
  // Maximal unobstructed central rect is 120x100 at x=40..160 -> centroid (100, 50)
  const resCorners = subtractObstaclesFromRect(target, [
    { x: 0, y: 0, width: 40, height: 40 },
    { x: 160, y: 60, width: 40, height: 40 },
  ]);
  assert.strictEqual(resCorners.status, 'EXPOSED_CLICKABLE');
  assert.ok(Math.abs(resCorners.exposedArea - 16800) < 1e-2);
  assert.ok(Math.abs(resCorners.centroid!.x - 100) < 1e-3);
  assert.ok(Math.abs(resCorners.centroid!.y - 50) < 1e-3);

  // Direct subtractRectFromPolygon verification
  const pieces = subtractRectFromPolygon(rectToPolygon(target), { x: 50, y: 20, width: 100, height: 60 });
  const pieceAreaSum = pieces.reduce((acc, p) => acc + computePolygonArea(p), 0);
  assert.ok(Math.abs(pieceAreaSum - (20000 - 6000)) < 1e-2, 'Disjoint pieces must sum exactly to exposed area');
});

// ============================================================================
// PART B: REAL PLAYWRIGHT CHROMIUM INTEGRATION TESTS (isTrusted === true)
// ============================================================================

test('Integration 1: Element hidden under Sticky Header auto-scrolls into safe band & receives isTrusted physical click', async () => {
  const { baseUrl, close } = await createOcclusionMockServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await attachNameHelperInitScript(context);
    const page = await context.newPage();

    await page.goto(`${baseUrl}/sticky-bars.html`);

    // Verify Safe Viewport Band detects Sticky Header (80px), Sticky Footer (60px), and centered FAB (bottom 70px -> top 610px => H_bottom = 110px)
    const band = await detectSafeViewportBand(page);
    assert.strictEqual(band.headerHeight, 80, `Expected headerHeight=80, got ${band.headerHeight}`);
    assert.ok(band.footerHeight >= 60, `Expected footerHeight>=60, got ${band.footerHeight}`);
    assert.strictEqual(band.safeTop, 100, `Expected safeTop=100, got ${band.safeTop}`);
    assert.strictEqual(band.stickyHeaders.length, 1);
    assert.strictEqual(band.stickyFooters.length, 1);
    assert.strictEqual(band.floatingActionBars.length, 1);

    // Deliberately scroll so #btn-under-header (at doc y=600) is trapped UNDER the 80px fixed header (viewport y=20..68)
    await page.evaluate(() => window.scrollTo(0, 580));

    const preBox = await page.locator('#btn-under-header').boundingBox();
    assert.ok(preBox && preBox.y >= 15 && preBox.y <= 25, `Button should be trapped under header, y=${preBox?.y}`);

    // Confirm raw 5-point hit-test before scroll sees the Sticky Header swallowing all points
    const preHit = await hitTest5Points(page, preBox!, '#btn-under-header');
    assert.strictEqual(preHit.allOccluded, true, 'Before scrolling, Sticky Header must occlude all 5 sample points');
    assert.ok(
      preHit.obstacles.some((o) => o.category === 'sticky-header' && o.id === 'top-nav'),
      'Obstacle must be identified as sticky-header #top-nav'
    );

    // Execute trusted physical click via Occlusion Engine (auto-scrolls into safe band center + clicks physically)
    const clickRes = await executeTrustedSafeClick(page, preBox, '#btn-under-header');
    assert.strictEqual(clickRes.clicked, true, `Expected click to succeed: ${clickRes.resolution.reason}`);
    assert.strictEqual(clickRes.resolution.scrolledToSafeBand, true, 'Must auto-scroll into safe band');
    assert.strictEqual(clickRes.resolution.status, 'CLEAR');

    // Verify button is now squarely inside the Safe Viewport Band
    const postBox = await page.locator('#btn-under-header').boundingBox();
    assert.ok(postBox, 'Post-scroll box must exist');
    assert.ok(
      isRectInSafeViewportBand(postBox!, clickRes.resolution.safeBand),
      `Post-scroll box y=${postBox!.y} must be inside safe band [${clickRes.resolution.safeBand.safeTop}, ${clickRes.resolution.safeBand.safeBottom}]`
    );

    // Verify 100% isTrusted physical click delivered to button and 0 clicks swallowed by header
    const clickData = await page.evaluate(() => ({
      clicks: (window as any).__clicks,
      headerClicks: (window as any).__headerClicks,
    }));
    assert.strictEqual(clickData.headerClicks, 0, 'Sticky Header must NOT swallow the click');
    assert.strictEqual(clickData.clicks.length, 1, 'Target button must receive exactly 1 click');
    assert.strictEqual(clickData.clicks[0].id, 'btn-under-header');
    assert.strictEqual(clickData.clicks[0].isTrusted, true, 'Click MUST be a genuine physical event (isTrusted === true)');

    // Also verify element trapped under Sticky Footer auto-scrolls UP into safe band & receives isTrusted click
    await page.evaluate(() => window.scrollTo(0, 520)); // doc y=1200 -> viewport y=680 (under 60px footer at 660..720)
    const footerRes = await executeTrustedSafeClick(page, null, '#btn-under-footer');
    assert.strictEqual(footerRes.clicked, true);
    assert.strictEqual(footerRes.resolution.scrolledToSafeBand, true);

    const afterFooterData = await page.evaluate(() => ({
      clicks: (window as any).__clicks,
      footerClicks: (window as any).__footerClicks,
    }));
    assert.strictEqual(afterFooterData.footerClicks, 0, 'Sticky Footer must NOT swallow the click');
    assert.strictEqual(afterFooterData.clicks.length, 2);
    assert.strictEqual(afterFooterData.clicks[1].id, 'btn-under-footer');
    assert.strictEqual(afterFooterData.clicks[1].isTrusted, true);
  } finally {
    await browser.close();
    await close();
  }
});

test('Integration 2: Button 50% occluded on the right side is clicked cleanly on its exposed left region (isTrusted === true)', async () => {
  const { baseUrl, close } = await createOcclusionMockServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await attachNameHelperInitScript(context);
    const page = await context.newPage();

    await page.goto(`${baseUrl}/partial-occlusion.html`);

    const btnBox = await page.locator('#btn-half-occluded').boundingBox();
    assert.ok(btnBox);

    // Button is at x=100..300, y=200..260; #right-banner covers x=200..380 (exact right 50% + center x=200)
    const clickRes = await executeTrustedSafeClick(page, btnBox, '#btn-half-occluded', {
      autoScroll: false,
    });

    assert.strictEqual(clickRes.clicked, true, `Expected exposed left click to succeed: ${clickRes.resolution.reason}`);
    assert.strictEqual(clickRes.resolution.status, 'SHIFTED_CENTROID');
    assert.strictEqual(clickRes.resolution.strategy, 'POLYGON_CENTROID');
    assert.ok(clickRes.resolution.polygonResult !== null);
    assert.ok(
      Math.abs(clickRes.resolution.polygonResult!.exposedAreaRatio - 0.5) < 0.03,
      `Expected ~50% exposed area, got ${clickRes.resolution.polygonResult!.exposedAreaRatio}`
    );
    assert.ok(
      clickRes.clickPoint!.x >= 135 && clickRes.clickPoint!.x <= 165,
      `Click point x=${clickRes.clickPoint!.x} must land near centroid (~150) of exposed left half`
    );

    const events = await page.evaluate(() => (window as any).__events);
    assert.strictEqual(events.length, 1, 'Only the target button should receive the click, not the banner');
    assert.strictEqual(events[0].id, 'btn-half-occluded');
    assert.strictEqual(events[0].isTrusted, true, 'Physical click must have isTrusted === true');
    assert.ok(events[0].clientX < 200, 'Click coordinate must be strictly inside the exposed left half');
  } finally {
    await browser.close();
    await close();
  }
});

test('Integration 3: 5-point hit-tester detects center obstacle & shifts coordinates accurately', async () => {
  const { baseUrl, close } = await createOcclusionMockServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await attachNameHelperInitScript(context);
    const page = await context.newPage();

    await page.goto(`${baseUrl}/partial-occlusion.html`);

    const btnBox = await page.locator('#btn-center-blocked').boundingBox();
    assert.ok(btnBox);

    // #center-badge covers x=185..215, y=335..405 -> blocks center (200, 370), leaves all 4 corners exposed
    const hit5 = await hitTest5Points(page, btnBox!, '#btn-center-blocked');
    assert.strictEqual(hit5.centerExposed, false, 'Center point must be detected as occluded');
    assert.strictEqual(hit5.exposedPoints.length, 4, 'All 4 safe corners must be exposed (including nested <span>)');
    assert.strictEqual(hit5.occludedPoints.length, 1);
    assert.strictEqual(hit5.obstacles.length, 1);
    assert.strictEqual(hit5.obstacles[0].id, 'center-badge');
    assert.ok(hit5.selectedPoint !== null, '5-point hit-tester must select an exposed safe corner');
    assert.notStrictEqual(hit5.selectedPoint!.source, 'center');

    // Physically clicking the 5-point shifted corner delivers isTrusted click directly to button (0 clicks on badge)
    await page.mouse.click(hit5.selectedPoint!.x, hit5.selectedPoint!.y);
    const events = await page.evaluate(() => (window as any).__events);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].id, 'btn-center-blocked');
    assert.strictEqual(events[0].isTrusted, true);
  } finally {
    await browser.close();
    await close();
  }
});

test('Integration 4: 100% occluded & <40% exposed return escalation status without blind clicking', async () => {
  const { baseUrl, close } = await createOcclusionMockServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await attachNameHelperInitScript(context);
    const page = await context.newPage();

    await page.goto(`${baseUrl}/partial-occlusion.html`);

    // Case A: 80% covered by #toast-80 (only 20% exposed < 40%) -> INSUFFICIENT_EXPOSED_AREA
    const res80 = await executeTrustedSafeClick(page, null, '#btn-80-blocked', { autoScroll: false });
    assert.strictEqual(res80.clicked, false, 'Must NOT click when exposed area < 40%');
    assert.strictEqual(res80.resolution.status, 'INSUFFICIENT_EXPOSED_AREA');
    assert.strictEqual(res80.resolution.requiresDismissalLadder, true);
    assert.ok(res80.resolution.obstacles.some((o) => o.id === 'toast-80' && o.category === 'toast'));

    // Case B: 100% covered by #modal-blocker -> FULLY_OCCLUDED
    const res100 = await executeTrustedSafeClick(page, null, '#btn-full-blocked', { autoScroll: false });
    assert.strictEqual(res100.clicked, false, 'Must NOT click when 100% occluded');
    assert.strictEqual(res100.resolution.status, 'FULLY_OCCLUDED');
    assert.strictEqual(res100.resolution.requiresDismissalLadder, true);
    assert.ok(res100.resolution.obstacles.some((o) => o.id === 'modal-blocker' && o.category === 'modal'));

    // Verify ZERO clicks were blindly fired at either button, toast, or modal
    const events = await page.evaluate(() => (window as any).__events);
    assert.strictEqual(events.length, 0, 'No clicks may be dispatched when occlusion triggers dismissal ladder');
  } finally {
    await browser.close();
    await close();
  }
});

test('Integration 5: Shadow DOM button partially occluded resolves exposed centroid & receives isTrusted click', async () => {
  const { baseUrl, close } = await createOcclusionMockServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await attachNameHelperInitScript(context);
    const page = await context.newPage();

    await page.goto(`${baseUrl}/shadow-occlusion.html`);

    const shadowLocator = page.locator('#shadow-host >> #shadow-pay-btn');
    const box = await shadowLocator.boundingBox();
    assert.ok(box, 'Shadow button boundingBox must resolve');

    // Shadow button at x=120..320; #shadow-right-cover covers x=220..360 (exact right 50%)
    const hit5 = await hitTest5Points(page, box!, shadowLocator);
    assert.strictEqual(hit5.centerExposed, false, 'Center of shadow button is covered by #shadow-right-cover');
    assert.strictEqual(hit5.exposedPoints.length, 2, 'Left 2 corners of shadow button must be exposed');
    assert.ok(hit5.obstacles.some((o) => o.id === 'shadow-right-cover'));

    // Verify single-point hitTestPoint pierces Shadow DOM on exposed left centroid
    const leftCentroidCheck = await hitTestPoint(page, { x: 170, y: 250 }, shadowLocator, { targetRect: box! });
    assert.strictEqual(leftCentroidCheck.hitsTarget, true, 'hitTestPoint must recognize shadow button & child span');

    const clickRes = await executeTrustedSafeClick(page, box, shadowLocator, { autoScroll: false });
    assert.strictEqual(clickRes.clicked, true);
    assert.strictEqual(clickRes.resolution.status, 'SHIFTED_CENTROID');
    assert.ok(clickRes.clickPoint!.x < 220);

    const shadowClicks = await page.evaluate(() => (window as any).__shadowClicks);
    assert.strictEqual(shadowClicks.length, 1);
    assert.strictEqual(shadowClicks[0].isTrusted, true, 'Shadow DOM click must be isTrusted === true');
  } finally {
    await browser.close();
    await close();
  }
});

test('Integration 6: CSS position:sticky header engages on scroll & scrollIntoSafeViewportBand clears it cleanly', async () => {
  const { baseUrl, close } = await createOcclusionMockServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await attachNameHelperInitScript(context);
    const page = await context.newPage();

    await page.goto(`${baseUrl}/css-sticky.html`);

    // Scroll until #sticky-target-btn slides directly beneath the engaged position:sticky nav bar
    const docY = await page.evaluate(() => {
      const btn = document.getElementById('sticky-target-btn')!;
      return btn.getBoundingClientRect().top + window.scrollY;
    });
    await page.evaluate((y) => window.scrollTo(0, y - 20), docY);

    const scrollRes = await scrollIntoSafeViewportBand(page, page.locator('#sticky-target-btn'));
    assert.strictEqual(scrollRes.scrolled, true);
    assert.strictEqual(scrollRes.inSafeBand, true);
    assert.strictEqual(scrollRes.safeBand.headerHeight, 72, 'Must detect engaged CSS position:sticky nav height (72px)');
    assert.ok(scrollRes.afterRect!.y >= scrollRes.safeBand.safeTop - 1);

    const clickRes = await executeTrustedSafeClick(page, null, '#sticky-target-btn');
    assert.strictEqual(clickRes.clicked, true);
    assert.strictEqual(clickRes.resolution.status, 'CLEAR');

    const stickyClicks = await page.evaluate(() => (window as any).__stickyTargetClicks);
    assert.strictEqual(stickyClicks.length, 1);
    assert.strictEqual(stickyClicks[0].isTrusted, true);
  } finally {
    await browser.close();
    await close();
  }
});

test('Integration 7: DOMCandidate input with multi-obstacle live occlusion resolves bottom-left exposed centroid (isTrusted === true)', async () => {
  const { baseUrl, close } = await createOcclusionMockServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await attachNameHelperInitScript(context);
    const page = await context.newPage();

    await page.goto(`${baseUrl}/multi-obstacle.html`);

    // Button at x=200..400, y=200..300 (200x100)
    // obs-top covers y=190..220 (top 20px of button)
    // obs-right covers x=320..420 (right 80px of button)
    // Exposed bottom-left region: x=200..320 (120px), y=220..300 (80px) => area 9600 / 20000 = 48% >= 40%, centroid (260, 260)
    const candidate: DOMCandidate = {
      candidateId: 42,
      tag: 'button',
      text: 'Multi Obstacle Target',
      disabled: false,
      obscured: true,
      rect: { x: 200, y: 200, width: 200, height: 100 },
      selectorPath: '[data-autotest-id="42"]',
      frameIndex: 0,
      fingerprint: {
        tag: 'button',
        id: 'multi-btn',
        text: 'Multi Obstacle Target',
        stableClasses: [],
        selectorPath: '[data-autotest-id="42"]',
      },
    };

    const clickRes = await executeTrustedSafeClick(page, candidate.rect, candidate, { autoScroll: false });
    assert.strictEqual(clickRes.clicked, true, `Multi-obstacle click should succeed: ${clickRes.resolution.reason}`);
    assert.strictEqual(clickRes.resolution.status, 'SHIFTED_CENTROID');
    assert.ok(clickRes.resolution.obstacles.length >= 2, 'Must detect both top and right obstacles');
    assert.ok(
      Math.abs(clickRes.resolution.polygonResult!.exposedAreaRatio - 0.48) < 0.03,
      `Expected ~48% exposed area, got ${clickRes.resolution.polygonResult!.exposedAreaRatio}`
    );
    assert.ok(clickRes.clickPoint!.x >= 245 && clickRes.clickPoint!.x <= 275, `Centroid x=${clickRes.clickPoint!.x} expected ~260`);
    assert.ok(clickRes.clickPoint!.y >= 245 && clickRes.clickPoint!.y <= 275, `Centroid y=${clickRes.clickPoint!.y} expected ~260`);

    const events = await page.evaluate(() => (window as any).__multiClicks);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].id, 'multi-btn');
    assert.strictEqual(events[0].isTrusted, true);
  } finally {
    await browser.close();
    await close();
  }
});

test('Integration 8: Pure Rect-only mode scrolls into Safe Viewport Band & resolves physical click point', async () => {
  const { baseUrl, close } = await createOcclusionMockServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await attachNameHelperInitScript(context);
    const page = await context.newPage();

    await page.goto(`${baseUrl}/sticky-bars.html`);
    await page.evaluate(() => window.scrollTo(0, 580));

    const preBox = await page.locator('#btn-under-header').boundingBox();
    assert.ok(preBox);

    // Call resolveSafeClickPoint with ONLY a Rect (no selector)
    const resolution = await resolveSafeClickPoint(page, preBox);
    assert.strictEqual(resolution.canClick, true, `Rect-only resolution should succeed: ${resolution.reason}`);
    assert.strictEqual(resolution.scrolledToSafeBand, true);
    assert.ok(resolution.clickPoint !== null);

    await page.mouse.click(resolution.clickPoint!.x, resolution.clickPoint!.y);
    const clickData = await page.evaluate(() => ({
      clicks: (window as any).__clicks,
      headerClicks: (window as any).__headerClicks,
    }));
    assert.strictEqual(clickData.headerClicks, 0);
    assert.strictEqual(clickData.clicks.length, 1);
    assert.strictEqual(clickData.clicks[0].id, 'btn-under-header');
    assert.strictEqual(clickData.clicks[0].isTrusted, true);
  } finally {
    await browser.close();
    await close();
  }
});
