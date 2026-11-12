// Khởi động overlay: canvas scale vừa cửa sổ, vòng lặp rAF (delta time), nối WS hoặc mock.
import { W, H } from './layout.js';
import { store, handleMessage, on, setConn } from './store.js';
import { connectWS, defaultWsUrl } from './net.js';
import { initScene, updateScene, drawSceneBack, drawDocks } from './render/scene.js';
import { drawAnglers } from './render/anglers.js';
import { updateEffects, drawParticles, drawPops, catchEffect, shakeOffset, particleCount } from './render/effects.js';
import { pushBanner, updateBanner, drawBanner } from './render/banner.js';
import { pushGift, pushToast, updateNotices, drawNotices } from './render/notices.js';
import { rarityOf } from './config.js';
import { fmtNum } from './util.js';
import { updateLeaderboard, drawLeaderboard } from './render/leaderboard.js';
import { drawHeader, drawQueue, drawGuide, drawDebug } from './render/hud.js';
import { avatarStats } from './avatars.js';

const params = new URLSearchParams(location.search);
const MOCK = params.get('mock') === '1' || params.get('mock') === 'true';
const DEBUG = params.get('debug') === '1';
const FULL_RES = params.get('res') === 'full';
if (params.get('bg') === 'transparent') document.documentElement.classList.add('transparent');

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
let sx = 1, sy = 1;

function resize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const scale = Math.min(vw / W, vh / H);
  const cssW = Math.max(1, Math.floor(W * scale));
  const cssH = Math.max(1, Math.floor(H * scale));
  // Độ phân giải thật: theo devicePixelRatio, không vượt quá 2x sân khấu logic
  // ?res=full: luôn vẽ đủ 1080x1920 điểm ảnh (đo FPS / chụp ảnh chi tiết dù cửa sổ nhỏ)
  const dpr = FULL_RES ? W / cssW : Math.min(window.devicePixelRatio || 1, (2 * W) / cssW);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  sx = canvas.width / W;
  sy = canvas.height / H;
}
window.addEventListener('resize', resize);
resize();

// ---------- Nối message → hiệu ứng ----------
on('catch', (ev) => {
  catchEffect(ev);
  pushBanner(ev);
  // Sử thi: báo ở dải toast (cá & điểm) — legendary/mythic đã có banner riêng
  if (ev.fish.rarity === 'epic') pushToast({ kind: 'catch', text: `${ev.who.nickname} câu được ${ev.fish.name} (${rarityOf('epic').label}) +${fmtNum(ev.points)}` });
});
on('gift', (g) => pushGift(g));
on('toast', (t) => pushToast(t));

/** Mọi dữ liệu thô (WS hay mock) đi qua đây → handleMessage duy nhất. */
function onRaw(data) {
  let msg;
  try { msg = JSON.parse(data); } catch { console.warn('[overlay] JSON hỏng'); return; }
  try { handleMessage(msg); } catch (e) { console.error('[overlay] handleMessage', msg?.type, e); }
}

initScene();

if (MOCK) {
  setConn({ mode: 'mock', state: 'open' });
  import('./mock.js').then((m) => m.startMock(onRaw, params));
} else {
  setConn({ mode: 'ws' });
  connectWS({ url: defaultWsUrl(params), onRaw, onConn: (c) => setConn(c) });
}

// ---------- Vòng lặp ----------
let last = performance.now();
let fps = 60, fpsAcc = 0, fpsN = 0, errLogged = 0, cpuMs = 0, cpuMax = 0;
// Thống kê thời gian frame (đo FPS thật): bỏ các khoảng > 250ms (tab/cửa sổ bị ẩn, rAF dừng).
const FT_N = 1200;
const frameTimes = new Float32Array(FT_N);
let ftIdx = 0, ftCount = 0, ftSkipped = 0;
function frameStats(reset = false) {
  const n = Math.min(ftCount, FT_N);
  const arr = Array.from(frameTimes.subarray(0, n)).sort((a, b) => a - b);
  const q = (p) => (n ? arr[Math.min(n - 1, Math.floor(p * n))] : 0);
  const out = { frames: n, skippedHidden: ftSkipped, p50: +q(0.5).toFixed(2), p90: +q(0.9).toFixed(2), p99: +q(0.99).toFixed(2), max: +(arr[n - 1] || 0).toFixed(2), fpsFromP50: n ? +(1000 / q(0.5)).toFixed(1) : 0 };
  if (reset) { ftIdx = 0; ftCount = 0; ftSkipped = 0; }
  return out;
}

let dbgN = 0, dbgFs = { p50: 0, p99: 0 };
function frame(now) {
  requestAnimationFrame(frame);
  const rawMs = now - last;
  const dt = Math.min(0.05, Math.max(0, rawMs / 1000));
  last = now;
  if (rawMs > 250) ftSkipped++;
  else if (rawMs > 0) { frameTimes[ftIdx] = rawMs; ftIdx = (ftIdx + 1) % FT_N; ftCount++; }
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  const c0 = performance.now();
  try {
    const t = now / 1000;
    updateScene(dt, t);
    updateEffects(dt);
    updateNotices(dt, now);
    updateLeaderboard(dt, now);
    updateBanner(now);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const [ox, oy] = shakeOffset(now);
    ctx.setTransform(sx, 0, 0, sy, ox * sx, oy * sy);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    drawSceneBack(ctx, t);
    drawDocks(ctx, t);
    drawAnglers(ctx, now);
    drawParticles(ctx, 0);
    drawPops(ctx, now);
    drawHeader(ctx, now);
    drawLeaderboard(ctx, now);
    drawNotices(ctx, now);
    drawQueue(ctx, now);
    drawGuide(ctx, now);
    drawBanner(ctx, now);
    drawParticles(ctx, 1);
    if (DEBUG) {
      const a = avatarStats();
      if (!(dbgN++ % 30)) dbgFs = frameStats();
      drawDebug(ctx, [
        `FPS ${fps.toFixed(0)}  CPU ${cpuMs.toFixed(1)}ms  hạt ${particleCount()}`,
        `frame p50 ${dbgFs.p50}ms  p99 ${dbgFs.p99}ms`,
        `players ${store.players.size}  msg ${store.msgCount}`,
        `clock lệch ${(store.clockOffset / 1000).toFixed(1)}s  state#${store.stateCount}`,
        `avatar ok ${a.ok} lỗi ${a.err} tải ${a.loading}`,
        `ws ${store.conn.mode}/${store.conn.state}`,
      ]);
    }
  } catch (e) {
    if (errLogged++ < 5) console.error('[overlay] render', e);
  }
  const c = performance.now() - c0;
  cpuMs = cpuMs * 0.95 + c * 0.05;
  cpuMax = Math.max(cpuMax, c);
}
requestAnimationFrame(frame);

// Cho kiểm thử / debug từ console
window.__overlay = { store, handleMessage, fps: () => fps, cpuMs: () => cpuMs, cpuMax: () => { const m = cpuMax; cpuMax = 0; return m; }, particles: particleCount, frameStats };
