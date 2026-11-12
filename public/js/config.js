// Hằng số hiển thị (màu, nhãn) + chuẩn hoá `config` nhận từ server (message `state`).
import { sanitizeName } from './util.js';

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

export const RARITY = {
  common: { idx: 0, label: 'Thường', color: '#e6eef3', glow: '#ffffff' },
  uncommon: { idx: 1, label: 'Khá', color: '#69e88a', glow: '#3dff7a' },
  rare: { idx: 2, label: 'Hiếm', color: '#4cb8ff', glow: '#2aa3ff' },
  epic: { idx: 3, label: 'Sử Thi', color: '#c785ff', glow: '#b45cff' },
  legendary: { idx: 4, label: 'Huyền Thoại', color: '#ffbf2e', glow: '#ff9d00' },
  mythic: { idx: 5, label: 'Thần Thoại', color: '#ff5c9d', glow: '#ff2d7a' },
};
export const rarityOf = (r) => RARITY[r] || RARITY.common;

// Màu nhận diện theo tier cần/mồi (1..6)
export const TIER_STYLE = [
  null,
  { color: '#d8b46a', dark: '#6e5226', label: 'Tre' },
  { color: '#a3afbd', dark: '#3d4652', label: 'Sắt' },
  { color: '#eef4fb', dark: '#7d8ea3', label: 'Bạc' },
  { color: '#ffcf3a', dark: '#8a5a00', label: 'Vàng' },
  { color: '#62f2ff', dark: '#0a6c96', label: 'Kim Cương' },
  { color: '#ff5fe0', dark: '#5a0f74', label: 'Huyền Thoại' },
];
export const tierStyle = (t) => TIER_STYLE[Math.min(6, Math.max(1, t | 0))] || TIER_STYLE[1];

// Mặc định theo SPEC mục 2 — chỉ dùng khi server chưa gửi config / thiếu trường.
export const DEFAULT_CONFIG = {
  rods: [
    { tier: 1, id: 'bamboo', name: 'Cần Tre', minDiamonds: 0, castMs: 9000, luck: 1.0 },
    { tier: 2, id: 'iron', name: 'Cần Sắt', minDiamonds: 5, castMs: 8000, luck: 1.15 },
    { tier: 3, id: 'silver', name: 'Cần Bạc', minDiamonds: 30, castMs: 7000, luck: 1.3 },
    { tier: 4, id: 'gold', name: 'Cần Vàng', minDiamonds: 100, castMs: 6000, luck: 1.5 },
    { tier: 5, id: 'diamond', name: 'Cần Kim Cương', minDiamonds: 500, castMs: 5000, luck: 1.8 },
    { tier: 6, id: 'legend', name: 'Cần Huyền Thoại', minDiamonds: 2000, castMs: 4000, luck: 2.2 },
  ],
  baits: [
    { tier: 1, name: 'Mồi Giun', price: 1 },
    { tier: 2, name: 'Mồi Tôm', price: 2 },
    { tier: 3, name: 'Mồi Mực', price: 6 },
    { tier: 4, name: 'Mồi Vàng', price: 20 },
    { tier: 5, name: 'Mồi Kim Cương', price: 60 },
    { tier: 6, name: 'Mồi Huyền Thoại', price: 200 },
  ],
  fish: [],
  // Số chỗ câu: server gửi trong config.slots (server/config.js GAME.maxSlots). Số này chỉ là dự phòng
  // khi server cũ không gửi trường đó.
  slots: 24,
  // Không có trong hợp đồng mục 4 → dùng số của SPEC mục 2 nếu server không gửi.
  free: { firstComment: 2, follow: 3, share: 2, likesPerBait: 30 },
};

const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);

function toArr(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object')
    return Object.entries(x).map(([k, v]) => ({ tier: Number(k) || undefined, ...(v && typeof v === 'object' ? v : { price: v }) }));
  return [];
}

function castMsOf(r, d) {
  const ms = r.castMs ?? r.castTimeMs ?? r.durationMs ?? r.castDurationMs;
  if (Number.isFinite(Number(ms)) && ms !== null) return Number(ms);
  const s = r.castSec ?? r.castSeconds ?? r.castTime ?? r.seconds;
  if (Number.isFinite(Number(s)) && s !== null) return Number(s) < 200 ? Number(s) * 1000 : Number(s);
  return d;
}

/** Chuẩn hoá config — chịu được tên trường khác nhau / thiếu trường. */
export function normalizeConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const D = DEFAULT_CONFIG;
  let rods = toArr(c.rods).map((r, i) => {
    const tier = num(r.tier, i + 1);
    const d = D.rods[tier - 1] || D.rods[0];
    return {
      tier,
      id: r.id ?? d.id,
      name: sanitizeName(r.name ?? d.name, d.name),
      minDiamonds: num(r.minDiamonds ?? r.threshold ?? r.minDiamond ?? r.diamonds ?? r.min, d.minDiamonds),
      castMs: castMsOf(r, d.castMs),
      luck: num(r.luck, d.luck),
    };
  });
  if (!rods.length) rods = D.rods.map((r) => ({ ...r }));
  rods.sort((a, b) => a.tier - b.tier);

  let baits = toArr(c.baits).map((b, i) => {
    const tier = num(b.tier, i + 1);
    const d = D.baits[tier - 1] || D.baits[0];
    return {
      tier,
      name: sanitizeName(b.name ?? d.name, d.name),
      price: num(b.price ?? b.diamonds ?? b.cost ?? b.costDiamonds, d.price),
    };
  });
  if (!baits.length) baits = D.baits.map((b) => ({ ...b }));
  baits.sort((a, b) => a.tier - b.tier);

  const fish = toArr(c.fish)
    .filter((f) => f && typeof f === 'object')
    .map((f) => ({
      id: String(f.id ?? ''),
      name: sanitizeName(f.name, '?'),
      emoji: typeof f.emoji === 'string' && f.emoji ? f.emoji : '🐟',
      rarity: RARITY[f.rarity] ? f.rarity : 'common',
      minPoints: num(f.minPoints, 0),
      maxPoints: num(f.maxPoints, 0),
    }));

  const fr = c.free || c.freeBait || {};
  const free = {
    firstComment: num(fr.firstComment, D.free.firstComment),
    follow: num(fr.follow, D.free.follow),
    share: num(fr.share, D.free.share),
    likesPerBait: num(fr.likesPerBait ?? fr.likes, D.free.likesPerBait),
  };
  const sl = Math.round(num(c.slots ?? c.maxSlots, D.slots));
  const slots = sl >= 1 && sl <= 60 ? sl : D.slots;
  return { slots, rods, baits, fish, free };
}

export const rodOf = (cfg, tier) => cfg.rods.find((r) => r.tier === tier) || DEFAULT_CONFIG.rods[Math.min(5, Math.max(0, tier - 1))];
export const baitOf = (cfg, tier) => cfg.baits.find((b) => b.tier === tier) || DEFAULT_CONFIG.baits[Math.min(5, Math.max(0, tier - 1))];
