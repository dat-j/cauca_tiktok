// Hạt (có giới hạn), cá bật lên khi catch (bay vào khe cạnh người câu), huy hiệu điểm trên cầu tàu, rung màn hình.
// Mọi quầng sáng/tia xoay dùng sprite dựng sẵn (không tạo gradient mỗi frame).
import { TAU, clamp, rand, easeOutBack, easeOutCubic, font, outlinedText, drawEmoji, rgba, fmtNum, rrPath } from '../util.js';
import { rarityOf } from '../config.js';
import { slotPos, layout } from '../layout.js';

export const MAX_PARTICLES = 700;
const parts = [];
const pool = [];

/** layer 0 = thế giới (dưới UI), 1 = trên cùng (trên banner). */
export function spawn(o) {
  if (parts.length >= MAX_PARTICLES) return null;
  const p = pool.pop() || {};
  p.x = o.x; p.y = o.y;
  p.vx = o.vx ?? 0; p.vy = o.vy ?? 0;
  p.g = o.g ?? 0; p.drag = o.drag ?? 0;
  p.life = o.life ?? 1; p.age = 0;
  p.size = o.size ?? 6; p.grow = o.grow ?? 0;
  p.color = o.color ?? '#fff';
  p.kind = o.kind ?? 'spark';
  p.rot = o.rot ?? rand(0, TAU); p.vr = o.vr ?? 0;
  p.layer = o.layer ?? 0;
  p.alpha = o.alpha ?? 1;
  parts.push(p);
  return p;
}
export const particleCount = () => parts.length;
export const particleRoom = () => MAX_PARTICLES - parts.length;

// ---------- Sprite dựng sẵn ----------
const glowCache = new Map();
/** Quầng sáng tròn theo màu hex (cache). */
export function glowSprite(color) {
  let c = glowCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, rgba(color, 0.95));
  gr.addColorStop(0.5, rgba(color, 0.35));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(color, c);
  return c;
}
const softCache = new Map();
/** Quầng sáng mềm (không lõi trắng) — dùng cho hào quang quanh người chơi. */
export function softGlow(color) {
  let c = softCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, rgba(color, 0.7));
  gr.addColorStop(0.45, rgba(color, 0.3));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  softCache.set(color, c);
  return c;
}
const rayCache = new Map();
/** Vòng tia sáng (n tia) theo màu — xoay bằng transform khi vẽ. */
export function raysSprite(color, n = 12) {
  const key = color + '|' + n;
  let c = rayCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.translate(128, 128);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 128);
  gr.addColorStop(0, rgba(color, 0.8));
  gr.addColorStop(0.6, rgba(color, 0.3));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  for (let i = 0; i < n; i++) {
    g.rotate(TAU / n);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(128, -11);
    g.lineTo(128, 11);
    g.closePath();
    g.fill();
  }
  rayCache.set(key, c);
  return c;
}
const beamCache = new Map();
/** Cột sáng dọc (nâng cấp cần, top 1). */
export function beamSprite(color) {
  let c = beamCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = 120; c.height = 400;
  const g = c.getContext('2d');
  const v = g.createLinearGradient(0, 0, 0, 400);
  v.addColorStop(0, rgba(color, 0));
  v.addColorStop(0.5, rgba(color, 0.55));
  v.addColorStop(1, rgba(color, 0.9));
  g.fillStyle = v;
  g.fillRect(0, 0, 120, 400);
  g.globalCompositeOperation = 'destination-in';
  const h = g.createLinearGradient(0, 0, 120, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)');
  h.addColorStop(0.5, 'rgba(0,0,0,1)');
  h.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = h;
  g.fillRect(0, 0, 120, 400);
  beamCache.set(color, c);
  return c;
}
/** 12 màu cầu vồng (hex) — dùng thay hsl() động để cache sprite được. */
export const RAINBOW = ['#ff4d6d', '#ff8a3d', '#ffc93d', '#d6f53d', '#6cf542', '#3df5a0', '#3de8f5', '#3d9df5', '#5d6bff', '#a35dff', '#e05dff', '#ff5dc4'];
export const rainbowAt = (t, off = 0) => RAINBOW[(Math.floor(t * 4) + off) % RAINBOW.length];

function updateParticles(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.age += dt;
    if (p.age >= p.life) {
      parts[i] = parts[parts.length - 1];
      parts.pop();
      pool.push(p);
      continue;
    }
    if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; }
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    p.size += p.grow * dt;
  }
}

export function drawParticles(ctx, layer) {
  for (const p of parts) {
    if (p.layer !== layer) continue;
    const t = p.age / p.life;
    const a = p.alpha * (1 - t * t);
    if (p.kind === 'confetti') {
      ctx.globalAlpha = a;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.rot * 2.3));
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    } else if (p.kind === 'drop') {
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    } else if (p.kind === 'ring') {
      ctx.globalAlpha = a * 0.8;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.size, p.size * 0.32, 0, 0, TAU);
      ctx.stroke();
    } else if (p.kind === 'emoji') {
      ctx.globalAlpha = a;
      drawEmoji(ctx, p.color, p.x, p.y, p.size);
    }
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const p of parts) {
    if (p.layer !== layer) continue;
    if (p.kind !== 'spark' && p.kind !== 'star') continue;
    const t = p.age / p.life;
    ctx.globalAlpha = p.alpha * (1 - t);
    const s = p.size;
    ctx.drawImage(glowSprite(p.color), p.x - s, p.y - s, s * 2, s * 2);
    if (p.kind === 'star') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      const L = s * 1.4, w = s * 0.18;
      ctx.moveTo(-L, 0); ctx.lineTo(-w, -w); ctx.lineTo(0, -L); ctx.lineTo(w, -w);
      ctx.lineTo(L, 0); ctx.lineTo(w, w); ctx.lineTo(0, L); ctx.lineTo(-w, w);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

// ---------- Bộ phát dựng sẵn ----------
export function splash(x, y, n = 12, color = '#cdf3ff') {
  for (let i = 0; i < n; i++) {
    spawn({ kind: 'drop', x: x + rand(-8, 8), y, vx: rand(-160, 160), vy: rand(-420, -160), g: 1100, life: rand(0.5, 0.9), size: rand(2.5, 5.5), color });
  }
  spawn({ kind: 'ring', x, y: y + 4, size: 10, grow: 90, life: 0.8, color: '#e8fbff' });
  spawn({ kind: 'ring', x, y: y + 4, size: 4, grow: 60, life: 1.0, color: '#bfefff' });
}
export function ripple(x, y, color = '#d8f6ff') {
  spawn({ kind: 'ring', x, y, size: 6, grow: 40, life: 1.1, color, alpha: 0.6 });
}
export function burst(x, y, n, colors, { speed = 420, layer = 0, size = [4, 10], life = [0.6, 1.3], g = 200, kind = 'spark' } = {}) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), sp = rand(speed * 0.3, speed);
    spawn({
      kind: kind === 'mix' ? (Math.random() < 0.5 ? 'spark' : 'star') : kind,
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g, drag: 1.6,
      life: rand(life[0], life[1]), size: rand(size[0], size[1]),
      color: colors[i % colors.length], vr: rand(-6, 6), layer,
    });
  }
}
export function confetti(n, colors, layer = 1) {
  for (let i = 0; i < n; i++) {
    spawn({
      kind: 'confetti', x: rand(0, 1080), y: rand(-200, -10), vx: rand(-80, 80), vy: rand(200, 520),
      g: 160, drag: 0.4, life: rand(2.2, 3.6), size: rand(12, 22), color: colors[i % colors.length], vr: rand(-8, 8), layer,
    });
  }
}

// ---------- Rung màn hình ----------
const shakeState = { mag: 0, until: 0, dur: 1 };
export function shake(mag, ms) {
  const now = performance.now();
  if (mag >= shakeState.mag * Math.max(0, (shakeState.until - now) / shakeState.dur)) {
    shakeState.mag = mag; shakeState.until = now + ms; shakeState.dur = ms;
  }
}
export function shakeOffset(now) {
  const left = shakeState.until - now;
  if (left <= 0) return [0, 0];
  const m = shakeState.mag * (left / shakeState.dur);
  return [rand(-m, m), rand(-m, m)];
}

// ---------- Cá bật lên ----------
// Vị trí tương đối với (x, dockY) của slot, ở tỉ lệ 1 (nhân layout.scale khi dùng).
export const BOB = { x: 66, y: 60 }; // phao nằm trên mặt nước ngay trước cầu tàu
export const GAP = { x: 74, y: -70 }; // khe giữa 2 người câu, ngang đầu — nơi cá "đậu" sau khi kéo lên
const POP_TOTAL = 1.9;
const pops = []; // mỗi slot tối đa 1

export function catchEffect(ev) {
  if (ev.slot === null) return;
  const R = rarityOf(ev.fish.rarity);
  const { x, dockY } = slotPos(ev.slot);
  const k = layout.scale;
  const bx = x + BOB.x * k, by = dockY + BOB.y * k;
  const now = performance.now();
  for (let i = pops.length - 1; i >= 0; i--) if (pops[i].slot === ev.slot) pops.splice(i, 1);
  pops.push({
    slot: ev.slot, t0: now, x0: bx, y0: by, x1: x + GAP.x * k, y1: dockY + GAP.y * k, k,
    fish: ev.fish, R, isBest: ev.isBest, points: ev.points, bx: x + GAP.x * k, by: dockY + 16 * k, nextTrail: 0,
  });
  splash(bx, by, 8 + R.idx * 4);
  if (R.idx >= 2) burst(x + GAP.x * k, dockY + GAP.y * k, 6 + R.idx * 5, [R.color, R.glow, '#ffffff'], { speed: 220 + R.idx * 50, kind: 'mix', size: [3, 8] });
  if (R.idx === 3) shake(4, 260); // sử thi: rung nhẹ
}

/** Vị trí cá đang bay (để vẽ dây câu kéo theo), null nếu không có. */
export function popPos(slot, now) {
  for (const p of pops) {
    if (p.slot !== slot) continue;
    const t = (now - p.t0) / 1000;
    const fly = clamp(t / 0.5, 0, 1);
    if (fly >= 1) return null;
    const e = easeOutCubic(fly);
    return { x: p.x0 + (p.x1 - p.x0) * e, y: p.y0 + (p.y1 - p.y0) * e - Math.sin(fly * Math.PI) * 50 * p.k, fly };
  }
  return null;
}

export function updateEffects(dt) {
  updateParticles(dt);
}

const RARE_TAG = ['', '', 'HIẾM', 'SỬ THI', 'HUYỀN THOẠI', 'THẦN THOẠI'];

export function drawPops(ctx, now) {
  const t = now / 1000;
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i];
    const el = (now - p.t0) / 1000;
    if (el > POP_TOTAL) { pops.splice(i, 1); continue; }
    const fly = clamp(el / 0.5, 0, 1);
    const e = easeOutCubic(fly);
    let x = p.x0 + (p.x1 - p.x0) * e;
    let y = p.y0 + (p.y1 - p.y0) * e - Math.sin(fly * Math.PI) * 50 * p.k;
    const fade = el > POP_TOTAL - 0.35 ? 1 - (el - (POP_TOTAL - 0.35)) / 0.35 : 1;
    if (fly >= 1) y += Math.sin((el - 0.5) * 9) * 3;
    const R = p.R;
    const sz = (R.idx >= 2 ? 62 : 50) * p.k;
    // hào quang (rare+): quầng mềm + tia xoay; epic+ thêm vòng tia ngược chiều
    if (R.idx >= 2) {
      const ak = fade * Math.min(1, el * 3);
      ctx.globalCompositeOperation = 'lighter';
      const gr = (48 + R.idx * 10) * p.k * (1 + 0.08 * Math.sin(t * 6));
      ctx.globalAlpha = ak * 0.9;
      ctx.drawImage(softGlow(R.glow), x - gr, y - gr, gr * 2, gr * 2);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * 1.4);
      const rr = (58 + R.idx * 10) * p.k;
      ctx.globalAlpha = ak * 0.7;
      ctx.drawImage(raysSprite(R.color, 6 + R.idx * 2), -rr, -rr, rr * 2, rr * 2);
      if (R.idx >= 3) {
        ctx.rotate(-t * 2.6);
        ctx.globalAlpha = ak * 0.5;
        ctx.drawImage(raysSprite('#ffffff', 8), -rr * 0.8, -rr * 0.8, rr * 1.6, rr * 1.6);
      }
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
      // vệt hạt khi đang bay + lấp lánh khi đậu
      if (now > p.nextTrail && particleRoom() > 150) {
        p.nextTrail = now + (fly < 1 ? 30 : 160 - R.idx * 20);
        spawn({ kind: R.idx >= 3 ? 'star' : 'spark', x: x + rand(-14, 14), y: y + rand(-14, 14), vx: rand(-30, 30), vy: rand(-60, -10), life: 0.7, size: rand(4, 8), color: Math.random() < 0.5 ? R.color : '#ffffff', vr: 3 });
      }
    } else if (R.idx === 1) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = fade * 0.5;
      const gr = 40 * p.k;
      ctx.drawImage(softGlow(R.glow), x - gr, y - gr, gr * 2, gr * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = fade;
    ctx.save();
    ctx.translate(x, y);
    if (fly < 1) ctx.rotate((1 - fly) * -2.4);
    else ctx.rotate(Math.sin(el * 7) * 0.12);
    drawEmoji(ctx, p.fish.emoji, 0, 0, sz, 0.6 + 0.4 * easeOutBack(fly));
    ctx.restore();

    // Huy hiệu điểm trên mặt cầu tàu (trong khe, không che tên/mồi của ai)
    if (el > 0.35) {
      const k2 = easeOutBack(clamp((el - 0.35) / 0.3, 0, 1));
      const rise = easeOutCubic(clamp((el - 0.35) / 1.2, 0, 1)) * 8 * p.k;
      const label = (p.isBest ? '🏅' : '') + '+' + fmtNum(p.points);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.bx, p.by - rise);
      ctx.scale(k2 * p.k, k2 * p.k);
      ctx.font = font(R.idx >= 4 ? 26 : 24, 900);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(label).width + 16;
      ctx.fillStyle = R.idx >= 2 ? rgba(R.color, 0.95) : 'rgba(8,14,36,0.85)';
      rrPath(ctx, -tw / 2, -15, tw, 30, 15);
      ctx.fill();
      ctx.strokeStyle = R.idx >= 2 ? '#ffffff' : R.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      if (R.idx >= 2) outlinedText(ctx, label, 0, 1, '#ffffff', 'rgba(10,6,30,0.95)', 5);
      else { ctx.fillStyle = R.idx === 1 ? R.color : '#ffffff'; ctx.fillText(label, 0, 1); }
      // nhãn độ hiếm nhỏ ngay trên huy hiệu (rare+)
      if (R.idx >= 2 && el < 1.5) {
        ctx.font = font(17, 900);
        outlinedText(ctx, RARE_TAG[R.idx], 0, -24, R.color, 'rgba(5,8,22,0.95)', 4);
      }
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

// Tương thích: không còn điểm bay toàn màn (đã chuyển thành huy hiệu trên cầu tàu).
export function drawFloaters() {}
