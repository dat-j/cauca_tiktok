// Độ bền khi chạy LIVE nhiều giờ + payload lạ (thêm bởi bước tích hợp/QA).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Game, seededRng } from '../server/game.js';
import config from '../server/config.js';
import { TikTokAdapter } from '../server/tiktok.js';
import { createServer } from '../server/index.js';

function setup() {
  const clock = { t: 1_000_000 };
  const msgs = [];
  const game = new Game({ now: () => clock.t, rng: seededRng(7), emit: (m) => msgs.push(m) });
  return { game, clock, msgs };
}

test('publicConfig gửi kèm free (mồi miễn phí) lấy từ server/config.js', () => {
  const { game } = setup();
  const c = game.snapshot().config;
  assert.deepEqual(c.free, {
    firstComment: config.FREE_BAIT.firstComment,
    follow: config.FREE_BAIT.follow,
    share: config.FREE_BAIT.share,
    likesPerBait: config.FREE_BAIT.likesPerBait,
  });
});

test('map người chơi không phình vô hạn: dọn người xem 0 điểm, im lặng lâu khi vượt ngưỡng', () => {
  const { game, clock } = setup();
  const G = config.GAME;
  // 1 người có điểm + 1 người đang có mồi (đang ngồi câu) phải được giữ.
  game.handleEvent({ type: 'gift', userId: 'vip', nickname: 'VIP', diamonds: 100 });
  // Rất nhiều người chỉ like lẻ (<30 like → không có mồi).
  for (let i = 0; i < G.maxTrackedUsers + 500; i++) game.handleEvent({ type: 'like', userId: 'lurker' + i, count: 1 });
  assert.ok(game.users.size > G.maxTrackedUsers);
  // Chưa đủ thời gian im lặng → chưa dọn.
  assert.equal(game.pruneUsers(clock.t + 1000), 0);
  clock.t += G.userPruneIdleMs + 1;
  game.handleEvent({ type: 'like', userId: 'lurker0', count: 1 }); // vừa tương tác lại → giữ
  game.tick(); // tick tự gọi prune (đã quá userPruneEveryMs)
  assert.ok(game.users.has('vip'));
  assert.ok(game.users.has('lurker0'));
  assert.ok(!game.users.has('lurker1'));
  assert.ok(game.users.size < 10);
});

test('không dọn khi số người dưới ngưỡng (giữ cờ comment/follow trong phiên)', () => {
  const { game, clock } = setup();
  game.handleEvent({ type: 'follow', userId: 'a' });
  clock.t += 3_600_000;
  game.tick();
  assert.equal(game.pruneUsers(), 0);
  assert.ok(game.users.get('a').followed);
});

test('bảng mọi thời đại bị cắt về allTimeMaxEntries người điểm cao nhất', () => {
  const max = 20;
  const cfg = { ...config, GAME: { ...config.GAME, allTimeMaxEntries: max } };
  const allTime = {};
  for (let i = 0; i < 30; i++) allTime['u' + i] = { userId: 'u' + i, nickname: 'u' + i, avatarUrl: '', score: 1000 + i, rodTier: 1, bestCatch: null };
  const clock = { t: 1_000_000 };
  let saved = null;
  const game = new Game({ config: cfg, now: () => clock.t, rng: seededRng(3), allTime, onAllTimeChange: (a) => (saved = a) });
  game.handleEvent({ type: 'gift', userId: 'new', diamonds: 1 });
  for (let i = 0; i < 20; i++) { clock.t += 500; game.tick(); }
  assert.ok(saved, 'đã ghi all-time');
  assert.equal(Object.keys(saved).length, max);
  assert.ok(saved.u29 && !saved.u0, 'giữ người điểm cao, bỏ người điểm thấp');
});

test('tập msgId chống trùng của adapter TikTok có giới hạn', () => {
  const a = new TikTokAdapter({ log: { warn() {}, error() {}, info() {} } });
  for (let i = 0; i < 20000; i++) a._dup({ common: { msgId: String(i + 1) } });
  assert.ok(a.seenMsg.size <= 5001, `size=${a.seenMsg.size}`);
  assert.equal(a._dup({ common: { msgId: '20000' } }), true, 'msg gần đây vẫn bị chặn trùng');
});

test('HTTP API không crash với payload lạ; reset phát lại state', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishing-test-'));
  const tiktok = Object.assign(new EventEmitter(), { connect: async () => ({ ok: false, invalid: true, error: 'x' }), disconnect: async () => {} });
  const quiet = { info() {}, warn() {}, error() {} };
  const srv = createServer({ port: 0, dataFile: path.join(dir, 'lb.json'), tiktok, log: quiet });
  const addr = await srv.start();
  const base = `http://127.0.0.1:${addr.port}`;
  const post = (p, body, raw) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify(body) });
  try {
    const weird = [
      null, [], 'x', 42, {}, { type: 'gift' }, { type: '__proto__', userId: 'a' },
      { type: 'gift', userId: 'a', diamonds: -5 }, { type: 'gift', userId: 'a', diamonds: 1e12 },
      { type: 'gift', userId: 'a', diamonds: 'NaN' }, { type: 'gift', userId: { $ne: 1 }, diamonds: 1 },
      { type: 'like', userId: 'a', count: Infinity }, { type: 'chat', userId: 'a', comment: { x: 1 } },
      { type: 'gift', userId: 'a', diamonds: 1, avatarUrl: 'javascript:alert(1)' },
      { type: 'follow', userId: 'x'.repeat(10000) },
    ];
    for (const b of weird) {
      const r = await post('/api/simulate', b);
      assert.equal(r.status, 400, JSON.stringify(b)?.slice(0, 80));
    }
    assert.equal((await post('/api/simulate', null, '{hỏng')).status, 400);
    assert.equal((await post('/api/simulate', null, '{"a":"' + 'x'.repeat(40000) + '"}')).status, 413);
    assert.equal((await post('/api/simulate/burst', { players: 1e9 })).status, 400);
    assert.equal((await post('/api/reset', { scope: 'everything' })).status, 400);
    // Tên chứa HTML được giữ nguyên dạng chữ (client không chèn bằng innerHTML).
    const ok = await post('/api/simulate', { type: 'gift', userId: 'h', nickname: '<img src=x onerror=alert(1)>', diamonds: 5 });
    assert.equal(ok.status, 200);
    const st = await (await fetch(base + '/api/state')).json();
    assert.equal(st.players[0].nickname, '<img src=x onerror=alert(1)>');
    // reset → server phát lại `state` rỗng qua WS
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws`);
    const got = [];
    await new Promise((res, rej) => { ws.onmessage = (e) => { got.push(JSON.parse(e.data)); if (got.length === 1) res(); }; ws.onerror = rej; });
    assert.equal(got[0].type, 'state');
    assert.equal(got[0].players.length, 1);
    await post('/api/reset', { scope: 'session' });
    await new Promise((r) => setTimeout(r, 100));
    const st2 = got.filter((m) => m.type === 'state').at(-1);
    assert.equal(got.filter((m) => m.type === 'state').length, 2);
    assert.equal(st2.players.length, 0);
    ws.close();
  } finally {
    await srv.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
