// Cache avatar: Image theo URL + sprite tròn đã cắt sẵn theo (url, cỡ).
// Avatar TikTok là URL ngoài (có thể lỗi CORS/404/hết hạn) → fallback chữ cái đầu trên nền màu.
// KHÔNG đặt crossOrigin và KHÔNG bao giờ đọc pixel (getImageData) — canvas bị "taint" cũng không sao.
import { hashStr, initialOf, font } from './util.js';

const images = new Map(); // url -> { img, status: 'loading'|'ok'|'error', used }
const sprites = new Map(); // key -> canvas
let tick = 0;

function safeUrl(url) {
  if (typeof url !== 'string' || !url) return null;
  const u = url.trim();
  if (/^(https?:)?\/\//i.test(u) || /^data:image\//i.test(u) || /^\/(?!\/)/.test(u) || /^blob:/i.test(u)) return u;
  if (/^[\w.-]+\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(u)) return u; // đường dẫn tương đối đơn giản
  return null;
}

function prune() {
  // Bỏ một nửa mục ít dùng nhất.
  const arr = [...images.entries()].sort((a, b) => a[1].used - b[1].used);
  for (let i = 0; i < arr.length / 2; i++) images.delete(arr[i][0]);
  sprites.clear();
}

function getImage(url) {
  const u = safeUrl(url);
  if (!u) return null;
  let e = images.get(u);
  if (!e) {
    if (images.size > 400) prune();
    const img = new Image();
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    e = { img, status: 'loading', used: tick };
    img.onload = () => { e.status = img.naturalWidth > 0 ? 'ok' : 'error'; };
    img.onerror = () => { e.status = 'error'; };
    img.src = u;
    images.set(u, e);
  }
  e.used = ++tick;
  return e;
}

export function colorFor(id) {
  const h = hashStr(id) % 360;
  return [`hsl(${h},70%,52%)`, `hsl(${(h + 40) % 360},75%,38%)`];
}

function buildSprite(d, e, id, name) {
  const S = 2; // siêu lấy mẫu
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(d * S);
  const g = c.getContext('2d');
  g.scale(S, S);
  g.beginPath();
  g.arc(d / 2, d / 2, d / 2, 0, Math.PI * 2);
  g.closePath();
  g.clip();
  if (e && e.status === 'ok') {
    const iw = e.img.naturalWidth, ih = e.img.naturalHeight;
    const s = Math.max(d / iw, d / ih);
    try {
      g.drawImage(e.img, (d - iw * s) / 2, (d - ih * s) / 2, iw * s, ih * s);
      return c;
    } catch { /* ảnh hỏng → fallback */ }
  }
  const [c1, c2] = colorFor(id || name);
  const gr = g.createLinearGradient(0, 0, d, d);
  gr.addColorStop(0, c1);
  gr.addColorStop(1, c2);
  g.fillStyle = gr;
  g.fillRect(0, 0, d, d);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.beginPath();
  g.ellipse(d * 0.35, d * 0.25, d * 0.45, d * 0.28, -0.5, 0, Math.PI * 2);
  g.fill();
  g.font = font(Math.round(d * 0.5), 900);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = Math.max(2, d * 0.06);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  const ch = initialOf(name);
  g.strokeText(ch, d / 2, d / 2 + d * 0.04);
  g.fillStyle = '#fff';
  g.fillText(ch, d / 2, d / 2 + d * 0.04);
  return c;
}

/** Vẽ avatar tròn tâm (x,y) bán kính r. who = {userId, nickname, avatarUrl}. */
export function drawAvatar(ctx, who, x, y, r) {
  const d = Math.max(8, Math.round(r * 2));
  const e = getImage(who.avatarUrl);
  const status = e ? e.status : 'none';
  // Đang tải → tạm dùng fallback (key khác), khi xong sẽ tự đổi sang ảnh.
  const key = `${who.avatarUrl || ''}|${who.userId || ''}|${who.nickname || ''}|${d}|${status === 'ok' ? 'ok' : 'fb'}`;
  let spr = sprites.get(key);
  if (!spr) {
    if (sprites.size > 600) sprites.clear();
    spr = buildSprite(d, e, who.userId, who.nickname);
    sprites.set(key, spr);
  }
  ctx.drawImage(spr, x - r, y - r, r * 2, r * 2);
}

export function avatarStats() {
  let ok = 0, err = 0, loading = 0;
  for (const e of images.values()) e.status === 'ok' ? ok++ : e.status === 'error' ? err++ : loading++;
  return { ok, err, loading, sprites: sprites.size };
}
