// Chế độ ?mock=1 — máy chủ giả chạy trong trình duyệt.
// Sinh message ĐÚNG schema SPEC mục 4 dưới dạng chuỗi JSON và đẩy qua cùng onRaw → handleMessage như WS thật.
//
// Tham số URL:
//   scene=crowd      : khởi đầu đông người (đầy slot + hàng chờ, đang câu dở)
//   slots=<n>        : số chỗ câu giả lập gửi trong config.slots (mặc định = DEFAULT_CONFIG.slots, khớp server/config.js)
//   legendary=<ms>   : ép một mẻ legendary sau <ms> (để demo/chụp banner)
//   mythic=<ms>      : ép một mẻ mythic sau <ms>
//   reconnect=<giây> : định kỳ gửi lại `state` (giả lập reconnect, client phải dựng lại toàn bộ)
//   rate=<hệ số>     : nhân tốc độ sinh sự kiện (mặc định 1)
//   skew=<ms>        : lệch đồng hồ "server" so với máy (mặc định 73000) để kiểm tra hiệu chỉnh serverTime

import { DEFAULT_CONFIG } from './config.js';

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const LUCK_AFFECTED = new Set(['rare', 'epic', 'legendary', 'mythic']);

// Bảng theo SPEC mục 2 (cùng số với server/config.js tại thời điểm viết).
const RODS = [
  { tier: 1, id: 'bamboo', name: 'Cần Tre', minDiamonds: 0, castMs: 9000, luck: 1.0 },
  { tier: 2, id: 'iron', name: 'Cần Sắt', minDiamonds: 5, castMs: 8000, luck: 1.15 },
  { tier: 3, id: 'silver', name: 'Cần Bạc', minDiamonds: 30, castMs: 7000, luck: 1.3 },
  { tier: 4, id: 'gold', name: 'Cần Vàng', minDiamonds: 100, castMs: 6000, luck: 1.5 },
  { tier: 5, id: 'diamond', name: 'Cần Kim Cương', minDiamonds: 500, castMs: 5000, luck: 1.8 },
  { tier: 6, id: 'legend', name: 'Cần Huyền Thoại', minDiamonds: 2000, castMs: 4000, luck: 2.2 },
];
const BAITS = [
  { tier: 1, name: 'Mồi Giun', price: 1, weights: [82, 16, 1.8, 0.18, 0.01, 0] },
  { tier: 2, name: 'Mồi Tôm', price: 2, weights: [55, 37, 7, 0.9, 0.1, 0.003] },
  { tier: 3, name: 'Mồi Mực', price: 6, weights: [22, 40, 30, 6.5, 1.4, 0.06] },
  { tier: 4, name: 'Mồi Vàng', price: 20, weights: [5, 20, 40, 27, 7, 1.1] },
  { tier: 5, name: 'Mồi Kim Cương', price: 60, weights: [0, 3, 25, 40, 25, 7] },
  { tier: 6, name: 'Mồi Huyền Thoại', price: 200, weights: [0, 0, 5, 24, 32, 39] },
];
const FISH = [
  ['ca_ro', 'Cá Rô', '🐟', 'common', 2, 8], ['ca_diec', 'Cá Diếc', '🐟', 'common', 2, 7],
  ['ca_bong', 'Cá Bống', '🐟', 'common', 1, 6], ['tep_dong', 'Tép Đồng', '🦐', 'common', 3, 10],
  ['cua_dong', 'Cua Đồng', '🦀', 'common', 4, 10], ['ung_rach', 'Ủng Rách', '👢', 'common', 0, 1],
  ['lon_nuoc', 'Lon Nước', '🥫', 'common', 0, 1],
  ['ca_chep', 'Cá Chép', '🐠', 'uncommon', 12, 25], ['ca_tram', 'Cá Trắm', '🐟', 'uncommon', 15, 30],
  ['ca_loc', 'Cá Lóc', '🐟', 'uncommon', 18, 35], ['ca_thu', 'Cá Thu', '🐟', 'uncommon', 15, 30],
  ['ca_ngu', 'Cá Ngừ', '🐟', 'rare', 40, 90], ['ca_hoi', 'Cá Hồi', '🐠', 'rare', 45, 100],
  ['ca_noc', 'Cá Nóc', '🐡', 'rare', 40, 95], ['muc_ong', 'Mực Ống', '🦑', 'rare', 35, 80],
  ['ca_kiem', 'Cá Kiếm', '🐟', 'epic', 150, 350], ['bach_tuoc', 'Bạch Tuộc', '🐙', 'epic', 120, 300],
  ['rua_bien', 'Rùa Biển', '🐢', 'epic', 200, 400],
  ['ca_map', 'Cá Mập', '🦈', 'legendary', 800, 1800], ['ca_voi_xanh', 'Cá Voi Xanh', '🐋', 'legendary', 1000, 2200],
  ['ca_heo_vang', 'Cá Heo Vàng', '🐬', 'legendary', 900, 2000],
  ['rong_bien', 'Rồng Biển', '🐉', 'mythic', 5000, 20000], ['thuy_quai', 'Thuỷ Quái Kraken', '🦑', 'mythic', 8000, 20000],
].map(([id, name, emoji, rarity, minPoints, maxPoints]) => ({ id, name, emoji, rarity, minPoints, maxPoints }));

const GIFTS = [
  { name: 'Hoa Hồng', d: 1, w: 34 }, { name: 'Kẹo Bông', d: 5, w: 20 }, { name: 'Trái Tim Tay', d: 10, w: 10 },
  { name: 'Bánh Donut', d: 30, w: 12 }, { name: 'Mũ Cao Bồi', d: 99, w: 6 }, { name: 'Vương Miện', d: 100, w: 5 },
  { name: 'Pháo Hoa', d: 500, w: 3 }, { name: 'Du Thuyền', d: 2000, w: 1 }, { name: 'Sư Tử Vàng', d: 5000, w: 0.4 },
];

const NAMES = [
  'Nguyễn Văn Anh', '🐟Cá Con Dễ Thương🐟', 'xXx_ProGamer_VN_2026_xXx', 'Bé Na 🌸', 'ʕ•ᴥ•ʔ Gấu Lười',
  'Trần Thị Bích Ngọc Hoàng Lan Phương', 'Z̷̢a̸̡l̵g̶o̷ ̸T̴ê̵n̷', 'user8823410097', 'Mèo Mập', 'Anh Bảy Câu Cá',
  'سارة', '李小龙', 'Hùng Dũng', 'Thuỳ Linh 💕', 'Long Rồng 🐉', 'Tí Nị', 'Đức Phúc', '🔥🔥🔥🔥🔥🔥🔥',
  'Minh Châu', 'Ông Già Biển Cả', 'Cô Ba Sài Gòn', 'Khánh Vy', 'Tuấn Hưng', 'Ngọc Trinh', 'Bảo Bối 👨‍👩‍👧',
  'Vịt Bầu', 'Sóc Nâu', 'Chú Cuội', 'Hằng Nga', '‮Đảo ngược‮', 'Lão Ngư', 'Hải Đăng', 'Út Cưng', 'Rô Phi Fan',
];

function svgAvatar(seed) {
  const h = seed % 360;
  const skin = ['#f6d3b8', '#e9b88f', '#c98e62', '#8d5a3b'][seed % 4];
  const hair = ['#2b1d14', '#5a3a1e', '#d9a441', '#1d1d2b', '#b0413e'][seed % 5];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
    `<rect width="128" height="128" fill="hsl(${h},70%,58%)"/>` +
    `<rect y="104" width="128" height="24" fill="hsl(${(h + 180) % 360},60%,40%)"/>` +
    `<circle cx="64" cy="70" r="36" fill="${skin}"/>` +
    `<path d="M26 66 Q30 22 64 24 Q98 22 102 66 Q92 42 64 42 Q36 42 26 66Z" fill="${hair}"/>` +
    `<circle cx="51" cy="72" r="4.5" fill="#222"/><circle cx="77" cy="72" r="4.5" fill="#222"/>` +
    `<path d="M50 88 Q64 100 78 88" stroke="#222" stroke-width="4" fill="none" stroke-linecap="round"/></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
function avatarFor(i) {
  if (i % 7 === 3) return 'https://p16-sign.tiktokcdn.invalid/avatar-loi.jpeg'; // lỗi DNS → fallback
  if (i % 7 === 5) return '/khong-ton-tai-avatar.png'; // 404 → fallback
  if (i % 11 === 9) return ''; // không có avatar
  return svgAvatar(i * 47 + 13);
}

const rnd = (a, b) => a + Math.random() * (b - a);
const rndInt = (a, b) => Math.floor(rnd(a, b + 1));
function weighted(items, wf) {
  let s = 0;
  for (const it of items) s += wf(it);
  let r = Math.random() * s;
  for (const it of items) { r -= wf(it); if (r <= 0) return it; }
  return items[items.length - 1];
}

export function startMock(onRaw, params) {
  const SKEW = Number(params.get('skew') ?? 73000);
  const RATE = Math.max(0.1, Number(params.get('rate') || 1));
  const now = () => Date.now() + SKEW;
  const send = (m) => onRaw(JSON.stringify(m));
  const t0 = Date.now();

  const users = new Map();
  const SLOTS = Math.max(1, Math.min(60, Math.round(Number(params.get('slots'))) || DEFAULT_CONFIG.slots));
  const slots = new Array(SLOTS).fill(null);
  const queue = [];
  let seq = 0, nameIdx = 0;
  let lbDirty = false, lastLb = 0, lbTimer = null;
  let forced = [];
  const status = { tiktok: 'connected', username: 'hocauca_demo', viewers: 1287, message: 'Đang chạy chế độ giả lập', queueLength: 0 };
  const allTimeSeed = [
    ['legend_1', 'Vua Câu Cá Miền Tây', 158340, 6, { name: 'Rồng Biển', emoji: '🐉', points: 18420 }],
    ['legend_2', 'Cô Tư Bến Tre', 97210, 5, { name: 'Cá Voi Xanh', emoji: '🐋', points: 2140 }],
    ['legend_3', 'Ngư Ông Đất Mũi', 64300, 5, { name: 'Cá Mập', emoji: '🦈', points: 1790 }],
    ['legend_4', 'Bé Bông', 21050, 4, { name: 'Rùa Biển', emoji: '🐢', points: 398 }],
    ['legend_5', 'Tèo Em', 8800, 3, { name: 'Cá Hồi', emoji: '🐠', points: 99 }],
  ].map(([userId, nickname, score, rodTier, bestCatch], i) => ({ userId, nickname, avatarUrl: avatarFor(i + 20), score, rodTier, bestCatch }));

  const baitTotal = (u) => Object.values(u.bait).reduce((a, b) => a + b, 0);
  const view = (u) => ({
    userId: u.userId, nickname: u.nickname, avatarUrl: u.avatarUrl, slot: u.slot, rodTier: u.rodTier,
    bait: { ...u.bait }, baitTotal: baitTotal(u), score: u.score,
    state: u.slot === null ? 'waiting' : u.state, castEndsAt: u.state === 'casting' ? u.castEndsAt : null,
  });
  const sendPlayer = (u) => send({ type: 'player', player: view(u) });

  function rank(list) {
    return list.sort((a, b) => b.score - a.score).slice(0, 10).map((e, i) => ({
      rank: i + 1, userId: e.userId, nickname: e.nickname, avatarUrl: e.avatarUrl, score: e.score, rodTier: e.rodTier, bestCatch: e.bestCatch,
    }));
  }
  const sessionLb = () => rank([...users.values()].filter((u) => u.score > 0));
  function allTimeLb() {
    const m = new Map(allTimeSeed.map((e) => [e.userId, { ...e }]));
    for (const u of users.values()) if (u.score > 0) {
      const prev = m.get(u.userId);
      m.set(u.userId, { ...u, score: (prev?.score || 0) + u.score });
    }
    return rank([...m.values()]);
  }
  function markLb() {
    lbDirty = true;
    if (lbTimer) return;
    const wait = Math.max(0, 500 - (Date.now() - lastLb));
    lbTimer = setTimeout(() => {
      lbTimer = null; lbDirty = false; lastLb = Date.now();
      send({ type: 'leaderboard', leaderboard: sessionLb(), allTime: allTimeLb() });
    }, wait);
  }
  function sendStatus() {
    status.queueLength = queue.length;
    send({ type: 'status', status: { ...status } });
  }
  function snapshot() {
    const players = [];
    for (const id of slots) if (id) players.push(view(users.get(id)));
    for (const id of queue) players.push(view(users.get(id)));
    status.queueLength = queue.length;
    return {
      type: 'state', players, leaderboard: sessionLb(), allTime: allTimeLb(), status: { ...status },
      config: {
        slots: SLOTS, rods: RODS.map((r) => ({ ...r })), baits: BAITS.map(({ tier, name, price }) => ({ tier, name, price })), fish: FISH,
        free: { firstComment: 2, follow: 3, share: 2, likesPerBait: 30 },
      },
      serverTime: now(),
    };
  }

  function newUser() {
    const i = nameIdx++;
    const base = NAMES[i % NAMES.length];
    const nickname = i < NAMES.length ? base : `${base} ${Math.floor(i / NAMES.length) + 1}`;
    const u = {
      userId: 'mock_' + i, nickname, avatarUrl: avatarFor(i), slot: null, rodTier: 1,
      bait: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }, score: 0, state: 'idle', castEndsAt: null, castTier: 1,
      restUntil: 0, idleSince: now(), likes: 0, likeAwarded: 0, commented: false, followed: false, bestCatch: null, timer: null, qseq: 0,
    };
    users.set(u.userId, u);
    return u;
  }

  function sortQueue() {
    queue.sort((a, b) => users.get(b).rodTier - users.get(a).rodTier || users.get(a).qseq - users.get(b).qseq);
  }
  function seat(u, s) {
    slots[s] = u.userId; u.slot = s; u.state = 'idle'; u.idleSince = now(); u.restUntil = 0;
    send({ type: 'toast', kind: 'join', text: `${u.nickname} đã vào chỗ câu!` });
  }
  function afterBait(u) {
    if (u.slot === null && !queue.includes(u.userId)) {
      const free = slots.indexOf(null);
      if (free !== -1 && queue.length === 0) { seat(u, free); if (!tryCast(u)) sendPlayer(u); }
      else {
        u.qseq = ++seq; queue.push(u.userId); sortQueue();
        send({ type: 'toast', kind: 'join', text: `${u.nickname} đang xếp hàng chờ chỗ câu` });
        sendPlayer(u); sendStatus();
      }
    } else if (u.slot !== null) { if (!tryCast(u)) sendPlayer(u); }
    else { sortQueue(); sendPlayer(u); }
  }
  function tryCast(u) {
    if (u.slot === null || u.state === 'casting' || now() < u.restUntil) return false;
    let tier = 0;
    for (let t = 6; t >= 1; t--) if (u.bait[t] > 0) { tier = t; break; }
    if (!tier) return false;
    u.bait[tier]--;
    const dur = RODS[u.rodTier - 1].castMs;
    u.state = 'casting'; u.castTier = tier; u.castEndsAt = now() + dur;
    send({ type: 'cast', userId: u.userId, slot: u.slot, baitTier: tier, durationMs: dur, endsAt: u.castEndsAt });
    sendPlayer(u);
    clearTimeout(u.timer);
    u.timer = setTimeout(() => doCatch(u), dur);
    return true;
  }
  function roll(u) {
    if (forced.length) return forced.shift();
    const luck = RODS[u.rodTier - 1].luck;
    const w = BAITS[u.castTier - 1].weights.map((x, i) => x * (LUCK_AFFECTED.has(RARITIES[i]) ? luck : 1));
    const idx = weighted(RARITIES.map((_, i) => i), (i) => w[i]);
    return RARITIES[idx];
  }
  function doCatch(u, forceRarity) {
    if (!users.has(u.userId) || u.slot === null || u.state !== 'casting') return;
    clearTimeout(u.timer);
    const rarity = forceRarity || roll(u);
    const fish = weighted(FISH.filter((f) => f.rarity === rarity), () => 1);
    const points = rndInt(fish.minPoints, fish.maxPoints);
    u.score += points;
    const isBest = !u.bestCatch || points > u.bestCatch.points;
    if (isBest) u.bestCatch = { name: fish.name, emoji: fish.emoji, points };
    u.state = 'idle'; u.castEndsAt = null; u.restUntil = now() + 1000; u.idleSince = now();
    send({ type: 'catch', userId: u.userId, slot: u.slot, fish: { id: fish.id, name: fish.name, emoji: fish.emoji, rarity }, points, score: u.score, isBest });
    sendPlayer(u);
    markLb();
    setTimeout(() => { if (users.has(u.userId) && !tryCast(u)) { u.idleSince = now(); sendPlayer(u); } }, 1000);
  }
  function manageSlots() {
    if (!queue.length) return;
    for (let s = 0; s < slots.length && queue.length; s++) {
      const id = slots[s];
      if (!id) continue;
      const u = users.get(id);
      if (u.state !== 'casting' && baitTotal(u) === 0 && now() - u.idleSince >= 20000) {
        slots[s] = null; u.slot = null; u.state = 'idle';
        send({ type: 'player_leave', userId: u.userId, slot: s });
      }
    }
    let free = slots.indexOf(null);
    let changed = false;
    while (free !== -1 && queue.length) {
      sortQueue();
      const u = users.get(queue.shift());
      seat(u, free);
      if (!tryCast(u)) sendPlayer(u);
      free = slots.indexOf(null);
      changed = true;
    }
    if (changed) sendStatus();
  }

  // ----- sự kiện TikTok giả -----
  function addBait(u, tier, n) { u.bait[tier] = (u.bait[tier] || 0) + n; afterBait(u); }
  function randomUser(preferExisting = 0.7) {
    const list = [...users.values()];
    if (list.length && (Math.random() < preferExisting || list.length > SLOTS + 22)) return list[rndInt(0, list.length - 1)];
    return newUser();
  }
  function gift(u, g, repeat) {
    const total = g.d * repeat;
    let tier = 1;
    for (const r of RODS) if (total >= r.minDiamonds) tier = r.tier;
    const upgraded = tier > u.rodTier;
    if (upgraded) u.rodTier = tier;
    const baitCount = Math.min(50, Math.max(1, Math.ceil(total / BAITS[tier - 1].price)));
    send({
      type: 'gift', userId: u.userId, nickname: u.nickname, avatarUrl: u.avatarUrl, giftName: g.name,
      diamonds: total, rodTier: u.rodTier, rodUpgraded: upgraded, baitTier: tier, baitCount,
    });
    addBait(u, tier, baitCount);
  }
  function randomEvent() {
    const r = Math.random();
    if (r < 0.3) {
      const u = randomUser(0.4);
      if (!u.commented) { u.commented = true; addBait(u, 1, 2); }
    } else if (r < 0.52) {
      const u = randomUser(0.85);
      u.likes += rndInt(5, 25);
      const earn = Math.floor(u.likes / 30) - u.likeAwarded;
      if (earn > 0) { u.likeAwarded += earn; addBait(u, 1, earn); }
    } else if (r < 0.6) {
      const u = randomUser(0.6);
      if (!u.followed) {
        u.followed = true;
        send({ type: 'toast', kind: 'follow', text: `${u.nickname} đã theo dõi! +3 mồi` });
        addBait(u, 1, 3);
      }
    } else if (r < 0.65) {
      const u = randomUser(0.8);
      send({ type: 'toast', kind: 'share', text: `${u.nickname} đã chia sẻ LIVE! +2 mồi` });
      addBait(u, 1, 2);
    } else {
      const u = randomUser(0.65);
      const g = weighted(GIFTS, (x) => x.w);
      gift(u, g, g.d <= 5 ? rndInt(1, 6) : 1);
    }
  }

  // ----- dữ liệu khởi đầu -----
  function seed(n, crowd) {
    for (let i = 0; i < n; i++) {
      const u = newUser();
      u.rodTier = crowd ? [1, 1, 2, 3, 1, 4, 2, 5, 1, 3, 6, 2, 1, 4, 3][i % 15] : rndInt(1, 3);
      u.bait[u.rodTier] = rndInt(3, 20);
      u.bait[1] += rndInt(0, 5);
      u.score = crowd ? Math.round(rnd(0, 1) ** 2 * 6000) : rndInt(0, 300);
      if (u.score > 0) u.bestCatch = { ...[{ name: 'Cá Chép', emoji: '🐠', points: 25 }, { name: 'Cá Ngừ', emoji: '🐟', points: 88 }, { name: 'Bạch Tuộc', emoji: '🐙', points: 290 }][i % 3] };
      if (i === 4 && crowd) { u.bait = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }; } // một người hết mồi
      const free = slots.indexOf(null);
      if (free !== -1) {
        u.slot = free; slots[free] = u.userId;
        if (baitTotal(u) > 0) {
          let tier = 0;
          for (let t = 6; t >= 1; t--) if (u.bait[t] > 0) { tier = t; break; }
          u.bait[tier]--;
          const dur = RODS[u.rodTier - 1].castMs;
          u.state = 'casting'; u.castTier = tier; u.castEndsAt = now() + rnd(0.15, 1) * dur;
          u.timer = setTimeout(() => doCatch(u), u.castEndsAt - now());
        }
      } else { u.qseq = ++seq; queue.push(u.userId); }
    }
    sortQueue();
  }

  const crowd = params.get('scene') === 'crowd';
  seed(crowd ? SLOTS + 5 : 6, crowd);

  setTimeout(() => send(snapshot()), 60);

  // Vòng sinh sự kiện ngẫu nhiên
  (function loop() {
    if (Date.now() - t0 > 400) randomEvent();
    setTimeout(loop, rnd(350, 1300) / RATE);
  })();
  setInterval(manageSlots, 1000);
  setInterval(() => {
    status.viewers = Math.max(50, status.viewers + rndInt(-40, 55));
    sendStatus();
  }, 5000);

  // Ép mẻ hiếm để demo/chụp ảnh
  function forceCatch(rarity) {
    const casting = [...users.values()].filter((u) => u.slot !== null && u.state === 'casting');
    if (casting.length) doCatch(casting[rndInt(0, casting.length - 1)], rarity);
    else forced.push(rarity);
  }
  for (const r of ['legendary', 'mythic']) {
    const ms = Number(params.get(r));
    if (Number.isFinite(ms) && params.has(r)) setTimeout(() => forceCatch(r), ms);
  }
  // Mỗi ~70s demo có một mẻ cực hiếm cho sinh động (chỉ khi không ép thủ công)
  if (!params.has('legendary') && !params.has('mythic') && params.get('showcase') !== '0') {
    setInterval(() => forceCatch(Math.random() < 0.7 ? 'legendary' : 'mythic'), 70000);
  }
  const rc = Number(params.get('reconnect'));
  if (rc > 0) setInterval(() => send(snapshot()), rc * 1000);

  // Hook cho kiểm thử thủ công từ console
  window.__mock = { users, slots, queue, forceCatch, snapshot: () => send(snapshot()), gift: (d) => gift(randomUser(0.5), { name: 'Quà Test', d }, 1) };
}
