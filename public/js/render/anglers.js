// Người câu ở các slot (số slot từ config.slots): thân + avatar tròn + tên viền + cần theo tier + dây/phao
// + vòng tiến độ + số mồi. Hiệu ứng: quăng cần (vung cần, dây cong, tóe nước), cá cắn (phao giật, cần cong, "❗"),
// kéo cá (dây kéo theo cá), hào quang theo cần (vàng/kim cương/huyền thoại), cột sáng khi nâng cần, điểm nhấn TOP 1-3.
//
// Hiệu năng (24 người): không gradient/shadowBlur mỗi frame — cần vẽ bằng nét màu phẳng, thân & phao là sprite
// cache, quầng sáng là sprite (effects.js), chữ viền qua outlinedText (cache).
import { store, serverNow, topBaitTier } from '../store.js';
import { slotPos, slotCount, layout } from '../layout.js';
import { tierStyle } from '../config.js';
import { drawAvatar, colorFor } from '../avatars.js';
import { TAU, clamp, lerp, easeOutBack, easeOutCubic, easeInOutSine, font, fitText, outlinedText, rrPath, drawEmoji } from '../util.js';
import { spawn, ripple, splash, burst, particleRoom, glowSprite, softGlow, raysSprite, beamSprite, rainbowAt, popPos, BOB } from './effects.js';

const HEAD_R = 33;
const HEAD_Y = -72;
const NAME_Y = -130;
const NAME_MAX_W = 124;
let slotFx = [];
function fxOf(i) {
  while (slotFx.length <= i) slotFx.push({ nextRipple: 0, nextSpark: 0, splashed: 0, upFx: 0, castT: 0, biteFx: 0 });
  return slotFx[i];
}

// ---------- Cần câu theo tier (nét phẳng, cong được) ----------
const ROD_COL = [null,
  { c: '#d9b56a', h: '#f6e2a6', w: 7 },
  { c: '#8a96a4', h: '#dfe6ee', w: 7 },
  { c: '#cfd9e6', h: '#ffffff', w: 7.5 },
  { c: '#ffc21f', h: '#fff3b0', w: 8 },
  { c: '#4fdcf5', h: '#eaffff', w: 8.5 },
  { c: '#ff5fe0', h: '#ffffff', w: 9.5 },
];
const SAMPLES = 9;
const qx = new Float32Array(SAMPLES), qy = new Float32Array(SAMPLES);

function sampleQuad(x0, y0, cx, cy, x1, y1) {
  for (let i = 0; i < SAMPLES; i++) {
    const u = i / (SAMPLES - 1), v = 1 - u;
    qx[i] = v * v * x0 + 2 * v * u * cx + u * u * x1;
    qy[i] = v * v * y0 + 2 * v * u * cy + u * u * y1;
  }
}
function strokeRange(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(qx[a], qy[a]);
  for (let i = a + 1; i <= b; i++) ctx.lineTo(qx[i], qy[i]);
  ctx.stroke();
}

/** Vẽ cần từ tay cầm (gx,gy) tới đầu cần (tx,ty). bend > 0 → cong xuống (cá kéo). */
export function drawRod(ctx, gx, gy, tx, ty, tier, t, scale = 1, bend = 0) {
  tier = clamp(tier | 0, 1, 6);
  const st = ROD_COL[tier];
  const color = tier === 6 ? rainbowAt(t) : st.c;
  const dx = tx - gx, dy = ty - gy;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len; // pháp tuyến
  const sgn = ny > 0 ? 1 : -1; // hướng "xuống"
  const cx = gx + dx * 0.55 + nx * sgn * bend, cy = gy + dy * 0.55 + ny * sgn * bend;
  sampleQuad(gx, gy, cx, cy, tx, ty);
  const w0 = st.w * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // viền tối
  ctx.strokeStyle = 'rgba(12,8,24,0.85)';
  ctx.lineWidth = w0 + 3 * scale; strokeRange(ctx, 0, 3);
  ctx.lineWidth = w0 * 0.72 + 3 * scale; strokeRange(ctx, 3, 6);
  ctx.lineWidth = w0 * 0.42 + 2.5 * scale; strokeRange(ctx, 6, SAMPLES - 1);
  // thân cần (thon dần)
  ctx.strokeStyle = color;
  ctx.lineWidth = w0; strokeRange(ctx, 0, 3);
  ctx.lineWidth = w0 * 0.72; strokeRange(ctx, 3, 6);
  ctx.lineWidth = w0 * 0.42; strokeRange(ctx, 6, SAMPLES - 1);
  // vệt sáng
  ctx.strokeStyle = st.h;
  ctx.lineWidth = Math.max(1, w0 * 0.22);
  strokeRange(ctx, 1, SAMPLES - 2);
  if (tier === 1) {
    // đốt tre
    ctx.fillStyle = '#6d5228';
    for (let i = 2; i < SAMPLES - 1; i += 2) { ctx.beginPath(); ctx.arc(qx[i], qy[i], w0 * 0.42, 0, TAU); ctx.fill(); }
  } else {
    // tay cầm + máy câu
    ctx.strokeStyle = tier >= 4 ? '#3a1d0c' : '#222831';
    ctx.lineWidth = w0 + 2 * scale;
    strokeRange(ctx, 0, 1);
    const ts = tierStyle(tier);
    ctx.fillStyle = ts.dark;
    ctx.beginPath(); ctx.arc(qx[1], qy[1] + 6 * scale, (4 + tier * 0.7) * scale, 0, TAU); ctx.fill();
    ctx.fillStyle = tier === 6 ? color : ts.color;
    ctx.beginPath(); ctx.arc(qx[1], qy[1] + 6 * scale, (2 + tier * 0.35) * scale, 0, TAU); ctx.fill();
  }
  if (tier >= 4) {
    // đá quý phát sáng ở đầu cần
    const r = (tier === 6 ? 16 : 12) * scale * (1 + 0.15 * Math.sin(t * 6));
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glowSprite(tier === 6 ? color : tier === 5 ? '#62f2ff' : '#ffcf3a'), tx - r, ty - r, r * 2, r * 2);
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ---------- Sprite: phao, thân ----------
const bobberCache = new Map();
function bobberSprite(tier) {
  let c = bobberCache.get(tier);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = 80; c.height = 100; // x2
  const g = c.getContext('2d');
  g.scale(2, 2);
  g.translate(20, 34);
  g.fillStyle = '#222';
  g.fillRect(-1.5, -24, 3, 14);
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(0, 0, 12, 0, TAU); g.fill();
  g.fillStyle = '#ff3b4e';
  g.beginPath(); g.arc(0, 0, 12, Math.PI, TAU); g.fill();
  g.fillStyle = tierStyle(tier).color;
  g.fillRect(-12, -2, 24, 4);
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 1.6;
  g.beginPath(); g.arc(0, 0, 12, 0, TAU); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath(); g.ellipse(-4, -6, 4, 2.4, -0.5, 0, TAU); g.fill();
  bobberCache.set(tier, c);
  return c;
}
/** Phao tâm (x,y); waterY = mặt nước; phần dưới nước bị cắt. */
function drawBobber(ctx, x, y, waterY, tier, k) {
  const spr = bobberSprite(tier);
  // phần nhìn thấy: từ đỉnh sprite tới (mặt nước + 3) theo toạ độ sprite (đơn vị logic, sprite x2)
  const top = y - 34 * k;
  const visH = clamp((waterY + 3 * k - top) / k, 6, 50);
  ctx.drawImage(spr, 0, 0, 80, visH * 2, x - 20 * k, top, 40 * k, visH * k);
  ctx.fillStyle = 'rgba(0,20,40,0.28)';
  ctx.beginPath(); ctx.ellipse(x, waterY + 6 * k, 14 * k, 4 * k, 0, 0, TAU); ctx.fill();
}

const bodyCache = new Map();
function bodySprite(userId) {
  let c = bodyCache.get(userId);
  if (c) return c;
  if (bodyCache.size > 300) bodyCache.clear();
  const [c1, c2] = colorFor(userId + '#shirt');
  c = document.createElement('canvas');
  c.width = 128; c.height = 112; // x2, gốc (32, 52) = chân giữa
  const g = c.getContext('2d');
  g.scale(2, 2);
  g.translate(32, 54);
  const gr = g.createLinearGradient(0, -50, 0, 0);
  gr.addColorStop(0, c1);
  gr.addColorStop(1, c2);
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(-28, 0); g.lineTo(-28, -28);
  g.quadraticCurveTo(-28, -48, -8, -48); g.lineTo(8, -48);
  g.quadraticCurveTo(28, -48, 28, -28); g.lineTo(28, 0);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.4)';
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.fillRect(-20, -40, 8, 34);
  bodyCache.set(userId, c);
  return c;
}

// ---------- Ô trống ----------
function drawEmptySlot(ctx, t, i) {
  const a = 0.3 + 0.12 * Math.sin(t * 2 + i);
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(10,20,40,0.55)';
  ctx.beginPath(); ctx.ellipse(0, -6, 26, 8, 0, 0, TAU); ctx.fill();
  ctx.setLineDash([7, 7]);
  ctx.strokeStyle = '#e8f6ff';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, HEAD_Y + 6, 26, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#e8f6ff';
  ctx.fillRect(-2.5, HEAD_Y - 6, 5, 24);
  ctx.fillRect(-12, HEAD_Y + 3.5, 24, 5);
  ctx.globalAlpha = 1;
}

// ---------- Hào quang theo cần ----------
function drawAura(ctx, tier, t, i) {
  if (tier < 4) return;
  const col = tier === 6 ? rainbowAt(t, i) : tier === 5 ? '#62f2ff' : '#ffcf3a';
  ctx.globalCompositeOperation = 'lighter';
  const r = (tier === 6 ? 74 : 64) * (1 + 0.06 * Math.sin(t * 3 + i));
  ctx.globalAlpha = tier === 4 ? 0.55 : 0.7;
  ctx.drawImage(softGlow(col), -r, HEAD_Y - r, r * 2, r * 2);
  if (tier >= 5) {
    ctx.save();
    ctx.translate(0, HEAD_Y);
    ctx.rotate(t * (tier === 6 ? 0.9 : 0.5) + i);
    ctx.globalAlpha = tier === 6 ? 0.55 : 0.4;
    const rr = tier === 6 ? 70 : 60;
    ctx.drawImage(raysSprite(col, tier === 6 ? 14 : 10), -rr, -rr, rr * 2, rr * 2);
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

// ---------- Một người câu (toạ độ cục bộ: gốc = (x, dockY), tỉ lệ k) ----------
function drawAngler(ctx, p, i, now, t, sNow, rank) {
  const { x, dockY: d } = slotPos(i);
  const k = layout.scale;
  const fx = fxOf(i);
  const enter = clamp((now - p._enterT) / 500, 0, 1);
  const s = easeOutBack(enter);
  const casting = p.state === 'casting' && p._cast;
  const hasBait = p.baitTotal > 0;
  const tier = p.rodTier;
  const resting = !casting && now - p._lastCatchT < 1300;
  const baseA = clamp(enter * 2, 0, 1);
  const W2A = (lx, ly) => [x + lx * k, d + ly * k]; // cục bộ → tuyệt đối (cho hạt)

  ctx.save();
  ctx.translate(x, d);
  ctx.scale(k, k);
  ctx.globalAlpha = baseA;

  // Điểm nhấn TOP 1: cột sáng vàng + quầng trên sàn
  if (rank === 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = baseA * (0.45 + 0.15 * Math.sin(t * 2.5));
    ctx.drawImage(beamSprite('#ffd23f'), -60, -172, 120, 184);
    ctx.globalAlpha = baseA * 0.8;
    ctx.drawImage(softGlow('#ffd23f'), -70, -26, 140, 44);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = baseA;
    if (now > fx.nextSpark && particleRoom() > 250) {
      fx.nextSpark = now + 260;
      const [px, py] = W2A((Math.random() - 0.5) * 80, -20 - Math.random() * 120);
      spawn({ kind: 'star', x: px, y: py, vx: 0, vy: -25, life: 0.9, size: 5, color: '#ffe27a', vr: 3 });
    }
  }
  drawAura(ctx, tier, t, i);
  ctx.globalAlpha = baseA;

  // ---- Hình học cần & phao
  const gx = 14, gy = -26; // tay cầm
  let tx = 62, ty = -108; // đầu cần (nghỉ)
  let bend = 0;
  let bob = null;
  let lineTo = null; // dây kéo theo cá khi vừa câu được
  const waterY = BOB.y;
  if (casting) {
    const { start, end, baitTier } = p._cast;
    const dur = Math.max(1, end - start);
    const el = sNow - start;
    const remain = end - sNow;
    const castK = clamp(el / 520, 0, 1); // pha vung cần
    let bx, by, sink = 0;
    if (castK < 1) {
      // vung ra sau rồi quất tới
      const back = castK < 0.3 ? easeInOutSine(castK / 0.3) : 1 - easeOutCubic((castK - 0.3) / 0.7);
      tx = lerp(62, -36, back); ty = lerp(-108, -128, back);
      const fl = clamp((castK - 0.3) / 0.7, 0, 1);
      bx = lerp(tx, BOB.x, fl);
      by = lerp(ty, waterY, easeOutCubic(fl)) - Math.sin(fl * Math.PI) * 70;
      if (fl <= 0) { bx = tx; by = ty + 14; }
      fx.splashed = 0;
    } else {
      if (!fx.splashed) {
        fx.splashed = 1;
        const [sx, sy] = W2A(BOB.x, waterY);
        splash(sx, sy, 9);
      }
      bx = BOB.x;
      by = waterY + Math.sin(t * 3.2 + i) * 3;
      if (remain < 900) {
        // cá cắn câu: phao giật & chìm, cần cong, chấm than
        const bite = Math.abs(Math.sin(t * 22));
        sink = 6 + bite * 11;
        by = waterY + sink;
        bend = 10 + bite * 8;
        ty += 10 + bite * 6;
        tx -= 4;
        if (now > fx.nextRipple) {
          const [rx, ry] = W2A(BOB.x, waterY + 6);
          ripple(rx, ry, '#ffffff');
          fx.nextRipple = now + 200;
        }
      } else if (now > fx.nextRipple) {
        const [rx, ry] = W2A(BOB.x, waterY + 6);
        ripple(rx, ry);
        fx.nextRipple = now + 1300 + Math.random() * 500;
      }
    }
    bob = { x: bx, y: by, baitTier, sink, prog: clamp(el / dur, 0, 1), bite: remain < 900 && castK >= 1, flying: castK < 1 };
  } else if (now - p._lastCatchT < 600) {
    // vừa kéo cá: cần cong mạnh, dây kéo theo cá
    const kk = (now - p._lastCatchT) / 600;
    bend = 22 * (1 - kk);
    tx = 54; ty = -116;
    const pp = popPos(i, now);
    if (pp) lineTo = { x: (pp.x - x) / k, y: (pp.y - d) / k };
  } else if (!hasBait && !resting) {
    tx = 74; ty = -40; // hạ cần
  }

  // Dây câu
  if (bob || lineTo) {
    const ex = bob ? bob.x : lineTo.x, ey = bob ? bob.y - 22 : lineTo.y;
    ctx.strokeStyle = tier === 6 ? rainbowAt(t, 3) : 'rgba(255,255,255,0.9)';
    ctx.lineWidth = tier >= 5 ? 2.4 : 1.8;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    const taut = (bob && (bob.bite || bob.flying)) || lineTo;
    const midx = (tx + ex) / 2 + (taut ? 0 : 10);
    const midy = (ty + ey) / 2 + (taut ? -4 : 22);
    ctx.quadraticCurveTo(midx, midy, ex, ey);
    ctx.stroke();
  }
  if (bob) drawBobber(ctx, bob.x, bob.y, bob.flying ? bob.y + 40 : waterY, bob.baitTier, 1);
  if (bob && bob.bite) {
    const pop = 1 + 0.18 * Math.abs(Math.sin(t * 11));
    drawEmoji(ctx, '❗', BOB.x + 22, 12, 26, pop);
  }

  // Thân + cần + tay
  ctx.drawImage(bodySprite(p.userId), -32, -54, 64, 56);
  drawRod(ctx, gx - 10, gy + 8, tx, ty, tier, t, 1, bend);
  ctx.fillStyle = '#f2c9a0';
  ctx.beginPath(); ctx.arc(gx + 2, gy + 2, 7, 0, TAU); ctx.fill();

  // Hạt lấp lánh trên cần xịn
  if (tier >= 5 && now > fx.nextSpark && particleRoom() > 220 && rank !== 0) {
    fx.nextSpark = now + (tier === 6 ? 140 : 240);
    const q = Math.random();
    const [px, py] = W2A(lerp(gx, tx, q), lerp(gy, ty, q));
    spawn({ kind: 'star', x: px, y: py, vx: (Math.random() - 0.5) * 30, vy: -20 - Math.random() * 30, life: 0.8, size: tier === 6 ? 7 : 5, color: tier === 6 ? '#ff8af0' : '#9ff8ff', vr: 3 });
  }

  // ---- Đầu = avatar
  ctx.save();
  ctx.translate(0, HEAD_Y);
  ctx.scale(s, s);
  const st = tierStyle(tier);
  const ringCol = tier === 6 ? rainbowAt(t, i) : st.color;
  ctx.fillStyle = ringCol;
  ctx.beginPath(); ctx.arc(0, 0, HEAD_R + 5, 0, TAU); ctx.fill();
  ctx.fillStyle = '#0b1230';
  ctx.beginPath(); ctx.arc(0, 0, HEAD_R + 1.5, 0, TAU); ctx.fill();
  if (!hasBait && !casting && !resting) ctx.globalAlpha = baseA * 0.6;
  drawAvatar(ctx, p, 0, 0, HEAD_R);
  ctx.globalAlpha = baseA;
  // vòng tiến độ câu
  if (bob) {
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(0, 0, HEAD_R + 10, 0, TAU); ctx.stroke();
    ctx.strokeStyle = bob.bite ? '#ffffff' : '#6dffb0';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, 0, HEAD_R + 10, -Math.PI / 2, -Math.PI / 2 + TAU * bob.prog); ctx.stroke();
    ctx.lineCap = 'butt';
  }
  // huy hiệu tier (số bậc cần)
  ctx.fillStyle = st.dark;
  ctx.beginPath(); ctx.arc(-HEAD_R + 1, HEAD_R - 6, 15, 0, TAU); ctx.fill();
  ctx.fillStyle = ringCol;
  ctx.beginPath(); ctx.arc(-HEAD_R + 1, HEAD_R - 6, 12.5, 0, TAU); ctx.fill();
  ctx.font = font(19, 900);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = tier >= 3 && tier <= 5 ? '#1a1300' : '#fff';
  ctx.fillText(String(tier), -HEAD_R + 1, HEAD_R - 5);
  // TOP 1-3: vương miện / huy chương trên đầu (góc phải)
  if (rank === 0) drawEmoji(ctx, '👑', HEAD_R - 6, -HEAD_R + 2, 34, 1 + 0.06 * Math.sin(t * 4));
  else if (rank === 1) drawEmoji(ctx, '🥈', HEAD_R - 4, -HEAD_R + 6, 28);
  else if (rank === 2) drawEmoji(ctx, '🥉', HEAD_R - 4, -HEAD_R + 6, 28);
  ctx.restore();

  // ---- Nâng cần mới: cột sáng + vòng lan + chữ
  if (p._rodUpT && now - p._rodUpT < 1700) {
    const q = (now - p._rodUpT) / 1700;
    if (fx.upFx !== p._rodUpT) {
      fx.upFx = p._rodUpT;
      const [hx, hy] = W2A(0, HEAD_Y);
      burst(hx, hy, 30, [st.color, '#ffffff'], { speed: 380, kind: 'mix' });
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (1 - q) * 0.9;
    const bw = 90 + q * 40;
    ctx.drawImage(beamSprite(tier === 6 ? '#ff5fe0' : st.color), -bw / 2, -330, bw, 340);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1 - q;
    ctx.strokeStyle = st.color;
    ctx.lineWidth = 6 * (1 - q) + 1;
    ctx.beginPath(); ctx.arc(0, HEAD_Y, HEAD_R + 10 + q * 60, 0, TAU); ctx.stroke();
    ctx.font = font(24, 900);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.translate(0, NAME_Y - 30 - q * 20);
    const sc = easeOutBack(clamp(q / 0.2, 0, 1));
    ctx.scale(sc, sc);
    outlinedText(ctx, '▲ CẦN MỚI!', 0, 0, tier === 6 ? '#ff8af0' : st.color, 'rgba(5,8,22,0.95)', 6);
    ctx.restore();
    ctx.globalAlpha = baseA;
  }

  // ---- Tên (trên đầu)
  ctx.font = font(25, 900);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const name = fitText(ctx, p.nickname, NAME_MAX_W);
  const nw = ctx.measureText(name).width + 18;
  ctx.fillStyle = rank === 0 ? 'rgba(90,60,0,0.85)' : 'rgba(6,10,30,0.7)';
  rrPath(ctx, -nw / 2, NAME_Y - 16, nw, 32, 16);
  ctx.fill();
  if (rank === 0) { ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2.5; ctx.stroke(); }
  outlinedText(ctx, name, 0, NAME_Y + 1, rank === 0 ? '#ffe680' : '#ffffff', 'rgba(0,0,0,0.95)', 6);

  // ---- Chip mồi (trên mặt cầu tàu)
  const bt = topBaitTier(p);
  let label, bg;
  if (!hasBait && !casting) {
    label = resting ? '🐛 0' : '💤 Hết mồi';
    bg = 'rgba(150,30,40,0.9)';
  } else {
    label = `🐛 ${p.baitTotal > 999 ? '999+' : p.baitTotal}`;
    bg = 'rgba(8,14,36,0.85)';
  }
  ctx.font = font(23, 900);
  const lw = ctx.measureText(label).width + 20;
  ctx.fillStyle = bg;
  rrPath(ctx, -lw / 2, 2, lw, 29, 14.5);
  ctx.fill();
  if (bt) {
    ctx.strokeStyle = tierStyle(bt).color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  ctx.fillText(label, 0, 17);

  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawLeaving(ctx, now) {
  const k = layout.scale;
  for (let j = store.leaving.length - 1; j >= 0; j--) {
    const L = store.leaving[j];
    const age = (now - L.t0) / 700;
    if (age >= 1 || (store.slotOwner[L.slot] && age > 0.4) || L.slot >= slotCount()) { store.leaving.splice(j, 1); continue; }
    const { x, dockY: d } = slotPos(L.slot);
    ctx.globalAlpha = 1 - age;
    const s = (1 - age * 0.6) * k;
    ctx.save();
    ctx.translate(x, d + (HEAD_Y - age * 40) * k);
    ctx.scale(s, s);
    drawAvatar(ctx, L.p, 0, 0, HEAD_R);
    ctx.restore();
    drawEmoji(ctx, '👋', x + 36 * k, d + (HEAD_Y - 50 - age * 50) * k, 32 * k);
    ctx.globalAlpha = 1;
  }
}

export function drawAnglers(ctx, now) {
  const t = now / 1000;
  const sNow = serverNow();
  const n = slotCount();
  // hạng phiên (top 3) của người đang ngồi
  const lb = store.leaderboard;
  const rankOf = new Map();
  for (let r = 0; r < Math.min(3, lb.length); r++) if (lb[r].score > 0) rankOf.set(lb[r].userId, r);
  const k = layout.scale;
  for (let i = 0; i < n; i++) {
    const uid = store.slotOwner[i];
    const p = uid ? store.players.get(uid) : null;
    if (!p) {
      if (!store.leaving.some((L) => L.slot === i)) {
        const { x, dockY } = slotPos(i);
        ctx.save();
        ctx.translate(x, dockY);
        ctx.scale(k, k);
        drawEmptySlot(ctx, t, i);
        ctx.restore();
      }
      continue;
    }
    drawAngler(ctx, p, i, now, t, sNow, rankOf.has(uid) ? rankOf.get(uid) : -1);
  }
  drawLeaving(ctx, now);
}
