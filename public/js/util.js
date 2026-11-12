// Tiện ích chung: toán, easing, chữ (cắt tên, viền chữ), màu, cache emoji.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
/** Nội suy mượt không phụ thuộc framerate. */
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInCubic = (t) => { t = clamp(t, 0, 1); return t * t * t; };
export const easeInOutSine = (t) => -(Math.cos(Math.PI * clamp(t, 0, 1)) - 1) / 2;
export const easeOutBack = (t) => {
  t = clamp(t, 0, 1);
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function hashStr(s) {
  s = String(s ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const FONT_STACK =
  '"Segoe UI", "Nunito", "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", system-ui, sans-serif';
export const font = (size, weight = 800) => `${weight} ${size}px ${FONT_STACK}`;

// ---------- Tên người chơi ----------
const segmenter =
  typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

export function graphemes(s) {
  if (segmenter) return Array.from(segmenter.segment(s), (x) => x.segment);
  return Array.from(s);
}

/**
 * Làm sạch tên hiển thị: bỏ ký tự điều khiển, ký tự định dạng vô hình (trừ ZWJ dùng trong emoji),
 * surrogate lẻ, chồng dấu kiểu "zalgo"; gom khoảng trắng; giới hạn độ dài.
 */
export function sanitizeName(s, fallback = 'Ẩn danh', maxLen = 40) {
  let t = String(s ?? '');
  try { t = t.normalize('NFC'); } catch { /* chuỗi hỏng */ }
  if (typeof t.toWellFormed === 'function') t = t.toWellFormed();
  t = t
    .replace(/[\p{Cc}\p{Co}\p{Cs}�]/gu, '')
    .replace(/(?!‍)\p{Cf}/gu, '')
    .replace(/(\p{M}{2})\p{M}+/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!t) return fallback;
  const g = graphemes(t);
  if (g.length > maxLen) t = g.slice(0, maxLen).join('');
  return t;
}

export function initialOf(name) {
  const g = graphemes(String(name || '?').trim());
  for (const ch of g) {
    if (/[\p{L}\p{N}]/u.test(ch)) return ch.toLocaleUpperCase('vi');
  }
  return g[0] || '?';
}

const fitCache = new Map();
/** Cắt chữ (theo grapheme, không làm vỡ emoji) cho vừa maxW, thêm "…". Có cache. */
export function fitText(ctx, text, maxW) {
  const key = ctx.font + '\u0001' + maxW + '\u0001' + text;
  const hit = fitCache.get(key);
  if (hit !== undefined) return hit;
  let r;
  if (ctx.measureText(text).width <= maxW) r = text;
  else {
    const g = graphemes(text);
    let lo = 0, hi = g.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(g.slice(0, mid).join('').trimEnd() + '…').width <= maxW) lo = mid;
      else hi = mid - 1;
    }
    r = g.slice(0, lo).join('').trimEnd() + '…';
  }
  if (fitCache.size > 4000) fitCache.clear();
  fitCache.set(key, r);
  return r;
}

// strokeText() trên canvas tăng tốc GPU bị Skia vẽ dưới dạng path MỖI frame (không dùng glyph cache),
// cộng với chữ bị scale/xoay theo animation → GPU raster rất nặng: đo thật trên Edge + RTX 3070, burst
// 40 người chỉ còn ~22fps; tắt riêng phần vẽ chữ → 60fps. Vì vậy chữ viền được vẽ một lần vào sprite
// (canvas phụ) rồi drawImage — giống emojiSprite. Cache LRU có giới hạn.
const TEXT_CACHE_MAX = 600;
const textCache = new Map();
let textCacheMisses = 0;
export const textCacheStats = () => ({ size: textCache.size, misses: textCacheMisses });

function textSprite(ctx, text, fill, stroke, lw, res) {
  const key = `${ctx.font}\u0001${ctx.textAlign}\u0001${ctx.textBaseline}\u0001${fill}\u0001${stroke}\u0001${lw}\u0001${res}\u0001${text}`;
  let s = textCache.get(key);
  if (s) {
    textCache.delete(key); // LRU: đưa về cuối
    textCache.set(key, s);
    return s;
  }
  textCacheMisses++;
  const m = ctx.measureText(text);
  const pad = Math.ceil(lw / 2) + 2;
  const left = Math.ceil(m.actualBoundingBoxLeft || 0) + pad;
  const right = Math.ceil(m.actualBoundingBoxRight || m.width) + pad;
  const up = Math.ceil(m.actualBoundingBoxAscent || 0) + pad;
  const down = Math.ceil(m.actualBoundingBoxDescent || 0) + pad;
  const w = Math.max(1, left + right), h = Math.max(1, up + down);
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * res);
  c.height = Math.ceil(h * res);
  const g = c.getContext('2d');
  g.scale(res, res);
  g.font = ctx.font;
  g.textAlign = ctx.textAlign;
  g.textBaseline = ctx.textBaseline;
  g.lineJoin = 'round';
  g.miterLimit = 2;
  if (lw > 0) {
    g.lineWidth = lw;
    g.strokeStyle = stroke;
    g.strokeText(text, left, up);
  }
  g.fillStyle = fill;
  g.fillText(text, left, up);
  s = { c, ax: left, ay: up, w: c.width / res, h: c.height / res };
  textCache.set(key, s);
  if (textCache.size > TEXT_CACHE_MAX) textCache.delete(textCache.keys().next().value);
  return s;
}

/** Vẽ chữ có viền đậm (dễ đọc trên nền động / màn hình điện thoại). Dùng sprite cache (xem trên). */
export function outlinedText(ctx, text, x, y, fill = '#fff', stroke = 'rgba(6,10,26,0.95)', lw = 6) {
  text = String(text);
  if (!text) return;
  if (typeof fill !== 'string' || typeof stroke !== 'string') {
    // gradient/pattern: không cache được → vẽ trực tiếp
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
    return;
  }
  // Độ phân giải sprite theo tỉ lệ thật của transform hiện tại (lượng tử 0.5 để ít biến thể).
  const t = ctx.getTransform();
  const scale = Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d));
  const res = Math.min(4, Math.max(0.5, Math.ceil(scale * 2) / 2));
  const s = textSprite(ctx, text, fill, stroke, lw, res);
  ctx.drawImage(s.c, x - s.ax, y - s.ay, s.w, s.h);
}

export function rrPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  r = Math.min(r, w / 2, h / 2);
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

// ---------- Số ----------
const nf = new Intl.NumberFormat('vi-VN');
export function fmtNum(n) {
  n = Math.round(Number(n) || 0);
  if (Math.abs(n) >= 10_000_000) return (n / 1_000_000).toFixed(1).replace('.', ',') + ' Tr';
  return nf.format(n);
}

// ---------- Màu ----------
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ---------- Cache emoji -> sprite (tránh fillText emoji mỗi frame) ----------
const emojiCache = new Map();
export function emojiSprite(ch, size) {
  const key = ch + '|' + size;
  let c = emojiCache.get(key);
  if (c) return c;
  const pad = Math.ceil(size * 0.25);
  const dim = Math.ceil(size * 1.3) + pad * 2;
  c = document.createElement('canvas');
  c.width = c.height = dim * 2; // siêu lấy mẫu x2 cho nét đẹp khi phóng to
  const g = c.getContext('2d');
  g.scale(2, 2);
  g.font = font(size, 400);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ch, dim / 2, dim / 2 + size * 0.06);
  c._dim = dim;
  if (emojiCache.size > 300) emojiCache.clear();
  emojiCache.set(key, c);
  return c;
}
/** Vẽ emoji căn giữa tại (x,y), kích thước size*scale. */
export function drawEmoji(ctx, ch, x, y, size, scale = 1) {
  const base = size <= 40 ? 40 : size <= 80 ? 80 : 160;
  const spr = emojiSprite(ch, base);
  const d = spr._dim * (size / base) * scale;
  ctx.drawImage(spr, x - d / 2, y - d / 2, d, d);
}
