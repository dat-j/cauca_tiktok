// Header (tiêu đề + trạng thái), hàng chờ, dải hướng dẫn quy đổi quà xoay vòng, debug.
import { W, HEADER_H, GUIDE, QUEUE, slotCount } from '../layout.js';
import { store } from '../store.js';
import { tierStyle } from '../config.js';
import { drawAvatar } from '../avatars.js';
import { TAU, clamp, font, fitText, outlinedText, rrPath, fmtNum, easeOutCubic } from '../util.js';
import { drawRod } from './anglers.js';

let headerC = null;
function buildHeader() {
  const S = 2;
  headerC = document.createElement('canvas');
  headerC.width = W * S; headerC.height = (HEADER_H + 20) * S;
  const g = headerC.getContext('2d');
  g.scale(S, S);
  const bg = g.createLinearGradient(0, 0, 0, HEADER_H + 20);
  bg.addColorStop(0, 'rgba(4,8,30,0.9)');
  bg.addColorStop(0.75, 'rgba(4,8,30,0.62)');
  bg.addColorStop(1, 'rgba(4,8,30,0)');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, HEADER_H + 20);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = font(50, 900);
  const tg = g.createLinearGradient(0, 14, 0, 66);
  tg.addColorStop(0, '#fff6b8');
  tg.addColorStop(0.55, '#ffc62e');
  tg.addColorStop(1, '#ff8a1f');
  g.lineJoin = 'round';
  g.lineWidth = 10;
  g.strokeStyle = '#2a0f3a';
  g.strokeText('🎣 HỒ CÂU THẦN TỐC', 20, 40);
  g.fillStyle = tg;
  g.fillText('🎣 HỒ CÂU THẦN TỐC', 20, 40);
  g.font = font(23, 800);
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText('Bình luận • Thả tim • Tặng quà để câu cá!', 24, 84);
  g.fillStyle = '#cfe6ff';
  g.fillText('Bình luận • Thả tim • Tặng quà để câu cá!', 24, 84);
}

export function drawHeader(ctx, now) {
  const t = now / 1000;
  if (!headerC) buildHeader();
  ctx.drawImage(headerC, 0, 0, W, HEADER_H + 20);
  // Trạng thái (bên phải)
  const s = store.status || {};
  const c = store.conn;
  let chip1, col1;
  if (c.mode !== 'mock' && c.state !== 'open') {
    const left = c.retryAt ? Math.max(0, Math.ceil((c.retryAt - Date.now()) / 1000)) : 0;
    chip1 = c.state === 'connecting' ? '⏳ Đang nối máy chủ…' : `⚠ Mất kết nối · thử lại ${left}s`;
    col1 = '#d9324a';
  } else if (s.tiktok === 'connected') {
    chip1 = `LIVE · @${s.username || '?'}`;
    col1 = '#ff2d55';
  } else if (s.tiktok === 'connecting') {
    chip1 = '⏳ Đang kết nối TikTok…';
    col1 = '#c98a14';
  } else if (s.tiktok === 'error') {
    chip1 = `⚠ ${s.message || 'Lỗi kết nối TikTok'}`;
    col1 = '#b3263c';
  } else {
    chip1 = '○ Chưa kết nối TikTok';
    col1 = '#4a5370';
  }
  if (c.mode === 'mock') chip1 += ' · DEMO';
  ctx.font = font(24, 900);
  ctx.textAlign = 'right';
  const t1 = fitText(ctx, chip1, 380);
  const dot = s.tiktok === 'connected' && !(c.mode !== 'mock' && c.state !== 'open');
  const w1 = ctx.measureText(t1).width + 30 + (dot ? 22 : 0);
  ctx.fillStyle = col1;
  rrPath(ctx, W - 20 - w1, 12, w1, 38, 19);
  ctx.fill();
  if (dot) {
    ctx.fillStyle = `rgba(255,255,255,${0.6 + 0.4 * Math.sin(t * 5)})`;
    ctx.beginPath(); ctx.arc(W - 20 - w1 + 20, 31, 7, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = '#fff';
  ctx.fillText(t1, W - 35, 32);

  const q = Math.max(Number(s.queueLength) || 0, queued().length);
  const used = store.slotOwner.filter(Boolean).length;
  const parts = [`👀 ${fmtNum(s.viewers || 0)}`, `🎣 ${used}/${slotCount()}`];
  if (q > 0) parts.push(`⏳ ${q} chờ`);
  const t2 = parts.join('   ');
  ctx.font = font(24, 900);
  const w2 = ctx.measureText(t2).width + 30;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  rrPath(ctx, W - 20 - w2, 56, w2, 38, 19);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(t2, W - 35, 76);
}

function queued() {
  const out = [];
  for (const p of store.players.values()) if (p.slot === null) out.push(p);
  out.sort((a, b) => b.rodTier - a.rodTier);
  return out;
}

export function drawQueue(ctx, now) {
  const list = queued();
  const n = Math.max(list.length, Number(store.status?.queueLength) || 0);
  if (!n) return;
  const { x, y, h } = QUEUE;
  ctx.font = font(26, 900);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const label = `⏳ Đang chờ chỗ (${n}):`;
  const lw = ctx.measureText(label).width;
  const fit = Math.max(1, Math.floor((QUEUE.w - lw - 120) / 46));
  const show = list.slice(0, fit);
  const w = lw + 40 + show.length * 46 + (n > show.length ? 70 : 0);
  ctx.fillStyle = 'rgba(6,12,36,0.7)';
  rrPath(ctx, x, y, Math.min(w, QUEUE.w), h, h / 2);
  ctx.fill();
  outlinedText(ctx, label, x + 18, y + h / 2 + 1, '#ffe27a', 'rgba(0,0,0,0.85)', 5);
  let ax = x + 18 + lw + 30;
  for (const p of show) {
    ctx.fillStyle = tierStyle(p.rodTier).color;
    ctx.beginPath(); ctx.arc(ax, y + h / 2, 21, 0, TAU); ctx.fill();
    drawAvatar(ctx, p, ax, y + h / 2, 18);
    ax += 46;
  }
  if (n > show.length) outlinedText(ctx, `+${n - show.length}`, ax - 14, y + h / 2 + 1, '#ffffff', 'rgba(0,0,0,0.85)', 5);
}

// ---------- Dải hướng dẫn ----------
let guideItems = [];
let guideKey = '';
function buildGuide() {
  const cfg = store.config;
  const key = JSON.stringify(cfg.rods) + JSON.stringify(cfg.baits) + JSON.stringify(cfg.free);
  if (key === guideKey) return;
  guideKey = key;
  const items = [];
  const f = cfg.free;
  items.push({ tier: 1, text: `🆓 Bình luận lần đầu +${f.firstComment} mồi · Follow +${f.follow} mồi` });
  items.push({ tier: 1, text: `🆓 Chia sẻ +${f.share} mồi · Mỗi ${f.likesPerBait} tim ❤️ +1 mồi` });
  const r1 = cfg.rods[0];
  if (r1) items.push({ tier: r1.tier, text: `🎋 Ai cũng có ${r1.name} miễn phí · ${Math.round(r1.castMs / 100) / 10}s/lần câu` });
  for (const r of cfg.rods) {
    if (r.minDiamonds <= 0) continue;
    const b = cfg.baits.find((x) => x.tier === r.tier);
    const price = b ? ` · ${fmtNum(b.price)}💎 = 1 ${b.name}` : '';
    items.push({ tier: r.tier, text: `💎${fmtNum(r.minDiamonds)}+ → ${r.name} (${Math.round(r.castMs / 100) / 10}s)${price}` });
  }
  items.push({ tier: 6, text: '✨ Mồi càng xịn → càng dễ ra cá Huyền Thoại & Thần Thoại!' });
  guideItems = items;
}

const GUIDE_STEP = 3400;
let guideC = null;
function buildGuidePanel() {
  const { w, h } = GUIDE;
  const S = 2;
  guideC = document.createElement('canvas');
  guideC.width = (w + 8) * S; guideC.height = (h + 8) * S;
  const g = guideC.getContext('2d');
  g.scale(S, S);
  g.translate(4, 4);
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, 'rgba(40,14,70,0.92)');
  bg.addColorStop(1, 'rgba(10,8,40,0.92)');
  g.fillStyle = bg;
  rrPath(g, 0, 0, w, h, 26);
  g.fill();
  g.lineWidth = 3;
  const bgr = g.createLinearGradient(0, 0, w, 0);
  bgr.addColorStop(0, '#ffd23f');
  bgr.addColorStop(0.5, '#ff5fe0');
  bgr.addColorStop(1, '#62f2ff');
  g.strokeStyle = bgr;
  g.stroke();
}
export function drawGuide(ctx, now) {
  buildGuide();
  const { x, y, w, h } = GUIDE;
  const t = now / 1000;
  if (!guideC) buildGuidePanel();
  ctx.drawImage(guideC, x - 4, y - 4, w + 8, h + 8);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = font(33, 900);
  const pulse = 1 + 0.03 * Math.sin(t * 4);
  ctx.save();
  ctx.translate(x + 20, y + 32);
  ctx.scale(pulse, pulse);
  outlinedText(ctx, '🎁 Tặng quà để nhận cần & mồi xịn!', 0, 0, '#ffe27a', '#2a0f3a', 7);
  ctx.restore();

  if (!guideItems.length) return;
  const idx = Math.floor(now / GUIDE_STEP) % guideItems.length;
  const ph = (now % GUIDE_STEP) / GUIDE_STEP;
  const item = guideItems[idx];
  const st = tierStyle(item.tier);
  const inK = easeOutCubic(clamp(ph / 0.12, 0, 1));
  const outK = clamp((ph - 0.9) / 0.1, 0, 1);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 10, y + 52, w - 20, h - 54);
  ctx.clip();
  ctx.globalAlpha = inK * (1 - outK);
  const yy = y + 76 + (1 - inK) * 24 - outK * 24;
  drawRod(ctx, x + 26, yy + 10, x + 76, yy - 12, item.tier, t, 0.8);
  ctx.font = font(27, 800);
  outlinedText(ctx, fitText(ctx, item.text, w - 120), x + 92, yy, item.tier >= 2 ? st.color : '#ffffff', 'rgba(0,0,0,0.9)', 6);
  ctx.restore();
  // chấm chỉ vị trí
  const n = guideItems.length;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i === idx ? '#ffe27a' : 'rgba(255,255,255,0.3)';
    ctx.beginPath(); ctx.arc(x + w - 24 - (n - 1 - i) * 14, y + 32, 4.5, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function drawDebug(ctx, info) {
  ctx.font = font(20, 700);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const lines = info;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(10, 120, 330, lines.length * 24 + 10);
  ctx.fillStyle = '#7fff9f';
  lines.forEach((l, i) => ctx.fillText(l, 18, 126 + i * 24));
}
