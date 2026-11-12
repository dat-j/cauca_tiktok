// State store phía client + handleMessage DUY NHẤT cho mọi message (WS thật và mock đi chung đường này).
// Client chỉ render; server là nguồn sự thật.
import { normalizeConfig, rodOf, RARITY } from './config.js';
import { sanitizeName, clamp } from './util.js';
import { configureSlots, layout } from './layout.js';

export const store = {
  players: new Map(), // userId -> Player (đã chuẩn hoá, kèm trường nội bộ _cast, _enterT, ...)
  slotOwner: [], // slot -> userId (độ dài = config.slots)
  leaving: [], // bóng người rời slot để chạy animation {p, slot, t0}
  leaderboard: [],
  allTime: [],
  status: { tiktok: 'disconnected', username: '', viewers: 0, message: '', queueLength: 0 },
  config: normalizeConfig(null),
  clockOffset: 0, // serverTime - Date.now()
  hasState: false,
  stateCount: 0,
  lbVersion: 0,
  conn: { mode: 'ws', state: 'connecting', retryAt: 0 },
  msgCount: 0,
};

const listeners = new Map();
export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, []);
  listeners.get(type).push(fn);
}
function emit(type, data) {
  const arr = listeners.get(type);
  if (!arr) return;
  for (const fn of arr) {
    try { fn(data); } catch (e) { console.error('[overlay] listener', type, e); }
  }
}

export const serverNow = () => Date.now() + store.clockOffset;
const perfNow = () => performance.now();
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const validSlot = (s) => (Number.isInteger(s) && s >= 0 && s < store.slotOwner.length ? s : null);

/** Đặt số slot (từ config.slots). Dàn lại bố cục + mảng chủ slot. */
function applySlotCount(n) {
  configureSlots(n);
  if (store.slotOwner.length !== layout.n) store.slotOwner = new Array(layout.n).fill(null);
}
applySlotCount(store.config.slots);

function sumBait(b) {
  let s = 0;
  if (b && typeof b === 'object') for (const k in b) s += Number(b[k]) || 0;
  return s;
}
export function topBaitTier(p) {
  for (let t = 6; t >= 1; t--) if ((Number(p.bait?.[t]) || 0) > 0) return t;
  return 0;
}

function normPlayer(raw, prev) {
  const userId = String(raw.userId ?? '');
  const bait = raw.bait && typeof raw.bait === 'object' ? raw.bait : prev?.bait || {};
  return {
    userId,
    nickname: sanitizeName(raw.nickname ?? prev?.nickname ?? userId),
    avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : prev?.avatarUrl || '',
    slot: validSlot(raw.slot),
    rodTier: clamp(Math.round(Number(raw.rodTier) || prev?.rodTier || 1), 1, 6),
    bait,
    baitTotal: isNum(raw.baitTotal) ? raw.baitTotal : sumBait(bait),
    score: isNum(raw.score) ? raw.score : prev?.score || 0,
    state: raw.state === 'casting' || raw.state === 'waiting' ? raw.state : 'idle',
    castEndsAt: isNum(raw.castEndsAt) ? raw.castEndsAt : null,
    // nội bộ client
    _cast: null,
    _enterT: prev?._enterT ?? 0,
    _rodUpT: prev?._rodUpT ?? 0,
    _lastCatchT: prev?._lastCatchT ?? 0,
  };
}

function vacate(p, animate = true) {
  if (p.slot === null) return;
  if (store.slotOwner[p.slot] === p.userId) store.slotOwner[p.slot] = null;
  if (animate) {
    store.leaving.push({ p: { ...p }, slot: p.slot, t0: perfNow() });
    if (store.leaving.length > 24) store.leaving.shift();
  }
}

function applyCastFromPlayer(np, prev) {
  if (np.state === 'casting' && np.castEndsAt) {
    if (prev?._cast && prev._cast.end === np.castEndsAt) np._cast = prev._cast;
    else {
      const dur = rodOf(store.config, np.rodTier).castMs;
      np._cast = { start: np.castEndsAt - dur, end: np.castEndsAt, baitTier: topBaitTier(np) || 1 };
    }
  } else np._cast = null;
}

function setPlayer(raw, { animate = true } = {}) {
  if (!raw || typeof raw !== 'object' || raw.userId === undefined || raw.userId === null) return null;
  const id = String(raw.userId);
  const prev = store.players.get(id);
  const np = normPlayer(raw, prev);
  if (prev && prev.slot !== null && prev.slot !== np.slot) vacate(prev, animate);
  if (np.slot !== null) {
    const owner = store.slotOwner[np.slot];
    if (owner && owner !== id) {
      // Slot đã có người khác (thiếu message rời) → đẩy người cũ ra hàng chờ cục bộ.
      const other = store.players.get(owner);
      if (other) { vacate(other, animate); other.slot = null; other.state = 'waiting'; other._cast = null; }
    }
    store.slotOwner[np.slot] = id;
    if (!prev || prev.slot !== np.slot) np._enterT = animate ? perfNow() : perfNow() - 10000;
  }
  if (prev && np.rodTier > prev.rodTier) np._rodUpT = perfNow();
  applyCastFromPlayer(np, prev);
  store.players.set(id, np);
  return np;
}

function normLb(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && e.userId !== undefined)
    .slice(0, 10)
    .map((e, i) => ({
      rank: Number.isInteger(e.rank) ? e.rank : i + 1,
      userId: String(e.userId),
      nickname: sanitizeName(e.nickname ?? e.userId),
      avatarUrl: typeof e.avatarUrl === 'string' ? e.avatarUrl : '',
      score: Number(e.score) || 0,
      rodTier: clamp(Math.round(Number(e.rodTier) || 1), 1, 6),
      bestCatch: e.bestCatch && typeof e.bestCatch === 'object'
        ? { name: sanitizeName(e.bestCatch.name, '?'), emoji: String(e.bestCatch.emoji || '🐟'), points: Number(e.bestCatch.points) || 0 }
        : null,
    }));
}

function findWho(userId) {
  const p = store.players.get(userId);
  if (p) return p;
  return store.leaderboard.find((e) => e.userId === userId) || store.allTime.find((e) => e.userId === userId) || null;
}

/** Điểm vào duy nhất cho mọi message server → client. */
export function handleMessage(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
  store.msgCount++;
  switch (msg.type) {
    case 'state': {
      if (isNum(msg.serverTime)) store.clockOffset = msg.serverTime - Date.now();
      store.config = normalizeConfig(msg.config);
      applySlotCount(store.config.slots);
      if (msg.status && typeof msg.status === 'object') store.status = { ...store.status, ...msg.status };
      // Dựng lại TOÀN BỘ từ snapshot (an toàn khi reconnect). Giữ animation nếu người đó vẫn ở slot cũ.
      const old = store.players;
      store.players = new Map();
      store.slotOwner.fill(null);
      store.leaving.length = 0;
      for (const raw of Array.isArray(msg.players) ? msg.players : []) {
        const prev = old.get(String(raw?.userId));
        if (prev) store.players.set(prev.userId, { ...prev, slot: null });
        const np = setPlayer(raw, { animate: !store.hasState });
        if (np && prev && prev.slot === np.slot) np._enterT = prev._enterT;
      }
      store.leaderboard = normLb(msg.leaderboard);
      store.allTime = normLb(msg.allTime);
      store.lbVersion++;
      store.hasState = true;
      store.stateCount++;
      emit('state', msg);
      break;
    }
    case 'player': {
      const np = setPlayer(msg.player);
      if (np) emit('player', np);
      break;
    }
    case 'player_leave': {
      const id = String(msg.userId ?? '');
      const p = store.players.get(id);
      if (p) {
        vacate(p);
        store.players.delete(id);
      } else {
        const s = validSlot(msg.slot);
        if (s !== null && store.slotOwner[s] === id) store.slotOwner[s] = null;
      }
      emit('player_leave', { userId: id, slot: msg.slot });
      break;
    }
    case 'gift': {
      const id = String(msg.userId ?? '');
      const p = store.players.get(id);
      const rodTier = clamp(Math.round(Number(msg.rodTier) || 1), 1, 6);
      if (p) {
        if (typeof msg.avatarUrl === 'string' && msg.avatarUrl) p.avatarUrl = msg.avatarUrl;
        if (rodTier > p.rodTier) { p.rodTier = rodTier; p._rodUpT = perfNow(); }
      }
      emit('gift', {
        userId: id,
        nickname: sanitizeName(msg.nickname ?? p?.nickname ?? id),
        avatarUrl: typeof msg.avatarUrl === 'string' ? msg.avatarUrl : p?.avatarUrl || '',
        giftName: sanitizeName(msg.giftName, 'Quà'),
        diamonds: Number(msg.diamonds) || 0,
        rodTier,
        rodUpgraded: !!msg.rodUpgraded,
        baitTier: clamp(Math.round(Number(msg.baitTier) || 1), 1, 6),
        baitCount: Number(msg.baitCount) || 0,
      });
      break;
    }
    case 'cast': {
      const id = String(msg.userId ?? '');
      const p = store.players.get(id);
      if (!p) break;
      const s = validSlot(msg.slot);
      if (s !== null && p.slot !== s) setPlayer({ ...p, slot: s });
      const q = store.players.get(id);
      const end = isNum(msg.endsAt) ? msg.endsAt : serverNow() + (Number(msg.durationMs) || rodOf(store.config, q.rodTier).castMs);
      const dur = isNum(msg.durationMs) && msg.durationMs > 0 ? msg.durationMs : rodOf(store.config, q.rodTier).castMs;
      q.state = 'casting';
      q.castEndsAt = end;
      q._cast = { start: end - dur, end, baitTier: clamp(Math.round(Number(msg.baitTier) || 1), 1, 6) };
      emit('cast', { player: q });
      break;
    }
    case 'catch': {
      const id = String(msg.userId ?? '');
      const p = store.players.get(id);
      const fish = msg.fish && typeof msg.fish === 'object' ? msg.fish : {};
      const rarity = RARITY[fish.rarity] ? fish.rarity : 'common';
      const slot = validSlot(msg.slot) ?? p?.slot ?? null;
      if (p) {
        if (isNum(msg.score)) p.score = msg.score;
        p.state = 'idle';
        p.castEndsAt = null;
        p._cast = null;
        p._lastCatchT = perfNow();
      }
      const who = findWho(id) || { userId: id, nickname: id, avatarUrl: '' };
      emit('catch', {
        userId: id,
        slot: slot !== null && store.slotOwner[slot] === id ? slot : null,
        who: { userId: id, nickname: who.nickname, avatarUrl: who.avatarUrl, rodTier: who.rodTier || 1 },
        fish: {
          id: String(fish.id ?? ''),
          name: sanitizeName(fish.name, 'Cá lạ'),
          emoji: typeof fish.emoji === 'string' && fish.emoji ? fish.emoji : '🐟',
          rarity,
        },
        points: Number(msg.points) || 0,
        score: Number(msg.score) || 0,
        isBest: !!msg.isBest,
      });
      break;
    }
    case 'leaderboard': {
      if (Array.isArray(msg.leaderboard)) store.leaderboard = normLb(msg.leaderboard);
      if (Array.isArray(msg.allTime)) store.allTime = normLb(msg.allTime);
      store.lbVersion++;
      emit('leaderboard', null);
      break;
    }
    case 'toast': {
      const text = sanitizeName(msg.text, '', 140);
      if (text) emit('toast', { kind: String(msg.kind || 'info'), text });
      break;
    }
    case 'status': {
      if (msg.status && typeof msg.status === 'object') store.status = { ...store.status, ...msg.status };
      emit('status', store.status);
      break;
    }
    default:
      break; // message lạ: bỏ qua (tương thích tiến)
  }
}

export function setConn(patch) {
  Object.assign(store.conn, patch);
}
