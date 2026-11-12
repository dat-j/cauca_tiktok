// Thông báo quà (cột trái vùng trời, ≤3 thẻ gọn) + dải toast (dưới thẻ quà) + dải "quà lớn" toàn ngang cho
// quà bậc 5–6 (≤1.8s) + lời mời tham gia khi chưa ai câu.
import { NOTICE, TOAST, W, layout } from '../layout.js';
import { store } from '../store.js';
import { tierStyle, rodOf, baitOf } from '../config.js';
import { drawAvatar } from '../avatars.js';
import { TAU, clamp, damp, easeOutBack, easeOutCubic, font, fitText, outlinedText, rrPath, rgba, fmtNum } from '../util.js';
import { burst, shake, confetti, rainbowAt, softGlow } from './effects.js';
import { ribbonActive } from './banner.js';

const CARD_H = 84, GAP = 8, MAX_CARDS = 3;
const cards = [];
const toasts = [];
const toastWait = [];
let big = null; // dải quà lớn đang chạy

export function pushGift(g) {
  const now = performance.now();
  const ex = cards.find((c) => c.g.userId === g.userId && !c.leaving && now - c.t0 < 4000);
  if (ex) {
    ex.g = {
      ...g,
      diamonds: ex.g.diamonds + g.diamonds,
      baitCount: ex.g.baitCount + g.baitCount,
      rodUpgraded: ex.g.rodUpgraded || g.rodUpgraded,
      baitTier: Math.max(ex.g.baitTier, g.baitTier),
      rodTier: Math.max(ex.g.rodTier, g.rodTier),
    };
    ex.combo++;
    ex.bump = now;
    ex.tEnd = now + life(ex.g);
  } else {
    cards.unshift({ g, t0: now, tEnd: now + life(g), y: -CARD_H, x: -680, combo: 1, bump: now, leaving: false, alpha: 1 });
  }
  const tier = g.baitTier;
  const st = tierStyle(tier);
  if (tier >= 3) burst(NOTICE.x + 46, NOTICE.y + CARD_H / 2, 6 + tier * 5, [st.color, '#ffffff'], { speed: 300 + tier * 30, kind: 'mix' });
  if (tier >= 5) {
    big = { g, t0: now, tier };
    shake(tier === 6 ? 9 : 5, tier === 6 ? 450 : 300);
    confetti(tier === 6 ? 70 : 34, tier === 6 ? ['#ff5fe0', '#ffd84d', '#62f2ff', '#ffffff'] : ['#62f2ff', '#ffffff', '#9ff8ff'], 0);
  }
  const alive = cards.filter((c) => !c.leaving);
  for (let i = MAX_CARDS; i < alive.length; i++) alive[i].leaving = true;
}
const life = (g) => 4200 + g.baitTier * 600 + (g.rodUpgraded ? 800 : 0);

export function pushToast(t) {
  toastWait.push(t);
  if (toastWait.length > 6) toastWait.splice(0, toastWait.length - 6);
}

export function updateNotices(dt, now) {
  for (let i = cards.length - 1; i >= 0; i--) {
    const c = cards[i];
    if (now > c.tEnd) c.leaving = true;
    if (c.leaving) {
      c.alpha -= dt * 4;
      c.x = damp(c.x, -700, 6, dt);
      if (c.alpha <= 0) cards.splice(i, 1);
    }
  }
  let slot = 0;
  for (const c of cards) {
    if (c.leaving) continue;
    c.x = damp(c.x, 0, 12, dt);
    c.y = damp(c.y, slot * (CARD_H + GAP), 12, dt);
    slot++;
  }
  for (let i = toasts.length - 1; i >= 0; i--) if (now - toasts[i].t0 > 3400) toasts.splice(i, 1);
  // dải toast nhường chỗ cho dải mẻ cá huyền thoại (banner pha 2)
  if (!ribbonActive()) {
    while (toasts.length < 2 && toastWait.length) {
      const tt = toastWait.shift();
      toasts.push({ ...tt, t0: now, y: toasts.length ? 1 : 0 });
    }
  }
  toasts.forEach((tt, i) => { tt.y = damp(tt.y, i, 10, dt); });
  if (big && now - big.t0 > 1800) big = null;
}

// nền thẻ theo tier: gradient tạo 1 lần ở toạ độ cục bộ rồi dùng lại
const cardBg = new Map();
function cardFill(ctx, tier) {
  let g = cardBg.get(tier);
  if (g) return g;
  const st = tierStyle(tier);
  g = ctx.createLinearGradient(0, 0, NOTICE.w, 0);
  g.addColorStop(0, rgba(st.dark, 0.96));
  g.addColorStop(0.55, 'rgba(10,14,40,0.92)');
  g.addColorStop(1, 'rgba(10,14,40,0.84)');
  cardBg.set(tier, g);
  return g;
}

function drawCard(ctx, c, now) {
  const g = c.g;
  const t = now / 1000;
  const tier = g.baitTier;
  const st = tierStyle(tier);
  const w = NOTICE.w, h = CARD_H;
  const x = NOTICE.x + c.x, y = NOTICE.y + c.y;
  const pop = 1 + 0.06 * Math.max(0, 1 - (now - c.bump) / 250);
  ctx.save();
  ctx.globalAlpha = clamp(c.alpha, 0, 1);
  ctx.translate(x + w / 2, y + h / 2);
  ctx.scale(pop, pop);
  ctx.translate(-w / 2, -h / 2);
  const edge = tier === 6 ? rainbowAt(t) : st.color;
  if (tier >= 5) {
    // viền phát sáng rẻ: nét rộng mờ thay cho shadowBlur
    ctx.strokeStyle = rgba(tier === 6 ? '#ff5fe0' : st.color, 0.35);
    ctx.lineWidth = 12;
    rrPath(ctx, 0, 0, w, h, 20);
    ctx.stroke();
  }
  ctx.fillStyle = cardFill(ctx, tier);
  rrPath(ctx, 0, 0, w, h, 20);
  ctx.fill();
  ctx.lineWidth = tier >= 4 ? 4 : 3;
  ctx.strokeStyle = edge;
  ctx.stroke();
  if (tier >= 4) {
    // vệt sáng lướt
    ctx.save();
    ctx.clip();
    const sx = ((now - c.t0) * 0.9) % (w + 400) - 200;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= 0.5;
    ctx.drawImage(softGlow('#ffffff'), sx - 90, -40, 180, h + 80);
    ctx.restore();
  }
  ctx.fillStyle = edge;
  ctx.beginPath(); ctx.arc(44, h / 2, 33, 0, TAU); ctx.fill();
  drawAvatar(ctx, g, 44, h / 2, 29.5);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = font(28, 900);
  const nm = fitText(ctx, g.nickname, 250);
  outlinedText(ctx, nm, 88, 27, '#ffffff', 'rgba(0,0,0,0.9)', 6);
  const cx = 88 + ctx.measureText(nm).width + 10;
  ctx.font = font(25, 800);
  const giftTxt = fitText(ctx, `tặng ${g.giftName}${c.combo > 1 ? ` ×${c.combo}` : ''}`, w - cx - 14);
  outlinedText(ctx, giftTxt, cx, 28, '#ffe07a', 'rgba(0,0,0,0.9)', 5);
  const rod = rodOf(store.config, g.rodTier);
  const bait = baitOf(store.config, tier);
  ctx.font = font(24, 800);
  const line2 = g.rodUpgraded
    ? `💎${fmtNum(g.diamonds)} → 🎣 ${rod.name} · 🐛+${g.baitCount}`
    : `💎${fmtNum(g.diamonds)} → 🐛 +${g.baitCount} ${bait.name}`;
  outlinedText(ctx, fitText(ctx, line2, w - 104), 88, 62, st.color === '#eef4fb' ? '#ffffff' : st.color, 'rgba(0,0,0,0.9)', 5);
  ctx.restore();
  if (g.rodUpgraded) {
    const k = 1 + 0.08 * Math.sin(t * 8);
    ctx.save();
    ctx.globalAlpha = clamp(c.alpha, 0, 1);
    ctx.translate(x + w - 104, y + 2);
    ctx.scale(k, k);
    ctx.rotate(-0.06);
    ctx.fillStyle = '#ff3355';
    rrPath(ctx, -100, -15, 200, 30, 15);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = font(19, 900);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('▲ NÂNG CẤP CẦN!', 0, 1);
    ctx.restore();
  }
}

const TOAST_STYLE = {
  follow: { icon: '💖', bg: 'rgba(214,40,110,0.94)' },
  share: { icon: '🔁', bg: 'rgba(30,140,90,0.94)' },
  join: { icon: '🎣', bg: 'rgba(20,80,160,0.94)' },
  top: { icon: '👑', bg: 'rgba(170,110,0,0.96)' },
  catch: { icon: '✨', bg: 'rgba(110,40,170,0.94)' },
  info: { icon: 'ℹ️', bg: 'rgba(40,40,70,0.94)' },
};

function drawBigGift(ctx, now) {
  if (!big) return;
  const el = (now - big.t0) / 1000;
  const t = now / 1000;
  const a = Math.min(clamp(el / 0.15, 0, 1), clamp((1.8 - el) / 0.3, 0, 1));
  const st = tierStyle(big.tier);
  const y = 300;
  const slide = easeOutCubic(clamp(el / 0.35, 0, 1));
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = big.tier === 6 ? 'rgba(60,8,70,0.92)' : 'rgba(4,40,70,0.92)';
  ctx.fillRect(0, y - 52, W, 104);
  ctx.fillStyle = big.tier === 6 ? rainbowAt(t) : st.color;
  ctx.fillRect(0, y - 52, W, 5);
  ctx.fillRect(0, y + 47, W, 5);
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(softGlow(big.tier === 6 ? '#ff5fe0' : st.color), W / 2 - 520, y - 90, 1040, 180);
  ctx.globalCompositeOperation = 'source-over';
  ctx.translate((1 - slide) * -W, 0);
  ctx.fillStyle = st.color;
  ctx.beginPath(); ctx.arc(80, y, 42, 0, TAU); ctx.fill();
  drawAvatar(ctx, big.g, 80, y, 38);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = font(44, 900);
  const head = big.tier === 6 ? '🎁 QUÀ KHỦNG!' : '💎 QUÀ LỚN!';
  outlinedText(ctx, head, 138, y - 18, big.tier === 6 ? '#ffe27a' : '#9ff8ff', '#14051f', 8);
  ctx.font = font(32, 900);
  const line = fitText(ctx, `${big.g.nickname} tặng ${big.g.giftName} · 💎${fmtNum(big.g.diamonds)}`, W - 170);
  outlinedText(ctx, line, 138, y + 26, '#ffffff', '#14051f', 7);
  ctx.restore();
}

export function drawNotices(ctx, now) {
  for (let i = cards.length - 1; i >= 0; i--) drawCard(ctx, cards[i], now);
  ctx.globalAlpha = 1;

  // Chưa ai câu → lời mời lớn ở giữa vùng cầu tàu (vùng đó đang trống nên không che ai)
  if (store.slotOwner.every((x) => !x) && layout.rows.length) {
    const r0 = layout.rows[0], rN = layout.rows[layout.rows.length - 1];
    const cy = (r0.dockY + rN.dockY) / 2 - 40;
    const a = 0.85 + 0.15 * Math.sin(now / 400);
    const s = 1 + 0.025 * Math.sin(now / 300);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(460, cy);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(6,12,36,0.82)';
    rrPath(ctx, -400, -96, 800, 192, 34);
    ctx.fill();
    ctx.strokeStyle = '#ffe27a';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(46, 900);
    outlinedText(ctx, '🎣 Hồ đang chờ bạn!', 0, -46, '#ffe27a', '#14051f', 8);
    ctx.font = font(32, 900);
    outlinedText(ctx, '💬 Bình luận bất kỳ → nhận mồi miễn phí', 0, 12, '#ffffff', 'rgba(0,0,0,0.9)', 6);
    outlinedText(ctx, '🎁 Tặng quà → cần xịn, cá hiếm!', 0, 56, '#9ff8ff', 'rgba(0,0,0,0.9)', 6);
    ctx.restore();
  }

  for (const tt of toasts) {
    const age = (now - tt.t0) / 1000;
    const a = Math.min(clamp(age / 0.25, 0, 1), clamp((3.4 - age) / 0.4, 0, 1));
    const s = easeOutBack(clamp(age / 0.35, 0, 1));
    const sty = TOAST_STYLE[tt.kind] || TOAST_STYLE.info;
    ctx.font = font(27, 900);
    const text = fitText(ctx, `${sty.icon} ${tt.text}`, TOAST.w - 36);
    const tw = Math.min(TOAST.w, ctx.measureText(text).width + 36);
    const y = TOAST.y + tt.y * 50;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(TOAST.x + tw / 2, y + 22);
    ctx.scale(s, s);
    ctx.fillStyle = sty.bg;
    rrPath(ctx, -tw / 2, -22, tw, 44, 22);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    outlinedText(ctx, text, 0, 1, '#ffffff', 'rgba(0,0,0,0.6)', 4);
    ctx.restore();
  }
  drawBigGift(ctx, now);
}
