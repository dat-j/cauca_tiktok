// Bảng cân bằng game câu cá. Mọi con số tinh chỉnh nằm ở đây.
// Engine (game.js) chỉ đọc config, không hard-code số.

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

// Các bậc độ hiếm được nhân `luck` của cần (rare trở lên) rồi chuẩn hoá.
export const LUCK_AFFECTED = ['rare', 'epic', 'legendary', 'mythic'];

// Cần câu: quyết định theo giá trị kim cương của MỘT lần tặng (diamondCount × repeatCount).
export const RODS = [
  { tier: 1, id: 'bamboo', name: 'Cần Tre', minDiamonds: 0, castMs: 9000, luck: 1.0 },
  { tier: 2, id: 'iron', name: 'Cần Sắt', minDiamonds: 5, castMs: 8000, luck: 1.15 },
  { tier: 3, id: 'silver', name: 'Cần Bạc', minDiamonds: 30, castMs: 7000, luck: 1.3 },
  { tier: 4, id: 'gold', name: 'Cần Vàng', minDiamonds: 100, castMs: 6000, luck: 1.5 },
  { tier: 5, id: 'diamond', name: 'Cần Kim Cương', minDiamonds: 500, castMs: 5000, luck: 1.8 },
  { tier: 6, id: 'legend', name: 'Cần Huyền Thoại', minDiamonds: 2000, castMs: 4000, luck: 2.2 },
];

// Mồi: giá (kim cương / 1 mồi) và bảng trọng số độ hiếm GỐC (trước khi nhân luck).
// Thứ tự trọng số: common, uncommon, rare, epic, legendary, mythic.
export const BAITS = [
  { tier: 1, name: 'Mồi Giun', price: 1, weights: [82, 16, 1.8, 0.18, 0.01, 0] },
  { tier: 2, name: 'Mồi Tôm', price: 2, weights: [55, 37, 7, 0.9, 0.1, 0.003] },
  { tier: 3, name: 'Mồi Mực', price: 6, weights: [22, 40, 30, 6.5, 1.4, 0.06] },
  { tier: 4, name: 'Mồi Vàng', price: 20, weights: [5, 20, 40, 27, 7, 1.1] },
  { tier: 5, name: 'Mồi Kim Cương', price: 60, weights: [0, 3, 25, 40, 25, 7] },
  { tier: 6, name: 'Mồi Huyền Thoại', price: 200, weights: [0, 0, 5, 24, 32, 39] },
];

export const BAIT_PER_GIFT_MIN = 1;
export const BAIT_PER_GIFT_MAX = 50;

// Mồi miễn phí (luôn là mồi tier 1).
export const FREE_BAIT = {
  firstComment: 2, // comment đầu tiên trong phiên
  follow: 3, // mỗi người tối đa 1 lần / phiên
  share: 2, // mỗi lần share
  shareMaxPerSession: 5, // chống spam share: tối đa số lần share được thưởng / người / phiên
  likesPerBait: 30, // mỗi 30 like tích luỹ → +1 mồi
};

// Cá. weight = trọng số chọn loài trong cùng độ hiếm (mặc định 1). junk = rác.
export const FISH = [
  // common ~1–10
  { id: 'ca_ro', name: 'Cá Rô', emoji: '🐟', rarity: 'common', minPoints: 2, maxPoints: 8 },
  { id: 'ca_diec', name: 'Cá Diếc', emoji: '🐟', rarity: 'common', minPoints: 2, maxPoints: 7 },
  { id: 'ca_bong', name: 'Cá Bống', emoji: '🐟', rarity: 'common', minPoints: 1, maxPoints: 6 },
  { id: 'ca_com', name: 'Cá Cơm', emoji: '🐟', rarity: 'common', minPoints: 1, maxPoints: 5 },
  { id: 'tep_dong', name: 'Tép Đồng', emoji: '🦐', rarity: 'common', minPoints: 3, maxPoints: 10 },
  { id: 'cua_dong', name: 'Cua Đồng', emoji: '🦀', rarity: 'common', minPoints: 4, maxPoints: 10 },
  { id: 'ung_rach', name: 'Ủng Rách', emoji: '👢', rarity: 'common', minPoints: 0, maxPoints: 1, junk: true, weight: 0.5 },
  { id: 'lon_nuoc', name: 'Lon Nước', emoji: '🥫', rarity: 'common', minPoints: 0, maxPoints: 1, junk: true, weight: 0.5 },
  { id: 'rong_reu', name: 'Mớ Rong Rêu', emoji: '🌿', rarity: 'common', minPoints: 0, maxPoints: 1, junk: true, weight: 0.5 },
  // uncommon ~10–35
  { id: 'ca_chep', name: 'Cá Chép', emoji: '🐠', rarity: 'uncommon', minPoints: 12, maxPoints: 25 },
  { id: 'ca_tram', name: 'Cá Trắm', emoji: '🐟', rarity: 'uncommon', minPoints: 15, maxPoints: 30 },
  { id: 'ca_ro_phi', name: 'Cá Rô Phi', emoji: '🐠', rarity: 'uncommon', minPoints: 10, maxPoints: 22 },
  { id: 'ca_loc', name: 'Cá Lóc', emoji: '🐟', rarity: 'uncommon', minPoints: 18, maxPoints: 35 },
  { id: 'ca_thu', name: 'Cá Thu', emoji: '🐟', rarity: 'uncommon', minPoints: 15, maxPoints: 30 },
  // rare ~35–110
  { id: 'ca_ngu', name: 'Cá Ngừ', emoji: '🐟', rarity: 'rare', minPoints: 40, maxPoints: 90 },
  { id: 'ca_hoi', name: 'Cá Hồi', emoji: '🐠', rarity: 'rare', minPoints: 45, maxPoints: 100 },
  { id: 'ca_chinh', name: 'Cá Chình', emoji: '🐍', rarity: 'rare', minPoints: 50, maxPoints: 110 },
  { id: 'ca_noc', name: 'Cá Nóc', emoji: '🐡', rarity: 'rare', minPoints: 40, maxPoints: 95 },
  { id: 'muc_ong', name: 'Mực Ống', emoji: '🦑', rarity: 'rare', minPoints: 35, maxPoints: 80 },
  // epic ~120–400
  { id: 'ca_kiem', name: 'Cá Kiếm', emoji: '🐟', rarity: 'epic', minPoints: 150, maxPoints: 350 },
  { id: 'bach_tuoc', name: 'Bạch Tuộc', emoji: '🐙', rarity: 'epic', minPoints: 120, maxPoints: 300 },
  { id: 'ca_duoi', name: 'Cá Đuối', emoji: '🐟', rarity: 'epic', minPoints: 150, maxPoints: 380 },
  { id: 'rua_bien', name: 'Rùa Biển', emoji: '🐢', rarity: 'epic', minPoints: 200, maxPoints: 400 },
  // legendary ~800–2200
  { id: 'ca_map', name: 'Cá Mập', emoji: '🦈', rarity: 'legendary', minPoints: 800, maxPoints: 1800 },
  { id: 'ca_voi_xanh', name: 'Cá Voi Xanh', emoji: '🐋', rarity: 'legendary', minPoints: 1000, maxPoints: 2200 },
  { id: 'ca_heo_vang', name: 'Cá Heo Vàng', emoji: '🐬', rarity: 'legendary', minPoints: 900, maxPoints: 2000 },
  // mythic ~5.000–20.000
  { id: 'rong_bien', name: 'Rồng Biển', emoji: '🐉', rarity: 'mythic', minPoints: 5000, maxPoints: 20000 },
  { id: 'ca_than_koi', name: 'Cá Thần Koi', emoji: '🎏', rarity: 'mythic', minPoints: 6000, maxPoints: 15000 },
  { id: 'thuy_quai', name: 'Thuỷ Quái Kraken', emoji: '🦑', rarity: 'mythic', minPoints: 8000, maxPoints: 20000 },
];

export const GAME = {
  // Số người câu đồng thời trên màn hình. Đây là tham số DUY NHẤT: gửi cho overlay qua `config.slots`
  // trong message `state`, overlay tự dàn bố cục theo số này (đã thử đọc được ở cửa sổ ~590px với 24).
  maxSlots: 24,
  restMs: 1000, // nghỉ sau mỗi lần catch
  idleYieldMs: 20000, // idle quá lâu khi có hàng chờ → nhường slot
  leaderboardSize: 10,
  leaderboardThrottleMs: 500, // ≤ 2 lần/giây
  // Chống phình bộ nhớ khi LIVE nhiều giờ:
  maxTrackedUsers: 5000, // vượt ngưỡng này thì dọn người xem 0 điểm, không mồi, không ngồi/chờ, im lặng lâu
  userPruneIdleMs: 10 * 60 * 1000, // ...im lặng tối thiểu 10 phút mới bị dọn
  userPruneEveryMs: 60 * 1000, // kiểm tra tối đa 1 lần/phút
  allTimeMaxEntries: 2000, // bảng mọi thời đại chỉ giữ 2000 người điểm cao nhất (file không phình mãi)
};

const config = { RARITIES, LUCK_AFFECTED, RODS, BAITS, FISH, FREE_BAIT, GAME, BAIT_PER_GIFT_MIN, BAIT_PER_GIFT_MAX };
export default config;
