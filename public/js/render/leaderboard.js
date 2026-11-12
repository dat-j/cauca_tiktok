// Bảng xếp hạng top 10 (Phiên này / Mọi thời đại xoay vòng) — gọn (hàng 39px) để nhường chỗ cho nhiều người câu.
// Hiệu ứng: hàng trượt khi đổi hạng, lên hạng nháy xanh + "▲n", tụt hạng nháy đỏ nhẹ, TOP 1 mới → hạt + toast,
// hàng TOP 1 có vệt sáng lướt. Khung tĩnh dựng sẵn ra canvas đệm.
import { LB } from '../layout.js';
import { store } from '../store.js';
import { tierStyle } from '../config.js';
import { drawAvatar } from '../avatars.js';
import { clamp, damp, font, fitText, outlinedText, rrPath, fmtNum, drawEmoji, TAU } from '../util.js';
import { burst } from './effects.js';
import { pushToast } from './notices.js';

const ROW_H = 39;
const HEAD_H = 50;
const views = { session: new Map(), allTime: new Map() };
let lastVersion = -1;
let tab = 'session';
let tabT0 = 0;
let fade = 1;
let lastTop = null; // userId top 1 phiên
let topFlash = 0;
let lastStateSeen = -1;

function sync(map, list, now, isSession, isSnap) {
  const seen = new Set();
  list.forEach((e, i) => {
    seen.add(e.userId);
    let v = map.get(e.userId);
    if (!v) {
      v = { e, y: i * ROW_H, a: 0, x: 60, shown: e.score, idx: i, flash: isSnap ? 0 : now, dir: 1, jump: 0, gone: false };
      map.set(e.userId, v);
    } else {
      if (i < v.idx && !v.gone) { v.flash = now; v.dir = 1; v.jump = v.idx - i; }
      else if (i > v.idx && !v.gone) { v.flash = now; v.dir = -1; v.jump = i - v.idx; }
      v.gone = false;
    }
    v.e = e;
    v.idx = i;
  });
  for (const [id, v] of map) if (!seen.has(id)) v.gone = true;
  if (isSession) {
    const top = list[0] && list[0].score > 0 ? list[0].userId : null;
    if (isSnap) lastTop = top;
    else if (top && top !== lastTop) {
      if (lastTop !== null) {
        topFlash = now;
        pushToast({ kind: 'top', text: `${list[0].nickname} vươn lên TOP 1!` });
        if (tab === 'session') burst(LB.x + 60, LB.y + HEAD_H + ROW_H / 2, 26, ['#ffd23f', '#fff3a0', '#ffffff'], { speed: 320, kind: 'mix' });
      }
      lastTop = top;
    } else if (!top) lastTop = null;
  }
}

export function updateLeaderboard(dt, now) {
  if (store.lbVersion !== lastVersion) {
    // snapshot mới (kết nối / reset): không coi là lên hạng / TOP 1 mới
    const isSnap = lastStateSeen !== store.stateCount;
    lastStateSeen = store.stateCount;
    lastVersion = store.lbVersion;
    sync(views.session, store.leaderboard, now, true, isSnap);
    sync(views.allTime, store.allTime, now, false, isSnap);
  }
  const span = tab === 'session' ? 16000 : 8000;
  if (!tabT0) tabT0 = now;
  if (now - tabT0 > span && (store.allTime.length > 0 || tab === 'allTime')) {
    fade -= dt * 4;
    if (fade <= 0) {
      fade = 0;
      tab = tab === 'session' ? 'allTime' : 'session';
      tabT0 = now;
    }
  } else fade = Math.min(1, fade + dt * 4);

  for (const map of Object.values(views)) {
    for (const [id, v] of map) {
      v.y = damp(v.y, v.idx * ROW_H, 9, dt);
      v.a = damp(v.a, v.gone ? 0 : 1, 8, dt);
      v.x = damp(v.x, v.gone ? 80 : 0, 8, dt);
      const diff = v.e.score - v.shown;
      v.shown = Math.abs(diff) < 1 ? v.e.score : v.shown + diff * (1 - Math.exp(-6 * dt));
      if (v.gone && v.a < 0.02) map.delete(id);
    }
  }
}

function drawCrown(ctx, x, y, color, dark) {
  ctx.fillStyle = color;
  ctx.strokeStyle = dark;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x - 16, y + 9);
  ctx.lineTo(x - 18, y - 8);
  ctx.lineTo(x - 8, y);
  ctx.lineTo(x, y - 13);
  ctx.lineTo(x + 8, y);
  ctx.lineTo(x + 18, y - 8);
  ctx.lineTo(x + 16, y + 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

const MEDAL = [
  { c: '#ffd23f', d: '#7a5200', bg: 'rgba(255,200,40,0.32)' },
  { c: '#e4ecf5', d: '#56637a', bg: 'rgba(220,230,245,0.22)' },
  { c: '#f0a060', d: '#6b3511', bg: 'rgba(240,150,80,0.24)' },
];

let frameC = null, shineC = null;
function buildFrame() {
  const { w, h } = LB;
  const S = 2;
  frameC = document.createElement('canvas');
  frameC.width = w * S; frameC.height = h * S;
  const g = frameC.getContext('2d');
  g.scale(S, S);
  g.fillStyle = 'rgba(8,12,38,0.82)';
  rrPath(g, 1.5, 1.5, w - 3, h - 3, 22);
  g.fill();
  g.strokeStyle = 'rgba(255,210,90,0.9)';
  g.lineWidth = 3;
  g.stroke();
  const hg = g.createLinearGradient(0, 0, 0, HEAD_H);
  hg.addColorStop(0, 'rgba(255,190,50,0.6)');
  hg.addColorStop(1, 'rgba(255,140,30,0.12)');
  g.fillStyle = hg;
  rrPath(g, 4, 4, w - 8, HEAD_H - 6, 19);
  g.fill();
  g.font = font(28, 900);
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 6;
  g.strokeStyle = '#2a1600';
  g.strokeText('🏆 TOP 10', 14, HEAD_H / 2 + 1);
  g.fillStyle = '#ffe680';
  g.fillText('🏆 TOP 10', 14, HEAD_H / 2 + 1);
  // vệt sáng lướt (dùng cho hàng TOP 1)
  shineC = document.createElement('canvas');
  shineC.width = 160; shineC.height = 40;
  const s = shineC.getContext('2d');
  const sg = s.createLinearGradient(0, 0, 160, 0);
  sg.addColorStop(0, 'rgba(255,255,255,0)');
  sg.addColorStop(0.5, 'rgba(255,250,210,0.45)');
  sg.addColorStop(1, 'rgba(255,255,255,0)');
  s.fillStyle = sg;
  s.fillRect(0, 0, 160, 40);
}

export function drawLeaderboard(ctx, now) {
  if (!frameC) buildFrame();
  const t = now / 1000;
  const { x, y, w, h } = LB;
  ctx.drawImage(frameC, x, y, w, h);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.font = font(20, 900);
  ctx.globalAlpha = fade;
  const label = tab === 'session' ? 'PHIÊN NÀY' : 'MỌI THỜI ĐẠI';
  const lw = ctx.measureText(label).width + 20;
  ctx.fillStyle = tab === 'session' ? '#ff3366' : '#7a4dff';
  rrPath(ctx, x + w - 12 - lw, y + 11, lw, 30, 15);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(label, x + w - 22, y + 27);

  const map = views[tab];
  const top = y + HEAD_H + 2;
  if (map.size === 0) {
    ctx.textAlign = 'center';
    ctx.font = font(26, 800);
    outlinedText(ctx, 'Chưa có ai câu được cá…', x + w / 2, top + 120, '#d8e4ff', 'rgba(0,0,0,0.8)', 5);
    ctx.font = font(24, 800);
    outlinedText(ctx, 'Hãy là người đầu tiên! 🎣', x + w / 2, top + 165, '#ffe680', 'rgba(0,0,0,0.8)', 5);
    ctx.globalAlpha = 1;
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, top - 2, w, h - HEAD_H - 4);
  ctx.clip();
  const arr = [...map.values()].sort((a, b) => b.y - a.y);
  for (const v of arr) {
    const e = v.e;
    const rx = x + 6 + v.x, ry = top + v.y, rw = w - 12;
    ctx.globalAlpha = fade * clamp(v.a, 0, 1);
    const medal = v.idx < 3 ? MEDAL[v.idx] : null;
    ctx.fillStyle = medal ? medal.bg : v.idx % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.09)';
    rrPath(ctx, rx, ry + 2, rw, ROW_H - 4, 11);
    ctx.fill();
    if (v.idx === 0 && tab === 'session') {
      // TOP 1: viền vàng + vệt sáng lướt
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.save();
      ctx.clip();
      const sx = ((now * 0.25) % (rw + 320)) - 160;
      ctx.drawImage(shineC, rx + sx, ry + 2, 160, ROW_H - 4);
      ctx.restore();
    }
    const fl = v.flash ? 1 - (now - v.flash) / 1400 : 0;
    if (fl > 0) {
      ctx.fillStyle = v.dir > 0 ? `rgba(90,255,150,${0.45 * fl})` : `rgba(255,80,90,${0.28 * fl})`;
      rrPath(ctx, rx, ry + 2, rw, ROW_H - 4, 11);
      ctx.fill();
    }
    const cy = ry + ROW_H / 2;
    if (medal) drawCrown(ctx, rx + 20, cy - 1, medal.c, medal.d);
    ctx.textAlign = 'center';
    ctx.font = font(medal ? 16 : 23, 900);
    if (medal) {
      ctx.fillStyle = medal.d;
      ctx.fillText(String(v.idx + 1), rx + 20, cy + 3);
    } else outlinedText(ctx, String(v.idx + 1), rx + 20, cy + 1, '#ffffff', 'rgba(0,0,0,0.8)', 5);
    const st = tierStyle(e.rodTier);
    ctx.fillStyle = st.color;
    ctx.beginPath(); ctx.arc(rx + 57, cy, 16.5, 0, TAU); ctx.fill();
    drawAvatar(ctx, e, rx + 57, cy, 14);
    ctx.textAlign = 'left';
    ctx.font = font(24, 900);
    const nm = fitText(ctx, e.nickname, 148);
    outlinedText(ctx, nm, rx + 80, cy + 1, medal ? medal.c : '#ffffff', 'rgba(0,0,0,0.9)', 5);
    if (e.bestCatch) drawEmoji(ctx, e.bestCatch.emoji, rx + 244, cy, 22);
    if (fl > 0 && v.dir > 0) {
      ctx.font = font(18, 900);
      ctx.textAlign = 'center';
      outlinedText(ctx, v.jump > 1 ? `▲${v.jump}` : '▲', rx + 57, cy - 15 - (1 - fl) * 6, '#5dff9a', 'rgba(0,0,0,0.9)', 4);
    }
    ctx.textAlign = 'right';
    ctx.font = font(24, 900);
    outlinedText(ctx, fmtNum(v.shown), rx + rw - 8, cy + 1, '#fff3a0', 'rgba(0,0,0,0.9)', 5);
  }
  ctx.restore();
  // TOP 1 mới: khung nháy vàng ~1.2s
  const tf = topFlash ? 1 - (now - topFlash) / 1200 : 0;
  if (tf > 0) {
    ctx.globalAlpha = tf;
    ctx.strokeStyle = '#ffe27a';
    ctx.lineWidth = 6;
    rrPath(ctx, x - 2, y - 2, w + 4, h + 4, 24);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  void t;
}
