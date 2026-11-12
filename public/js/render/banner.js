// Banner mẻ legendary / mythic (xếp hàng, mỗi lần 1 cái), 2 pha:
//  1) Toàn màn hình ~2s: chớp sáng, tia xoay, tiêu đề lớn, cá khổng lồ, tên người câu + điểm, rung + pháo giấy.
//  2) Thu về dải nhỏ ở vùng toast (trái, dưới thẻ quà) thêm ~3s — không che người câu / bảng xếp hạng.
// Tiêu đề viền + gradient được dựng sẵn thành sprite (không strokeText/shadowBlur mỗi frame).
import { W, H, TOAST } from '../layout.js';
import { rarityOf } from '../config.js';
import { drawAvatar } from '../avatars.js';
import { TAU, clamp, easeOutBack, easeOutCubic, font, fitText, outlinedText, drawEmoji, rgba, fmtNum, rand, rrPath } from '../util.js';
import { burst, confetti, shake, spawn, particleRoom, softGlow, raysSprite } from './effects.js';

const queue = [];
let cur = null;
const CY = 860;

export function pushBanner(ev) {
  if (ev.fish.rarity !== 'legendary' && ev.fish.rarity !== 'mythic') return;
  if (queue.length >= 6) queue.splice(0, queue.length - 5);
  queue.push(ev);
}
export const bannerActive = () => !!cur;
/** Đang ở pha dải nhỏ (vùng toast) — notices tạm hoãn toast mới. */
export const ribbonActive = () => !!cur && performance.now() - cur.t0 > cur.full - 300;

const titleCache = {};
function titleSprite(mythic) {
  const key = mythic ? 'm' : 'l';
  if (titleCache[key]) return titleCache[key];
  const S = 2, w = 900, h = 170;
  const c = document.createElement('canvas');
  c.width = w * S; c.height = h * S;
  const g = c.getContext('2d');
  g.scale(S, S);
  g.translate(w / 2, h / 2 + 6);
  g.font = font(116, 900);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const title = mythic ? 'THẦN THOẠI!' : 'HUYỀN THOẠI!';
  g.lineJoin = 'round';
  g.shadowColor = mythic ? '#ff2d7a' : '#ff9d00';
  g.shadowBlur = 30;
  g.lineWidth = 16;
  g.strokeStyle = '#1a0726';
  g.strokeText(title, 0, 0);
  g.shadowBlur = 0;
  let fill;
  if (mythic) {
    fill = g.createLinearGradient(-420, 0, 420, 0);
    for (let i = 0; i <= 5; i++) fill.addColorStop(i / 5, `hsl(${i * 60 + 300},100%,66%)`);
  } else {
    fill = g.createLinearGradient(0, -60, 0, 60);
    fill.addColorStop(0, '#fff7c4');
    fill.addColorStop(0.5, '#ffc21a');
    fill.addColorStop(1, '#ff7a00');
  }
  g.fillStyle = fill;
  g.fillText(title, 0, 0);
  titleCache[key] = { c, w, h };
  return titleCache[key];
}

// Nhiều mẻ hiếm liên tiếp (vd. vài người cần Huyền Thoại) → không phủ toàn màn liên tục:
// pha toàn màn chỉ khi lần toàn màn trước đã kết thúc đủ lâu; còn lại chỉ hiện dải nhỏ.
const FULL_COOLDOWN = { legendary: 8000, mythic: 2000 };
let lastFullEnd = -1e9;

function start(ev, now) {
  const mythic = ev.fish.rarity === 'mythic';
  const busy = queue.length >= 2 ? 0.7 : 1;
  const allowFull = now - lastFullEnd >= FULL_COOLDOWN[ev.fish.rarity];
  const full = allowFull ? (mythic ? 2200 : 1900) * busy : 300;
  const dur = full + (mythic ? 3300 : 2800) * busy;
  if (allowFull) lastFullEnd = now + full;
  cur = { ev, t0: now, full, dur, mythic, R: rarityOf(ev.fish.rarity), nextSpark: allowFull ? 0 : Infinity, allowFull };
  const cols = mythic ? ['#ff5c9d', '#ffd84d', '#6ef7ff', '#b685ff', '#ffffff'] : ['#ffbf2e', '#fff1a8', '#ff8a00', '#ffffff'];
  if (allowFull) {
    shake(mythic ? 22 : 14, mythic ? 800 : 550);
    burst(W / 2, CY, mythic ? 100 : 70, cols, { speed: 900, layer: 1, size: [6, 16], life: [0.8, 1.6], g: 120, kind: 'mix' });
    confetti(mythic ? 120 : 80, cols, 1);
  } else {
    shake(mythic ? 8 : 5, 300);
    burst(TOAST.x + 60, TOAST.y + 45, mythic ? 40 : 28, cols, { speed: 420, layer: 1, size: [4, 10], life: [0.6, 1.2], g: 120, kind: 'mix' });
  }
}

export function updateBanner(now) {
  if (!cur && queue.length) start(queue.shift(), now);
  if (cur && now - cur.t0 > cur.dur) {
    cur = null;
    if (queue.length) start(queue.shift(), now + 1);
  }
  if (cur && now - cur.t0 < cur.full && now > cur.nextSpark && particleRoom() > 120) {
    cur.nextSpark = now + 40;
    const a = rand(0, TAU), r = rand(170, 300);
    spawn({ kind: 'star', x: W / 2 + Math.cos(a) * r, y: CY + Math.sin(a) * r, vx: 0, vy: -40, life: 0.9, size: rand(6, 12), color: cur.R.color, layer: 1, vr: 4 });
  }
}

function drawFull(ctx, now) {
  const { ev, t0, full, mythic, R } = cur;
  const el = now - t0;
  const t = now / 1000;
  const vis = Math.min(clamp(el / 250, 0, 1), clamp((full - el) / 350, 0, 1));
  if (vis <= 0) return;
  ctx.globalAlpha = vis;
  ctx.fillStyle = 'rgba(4,6,20,0.72)';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  ctx.save();
  ctx.translate(W / 2, CY);
  ctx.rotate(t * 0.5);
  ctx.globalAlpha = vis * 0.8;
  ctx.drawImage(raysSprite(R.color, mythic ? 20 : 16), -1000, -1000, 2000, 2000);
  if (mythic) {
    ctx.rotate(-t * 1.1);
    ctx.globalAlpha = vis * 0.5;
    ctx.drawImage(raysSprite('#6ef7ff', 12), -800, -800, 1600, 1600);
  }
  ctx.restore();
  ctx.globalAlpha = vis;
  ctx.drawImage(softGlow(R.glow), W / 2 - 360, CY - 360, 720, 720);
  ctx.globalCompositeOperation = 'source-over';
  if (el < 240) {
    ctx.globalAlpha = 0.8 * (1 - el / 240);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalAlpha = vis;

  const ts = easeOutBack(clamp((el - 60) / 450, 0, 1));
  const spr = titleSprite(mythic);
  ctx.save();
  ctx.translate(W / 2, 470);
  ctx.scale(ts, ts);
  ctx.drawImage(spr.c, -spr.w / 2, -spr.h / 2, spr.w, spr.h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(40, 900);
  outlinedText(ctx, mythic ? '✦ MẺ CÁ THẦN THOẠI ✦' : '✦ MẺ CÁ HUYỀN THOẠI ✦', 0, -100, '#ffffff', '#1a0726', 8);
  ctx.restore();

  const fs = easeOutBack(clamp((el - 120) / 550, 0, 1));
  ctx.save();
  ctx.translate(W / 2, CY + Math.sin(t * 2.4) * 12);
  ctx.rotate(Math.sin(t * 1.7) * 0.08);
  drawEmoji(ctx, ev.fish.emoji, 0, 0, 160, 1.6 * fs);
  ctx.restore();

  const ia = easeOutCubic(clamp((el - 300) / 400, 0, 1));
  ctx.globalAlpha = vis * ia;
  const y0 = 1120 + (1 - ia) * 40;
  ctx.font = font(52, 900);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const name = fitText(ctx, ev.who.nickname, 700);
  const nw = ctx.measureText(name).width;
  const ax = W / 2 - (104 + nw) / 2;
  ctx.fillStyle = R.color;
  ctx.beginPath(); ctx.arc(ax + 44, y0, 50, 0, TAU); ctx.fill();
  drawAvatar(ctx, ev.who, ax + 44, y0, 44);
  outlinedText(ctx, name, ax + 104, y0, '#ffffff', '#0a0820', 9);
  ctx.textAlign = 'center';
  ctx.font = font(38, 800);
  outlinedText(ctx, 'đã câu được', W / 2, y0 + 72, '#e8e8ff', '#0a0820', 7);
  ctx.font = font(76, 900);
  outlinedText(ctx, fitText(ctx, ev.fish.name, 960), W / 2, y0 + 148, R.color, '#0a0820', 12);
  ctx.font = font(64, 900);
  outlinedText(ctx, `+${fmtNum(ev.points)} điểm`, W / 2, y0 + 236, '#fff3a0', '#0a0820', 11);
  ctx.globalAlpha = 1;
}

function drawRibbon(ctx, now) {
  const { ev, t0, full, dur, mythic, R } = cur;
  const el = now - t0 - (full - 300);
  if (el < 0) return;
  const t = now / 1000;
  const a = Math.min(clamp(el / 250, 0, 1), clamp((dur - (now - t0)) / 350, 0, 1));
  const sIn = easeOutBack(clamp(el / 400, 0, 1));
  const x = TOAST.x, y = TOAST.y - 4, w = TOAST.w, h = 98;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(x + w / 2, y + h / 2);
  ctx.scale(sIn, sIn);
  ctx.translate(-w / 2, -h / 2);
  ctx.fillStyle = mythic ? 'rgba(70,6,46,0.94)' : 'rgba(70,40,0,0.94)';
  rrPath(ctx, 0, 0, w, h, 24);
  ctx.fill();
  ctx.strokeStyle = R.color;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  ctx.save();
  ctx.translate(56, h / 2);
  ctx.rotate(t * 1.2);
  ctx.globalAlpha = a * 0.8;
  ctx.drawImage(raysSprite(R.color, 12), -62, -62, 124, 124);
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = a;
  drawEmoji(ctx, ev.fish.emoji, 56, h / 2 + Math.sin(t * 4) * 3, 60);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = font(30, 900);
  const head = mythic ? 'THẦN THOẠI! ' : 'HUYỀN THOẠI! ';
  outlinedText(ctx, head, 108, 30, R.color, '#14051f', 7);
  const hw = ctx.measureText(head).width;
  outlinedText(ctx, fitText(ctx, ev.who.nickname, w - 120 - hw), 108 + hw, 30, '#ffffff', '#14051f', 7);
  ctx.font = font(28, 900);
  outlinedText(ctx, fitText(ctx, `${ev.fish.name} · +${fmtNum(ev.points)} điểm`, w - 124), 108, 68, '#fff3a0', '#14051f', 6);
  ctx.restore();
  ctx.globalAlpha = 1;
}

export function drawBanner(ctx, now) {
  if (!cur) return;
  drawRibbon(ctx, now);
  if (cur.allowFull && now - cur.t0 < cur.full) drawFull(ctx, now);
}
