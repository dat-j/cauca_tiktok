import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, convertGift, tierForDiamonds, seededRng, rarityDistribution, expectedPointsPerCast } from '../server/game.js';
import config from '../server/config.js';

function setup({ seed = 42, start = 1_000_000 } = {}) {
  const clock = { t: start };
  const msgs = [];
  const game = new Game({ now: () => clock.t, rng: seededRng(seed), emit: (m) => msgs.push(m) });
  const advance = (ms, step = 100) => {
    const end = clock.t + ms;
    while (clock.t < end) {
      clock.t = Math.min(end, clock.t + step);
      game.tick();
    }
  };
  return { game, clock, msgs, advance };
}

const gift = (userId, diamonds, repeatCount = 1) => ({ type: 'gift', userId, nickname: userId, diamonds, repeatCount, giftName: 'Quà' });

test('quy đổi kim cương → tier tại các ngưỡng biên', () => {
  const cases = [
    [0, 1], [1, 1], [4, 1], [5, 2], [29, 2], [30, 3], [99, 3], [100, 4], [499, 4], [500, 5], [1999, 5], [2000, 6], [100000, 6],
  ];
  for (const [d, tier] of cases) assert.equal(tierForDiamonds(d), tier, `${d} kim cương → tier ${tier}`);
});

test('quy đổi số mồi: clamp(ceil(d/giá), 1, 50)', () => {
  const cases = [
    [1, 1, 1], [4, 1, 4], [5, 2, 3], [6, 2, 3], [29, 2, 15], [30, 3, 5], [31, 3, 6], [99, 3, 17],
    [100, 4, 5], [499, 4, 25], [500, 5, 9], [1999, 5, 34], [2000, 6, 10], [10000, 6, 50], [10001, 6, 50], [50000, 6, 50],
  ];
  for (const [d, tier, count] of cases) assert.deepEqual(convertGift(d), { tier, baitCount: count }, `${d} kim cương`);
  assert.deepEqual(convertGift(0), { tier: 1, baitCount: 1 }, 'tối thiểu 1 mồi');
});

test('gift dùng diamonds × repeatCount; cần chỉ nâng lên, không hạ', () => {
  const { game, msgs } = setup();
  game.handleEvent(gift('a', 1, 5)); // 5 kim cương → tier 2
  let g = msgs.filter((m) => m.type === 'gift').at(-1);
  assert.equal(g.diamonds, 5);
  assert.equal(g.rodTier, 2);
  assert.equal(g.rodUpgraded, true);
  assert.equal(g.baitTier, 2);
  assert.equal(g.baitCount, 3);
  game.handleEvent(gift('a', 1)); // 1 kim cương → mồi tier 1 nhưng cần giữ tier 2
  g = msgs.filter((m) => m.type === 'gift').at(-1);
  assert.equal(g.rodTier, 2);
  assert.equal(g.rodUpgraded, false);
  assert.equal(g.baitTier, 1);
  assert.equal(g.baitCount, 1);
});

test('chuỗi message: gift → player → cast → catch → leaderboard', () => {
  const { game, msgs, advance } = setup();
  game.handleEvent(gift('a', 100));
  const types = msgs.map((m) => m.type).filter((t) => t !== 'toast' && t !== '_queue');
  assert.deepEqual(types.slice(0, 3), ['gift', 'player', 'cast']);
  const cast = msgs.find((m) => m.type === 'cast');
  assert.equal(cast.durationMs, 6000); // Cần Vàng
  assert.equal(cast.baitTier, 4);
  assert.equal(cast.slot, 0);
  advance(6100);
  const iCatch = msgs.findIndex((m) => m.type === 'catch');
  const iLb = msgs.findIndex((m) => m.type === 'leaderboard');
  assert.ok(iCatch > 0 && iLb > iCatch);
  const c = msgs[iCatch];
  assert.equal(c.userId, 'a');
  assert.equal(c.score, c.points);
  assert.equal(c.isBest, c.points > 0);
  assert.equal(msgs[iLb].leaderboard[0].userId, 'a');
  assert.equal(msgs[iLb].leaderboard[0].rank, 1);
});

test('tiêu mồi tier cao trước', () => {
  const { game, msgs, advance } = setup();
  game.handleEvent({ type: 'follow', userId: 'a', nickname: 'A' }); // +3 mồi tier1, quăng ngay 1 cái tier1
  game.handleEvent(gift('a', 30)); // +5 mồi tier3, cần bạc
  game.handleEvent(gift('a', 5)); // +3 mồi tier2
  advance(120000);
  const tiers = msgs.filter((m) => m.type === 'cast').map((m) => m.baitTier);
  assert.deepEqual(tiers, [1, 3, 3, 3, 3, 3, 2, 2, 2, 1, 1]);
  const last = msgs.filter((m) => m.type === 'player').at(-1).player;
  assert.equal(last.baitTotal, 0);
  assert.equal(last.state, 'idle');
});

test('vòng câu: thời gian câu theo cần + nghỉ 1s giữa các lần', () => {
  const { game, msgs, advance, clock } = setup();
  const t0 = clock.t;
  game.handleEvent(gift('a', 2000)); // Cần Huyền Thoại 4s
  advance(20000, 50);
  const casts = msgs.filter((m) => m.type === 'cast');
  assert.equal(casts[0].endsAt, t0 + 4000);
  assert.ok(casts[1].endsAt - casts[0].endsAt >= 5000 && casts[1].endsAt - casts[0].endsAt <= 5100);
});

test('like tích luỹ: mỗi 30 like → +1 mồi', () => {
  const { game, msgs } = setup();
  const like = (count) => game.handleEvent({ type: 'like', userId: 'l', nickname: 'L', count });
  like(10);
  like(19);
  assert.equal(msgs.filter((m) => m.type === 'cast').length, 0, '29 like chưa đủ');
  like(1);
  assert.equal(msgs.filter((m) => m.type === 'cast').length, 1, '30 like → 1 mồi → quăng');
  like(65); // tổng dư 65 → +2 mồi, dư 5
  const p = msgs.filter((m) => m.type === 'player').at(-1).player;
  assert.equal(p.bait['1'], 2);
  like(25); // 5 + 25 = 30 → +1
  assert.equal(msgs.filter((m) => m.type === 'player').at(-1).player.bait['1'], 3);
});

test('mồi miễn phí: comment đầu +2 (1 lần), follow +3 (1 lần), share +2', () => {
  const { game } = setup();
  game.handleEvent({ type: 'chat', userId: 'c', nickname: 'C', comment: 'hi' });
  game.handleEvent({ type: 'chat', userId: 'c', nickname: 'C', comment: 'hi again' });
  const u = game.users.get('c');
  assert.equal(game.playerView(u).baitTotal + (u.state === 'casting' ? 1 : 0), 2);
  game.handleEvent({ type: 'follow', userId: 'c', nickname: 'C' });
  game.handleEvent({ type: 'follow', userId: 'c', nickname: 'C' });
  assert.equal(game.playerView(u).baitTotal + 1, 5);
  game.handleEvent({ type: 'share', userId: 'c', nickname: 'C' });
  assert.equal(game.playerView(u).baitTotal + 1, 7);
});

const SLOTS = config.GAME.maxSlots;

test('số slot là MỘT tham số (GAME.maxSlots) và được gửi cho overlay qua config.slots', () => {
  assert.ok(Number.isInteger(SLOTS) && SLOTS >= 18, `maxSlots=${SLOTS} phải ≥ 18`);
  const { game } = setup();
  assert.equal(game.slots.length, SLOTS);
  assert.equal(game.snapshot().config.slots, SLOTS);
  // engine đọc từ config, không hard-code: config tuỳ chỉnh → đúng số đó
  const custom = { ...config, GAME: { ...config.GAME, maxSlots: 5 } };
  const g2 = new Game({ config: custom, now: () => 0, rng: seededRng(1) });
  for (let i = 0; i < 8; i++) g2.handleEvent(gift(`c${i}`, 1));
  assert.equal(g2.snapshot().config.slots, 5);
  const seated = g2.players().filter((p) => p.slot !== null);
  assert.equal(seated.length, 5);
  assert.ok(seated.every((p) => p.slot >= 0 && p.slot < 5));
  assert.equal(g2.queueLength, 3);
});

test(`slot tối đa ${SLOTS} (GAME.maxSlots), hàng chờ ưu tiên rod tier cao rồi FIFO, idle >20s nhường slot`, () => {
  const { game, msgs, advance } = setup();
  for (let i = 0; i < SLOTS; i++) game.handleEvent(gift(`p${i}`, 1)); // mỗi người 1 mồi
  const seatedNow = game.players().filter((p) => p.slot !== null);
  assert.equal(seatedNow.length, SLOTS);
  assert.deepEqual(seatedNow.map((p) => p.slot).sort((a, b) => a - b), Array.from({ length: SLOTS }, (_, i) => i));
  game.handleEvent(gift('q1', 1)); // chờ, tier 1
  game.handleEvent(gift('q2', 30)); // chờ, tier 3 → ưu tiên
  game.handleEvent(gift('q3', 1)); // chờ, tier 1
  assert.equal(game.queueLength, 3);
  const waiting = game.players().filter((p) => p.slot === null);
  assert.deepEqual(waiting.map((p) => p.userId), ['q2', 'q1', 'q3']);
  assert.ok(waiting.every((p) => p.state === 'waiting'));
  assert.ok(msgs.some((m) => m.type === '_queue' && m.queueLength === 3));

  // sau 9s câu xong, hết mồi → idle. Chưa đủ 20s idle → chưa nhường.
  advance(9000 + 19000);
  assert.equal(msgs.filter((m) => m.type === 'player_leave').length, 0);
  advance(2000);
  const leaves = msgs.filter((m) => m.type === 'player_leave');
  assert.equal(leaves.length, 3);
  // người vào slot theo thứ tự ưu tiên
  const seated = game.players().filter((p) => p.slot !== null).map((p) => p.userId);
  assert.ok(['q1', 'q2', 'q3'].every((id) => seated.includes(id)));
  assert.equal(game.slots[leaves[0].slot], 'q2');
  assert.equal(game.slots[leaves[1].slot], 'q1');
  assert.equal(game.slots[leaves[2].slot], 'q3');
  assert.equal(game.queueLength, 0);
  assert.equal(game.players().length, SLOTS);
});

test('người idle không bị đá khi không có hàng chờ', () => {
  const { game, msgs, advance } = setup();
  game.handleEvent(gift('a', 1));
  advance(120000, 500);
  assert.equal(msgs.filter((m) => m.type === 'player_leave').length, 0);
  assert.equal(game.players()[0].state, 'idle');
});

test('leaderboard throttle ≤ 2 lần/giây', () => {
  const { game, clock, advance } = setup();
  const times = [];
  let catches = 0;
  game.emit = (m) => {
    if (m.type === 'leaderboard') times.push(clock.t);
    if (m.type === 'catch') catches++;
  };
  for (let i = 0; i < SLOTS; i++) game.handleEvent(gift(`p${i}`, 2000)); // đủ slot × 10 mồi, cần 4s
  advance(60000, 10);
  assert.equal(catches, SLOTS * 10);
  assert.ok(times.length > 5);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 500, `khoảng cách ${times[i] - times[i - 1]}ms`);
});

test('phân phối độ hiếm: luck chỉ tăng rare+ và tổng = 1', () => {
  for (let t = 1; t <= 6; t++) {
    const d = rarityDistribution(t, t);
    const sum = Object.values(d).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  }
  const base = rarityDistribution(3, 1);
  const lucky = rarityDistribution(3, 6);
  assert.ok(lucky.rare > base.rare && lucky.mythic > base.mythic && lucky.common < base.common);
});

// Mô phỏng (rng có seed): điểm kỳ vọng / kim cương phải TĂNG theo tier.
// Tặng quà đúng ngưỡng của tier (người mới, cần = tier đó), câu hết mồi, chia điểm cho kim cương.
function simulatePointsPerDiamond(diamonds, trials, seed) {
  const clock = { t: 0 };
  let points = 0;
  const game = new Game({ now: () => clock.t, rng: seededRng(seed), emit: (m) => { if (m.type === 'catch') points += m.points; } });
  for (let i = 0; i < trials; i++) {
    game.reset('session');
    game.handleEvent(gift('sim', diamonds));
    // nhảy thẳng tới mốc hẹn giờ tiếp theo cho nhanh, tới khi câu hết mồi
    for (;;) {
      const u = game.users.get('sim');
      if (u.state !== 'casting' && game.playerView(u).baitTotal === 0) break;
      clock.t = Math.max(clock.t, game.nextDueAt());
      game.tick();
    }
  }
  return points / (diamonds * trials);
}

test('kỳ vọng điểm/kim cương tăng theo tier (mô phỏng seed cố định)', () => {
  const thresholds = [1, 5, 30, 100, 500, 2000];
  const trials = [6000, 3000, 2000, 1500, 1200, 1000];
  const ratios = thresholds.map((d, i) => simulatePointsPerDiamond(d, trials[i], 1234 + i));
  for (let i = 1; i < ratios.length; i++) {
    assert.ok(ratios[i] > ratios[i - 1], `tier ${i + 1} (${ratios[i].toFixed(2)}) phải > tier ${i} (${ratios[i - 1].toFixed(2)})`);
  }
});

test('kỳ vọng điểm/kim cương (giải tích): mọi mức quà 1..10000 kim cương, tier cao luôn ≥ mọi mức của tier thấp', () => {
  const band = {};
  for (let d = 1; d <= 10000; d++) {
    const { tier, baitCount } = convertGift(d);
    const r = (expectedPointsPerCast(tier, tier) * baitCount) / d;
    const b = (band[tier] ||= { min: Infinity, max: -Infinity });
    b.min = Math.min(b.min, r);
    b.max = Math.max(b.max, r);
  }
  for (let t = 2; t <= 6; t++) assert.ok(band[t].min > band[t - 1].max, `tier ${t} min ${band[t].min.toFixed(2)} > tier ${t - 1} max ${band[t - 1].max.toFixed(2)}`);
});

test('mọi loài cá hợp lệ, ≥24 loài, đủ 6 độ hiếm', () => {
  assert.ok(config.FISH.filter((f) => !f.junk).length >= 24);
  for (const r of config.RARITIES) assert.ok(config.FISH.some((f) => f.rarity === r), r);
  const ids = new Set();
  for (const f of config.FISH) {
    assert.ok(!ids.has(f.id));
    ids.add(f.id);
    assert.ok(f.minPoints <= f.maxPoints);
  }
});
