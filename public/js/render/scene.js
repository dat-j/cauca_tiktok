// Nền sống động: bầu trời chu kỳ ngày → hoàng hôn → đêm → bình minh (chuyển chậm), mặt trời/trăng/sao,
// mây trôi 2 lớp parallax, núi/đảo/cọ/hải đăng nhiều lớp + phản chiếu, tia sáng xuyên nước, đáy hồ có
// rong/san hô, đàn cá bơi theo bầy, bong bóng, thỉnh thoảng sinh vật lớn lướt qua phía xa; cầu tàu có đèn lồng.
//
// Hiệu năng: mọi lớp tĩnh (gradient trời/nước, núi, đáy, sprite cá/mây/tia sáng/quầng sáng) được vẽ SẴN một lần
// ra canvas đệm cho từng "khung giờ" (keyframe); mỗi frame chỉ drawImage + trộn alpha giữa 2 keyframe kề nhau.
// Không tạo gradient, không shadowBlur, không chữ trong vòng lặp.
//
// Tham số URL (để demo/chụp ảnh): ?tod=day|sunset|night|dawn|<0..1> cố định giờ; ?cycle=<giây> độ dài 1 chu kỳ
// (mặc định 480s); ?creature=1 cho sinh vật lớn xuất hiện ngay.
import { W, H, WATER_Y, layout } from '../layout.js';
import { TAU, rand, clamp, lerp, hexToRgb } from '../util.js';

const params = new URLSearchParams(location.search);
const CYCLE = Math.max(20, Number(params.get('cycle')) || 480);
const SEABED_Y = 1690;

function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
function mixHex(a, b, k) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return `rgb(${Math.round(lerp(A[0], B[0], k))},${Math.round(lerp(A[1], B[1], k))},${Math.round(lerp(A[2], B[2], k))})`;
}

// ---------------------------------------------------------------- khung giờ
const KF = [
  {
    name: 'day',
    sky: [[0, '#2f7fd8'], [0.55, '#73b7ef'], [0.9, '#bfe6fb'], [1, '#e4f6ff']],
    water: [[0, '#8fdcf0'], [0.025, '#3fb0d8'], [0.25, '#1a83bb'], [0.6, '#0d5791'], [1, '#06325f']],
    land: ['#a9c6e6', '#6f9fc4', '#3f7c63', '#2d5a45'], bed: 0,
    light: 1, night: 0, sun: [250, 230, 1], warm: 0, moon: 0, cloud: 0,
  },
  {
    name: 'sunset',
    sky: [[0, '#1b1d5c'], [0.35, '#4f3489'], [0.66, '#c2508a'], [0.88, '#ff8a5c'], [1, '#ffcf86']],
    water: [[0, '#ffb889'], [0.03, '#c96f86'], [0.22, '#4d5ea3'], [0.6, '#1d3b76'], [1, '#081d42']],
    land: ['#b06a9c', '#7a3f7e', '#3e2453', '#2a1740'], bed: 0.35,
    light: 0.65, night: 0.2, sun: [360, 420, 1], warm: 1, moon: 0, cloud: 1,
  },
  {
    name: 'night',
    sky: [[0, '#02040f'], [0.45, '#0a1438'], [0.85, '#1a2a5c'], [1, '#2b3f73']],
    water: [[0, '#3a5488'], [0.03, '#1c3462'], [0.25, '#0f2449'], [0.6, '#071834'], [1, '#02081a']],
    land: ['#2a3566', '#1d2650', '#111838', '#0b1028'], bed: 0.72,
    light: 0.2, night: 1, sun: [600, 660, 0], warm: 1, moon: 1, cloud: 2,
  },
  {
    name: 'dawn',
    sky: [[0, '#26367a'], [0.4, '#6f74bd'], [0.75, '#efa6b6'], [1, '#ffe2b0']],
    water: [[0, '#ffd2b8'], [0.03, '#b48fb8'], [0.24, '#3f72aa'], [0.6, '#17497f'], [1, '#07274f']],
    land: ['#c69ab8', '#8b6a9e', '#4a456e', '#33304f'], bed: 0.3,
    light: 0.6, night: 0.3, sun: [190, 430, 1], warm: 0.75, moon: 0.15, cloud: 1,
  },
];
// [keyframe, thời gian giữ, thời gian chuyển sang keyframe kế] — tính theo phần của chu kỳ (tổng = 1)
const TIMELINE = [[0, 0.3, 0.06], [1, 0.12, 0.06], [2, 0.26, 0.05], [3, 0.08, 0.07]];
const FIXED = { day: 0.15, sunset: 0.42, night: 0.65, dawn: 0.87 };

function phaseNow() {
  const f = params.get('tod');
  if (f !== null) {
    if (f in FIXED) return FIXED[f];
    const v = Number(f);
    if (Number.isFinite(v)) return ((v % 1) + 1) % 1;
  }
  return (Date.now() / 1000 / CYCLE) % 1;
}

/** Trạng thái giờ hiện tại: keyframe a → b với tỉ lệ k, cùng các đại lượng đã nội suy. */
export const tod = { a: 0, b: 0, k: 0, light: 1, night: 0, warm: 0, moon: 0, sunX: 0, sunY: 0, sunA: 1, phase: 0 };
function updateTod() {
  let p = phaseNow();
  tod.phase = p;
  let a = 0, b = 0, k = 0;
  for (let i = 0; i < TIMELINE.length; i++) {
    const [kf, hold, trans] = TIMELINE[i];
    if (p < hold) { a = b = kf; k = 0; break; }
    p -= hold;
    if (p < trans) { a = kf; b = TIMELINE[(i + 1) % TIMELINE.length][0]; k = smooth(p / trans); break; }
    p -= trans;
  }
  const A = KF[a], B = KF[b];
  tod.a = a; tod.b = b; tod.k = k;
  for (const key of ['light', 'night', 'warm', 'moon']) tod[key] = lerp(A[key], B[key], k);
  tod.sunX = lerp(A.sun[0], B.sun[0], k);
  tod.sunY = lerp(A.sun[1], B.sun[1], k);
  tod.sunA = lerp(A.sun[2], B.sun[2], k);
}

// ---------------------------------------------------------------- lớp dựng sẵn
const skyC = [], waterC = [], landC = [], reflC = [];
let starC, sunDayC, sunSetC, moonC, raySprite, reflSun, reflMoon, lanternGlow, twinkleC;
const cloudShapes = []; // [shape][tint]
const fishSprites = [];
const smallFish = [];
let whaleC, mantaC, turtleC;
let dockCanvas = null, dockVersion = -1;
const LAND_TOP = 300;

function gradFill(g, x0, y0, x1, y1, stops) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}

function buildSky(kf) {
  const c = mk(W, WATER_Y);
  const g = c.getContext('2d');
  g.fillStyle = gradFill(g, 0, 0, 0, WATER_Y, kf.sky);
  g.fillRect(0, 0, W, WATER_Y);
  return c;
}

function seededRand(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function ridge(g, rnd, baseY, amp, freq, color, peaks) {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, WATER_Y + 2);
  const ph = rnd() * 10;
  for (let x = 0; x <= W; x += 8) {
    let y = baseY - Math.abs(Math.sin(x * freq + ph)) * amp - Math.sin(x * freq * 3.3 + ph * 2) * amp * 0.18;
    for (const [px, ph2, pw] of peaks) y = Math.min(y, baseY - ph2 * Math.max(0, 1 - Math.abs(x - px) / pw));
    g.lineTo(x, y);
  }
  g.lineTo(W, WATER_Y + 2);
  g.closePath();
  g.fill();
}

function palm(g, x, y, h, lean, color) {
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineCap = 'round';
  g.lineWidth = Math.max(3, h * 0.07);
  const tx = x + lean, ty = y - h;
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(x + lean * 0.2, y - h * 0.55, tx, ty);
  g.stroke();
  for (let k = 0; k < 7; k++) {
    const a = -Math.PI / 2 + (k - 3) * 0.48 + (k % 2 ? 0.1 : -0.1);
    const L = h * (0.42 + (k % 3) * 0.06);
    g.beginPath();
    g.moveTo(tx, ty);
    const ex = tx + Math.cos(a) * L, ey = ty + Math.sin(a) * L + L * 0.35;
    g.quadraticCurveTo(tx + Math.cos(a) * L * 0.55, ty + Math.sin(a) * L * 0.55 - L * 0.18, ex, ey);
    g.quadraticCurveTo(tx + Math.cos(a) * L * 0.5, ty + Math.sin(a) * L * 0.5 - L * 0.02, tx, ty + 3);
    g.fill();
  }
}

function buildLand(kf) {
  const c = mk(W, WATER_Y - LAND_TOP + 4);
  const g = c.getContext('2d');
  g.translate(0, -LAND_TOP);
  const rnd = seededRand(7);
  const [far, mid, near, deep] = kf.land;
  ridge(g, rnd, 470, 95, 0.0045, far, [[150, 190, 160], [520, 150, 140]]);
  ridge(g, rnd, 505, 55, 0.009, mid, [[330, 95, 120], [880, 120, 170]]);
  // đảo gần bên trái + bên phải (có cọ & hải đăng)
  g.fillStyle = near;
  g.beginPath();
  g.moveTo(-20, WATER_Y + 2);
  g.quadraticCurveTo(60, 480, 170, 505);
  g.quadraticCurveTo(250, 520, 300, WATER_Y + 2);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(470, WATER_Y + 2);
  g.quadraticCurveTo(560, 492, 640, 500);
  g.quadraticCurveTo(720, 506, 780, WATER_Y + 2);
  g.closePath();
  g.fill();
  palm(g, 70, 500, 78, 14, deep);
  palm(g, 118, 506, 58, -10, deep);
  palm(g, 215, 512, 48, 8, deep);
  palm(g, 548, 500, 66, -12, deep);
  // hải đăng
  g.fillStyle = deep;
  g.beginPath();
  g.moveTo(612, 503); g.lineTo(620, 432); g.lineTo(636, 432); g.lineTo(644, 503); g.closePath();
  g.fill();
  g.fillRect(614, 422, 28, 12);
  g.beginPath(); g.moveTo(612, 422); g.lineTo(628, 404); g.lineTo(644, 422); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.18)';
  for (const yy of [450, 476]) g.fillRect(618, yy, 20, 7);
  return c;
}

function buildRefl(land) {
  // phản chiếu: lật dọc, nén, gợn sóng theo hàng, mờ dần
  const hh = 210;
  const c = mk(W, hh);
  const g = c.getContext('2d');
  for (let y = 0; y < hh; y += 2) {
    const srcY = land.height - 4 - y / 0.75;
    if (srcY < 0) break;
    const off = Math.sin(y * 0.35) * (2 + y * 0.03);
    g.globalAlpha = 0.42 * (1 - y / hh);
    g.drawImage(land, 0, srcY, W, 2, off, y, W, 2);
  }
  return c;
}

function buildBed() {
  const c = mk(W, H - SEABED_Y + 80);
  const g = c.getContext('2d');
  g.translate(0, -(SEABED_Y - 80));
  const rnd = seededRand(42);
  // cát
  g.fillStyle = gradFill(g, 0, SEABED_Y, 0, H, [[0, '#2f6b86'], [0.4, '#5d8c86'], [1, '#c2b07a']]);
  g.beginPath();
  g.moveTo(0, H);
  for (let x = 0; x <= W; x += 20) g.lineTo(x, SEABED_Y + 30 - Math.sin(x * 0.006) * 26 - Math.sin(x * 0.023 + 1) * 8);
  g.lineTo(W, H);
  g.closePath();
  g.fill();
  // đá
  for (let i = 0; i < 9; i++) {
    const x = rnd() * W, y = SEABED_Y + 40 + rnd() * 120, r = 26 + rnd() * 50;
    g.fillStyle = `rgba(${30 + rnd() * 20},${50 + rnd() * 20},${70 + rnd() * 20},0.95)`;
    g.beginPath(); g.ellipse(x, y, r * 1.4, r * 0.8, 0, Math.PI, TAU); g.lineTo(x + r * 1.4, y + 10); g.lineTo(x - r * 1.4, y + 10); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.beginPath(); g.ellipse(x - r * 0.3, y - r * 0.45, r * 0.6, r * 0.2, -0.2, 0, TAU); g.fill();
  }
  // san hô nhánh
  const coralCols = ['#ff6f91', '#ff9a5c', '#c86bff', '#ffd166', '#ff5fa2'];
  const branch = (x, y, len, ang, w, depth, col) => {
    if (depth <= 0 || len < 6) return;
    const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke();
    branch(ex, ey, len * 0.72, ang - 0.45 - rnd() * 0.2, w * 0.72, depth - 1, col);
    branch(ex, ey, len * 0.72, ang + 0.45 + rnd() * 0.2, w * 0.72, depth - 1, col);
  };
  for (let i = 0; i < 9; i++) {
    const x = 40 + rnd() * (W - 80), y = SEABED_Y + 70 + rnd() * 90;
    branch(x, y, 34 + rnd() * 24, -Math.PI / 2 + (rnd() - 0.5) * 0.4, 9, 4, coralCols[i % coralCols.length]);
  }
  // san hô tròn + sao biển + vỏ sò
  for (let i = 0; i < 8; i++) {
    const x = rnd() * W, y = SEABED_Y + 90 + rnd() * 120, r = 14 + rnd() * 18;
    g.fillStyle = coralCols[(i + 2) % coralCols.length];
    g.beginPath(); g.arc(x, y, r, Math.PI, TAU); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(x - r * 0.6 + k * r * 0.3, y - r * 0.4, 2, 0, TAU); g.fill(); }
  }
  for (let i = 0; i < 6; i++) {
    const x = rnd() * W, y = SEABED_Y + 140 + rnd() * 80;
    g.fillStyle = i % 2 ? '#ffb347' : '#ff7b7b';
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU - Math.PI / 2, r = k % 2 ? 6 : 15;
      g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
  }
  return c;
}

function buildWater(kf, bed) {
  const c = mk(W, H - WATER_Y);
  const g = c.getContext('2d');
  g.fillStyle = gradFill(g, 0, 0, 0, H - WATER_Y, kf.water);
  g.fillRect(0, 0, W, H - WATER_Y);
  // đáy hồ (tối đi theo giờ)
  const b = mk(bed.width, bed.height);
  const bg = b.getContext('2d');
  bg.drawImage(bed, 0, 0);
  bg.globalCompositeOperation = 'source-atop';
  bg.fillStyle = `rgba(2,8,26,${kf.bed})`;
  bg.fillRect(0, 0, b.width, b.height);
  g.drawImage(b, 0, SEABED_Y - 80 - WATER_Y);
  // sương mù sâu: làm dịu chi tiết đáy
  g.fillStyle = gradFill(g, 0, SEABED_Y - 80 - WATER_Y, 0, H - WATER_Y, [[0, 'rgba(6,30,60,0.25)'], [1, 'rgba(6,30,60,0)']]);
  g.fillRect(0, SEABED_Y - 80 - WATER_Y, W, 300);
  return c;
}

function radial(size, stops) {
  const c = mk(size, size);
  const g = c.getContext('2d');
  const r = size / 2;
  const gr = g.createRadialGradient(r, r, 0, r, r, r);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}

function buildStars() {
  const c = mk(W, WATER_Y);
  const g = c.getContext('2d');
  const rnd = seededRand(99);
  for (let i = 0; i < 230; i++) {
    const y = Math.pow(rnd(), 1.4) * (WATER_Y - 60);
    const r = rnd() * 1.5 + 0.4;
    g.fillStyle = `rgba(255,255,255,${(0.35 + rnd() * 0.6) * (1 - y / WATER_Y)})`;
    g.beginPath(); g.arc(rnd() * W, y, r, 0, TAU); g.fill();
  }
  // dải ngân hà mờ
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 70; i++) {
    const t = rnd();
    const x = lerp(-50, W + 50, t), y = lerp(60, 330, t) + (rnd() - 0.5) * 90;
    const s = radial(120, [[0, 'rgba(150,160,255,0.06)'], [1, 'rgba(150,160,255,0)']]);
    g.drawImage(s, x - 60, y - 60);
  }
  return c;
}

function buildMoon() {
  const c = mk(300, 300);
  const g = c.getContext('2d');
  g.drawImage(radial(300, [[0, 'rgba(220,230,255,0.55)'], [0.25, 'rgba(180,200,255,0.18)'], [1, 'rgba(160,180,255,0)']]), 0, 0);
  g.fillStyle = '#f4f1dc';
  g.beginPath(); g.arc(150, 150, 46, 0, TAU); g.fill();
  g.fillStyle = 'rgba(160,160,140,0.35)';
  for (const [x, y, r] of [[136, 138, 11], [165, 160, 8], [150, 176, 6], [168, 132, 5], [128, 165, 5]]) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
  return c;
}

function buildCloud(seed, tint) {
  const rnd = seededRand(seed);
  const c = mk(340, 150);
  const g = c.getContext('2d');
  const [top, bottom] = [['#ffffff', '#d6e6f5'], ['#ffd9d0', '#c46a8f'], ['#3d4a78', '#1c2448']][tint];
  const puffs = [];
  for (let i = 0; i < 9; i++) puffs.push([60 + rnd() * 220, 70 + rnd() * 34 - (i % 3) * 12, 26 + rnd() * 34]);
  g.fillStyle = bottom;
  for (const [x, y, r] of puffs) { g.beginPath(); g.arc(x, y + 6, r, 0, TAU); g.fill(); }
  g.fillStyle = top;
  for (const [x, y, r] of puffs) { g.beginPath(); g.arc(x - 3, y - 3, r * 0.86, 0, TAU); g.fill(); }
  // đáy phẳng mềm
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = gradFill(g, 0, 105, 0, 150, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,1)']]);
  g.fillRect(0, 105, 340, 45);
  return c;
}

function buildFishSprite(hue, glow) {
  const c = mk(180, 90);
  const g = c.getContext('2d');
  g.translate(90, 45);
  const body = g.createLinearGradient(0, -30, 0, 30);
  body.addColorStop(0, `hsla(${hue},60%,62%,1)`);
  body.addColorStop(0.6, `hsla(${hue},55%,42%,1)`);
  body.addColorStop(1, `hsla(${hue},40%,75%,1)`);
  if (glow) { g.shadowColor = `hsla(${hue},100%,70%,1)`; g.shadowBlur = 18; }
  g.fillStyle = body;
  g.beginPath(); g.moveTo(-40, 0); g.lineTo(-78, -26); g.quadraticCurveTo(-66, 0, -78, 26); g.closePath(); g.fill();
  g.beginPath(); g.ellipse(4, 0, 54, 26, 0, 0, TAU); g.fill();
  g.shadowBlur = 0;
  g.fillStyle = `hsla(${hue},55%,35%,1)`;
  g.beginPath(); g.moveTo(-14, -22); g.quadraticCurveTo(6, -44, 22, -22); g.closePath(); g.fill();
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(36, -6, 6, 0, TAU); g.fill();
  g.fillStyle = '#102';
  g.beginPath(); g.arc(38, -6, 3.2, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.lineWidth = 3;
  for (const x of [-10, 8]) { g.beginPath(); g.arc(x, 0, 22, -0.9, 0.9); g.stroke(); }
  return c;
}

function buildSmallFish(col, stripe) {
  const c = mk(64, 28);
  const g = c.getContext('2d');
  g.translate(32, 14);
  g.fillStyle = col;
  g.beginPath(); g.moveTo(-14, 0); g.lineTo(-28, -9); g.lineTo(-25, 0); g.lineTo(-28, 9); g.closePath(); g.fill();
  g.beginPath(); g.ellipse(2, 0, 20, 8, 0, 0, TAU); g.fill();
  g.fillStyle = stripe;
  g.fillRect(-6, -7, 4, 14);
  g.fillRect(6, -7, 3, 14);
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(14, -2, 2.6, 0, TAU); g.fill();
  g.fillStyle = '#012';
  g.beginPath(); g.arc(14.6, -2, 1.3, 0, TAU); g.fill();
  return c;
}

function buildWhale() {
  const c = mk(760, 280);
  const g = c.getContext('2d');
  g.translate(380, 140);
  g.fillStyle = '#04121f';
  g.beginPath();
  g.moveTo(330, -10);
  g.bezierCurveTo(300, -80, 120, -95, -60, -60);
  g.bezierCurveTo(-180, -40, -260, -10, -300, 0);
  g.lineTo(-370, -55); g.quadraticCurveTo(-340, 0, -372, 52); g.lineTo(-300, 10);
  g.bezierCurveTo(-200, 40, -40, 80, 120, 70);
  g.bezierCurveTo(250, 62, 340, 40, 330, -10);
  g.fill();
  g.beginPath(); g.moveTo(60, 50); g.quadraticCurveTo(20, 130, -40, 120); g.quadraticCurveTo(0, 80, 10, 50); g.fill();
  g.fillStyle = 'rgba(120,170,210,0.18)';
  for (let i = 0; i < 9; i++) { g.fillRect(140 - i * 22, 40 + i * 1.5, 14, 22); }
  return c;
}
function buildManta() {
  const c = mk(520, 300);
  const g = c.getContext('2d');
  g.translate(260, 150);
  g.fillStyle = '#05131f';
  g.beginPath();
  g.moveTo(120, 0);
  g.bezierCurveTo(90, -40, 40, -60, -10, -140);
  g.bezierCurveTo(-30, -60, -70, -20, -110, 0);
  g.bezierCurveTo(-70, 20, -30, 60, -10, 140);
  g.bezierCurveTo(40, 60, 90, 40, 120, 0);
  g.fill();
  g.strokeStyle = '#05131f'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(-100, 0); g.quadraticCurveTo(-180, 10, -250, -6); g.stroke();
  g.beginPath(); g.moveTo(118, -12); g.lineTo(140, -22); g.moveTo(118, 12); g.lineTo(140, 22); g.stroke();
  return c;
}
function buildTurtle() {
  const c = mk(300, 200);
  const g = c.getContext('2d');
  g.translate(150, 100);
  g.fillStyle = '#06161f';
  g.beginPath(); g.ellipse(0, 0, 80, 52, 0, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(100, -4, 26, 20, 0, 0, TAU); g.fill();
  for (const [x, y, a] of [[40, -48, -0.7], [40, 48, 0.7], [-55, -38, -2.4], [-55, 38, 2.4]]) {
    g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.ellipse(26, 0, 34, 12, 0, 0, TAU); g.fill(); g.restore();
  }
  g.strokeStyle = 'rgba(120,180,170,0.2)'; g.lineWidth = 3;
  for (const [x, y] of [[0, 0], [-34, -12], [34, -12], [-30, 20], [30, 20]]) { g.beginPath(); g.arc(x, y, 18, 0, TAU); g.stroke(); }
  return c;
}

function buildRay() {
  const w = 240, h = 1100;
  const c = mk(w, h);
  const g = c.getContext('2d');
  g.fillStyle = gradFill(g, 0, 0, 0, h, [[0, 'rgba(200,245,255,1)'], [0.5, 'rgba(200,245,255,0.35)'], [1, 'rgba(200,245,255,0)']]);
  g.beginPath(); g.moveTo(w * 0.36, 0); g.lineTo(w * 0.64, 0); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fill();
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = gradFill(g, 0, 0, w, 0, [[0, 'rgba(0,0,0,0)'], [0.5, 'rgba(0,0,0,1)'], [1, 'rgba(0,0,0,0)']]);
  g.fillRect(0, 0, w, h);
  return c;
}

function buildReflColumn(rgb) {
  const w = 220, h = 520;
  const c = mk(w, h);
  const g = c.getContext('2d');
  g.fillStyle = gradFill(g, 0, 0, 0, h, [[0, `rgba(${rgb},0.75)`], [0.5, `rgba(${rgb},0.25)`], [1, `rgba(${rgb},0)`]]);
  for (let y = 0; y < h; y += 6) {
    const half = 30 + y * 0.16;
    const jitter = Math.sin(y * 0.7) * 12;
    g.fillRect(w / 2 - half + jitter, y, half * 2, 3.5);
  }
  return c;
}

// ---------------------------------------------------------------- thực thể động
const clouds = [];
const schools = [];
const loners = [];
const bubbles = [];
const glints = [];
const ripples = [];
const weeds = [];
const twinkles = [];
const birds = { active: false, x: 0, y: 0, sp: 0, n: 0, next: 0 };
const shooting = { t0: -1, x: 0, y: 0, next: 0 };
const creature = { on: false, spr: null, x: 0, y: 0, dir: 1, sp: 0, next: 0, ph: 0 };

export function initScene() {
  for (const kf of KF) {
    skyC.push(buildSky(kf));
    const land = buildLand(kf);
    landC.push(land);
    reflC.push(buildRefl(land));
  }
  const bed = buildBed();
  for (const kf of KF) waterC.push(buildWater(kf, bed));
  starC = buildStars();
  sunDayC = radial(460, [[0, 'rgba(255,255,245,1)'], [0.11, 'rgba(255,250,215,1)'], [0.13, 'rgba(255,240,180,0.55)'], [0.4, 'rgba(255,235,170,0.16)'], [1, 'rgba(255,230,160,0)']]);
  sunSetC = radial(560, [[0, 'rgba(255,244,200,1)'], [0.12, 'rgba(255,200,110,1)'], [0.14, 'rgba(255,150,90,0.6)'], [0.45, 'rgba(255,110,90,0.2)'], [1, 'rgba(255,90,90,0)']]);
  moonC = buildMoon();
  raySprite = buildRay();
  reflSun = buildReflColumn('255,214,150');
  reflMoon = buildReflColumn('220,230,255');
  lanternGlow = radial(160, [[0, 'rgba(255,220,140,0.9)'], [0.2, 'rgba(255,180,90,0.45)'], [1, 'rgba(255,150,60,0)']]);
  twinkleC = radial(32, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(220,230,255,0.6)'], [1, 'rgba(200,220,255,0)']]);
  for (let s = 0; s < 4; s++) cloudShapes.push([0, 1, 2].map((tint) => buildCloud(11 + s * 17, tint)));
  for (const [h, glow] of [[200, 0], [30, 0], [140, 0], [350, 0], [270, 0], [50, 1], [180, 1]]) fishSprites.push(buildFishSprite(h, glow));
  for (const [c, s] of [['#c8d8e8', '#7d93a8'], ['#ffd34d', '#2b2b2b'], ['#ff8a3d', '#ffffff'], ['#6fe0ff', '#0d4b6e'], ['#c7a4ff', '#5b2d9c']]) smallFish.push(buildSmallFish(c, s));
  whaleC = buildWhale(); mantaC = buildManta(); turtleC = buildTurtle();

  // mây: lớp xa (nhỏ, chậm) + lớp gần (to, nhanh hơn) → parallax
  for (let i = 0; i < 4; i++) clouds.push({ x: rand(0, W), y: rand(140, 300), s: rand(0.45, 0.65), sp: rand(5, 9), shape: i % 4, a: 0.55 });
  for (let i = 0; i < 3; i++) clouds.push({ x: rand(0, W), y: rand(250, 420), s: rand(0.8, 1.15), sp: rand(12, 20), shape: (i + 2) % 4, a: 0.85 });
  // đàn cá
  for (let i = 0; i < 4; i++) {
    const n = 8 + (i % 3) * 2;
    const members = [];
    for (let k = 0; k < n; k++) members.push({ ox: (k % 4) * 34 + rand(-8, 8) - (k % 2) * 16, oy: Math.floor(k / 4) * 22 + rand(-6, 6) + (k % 2) * 11, ph: rand(0, TAU) });
    schools.push({
      x: rand(0, W), y: rand(WATER_Y + 160, SEABED_Y - 80), dir: i % 2 ? -1 : 1, sp: rand(45, 75), spr: smallFish[i % smallFish.length],
      members, ph: rand(0, TAU), depth: 0.55 + (i % 2) * 0.3, baseY: 0,
    });
  }
  for (const s of schools) s.baseY = s.y;
  for (let i = 0; i < 9; i++) {
    const depth = Math.random();
    loners.push({
      x: rand(0, W), y: rand(WATER_Y + 80, SEABED_Y - 40), dir: Math.random() < 0.5 ? -1 : 1,
      speed: rand(25, 60) * (0.5 + depth), size: 0.28 + depth * 0.45, alpha: 0.22 + depth * 0.3,
      phase: rand(0, TAU), spr: fishSprites[i % fishSprites.length], depth, turnAt: rand(8, 25),
    });
  }
  loners.sort((a, b) => a.depth - b.depth);
  for (let i = 0; i < 40; i++) bubbles.push({ x: rand(0, W), y: rand(WATER_Y + 40, H), r: rand(2, 7), sp: rand(30, 90), ph: rand(0, TAU) });
  for (let i = 0; i < 60; i++) glints.push({ y: WATER_Y + 4 + Math.pow(Math.random(), 1.6) * 260, off: rand(-1, 1), ph: rand(0, TAU), w: rand(10, 34) });
  for (let i = 0; i < 46; i++) ripples.push({ x: rand(0, W), y: WATER_Y + 20 + Math.pow(Math.random(), 1.3) * 1100, ph: rand(0, TAU), w: rand(20, 60), sp: rand(6, 18) });
  for (let i = 0; i < 22; i++) weeds.push({ x: 20 + i * (W / 22) + rand(-14, 14), base: SEABED_Y + 70 + rand(0, 110), h: rand(90, 210), w: rand(7, 13), ph: rand(0, TAU), hue: rand(0, 1) });
  for (let i = 0; i < 28; i++) twinkles.push({ x: rand(0, W), y: Math.pow(Math.random(), 1.3) * 420, ph: rand(0, TAU), sp: rand(1.5, 4), s: rand(10, 20) });
  const now = performance.now() / 1000;
  birds.next = now + 6;
  shooting.next = now + 8;
  creature.next = now + (params.get('creature') === '1' ? 0.5 : 6);
  updateTod();
}

export function updateScene(dt, t) {
  updateTod();
  for (const c of clouds) { c.x += c.sp * dt; if (c.x > W + 60) { c.x = -340 * c.s - 40; c.y = c.a < 0.7 ? rand(140, 300) : rand(250, 420); } }
  for (const s of schools) {
    s.x += s.dir * s.sp * dt;
    s.y = s.baseY + Math.sin(t * 0.35 + s.ph) * 60;
    if (s.x < -260 || s.x > W + 260) {
      s.dir = s.x < 0 ? 1 : -1;
      s.baseY = rand(WATER_Y + 160, SEABED_Y - 80);
      s.sp = rand(45, 75);
    }
  }
  for (const f of loners) {
    f.x += f.dir * f.speed * dt;
    f.turnAt -= dt;
    if (f.x < -150 || f.x > W + 150 || f.turnAt < 0) {
      if (f.x < -150 || f.x > W + 150) {
        f.dir = f.x < 0 ? 1 : -1;
        f.y = rand(WATER_Y + 80, SEABED_Y - 40);
      } else if (Math.random() < 0.3) f.dir *= -1;
      f.turnAt = rand(8, 25);
    }
  }
  for (const b of bubbles) {
    b.y -= b.sp * dt;
    if (b.y < WATER_Y + 8) { b.y = H - rand(0, 80); b.x = rand(0, W); }
  }
  for (const r of ripples) r.x = (r.x + r.sp * dt + W + 120) % (W + 120) - 60;
  // chim (ban ngày/hoàng hôn)
  if (!birds.active && t > birds.next && tod.night < 0.6) {
    Object.assign(birds, { active: true, x: -80, y: rand(170, 330), sp: rand(60, 90), n: 3 + Math.floor(Math.random() * 4) });
  }
  if (birds.active) { birds.x += birds.sp * dt; if (birds.x > W + 120) { birds.active = false; birds.next = t + rand(18, 40); } }
  // sao băng (ban đêm)
  if (shooting.t0 < 0 && t > shooting.next && tod.night > 0.6) Object.assign(shooting, { t0: t, x: rand(100, 700), y: rand(130, 260) });
  if (shooting.t0 >= 0 && t - shooting.t0 > 1.1) { shooting.t0 = -1; shooting.next = t + rand(9, 22); }
  // sinh vật lớn phía xa
  if (!creature.on && t > creature.next) {
    const pick = Math.floor(Math.random() * 3);
    creature.spr = [whaleC, mantaC, turtleC][pick];
    creature.dir = Math.random() < 0.5 ? 1 : -1;
    creature.x = creature.dir > 0 ? -creature.spr.width / 2 : W + creature.spr.width / 2;
    creature.y = rand(1250, 1600);
    creature.sp = [38, 55, 45][pick];
    creature.on = true;
  }
  if (creature.on) {
    creature.x += creature.dir * creature.sp * dt;
    creature.ph += dt;
    if (creature.x < -creature.spr.width || creature.x > W + creature.spr.width) { creature.on = false; creature.next = t + rand(40, 90); }
  }
}

function drawLayer(ctx, arr, y = 0) {
  ctx.drawImage(arr[tod.a], 0, y);
  if (tod.k > 0.001 && tod.b !== tod.a) {
    ctx.globalAlpha = tod.k;
    ctx.drawImage(arr[tod.b], 0, y);
    ctx.globalAlpha = 1;
  }
}

function drawClouds(ctx) {
  const ta = KF[tod.a].cloud, tb = KF[tod.b].cloud;
  for (const c of clouds) {
    const shp = cloudShapes[c.shape];
    const w = 340 * c.s, h = 150 * c.s;
    const alpha = c.a * (1 - tod.night * 0.35);
    if (ta === tb || tod.k < 0.001) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(shp[ta], c.x, c.y - h / 2, w, h);
    } else {
      ctx.globalAlpha = alpha * (1 - tod.k);
      ctx.drawImage(shp[ta], c.x, c.y - h / 2, w, h);
      ctx.globalAlpha = alpha * tod.k;
      ctx.drawImage(shp[tb], c.x, c.y - h / 2, w, h);
    }
  }
  ctx.globalAlpha = 1;
}

export function drawSceneBack(ctx, t) {
  // ---- Trời
  drawLayer(ctx, skyC);
  if (tod.night > 0.02) {
    ctx.globalAlpha = tod.night;
    ctx.drawImage(starC, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const s of twinkles) {
      const a = tod.night * (0.35 + 0.65 * Math.max(0, Math.sin(t * s.sp + s.ph)));
      ctx.globalAlpha = a;
      ctx.drawImage(twinkleC, s.x - s.s / 2, s.y - s.s / 2, s.s, s.s);
    }
    if (shooting.t0 >= 0) {
      const k = (t - shooting.t0) / 1.1;
      const x = shooting.x + k * 420, y = shooting.y + k * 160;
      ctx.globalAlpha = tod.night * Math.sin(k * Math.PI);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 140, y - 53); ctx.stroke();
      ctx.drawImage(twinkleC, x - 12, y - 12, 24, 24);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  // Mặt trời / trăng (bị che bởi núi & nước vì vẽ trước)
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, WATER_Y);
  ctx.clip();
  if (tod.sunA > 0.01) {
    const low = clamp((tod.sunY - 300) / 200, 0, 1);
    const sc = 1 + low * 0.25;
    ctx.globalAlpha = tod.sunA * (1 - tod.warm);
    let d = sunDayC.width * sc;
    if (ctx.globalAlpha > 0.01) ctx.drawImage(sunDayC, tod.sunX - d / 2, tod.sunY - d / 2, d, d);
    ctx.globalAlpha = tod.sunA * tod.warm;
    d = sunSetC.width * sc;
    if (ctx.globalAlpha > 0.01) ctx.drawImage(sunSetC, tod.sunX - d / 2, tod.sunY - d / 2, d, d);
  }
  if (tod.moon > 0.01) {
    ctx.globalAlpha = tod.moon;
    const mx = 470 + Math.sin(tod.phase * TAU) * 40, my = 215;
    ctx.drawImage(moonC, mx - 150, my - 150);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  drawClouds(ctx);
  // chim
  if (birds.active) {
    ctx.strokeStyle = tod.night > 0.3 ? 'rgba(20,20,40,0.8)' : 'rgba(30,30,50,0.75)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let i = 0; i < birds.n; i++) {
      const bx = birds.x - i * 38 - (i % 2) * 12, by = birds.y + (i % 2 ? 16 : -6) * Math.ceil(i / 2) * 0.6;
      const f = Math.sin(t * 9 + i) * 6;
      ctx.beginPath(); ctx.moveTo(bx - 12, by - f); ctx.quadraticCurveTo(bx - 5, by - 6, bx, by); ctx.quadraticCurveTo(bx + 5, by - 6, bx + 12, by - f); ctx.stroke();
    }
  }
  drawLayer(ctx, landC, LAND_TOP);
  // đèn hải đăng ban đêm
  if (tod.night > 0.3) {
    const a = clamp((tod.night - 0.3) / 0.5, 0, 1);
    const ang = t * 0.9;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a * (0.55 + 0.45 * Math.max(0, Math.cos(ang)));
    ctx.drawImage(lanternGlow, 628 - 40, 428 - 40, 80, 80);
    ctx.save();
    ctx.translate(628, 428);
    ctx.scale(Math.cos(ang), 1);
    ctx.globalAlpha = a * 0.22;
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(420, -40); ctx.lineTo(420, 40); ctx.lineTo(0, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // ---- Nước
  drawLayer(ctx, waterC, WATER_Y);
  drawLayer(ctx, reflC, WATER_Y);
  // phản chiếu mặt trời / trăng
  ctx.globalCompositeOperation = 'lighter';
  const sunVis = tod.sunA * clamp((WATER_Y + 10 - tod.sunY) / 60, 0, 1);
  let gx = tod.sunX;
  if (sunVis > 0.02) {
    ctx.globalAlpha = sunVis * (0.45 + 0.4 * tod.warm);
    ctx.drawImage(reflSun, tod.sunX - 110 + Math.sin(t * 0.8) * 4, WATER_Y + 2);
  }
  if (tod.moon > 0.05) {
    const mx = 470 + Math.sin(tod.phase * TAU) * 40;
    ctx.globalAlpha = tod.moon * 0.6;
    ctx.drawImage(reflMoon, mx - 110 + Math.sin(t * 0.8) * 4, WATER_Y + 2);
    if (sunVis < 0.3) gx = mx;
  }
  // lấp lánh trên mặt nước quanh vệt phản chiếu
  const gcol = tod.warm > 0.5 && sunVis > 0.2 ? '255,214,160' : tod.moon > 0.5 ? '210,225,255' : '255,250,230';
  const gA = Math.max(sunVis, tod.moon * 0.7, 0.25);
  for (const g of glints) {
    const a = Math.max(0, Math.sin(t * 2.2 + g.ph)) * 0.8 * (1 - (g.y - WATER_Y) / 280) * gA;
    if (a <= 0.03) continue;
    const spread = 50 + (g.y - WATER_Y) * 0.55;
    ctx.globalAlpha = a;
    ctx.fillStyle = `rgb(${gcol})`;
    ctx.fillRect(gx + g.off * spread - g.w / 2, g.y, g.w, 2.5);
  }
  // tia sáng xuyên nước
  const L = tod.light;
  for (let i = 0; i < 7; i++) {
    const x = 60 + i * 160 + Math.sin(t * 0.21 + i * 1.7) * 50;
    const a = L * (0.07 + 0.045 * Math.sin(t * 0.5 + i * 2.1));
    if (a <= 0.01) continue;
    ctx.globalAlpha = a;
    ctx.save();
    ctx.translate(x, WATER_Y);
    ctx.transform(1, 0, Math.sin(t * 0.17 + i) * 0.12 + 0.1, 1, 0, 0);
    ctx.drawImage(raySprite, -120, 0, 240, 1100 * (0.8 + (i % 3) * 0.1));
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  // sinh vật lớn phía xa (rất mờ, sau đàn cá)
  if (creature.on) {
    const c = creature;
    ctx.globalAlpha = 0.2 + 0.08 * L;
    ctx.save();
    ctx.translate(c.x, c.y + Math.sin(c.ph * 0.6) * 18);
    ctx.scale(c.dir, 1);
    if (c.spr === mantaC) ctx.scale(1, 0.75 + 0.25 * Math.sin(c.ph * 1.6));
    ctx.drawImage(c.spr, -c.spr.width / 2, -c.spr.height / 2);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // rong biển đung đưa
  const wk = tod.night;
  const weedA = mixHex('#2fae6a', '#123a3a', wk), weedB = mixHex('#59c96b', '#1a4d44', wk);
  ctx.lineCap = 'round';
  for (const w of weeds) {
    const sway = Math.sin(t * 0.9 + w.ph) * 26;
    ctx.strokeStyle = w.hue < 0.5 ? weedA : weedB;
    ctx.lineWidth = w.w;
    ctx.beginPath();
    ctx.moveTo(w.x, w.base);
    ctx.bezierCurveTo(w.x + sway * 0.3, w.base - w.h * 0.35, w.x - sway * 0.4, w.base - w.h * 0.7, w.x + sway, w.base - w.h);
    ctx.stroke();
  }

  // đàn cá
  const fishDim = 0.55 + 0.45 * L;
  for (const s of schools) {
    ctx.globalAlpha = (0.32 + s.depth * 0.3) * fishDim;
    const sc = 0.7 + s.depth * 0.5;
    for (const m of s.members) {
      const wob = Math.sin(t * 7 + m.ph);
      const fx = s.x - s.dir * m.ox * sc + Math.sin(t * 1.3 + m.ph) * 5;
      const fy = s.y + m.oy * sc + Math.sin(t * 1.1 + m.ph) * 4;
      ctx.save();
      ctx.translate(fx, fy);
      ctx.scale(s.dir * sc * (1 + wob * 0.05), sc);
      ctx.drawImage(s.spr, -32, -14);
      ctx.restore();
    }
  }
  // cá lẻ
  for (const f of loners) {
    const s = f.size;
    const wob = Math.sin(t * (4 + f.speed * 0.04) + f.phase);
    ctx.globalAlpha = f.alpha * fishDim;
    ctx.save();
    ctx.translate(f.x, f.y + Math.sin(t * 0.8 + f.phase) * 8);
    ctx.scale(f.dir * s * (1 + wob * 0.04), s);
    ctx.transform(1, wob * 0.05, 0, 1, 0, 0);
    ctx.drawImage(f.spr, -90, -45);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // gợn sóng
  ctx.strokeStyle = 'rgba(220,245,255,0.5)';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  for (const r of ripples) {
    const depthK = 1 - (r.y - WATER_Y) / 1200;
    const a = (0.22 + 0.32 * Math.sin(t * 1.3 + r.ph)) * depthK * (0.6 + 0.4 * L);
    if (a <= 0.03) continue;
    ctx.globalAlpha = a;
    ctx.beginPath();
    const w = r.w * (0.6 + depthK * 0.6);
    ctx.moveTo(r.x - w / 2, r.y);
    ctx.quadraticCurveTo(r.x, r.y - 6 + Math.sin(t * 2 + r.ph) * 3, r.x + w / 2, r.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // bong bóng
  ctx.strokeStyle = 'rgba(210,245,255,0.5)';
  ctx.lineWidth = 1.6;
  for (const b of bubbles) {
    const x = b.x + Math.sin(t * 2 + b.ph) * 6;
    ctx.beginPath();
    ctx.arc(x, b.y, b.r, 0, TAU);
    ctx.stroke();
  }

  // viền mặt nước gợn
  ctx.fillStyle = tod.night > 0.6 ? 'rgba(150,180,230,0.45)' : 'rgba(220,245,255,0.6)';
  ctx.beginPath();
  ctx.moveTo(0, WATER_Y + 6);
  for (let x = 0; x <= W; x += 20) ctx.lineTo(x, WATER_Y + Math.sin(x * 0.03 + t * 1.6) * 2.2 + Math.sin(x * 0.011 - t) * 1.6);
  ctx.lineTo(W, WATER_Y + 6);
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------- cầu tàu
const POST_STEP = 148;
function plankDock(g, x0, x1, y, k) {
  const h = 34 * k;
  // cột (ngắn để không lấn hàng dưới)
  for (let x = x0 + 26; x < x1 - 10; x += POST_STEP * k) {
    g.fillStyle = '#3d2615';
    g.fillRect(x - 8, y + h - 4, 16, 34 * k);
    g.fillStyle = 'rgba(255,220,170,0.18)';
    g.fillRect(x - 6, y + h - 4, 4, 34 * k);
    g.fillStyle = 'rgba(10,40,70,0.5)';
    g.fillRect(x - 8, y + h + 18 * k, 16, 12 * k);
  }
  g.fillStyle = 'rgba(0,10,30,0.35)';
  g.fillRect(x0, y + h, x1 - x0, 12 * k);
  // mặt sàn
  g.fillStyle = gradFill(g, 0, y - 6, 0, y + h, [[0, '#d39a62'], [0.22, '#a86f3f'], [0.7, '#7a4d29'], [1, '#55351c']]);
  g.beginPath();
  g.roundRect ? g.roundRect(x0, y - 6, x1 - x0, h + 6, 8) : g.rect(x0, y - 6, x1 - x0, h + 6);
  g.fill();
  g.strokeStyle = 'rgba(40,20,8,0.55)';
  g.lineWidth = 2;
  for (let x = x0 + 40; x < x1; x += 46) { g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 3, y + h - 2); g.stroke(); }
  g.strokeStyle = 'rgba(40,20,8,0.35)';
  g.beginPath(); g.moveTo(x0 + 4, y + h * 0.45); g.lineTo(x1 - 4, y + h * 0.45); g.stroke();
  g.fillStyle = 'rgba(255,225,180,0.4)';
  g.fillRect(x0 + 6, y - 5, x1 - x0 - 12, 3);
  g.strokeStyle = 'rgba(20,10,4,0.75)';
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(x0, y + h); g.lineTo(x1, y + h); g.stroke();
}

function lanternSpots() {
  const out = [];
  for (const R of layout.rows) out.push({ x: R.dockX0 + 14, y: R.dockY + 14 }, { x: R.dockX1 - 14, y: R.dockY + 14 });
  return out;
}

function buildDocks() {
  const c = mk(W, H);
  const g = c.getContext('2d');
  const k = Math.max(0.75, layout.scale);
  for (const R of layout.rows) plankDock(g, R.dockX0, R.dockX1, R.dockY, k);
  for (const L of lanternSpots()) {
    g.fillStyle = '#2a1a10';
    g.fillRect(L.x - 2, L.y - 16, 4, 8);
    g.fillStyle = '#3b2414';
    g.beginPath(); g.roundRect ? g.roundRect(L.x - 9, L.y - 9, 18, 22, 5) : g.rect(L.x - 9, L.y - 9, 18, 22); g.fill();
    g.fillStyle = '#ffcf6b';
    g.fillRect(L.x - 5, L.y - 5, 10, 14);
  }
  return c;
}

export function drawDocks(ctx, t) {
  if (dockVersion !== layout.version) { dockCanvas = buildDocks(); dockVersion = layout.version; }
  ctx.drawImage(dockCanvas, 0, 0);
  // vệt nước quanh chân cột
  const k = Math.max(0.75, layout.scale);
  ctx.strokeStyle = 'rgba(220,245,255,0.35)';
  ctx.lineWidth = 2;
  for (const R of layout.rows) {
    const y = R.dockY + 34 * k + 22 * k;
    for (let x = R.dockX0 + 26; x < R.dockX1 - 10; x += POST_STEP * k) {
      const q = (Math.sin(t * 1.5 + x) + 1) / 2;
      ctx.globalAlpha = 0.3 + q * 0.35;
      ctx.beginPath();
      ctx.ellipse(x, y, 14 + q * 7, 3.5 + q * 1.5, 0, 0, TAU);
      ctx.stroke();
    }
  }
  // đèn lồng sáng khi trời tối
  if (tod.night > 0.25) {
    const a = clamp((tod.night - 0.25) / 0.5, 0, 1);
    ctx.globalCompositeOperation = 'lighter';
    for (const L of lanternSpots()) {
      ctx.globalAlpha = a * (0.75 + 0.25 * Math.sin(t * 7 + L.x));
      ctx.drawImage(lanternGlow, L.x - 70, L.y - 70, 140, 140);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = 1;
}
