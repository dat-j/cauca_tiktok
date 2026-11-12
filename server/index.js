// Server: express (static + HTTP API) + WebSocket /ws + vòng tick game + adapter TikTok.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';
import { LeaderboardStore } from './store.js';
import { TikTokAdapter } from './tiktok.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

export function createServer({
  port = Number(process.env.PORT) || 3000,
  host = process.env.HOST || '127.0.0.1',
  dataFile = process.env.DATA_FILE || path.join(ROOT, 'data', 'leaderboard.json'),
  tiktokUsername = process.env.TIKTOK_USERNAME || '',
  tiktok = new TikTokAdapter(),
  log = console,
} = {}) {
  const store = new LeaderboardStore(dataFile, { log });
  const clients = new Set();
  const status = { tiktok: 'disconnected', username: '', viewers: 0, message: '', queueLength: 0 };

  const broadcast = (msg) => {
    const data = JSON.stringify(msg);
    for (const ws of clients) if (ws.readyState === 1) ws.send(data);
  };
  const sendStatus = () => broadcast({ type: 'status', status: { ...status } });

  const game = new Game({
    allTime: store.load(),
    onAllTimeChange: (all) => store.save(all),
    emit: (msg) => {
      if (msg.type === '_queue') {
        status.queueLength = msg.queueLength;
        sendStatus();
        return;
      }
      broadcast(msg);
      scheduleTick();
    },
  });

  const snapshot = () => ({ type: 'state', ...game.snapshot(), status: { ...status } });
  const broadcastState = () => broadcast(snapshot());

  // ---- tick: hẹn giờ theo nextDueAt + nhịp an toàn 250ms
  let tickTimer = null;
  let ticking = false;
  function runTick() {
    if (ticking) return;
    ticking = true;
    try { game.tick(); } catch (err) { log.error('[game] tick lỗi:', err); }
    ticking = false;
    scheduleTick();
  }
  function scheduleTick() {
    if (ticking) return;
    const due = game.nextDueAt();
    if (due === null) return;
    const delay = Math.max(0, due - Date.now());
    if (tickTimer && tickTimer._due <= due) return;
    clearTimeout(tickTimer);
    tickTimer = setTimeout(() => { tickTimer = null; runTick(); }, delay);
    tickTimer._due = due;
  }
  const heartbeat = setInterval(runTick, 250);

  // ---- TikTok
  tiktok.on('status', (s) => { Object.assign(status, s); sendStatus(); });
  tiktok.on('event', (ev) => {
    try { game.handleEvent(ev); } catch (err) { log.error('[game] lỗi xử lý sự kiện:', err); }
  });

  // ---- HTTP
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));
  // no-cache: trình duyệt luôn hỏi lại server (ETag) → cửa sổ overlay đang mở chỉ cần F5 là nhận JS mới,
  // không bị kẹt bản cũ trong cache sau khi cập nhật.
  app.use(express.static(PUBLIC, { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

  app.get('/api/state', (req, res) => res.json(snapshot()));

  app.post('/api/connect', async (req, res) => {
    const username = req.body?.username;
    if (typeof username !== 'string' || !username.trim()) return res.status(400).json({ ok: false, error: 'Thiếu username' });
    try {
      const r = await tiktok.connect(username);
      if (r.invalid) return res.status(400).json({ ok: false, error: r.error, status: { ...status } });
      res.json({ ok: r.ok, status: { ...status } });
    } catch (err) {
      log.error('[api] connect lỗi:', err);
      res.status(500).json({ ok: false, error: err.message, status: { ...status } });
    }
  });

  app.post('/api/disconnect', async (req, res) => {
    await tiktok.disconnect();
    res.json({ ok: true, status: { ...status } });
  });

  app.post('/api/simulate', (req, res) => {
    const v = validateEvent(req.body);
    if (v.error) return res.status(400).json({ ok: false, error: v.error });
    game.handleEvent(v.event);
    res.json({ ok: true, event: v.event });
  });

  const burstTimers = new Set();
  app.post('/api/simulate/burst', (req, res) => {
    const players = Number(req.body?.players ?? game.config.GAME.maxSlots);
    const durationSec = Number(req.body?.durationSec ?? 30);
    if (!Number.isInteger(players) || players < 1 || players > 200) return res.status(400).json({ ok: false, error: 'players phải là số nguyên 1..200' });
    if (!Number.isFinite(durationSec) || durationSec < 0 || durationSec > 600) return res.status(400).json({ ok: false, error: 'durationSec phải trong 0..600' });
    const events = makeBurst(players, durationSec);
    for (const { at, ev } of events) {
      const t = setTimeout(() => { burstTimers.delete(t); game.handleEvent(ev); }, at);
      burstTimers.add(t);
    }
    res.json({ ok: true, players, durationSec, scheduled: events.length });
  });

  app.post('/api/reset', (req, res) => {
    const scope = req.body?.scope ?? 'session';
    if (scope !== 'session' && scope !== 'all') return res.status(400).json({ ok: false, error: 'scope phải là "session" hoặc "all"' });
    for (const t of burstTimers) clearTimeout(t);
    burstTimers.clear();
    game.reset(scope);
    status.queueLength = 0;
    if (scope === 'all') store.flush();
    broadcastState();
    broadcast({ type: 'toast', kind: 'info', text: scope === 'all' ? 'Đã xoá toàn bộ bảng xếp hạng' : 'Bắt đầu phiên mới!' });
    res.json({ ok: true, scope });
  });

  app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Không tìm thấy API' }));
  // lỗi body JSON hỏng v.v.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const code = err.status || err.statusCode || 500;
    res.status(code).json({ ok: false, error: code === 400 ? 'Body JSON không hợp lệ' : err.message });
  });

  const server = http.createServer(app);

  // ---- WebSocket
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});
    ws.on('close', () => clients.delete(ws));
    ws.on('message', () => {}); // client → server không dùng
    clients.add(ws);
    ws.send(JSON.stringify(snapshot()));
  });
  const ping = setInterval(() => {
    for (const ws of clients) {
      if (!ws.isAlive) { ws.terminate(); clients.delete(ws); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* bỏ qua */ }
    }
  }, 30000);

  async function start() {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve(); });
    });
    const addr = server.address();
    log.info(`[server] http://${addr.address}:${addr.port}/  (admin: /admin, ws: /ws)`);
    if (tiktokUsername) tiktok.connect(tiktokUsername).catch((err) => log.error('[tiktok] lỗi:', err));
    return addr;
  }

  async function stop() {
    clearInterval(heartbeat);
    clearInterval(ping);
    clearTimeout(tickTimer);
    for (const t of burstTimers) clearTimeout(t);
    // Ghi all-time TRƯỚC mọi bước có thể treo (disconnect TikTok, keep-alive HTTP) — shutdown() ép
    // process.exit sau 5s, trước đây flush nằm cuối nên có thể không bao giờ chạy.
    store.flush();
    await tiktok.disconnect({ silent: true }).catch(() => {});
    for (const ws of clients) ws.terminate();
    wss.close();
    const closed = new Promise((r) => server.close(() => r()));
    server.closeAllConnections?.(); // keep-alive của trình duyệt (admin) không giữ server mở
    await closed;
    store.flush();
  }

  return { app, server, game, store, start, stop };
}

// ---------------------------------------------------------------- validate & burst

const str = (v, max) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);

export function validateEvent(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'Body phải là object JSON' };
  const types = ['gift', 'like', 'follow', 'share', 'chat'];
  if (!types.includes(b.type)) return { error: `type phải là một trong: ${types.join(', ')}` };
  const userId = str(b.userId, 64);
  if (!userId) return { error: 'userId là chuỗi bắt buộc (≤64 ký tự)' };
  const nickname = b.nickname === undefined ? userId : str(b.nickname, 64);
  if (!nickname) return { error: 'nickname phải là chuỗi (≤64 ký tự)' };
  let avatarUrl = '';
  if (b.avatarUrl !== undefined && b.avatarUrl !== '') {
    if (typeof b.avatarUrl !== 'string' || b.avatarUrl.length > 1024 || !/^(https?:|data:image\/)/.test(b.avatarUrl)) return { error: 'avatarUrl phải là URL http(s)' };
    avatarUrl = b.avatarUrl;
  }
  const ev = { type: b.type, userId, nickname, avatarUrl };
  if (b.type === 'gift') {
    const diamonds = Number(b.diamonds);
    if (!Number.isInteger(diamonds) || diamonds < 1 || diamonds > 1_000_000) return { error: 'diamonds phải là số nguyên 1..1000000' };
    const repeatCount = b.repeatCount === undefined ? 1 : Number(b.repeatCount);
    if (!Number.isInteger(repeatCount) || repeatCount < 1 || repeatCount > 10_000) return { error: 'repeatCount phải là số nguyên 1..10000' };
    const giftName = b.giftName === undefined ? 'Quà' : str(b.giftName, 64);
    if (!giftName) return { error: 'giftName phải là chuỗi (≤64 ký tự)' };
    Object.assign(ev, { diamonds, repeatCount, giftName });
  } else if (b.type === 'like') {
    const count = b.count === undefined ? 1 : Number(b.count);
    if (!Number.isInteger(count) || count < 1 || count > 100_000) return { error: 'count phải là số nguyên 1..100000' };
    ev.count = count;
  } else if (b.type === 'chat') {
    const comment = b.comment === undefined ? '' : b.comment;
    if (typeof comment !== 'string' || comment.length > 500) return { error: 'comment phải là chuỗi ≤500 ký tự' };
    ev.comment = comment;
  }
  return { event: ev };
}

const SIM_NAMES = ['Mèo Mập', 'Cá Khô', 'Bé Na', 'Anh Ba Câu', 'Tiểu Long', 'Hoa Sen', 'Cún Con', 'Lão Ngư', 'Gió Biển', 'Sóng Nhỏ', 'Mây Trắng', 'Thỏ Ngọc', 'Chú Cuội', 'Bắp Rang', 'Trà Sữa', 'Bánh Bao'];
const SIM_GIFTS = [
  { giftName: 'Hoa Hồng', diamonds: 1 },
  { giftName: 'TikTok', diamonds: 1 },
  { giftName: 'Kem Ốc Quế', diamonds: 1 },
  { giftName: 'Mũ Phớt', diamonds: 5 },
  { giftName: 'Bánh Donut', diamonds: 30 },
  { giftName: 'Nhẫn Kim Cương', diamonds: 100 },
  { giftName: 'Pháo Hoa', diamonds: 500 },
  { giftName: 'Sư Tử', diamonds: 2000 },
];
const GIFT_WEIGHTS = [30, 20, 15, 15, 10, 6, 3, 1];

function pickWeighted(items, weights) {
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r < 0) return items[i]; }
  return items[items.length - 1];
}

export function makeBurst(players, durationSec) {
  const out = [];
  const ms = durationSec * 1000;
  const runId = Math.random().toString(36).slice(2, 6);
  for (let i = 0; i < players; i++) {
    const user = {
      userId: `sim_${runId}_${i}`,
      nickname: `${SIM_NAMES[i % SIM_NAMES.length]}${i >= SIM_NAMES.length ? ' ' + Math.floor(i / SIM_NAMES.length + 1) : ''}`,
      avatarUrl: '',
    };
    const n = 1 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const g = pickWeighted(SIM_GIFTS, GIFT_WEIGHTS);
      out.push({ at: Math.floor(Math.random() * ms), ev: { type: 'gift', ...user, ...g, repeatCount: g.diamonds === 1 ? 1 + Math.floor(Math.random() * 5) : 1 } });
    }
    if (Math.random() < 0.5) out.push({ at: Math.floor(Math.random() * ms), ev: { type: 'like', ...user, count: 15 + Math.floor(Math.random() * 60) } });
    if (Math.random() < 0.2) out.push({ at: Math.floor(Math.random() * ms), ev: { type: 'follow', ...user } });
    if (Math.random() < 0.1) out.push({ at: Math.floor(Math.random() * ms), ev: { type: 'share', ...user } });
  }
  return out.sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------- main
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const app = createServer();
  app.start().catch((err) => {
    console.error(`[server] Không khởi động được: ${err.message}`);
    process.exit(1);
  });
  let stopping = false;
  const shutdown = async (sig) => {
    if (stopping) return;
    stopping = true;
    console.info(`[server] ${sig} → đang tắt…`);
    const force = setTimeout(() => process.exit(0), 5000);
    force.unref();
    try { await app.stop(); } catch (err) { console.error(err); }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // Windows: đóng cửa sổ console (nút X của start.bat) → SIGHUP; Ctrl+Break → SIGBREAK.
  // Không bắt thì Node thoát ngay, mất tối đa 2s dữ liệu all-time chưa ghi (store ghi debounce).
  process.on('SIGHUP', () => shutdown('SIGHUP'));
  if (process.platform === 'win32') process.on('SIGBREAK', () => shutdown('SIGBREAK'));
  process.on('unhandledRejection', (err) => console.error('[server] unhandledRejection:', err));
  process.on('uncaughtException', (err) => console.error('[server] uncaughtException:', err));
}
