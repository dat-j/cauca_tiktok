// Engine game câu cá — thuần logic, không I/O, không timer.
// - Đồng hồ (`now`) và bộ sinh số ngẫu nhiên (`rng`) được inject để test.
// - Mọi thay đổi phát ra qua callback `emit(msg)` với msg đúng schema WebSocket (SPEC mục 4).
// - Thời gian trôi được xử lý trong `tick()`; host (index.js) gọi tick định kỳ.

import defaultConfig from './config.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** RNG có seed (mulberry32) — dùng cho test/mô phỏng. */
export function seededRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tier cần/mồi tương ứng với tổng kim cương của một lần tặng. */
export function tierForDiamonds(total, config = defaultConfig) {
  let tier = config.RODS[0].tier;
  for (const r of config.RODS) if (total >= r.minDiamonds) tier = Math.max(tier, r.tier);
  return tier;
}

/** Quy đổi một lần tặng quà → {tier, baitCount}. */
export function convertGift(totalDiamonds, config = defaultConfig) {
  const total = Math.max(0, Number(totalDiamonds) || 0);
  const tier = tierForDiamonds(total, config);
  const bait = config.BAITS.find((b) => b.tier === tier);
  const baitCount = clamp(Math.ceil(total / bait.price), config.BAIT_PER_GIFT_MIN, config.BAIT_PER_GIFT_MAX);
  return { tier, baitCount };
}

/** Trọng số độ hiếm đã nhân luck và chuẩn hoá (tổng = 1). */
export function rarityDistribution(baitTier, rodTier, config = defaultConfig) {
  const bait = config.BAITS.find((b) => b.tier === baitTier);
  const rod = config.RODS.find((r) => r.tier === rodTier);
  const w = config.RARITIES.map((rar, i) => bait.weights[i] * (config.LUCK_AFFECTED.includes(rar) ? rod.luck : 1));
  const sum = w.reduce((a, b) => a + b, 0);
  const out = {};
  config.RARITIES.forEach((rar, i) => (out[rar] = sum > 0 ? w[i] / sum : 0));
  return out;
}

/** Kỳ vọng điểm (giải tích) của một lần quăng. Dùng cho test/tinh chỉnh. */
export function expectedPointsPerCast(baitTier, rodTier, config = defaultConfig) {
  const dist = rarityDistribution(baitTier, rodTier, config);
  let e = 0;
  for (const rar of config.RARITIES) {
    const list = config.FISH.filter((f) => f.rarity === rar);
    if (!list.length) continue;
    const wsum = list.reduce((a, f) => a + (f.weight ?? 1), 0);
    const avg = list.reduce((a, f) => a + (f.weight ?? 1) * (f.minPoints + f.maxPoints) / 2, 0) / wsum;
    e += dist[rar] * avg;
  }
  return e;
}

function emptyBait(config) {
  const b = {};
  for (const x of config.BAITS) b[String(x.tier)] = 0;
  return b;
}

const cleanStr = (s, max = 64) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

export class Game {
  /**
   * @param {object} opts
   * @param {object} [opts.config]
   * @param {() => number} [opts.now] epoch ms
   * @param {() => number} [opts.rng] [0,1)
   * @param {(msg: object) => void} [opts.emit]
   * @param {Record<string, object>} [opts.allTime] dữ liệu all-time đã nạp
   * @param {(allTime: Record<string, object>) => void} [opts.onAllTimeChange]
   */
  constructor({ config = defaultConfig, now = Date.now, rng = Math.random, emit = () => {}, allTime = {}, onAllTimeChange = () => {} } = {}) {
    this.config = config;
    this.now = now;
    this.rng = rng;
    this.emit = emit;
    this.onAllTimeChange = onAllTimeChange;
    this.allTime = { ...allTime };
    this._resetSession();
  }

  _resetSession() {
    /** @type {Map<string, any>} mọi user đã tương tác trong phiên */
    this.users = new Map();
    /** @type {(string|null)[]} slot → userId */
    this.slots = new Array(this.config.GAME.maxSlots).fill(null);
    /** @type {string[]} userId đang chờ */
    this.queue = [];
    this.seq = 0;
    this.lbDirty = false;
    this.lastLbAt = -Infinity;
    this.lastQueueLen = 0;
    this.lastPruneAt = this.now();
  }

  // ---------------------------------------------------------------- public API

  /** Xử lý một sự kiện chuẩn hoá (SPEC mục 3). Trả về {ok, error?}. */
  handleEvent(ev) {
    if (!ev || typeof ev !== 'object') return { ok: false, error: 'event không hợp lệ' };
    switch (ev.type) {
      case 'gift': this.gift(ev); break;
      case 'like': this.like(ev); break;
      case 'follow': this.follow(ev); break;
      case 'share': this.share(ev); break;
      case 'chat': this.chat(ev); break;
      default: return { ok: false, error: `type không hỗ trợ: ${ev.type}` };
    }
    return { ok: true };
  }

  gift({ userId, nickname, avatarUrl, diamonds, giftName, repeatCount }) {
    const u = this._user(userId, nickname, avatarUrl);
    if (!u) return;
    const rc = Math.max(1, Math.floor(Number(repeatCount) || 1));
    const total = Math.max(0, Number(diamonds) || 0) * rc;
    const { tier, baitCount } = convertGift(total, this.config);
    const rodUpgraded = tier > u.rodTier;
    if (rodUpgraded) u.rodTier = tier;
    u.bait[String(tier)] += baitCount;
    this.emit({
      type: 'gift',
      userId: u.userId,
      nickname: u.nickname,
      avatarUrl: u.avatarUrl,
      giftName: cleanStr(giftName, 64) || 'Quà',
      diamonds: total,
      rodTier: u.rodTier,
      rodUpgraded,
      baitTier: tier,
      baitCount,
    });
    this._afterBaitChange(u);
  }

  like({ userId, nickname, avatarUrl, count }) {
    const u = this._user(userId, nickname, avatarUrl);
    if (!u) return;
    u.likeAccum += Math.max(0, Math.floor(Number(count) || 0));
    const per = this.config.FREE_BAIT.likesPerBait;
    const n = Math.floor(u.likeAccum / per);
    if (n > 0) {
      u.likeAccum -= n * per;
      u.bait['1'] += n;
      this._afterBaitChange(u);
    }
  }

  follow({ userId, nickname, avatarUrl }) {
    const u = this._user(userId, nickname, avatarUrl);
    if (!u || u.followed) return;
    u.followed = true;
    const n = this.config.FREE_BAIT.follow;
    u.bait['1'] += n;
    this.emit({ type: 'toast', kind: 'follow', text: `${u.nickname} đã theo dõi! +${n} mồi` });
    this._afterBaitChange(u);
  }

  share({ userId, nickname, avatarUrl }) {
    const u = this._user(userId, nickname, avatarUrl);
    if (!u) return;
    if (u.shares >= this.config.FREE_BAIT.shareMaxPerSession) return;
    u.shares += 1;
    const n = this.config.FREE_BAIT.share;
    u.bait['1'] += n;
    this.emit({ type: 'toast', kind: 'share', text: `${u.nickname} đã chia sẻ LIVE! +${n} mồi` });
    this._afterBaitChange(u);
  }

  chat({ userId, nickname, avatarUrl }) {
    const u = this._user(userId, nickname, avatarUrl);
    if (!u || u.commented) return;
    u.commented = true;
    u.bait['1'] += this.config.FREE_BAIT.firstComment;
    this._afterBaitChange(u);
  }

  /** Cho thời gian trôi: kết thúc lượt câu, nhường slot, quăng mới, phát leaderboard. */
  tick() {
    const now = this.now();
    // 1. catch đến hạn
    for (const id of this.slots) {
      if (!id) continue;
      const u = this.users.get(id);
      if (u.state === 'casting' && u.castEndsAt <= now) this._catch(u, now);
    }
    // 2. nhường slot cho hàng chờ
    this._manageSlots(now);
    // 3. quăng mới
    for (const id of this.slots) {
      if (!id) continue;
      this._tryCast(this.users.get(id), now);
    }
    // 4. leaderboard (throttle)
    this._flushLeaderboard(now, false);
    this._emitQueueStatusIfChanged();
    // 5. dọn bộ nhớ (thưa)
    if (now - this.lastPruneAt >= (this.config.GAME.userPruneEveryMs ?? 60000)) this.pruneUsers(now);
  }

  /**
   * Dọn người xem "vô hại" khỏi map khi số người vượt GAME.maxTrackedUsers: 0 điểm, hết mồi,
   * không ngồi/không chờ, không tương tác trong GAME.userPruneIdleMs. Người có điểm phiên giữ nguyên
   * (cần cho bảng xếp hạng phiên). Đánh đổi: người bị dọn mất cờ "đã comment/follow/share" và like lẻ
   * tích luỹ — chỉ xảy ra sau ≥10 phút im lặng và khi phòng rất đông. Trả về số người đã dọn.
   */
  pruneUsers(now = this.now()) {
    this.lastPruneAt = now;
    const G = this.config.GAME;
    const max = G.maxTrackedUsers ?? 5000;
    if (this.users.size <= max) return 0;
    const idleMs = G.userPruneIdleMs ?? 600000;
    let n = 0;
    for (const [id, u] of this.users) {
      if (u.slot !== null || u.queued || u.score > 0 || this._baitTotal(u) > 0) continue;
      if (now - u.lastSeenAt < idleMs) continue;
      this.users.delete(id);
      n++;
    }
    return n;
  }

  /** Thời điểm (epoch ms) gần nhất cần tick lại; null nếu không có việc gì hẹn giờ. */
  nextDueAt() {
    let t = Infinity;
    for (const id of this.slots) {
      if (!id) continue;
      const u = this.users.get(id);
      if (u.state === 'casting') t = Math.min(t, u.castEndsAt);
      else if (this._baitTotal(u) > 0) t = Math.min(t, u.restUntil);
      else if (this.queue.length) t = Math.min(t, u.idleSince + this.config.GAME.idleYieldMs);
    }
    if (this.lbDirty) t = Math.min(t, this.lastLbAt + this.config.GAME.leaderboardThrottleMs);
    return Number.isFinite(t) ? t : null;
  }

  reset(scope = 'session') {
    this._resetSession();
    if (scope === 'all') {
      this.allTime = {};
      this.onAllTimeChange(this.allTime);
    }
  }

  publicConfig() {
    const c = this.config;
    return {
      // Số chỗ câu đồng thời (slot 0..slots-1) — overlay dàn bố cục theo số này.
      slots: c.GAME.maxSlots,
      rods: c.RODS.map((r) => ({ ...r })),
      baits: c.BAITS.map((b) => ({ tier: b.tier, name: b.name, price: b.price })),
      fish: c.FISH.map(({ id, name, emoji, rarity, minPoints, maxPoints }) => ({ id, name, emoji, rarity, minPoints, maxPoints })),
      // Mồi miễn phí — overlay đọc để vẽ dải hướng dẫn (public/js/config.js normalizeConfig → cfg.free).
      free: {
        firstComment: c.FREE_BAIT.firstComment,
        follow: c.FREE_BAIT.follow,
        share: c.FREE_BAIT.share,
        likesPerBait: c.FREE_BAIT.likesPerBait,
      },
    };
  }

  /** Người đang hiển thị (có slot) + hàng chờ. */
  players() {
    const out = [];
    for (const id of this.slots) if (id) out.push(this.playerView(this.users.get(id)));
    for (const id of this._sortedQueue()) out.push(this.playerView(this.users.get(id)));
    return out;
  }

  leaderboard() {
    const list = [...this.users.values()].filter((u) => u.score > 0);
    return this._rank(list.map((u) => ({ userId: u.userId, nickname: u.nickname, avatarUrl: u.avatarUrl, score: u.score, rodTier: u.rodTier, bestCatch: u.bestCatch })));
  }

  allTimeLeaderboard() {
    return this._rank(Object.values(this.allTime).filter((e) => e && e.score > 0));
  }

  snapshot() {
    return {
      players: this.players(),
      leaderboard: this.leaderboard(),
      allTime: this.allTimeLeaderboard(),
      config: this.publicConfig(),
      serverTime: this.now(),
    };
  }

  get queueLength() {
    return this.queue.length;
  }

  playerView(u) {
    return {
      userId: u.userId,
      nickname: u.nickname,
      avatarUrl: u.avatarUrl,
      slot: u.slot,
      rodTier: u.rodTier,
      bait: { ...u.bait },
      baitTotal: this._baitTotal(u),
      score: u.score,
      state: u.slot === null ? 'waiting' : u.state,
      castEndsAt: u.state === 'casting' ? u.castEndsAt : null,
    };
  }

  // ---------------------------------------------------------------- internals

  _user(userId, nickname, avatarUrl) {
    const id = cleanStr(userId, 64);
    if (!id) return null;
    let u = this.users.get(id);
    if (!u) {
      u = {
        userId: id,
        nickname: cleanStr(nickname, 48) || id,
        avatarUrl: cleanStr(avatarUrl, 1024),
        slot: null,
        queued: false,
        queueSeq: 0,
        rodTier: 1,
        bait: emptyBait(this.config),
        score: 0,
        state: 'idle',
        castEndsAt: null,
        castBaitTier: null,
        restUntil: 0,
        idleSince: this.now(),
        likeAccum: 0,
        commented: false,
        followed: false,
        shares: 0,
        bestCatch: null,
        lastSeenAt: this.now(),
      };
      this.users.set(id, u);
    } else {
      u.lastSeenAt = this.now();
      const nn = cleanStr(nickname, 48);
      if (nn) u.nickname = nn;
      const av = cleanStr(avatarUrl, 1024);
      if (av) u.avatarUrl = av;
    }
    return u;
  }

  _baitTotal(u) {
    let s = 0;
    for (const k in u.bait) s += u.bait[k];
    return s;
  }

  _sortedQueue() {
    return [...this.queue].sort((a, b) => {
      const ua = this.users.get(a);
      const ub = this.users.get(b);
      return ub.rodTier - ua.rodTier || ua.queueSeq - ub.queueSeq;
    });
  }

  /** Sau khi người chơi nhận thêm mồi: vào slot / hàng chờ / quăng ngay. */
  _afterBaitChange(u) {
    const now = this.now();
    if (u.slot === null && !u.queued) {
      const free = this.slots.indexOf(null);
      if (free !== -1 && this.queue.length === 0) {
        this._seat(u, free, now);
        if (!this._tryCast(u, now)) this.emit({ type: 'player', player: this.playerView(u) });
      } else {
        u.queued = true;
        u.queueSeq = ++this.seq;
        this.queue.push(u.userId);
        this.emit({ type: 'player', player: this.playerView(u) });
        // có thể có slot trống / người idle lâu → sắp xếp lại ngay (có thể seat luôn u)
        this._manageSlots(now);
      }
    } else if (u.slot !== null) {
      if (!this._tryCast(u, now)) this.emit({ type: 'player', player: this.playerView(u) });
    } else {
      this.emit({ type: 'player', player: this.playerView(u) }); // đang chờ, số mồi/cần đổi
    }
    this._emitQueueStatusIfChanged();
  }

  _seat(u, slot, now) {
    this.slots[slot] = u.userId;
    u.slot = slot;
    u.queued = false;
    u.state = 'idle';
    u.idleSince = now;
    u.restUntil = 0;
    this.emit({ type: 'toast', kind: 'join', text: `${u.nickname} đã vào chỗ câu!` });
  }

  _manageSlots(now) {
    if (!this.queue.length) return;
    // giải phóng slot của người idle quá lâu
    for (let s = 0; s < this.slots.length && this.queue.length; s++) {
      const id = this.slots[s];
      if (!id) continue;
      const u = this.users.get(id);
      if (u.state !== 'casting' && this._baitTotal(u) === 0 && now - u.idleSince >= this.config.GAME.idleYieldMs) {
        this.slots[s] = null;
        u.slot = null;
        u.state = 'idle';
        this.emit({ type: 'player_leave', userId: u.userId, slot: s });
        this._fillFreeSlots(now);
      }
    }
    this._fillFreeSlots(now);
  }

  _fillFreeSlots(now) {
    let free = this.slots.indexOf(null);
    while (free !== -1 && this.queue.length) {
      const next = this._sortedQueue()[0];
      this.queue.splice(this.queue.indexOf(next), 1);
      const u = this.users.get(next);
      this._seat(u, free, now);
      if (!this._tryCast(u, now)) this.emit({ type: 'player', player: this.playerView(u) });
      free = this.slots.indexOf(null);
    }
  }

  /** Quăng nếu đủ điều kiện. Trả về true nếu đã quăng (đã emit player + cast). */
  _tryCast(u, now) {
    if (!u || u.slot === null || u.state === 'casting' || now < u.restUntil) return false;
    let tier = 0;
    for (const b of this.config.BAITS) if (u.bait[String(b.tier)] > 0) tier = Math.max(tier, b.tier);
    if (!tier) return false;
    u.bait[String(tier)] -= 1;
    const rod = this.config.RODS.find((r) => r.tier === u.rodTier);
    u.state = 'casting';
    u.castBaitTier = tier;
    u.castEndsAt = now + rod.castMs;
    this.emit({ type: 'player', player: this.playerView(u) });
    this.emit({ type: 'cast', userId: u.userId, slot: u.slot, baitTier: tier, durationMs: rod.castMs, endsAt: u.castEndsAt });
    return true;
  }

  _pickFish(baitTier, rodTier) {
    const dist = rarityDistribution(baitTier, rodTier, this.config);
    let r = this.rng();
    let rarity = this.config.RARITIES[0];
    for (const rar of this.config.RARITIES) {
      if (dist[rar] <= 0) continue;
      rarity = rar;
      if (r < dist[rar]) break;
      r -= dist[rar];
    }
    const list = this.config.FISH.filter((f) => f.rarity === rarity);
    const wsum = list.reduce((a, f) => a + (f.weight ?? 1), 0);
    let x = this.rng() * wsum;
    let fish = list[list.length - 1];
    for (const f of list) {
      x -= f.weight ?? 1;
      if (x < 0) { fish = f; break; }
    }
    const points = fish.minPoints + Math.floor(this.rng() * (fish.maxPoints - fish.minPoints + 1));
    return { fish, points };
  }

  _catch(u, now) {
    const { fish, points } = this._pickFish(u.castBaitTier, u.rodTier);
    u.score += points;
    const isBest = points > 0 && (!u.bestCatch || points > u.bestCatch.points);
    if (isBest) u.bestCatch = { name: fish.name, emoji: fish.emoji, points };
    u.state = 'idle';
    u.castEndsAt = null;
    u.castBaitTier = null;
    u.restUntil = now + this.config.GAME.restMs;
    u.idleSince = now;
    this.emit({
      type: 'catch',
      userId: u.userId,
      slot: u.slot,
      fish: { id: fish.id, name: fish.name, emoji: fish.emoji, rarity: fish.rarity },
      points,
      score: u.score,
      isBest,
    });
    this.emit({ type: 'player', player: this.playerView(u) });
    this._recordAllTime(u, fish, points);
    this.lbDirty = true;
  }

  _recordAllTime(u, fish, points) {
    const e = this.allTime[u.userId] || { userId: u.userId, nickname: u.nickname, avatarUrl: u.avatarUrl, score: 0, rodTier: 1, bestCatch: null };
    e.nickname = u.nickname;
    e.avatarUrl = u.avatarUrl;
    e.score += points;
    e.rodTier = Math.max(e.rodTier || 1, u.rodTier);
    if (points > 0 && (!e.bestCatch || points > e.bestCatch.points)) e.bestCatch = { name: fish.name, emoji: fish.emoji, points };
    this.allTime[u.userId] = e;
    this._trimAllTime();
    this.onAllTimeChange(this.allTime);
  }

  /** Giữ bảng mọi thời đại ≤ GAME.allTimeMaxEntries (cắt khi vượt 10% để không sort mỗi lần câu). */
  _trimAllTime() {
    const max = this.config.GAME.allTimeMaxEntries ?? 2000;
    const keys = Object.keys(this.allTime);
    if (keys.length <= Math.ceil(max * 1.1)) return;
    const keep = Object.values(this.allTime).sort((a, b) => b.score - a.score).slice(0, max);
    this.allTime = {};
    for (const e of keep) this.allTime[e.userId] = e;
  }

  _rank(list) {
    return [...list]
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.GAME.leaderboardSize)
      .map((e, i) => ({ rank: i + 1, userId: e.userId, nickname: e.nickname, avatarUrl: e.avatarUrl || '', score: e.score, rodTier: e.rodTier || 1, bestCatch: e.bestCatch || null }));
  }

  /** force=true: phát ngay bỏ qua throttle (vd sau reset). */
  _flushLeaderboard(now, force) {
    if (!this.lbDirty && !force) return;
    if (!force && now - this.lastLbAt < this.config.GAME.leaderboardThrottleMs) return;
    this.lbDirty = false;
    this.lastLbAt = now;
    this.emit({ type: 'leaderboard', leaderboard: this.leaderboard(), allTime: this.allTimeLeaderboard() });
  }

  _emitQueueStatusIfChanged() {
    if (this.queue.length !== this.lastQueueLen) {
      this.lastQueueLen = this.queue.length;
      this.emit({ type: '_queue', queueLength: this.queue.length }); // nội bộ: host gộp vào Status
    }
  }
}
