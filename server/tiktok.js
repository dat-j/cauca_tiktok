// Adapter tiktok-live-connector (đã kiểm tra với bản 2.5.0) → sự kiện chuẩn hoá (SPEC mục 3).
//
// Ghi chú API của bản 2.5.0 (đọc từ dist/lib-*.js + tiktok-live-proto/v3 trong node_modules):
// - `new TikTokLiveConnection(uniqueId, options)` — options BẮT BUỘC là object (constructor đọc
//   options.processInitialData không có `?.`, truyền undefined sẽ TypeError).
// - Payload sự kiện là object protobuf v3 thô: gift → {giftId, repeatCount, repeatEnd:number, groupId,
//   user:User, gift:{name, diamondCount, type}, common:{msgId}}; like → {count, total, user};
//   chat → {content, user}; roomUser → {total (string)}; follow/share → WebcastSocialMessage {user}.
// - User (proto v3) có `displayId` (@handle), `id` (số), `nickname`, `avatarThumb.urlList[]`.
//   README của thư viện vẫn ghi `user.uniqueId`, `data.comment`, `giftDetails.giftType`, `likeCount`
//   (schema cũ) → ở đây đọc cả hai để an toàn.
// - Sign key: thư viện tự đọc env SIGN_API_KEY; ta nhận thêm EULER_API_KEY và truyền qua `signApiKey`.

import { EventEmitter } from 'node:events';

const BACKOFF_MS = [2000, 5000, 10000, 20000, 40000, 60000];
const OFFLINE_RETRY_MS = 30000;

export function apiKeyFromEnv(env = process.env) {
  return env.EULER_API_KEY || env.SIGN_API_KEY || undefined;
}

function userOf(u) {
  if (!u) return null;
  const userId = u.displayId || u.uniqueId || u.id || u.userId;
  if (!userId) return null;
  return {
    userId: String(userId),
    nickname: u.nickname || String(userId),
    avatarUrl: u.avatarThumb?.urlList?.[0] || u.avatarMedium?.urlList?.[0] || u.profilePictureUrl || '',
  };
}

/**
 * Chuẩn hoá gift. Trả về null nếu đang trong streak (chưa kết thúc) để tránh cộng trùng.
 * Quy tắc theo README thư viện: giftType === 1 (quà combo) → chỉ tính khi repeatEnd = true;
 * quà khác → tính ngay với repeatCount cuối cùng.
 */
export function normalizeGift(data) {
  const user = userOf(data?.user);
  if (!user) return null;
  const g = data.gift || {};
  const legacy = data.giftDetails || {};
  const ext = data.extendedGiftInfo || {};
  const giftType = g.type ?? legacy.giftType ?? data.giftType ?? ext.type;
  const repeatEnd = Boolean(data.repeatEnd);
  if (giftType === 1 && !repeatEnd) return null;
  const diamonds = Number(g.diamondCount ?? legacy.diamondCount ?? data.diamondCount ?? ext.diamond_count ?? ext.diamondCount ?? 0) || 0;
  return {
    type: 'gift',
    ...user,
    diamonds,
    repeatCount: Math.max(1, Number(data.repeatCount) || 1),
    giftName: g.name || legacy.giftName || ext.name || `Quà #${data.giftId ?? '?'}`,
  };
}

export function normalizeLike(data) {
  const user = userOf(data?.user);
  if (!user) return null;
  return { type: 'like', ...user, count: Number(data.count ?? data.likeCount ?? 0) || 0 };
}

export function normalizeChat(data) {
  const user = userOf(data?.user);
  if (!user) return null;
  return { type: 'chat', ...user, comment: String(data.content ?? data.comment ?? '') };
}

export function normalizeSocial(type, data) {
  const user = userOf(data?.user);
  return user ? { type, ...user } : null;
}

/**
 * Sự kiện phát ra:
 *  - 'event'  (ev)      sự kiện chuẩn hoá
 *  - 'status' (patch)   {tiktok, username, viewers, message}
 */
export class TikTokAdapter extends EventEmitter {
  constructor({ apiKey = apiKeyFromEnv(), log = console, loadLib } = {}) {
    super();
    this.apiKey = apiKey;
    this.log = log;
    this.loadLib = loadLib || (() => import('tiktok-live-connector'));
    this.lib = null;
    this.conn = null;
    this.username = '';
    this.wanted = false; // người dùng muốn duy trì kết nối
    this.attempt = 0;
    this.retryTimer = null;
    this.gen = 0; // tăng mỗi lần connect/disconnect để bỏ callback cũ
    this.seenMsg = new Map(); // msgId → ts, chống trùng
    this.status = { tiktok: 'disconnected', username: '', viewers: 0, message: '' };
  }

  _setStatus(patch) {
    Object.assign(this.status, patch);
    this.emit('status', { ...this.status });
  }

  /** Bắt đầu kết nối (và tự reconnect). Resolve sau lần thử đầu tiên với status hiện tại. */
  async connect(username) {
    const name = String(username || '').trim().replace(/^https?:\/\/(www\.)?tiktok\.com\//, '').replace(/^@/, '').replace(/\/live\/?$/, '');
    if (!/^[A-Za-z0-9._]{2,24}$/.test(name)) {
      return { ok: false, invalid: true, error: 'Username không hợp lệ (chỉ chữ, số, dấu chấm, gạch dưới; 2–24 ký tự)', status: { ...this.status } };
    }
    await this.disconnect({ silent: true });
    this.username = name;
    this.wanted = true;
    this.attempt = 0;
    const ok = await this._attempt(++this.gen);
    return { ok, status: { ...this.status } };
  }

  async disconnect({ silent = false } = {}) {
    this.wanted = false;
    this.gen++;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const c = this.conn;
    this.conn = null;
    if (c) {
      try { await c.disconnect(); } catch { /* bỏ qua */ }
      c.removeAllListeners();
      c.on('error', () => {}); // nuốt lỗi trễ của instance cũ
    }
    if (!silent) this._setStatus({ tiktok: 'disconnected', viewers: 0, message: 'Đã ngắt kết nối' });
  }

  async _attempt(gen) {
    if (!this.wanted || gen !== this.gen) return false;
    this._setStatus({ tiktok: 'connecting', username: this.username, message: this.attempt ? `Đang kết nối lại (lần ${this.attempt + 1})…` : 'Đang kết nối…' });
    try {
      this.lib ||= await this.loadLib();
    } catch (err) {
      this.wanted = false;
      this._setStatus({ tiktok: 'error', message: `Không tải được tiktok-live-connector: ${err.message}` });
      return false;
    }
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = this.lib;
    let conn;
    try {
      conn = new TikTokLiveConnection(this.username, {
        signApiKey: this.apiKey,
        processInitialData: false, // không phát lại lịch sử (tránh cộng quà trùng khi reconnect)
        fetchRoomInfoOnConnect: true, // ném UserOfflineError nếu chưa live
        enableExtendedGiftInfo: false,
      });
    } catch (err) {
      this.wanted = false;
      this._setStatus({ tiktok: 'error', message: `Lỗi khởi tạo: ${err.message}` });
      return false;
    }
    this.conn = conn;
    const live = () => gen === this.gen && this.conn === conn;
    const safe = (fn) => (data) => {
      if (!live()) return;
      try {
        const ev = fn(data);
        if (ev && !this._dup(data)) this.emit('event', ev);
      } catch (err) {
        this.log.warn('[tiktok] Lỗi xử lý sự kiện:', err.message);
      }
    };

    conn.on(ControlEvent.ERROR, (e) => {
      if (!live()) return;
      this.log.warn('[tiktok] error:', e?.info, e?.exception?.message || e?.exception);
    });
    conn.on(WebcastEvent.GIFT, safe(normalizeGift));
    conn.on(WebcastEvent.LIKE, safe(normalizeLike));
    conn.on(WebcastEvent.CHAT, safe(normalizeChat));
    conn.on(WebcastEvent.FOLLOW, safe((d) => normalizeSocial('follow', d)));
    conn.on(WebcastEvent.SHARE, safe((d) => normalizeSocial('share', d)));
    conn.on(WebcastEvent.ROOM_USER, (d) => {
      if (!live()) return;
      const v = Number(d?.total ?? d?.viewerCount);
      if (Number.isFinite(v)) this._setStatus({ viewers: v });
    });
    conn.on(WebcastEvent.STREAM_END, () => {
      if (!live()) return;
      this._setStatus({ message: 'Buổi LIVE đã kết thúc' });
    });
    conn.on(ControlEvent.DISCONNECTED, ({ code, reason } = {}) => {
      if (!live()) return;
      this.log.warn(`[tiktok] disconnected code=${code} reason=${reason || ''}`);
      this._scheduleRetry(gen, null, `Mất kết nối (${code ?? '?'})`);
    });

    try {
      const state = await conn.connect();
      if (!live()) return false;
      this.attempt = 0;
      this._setStatus({ tiktok: 'connected', message: `Đã kết nối phòng ${state?.roomId ?? ''}`.trim() });
      return true;
    } catch (err) {
      if (!live()) return false;
      this._handleConnectError(gen, err);
      return false;
    }
  }

  _handleConnectError(gen, err) {
    const L = this.lib;
    const name = err?.constructor?.name || 'Error';
    const msg = String(err?.message || err).split('\n')[0].slice(0, 200);
    this.log.warn(`[tiktok] connect lỗi ${name}: ${msg}`);
    if (L.InvalidUniqueIdError && err instanceof L.InvalidUniqueIdError) {
      this.wanted = false;
      this._setStatus({ tiktok: 'error', message: 'Username không hợp lệ' });
      return;
    }
    if (L.UserOfflineError && err instanceof L.UserOfflineError) {
      return this._scheduleRetry(gen, OFFLINE_RETRY_MS, `@${this.username} hiện chưa LIVE`);
    }
    if (L.SignatureRateLimitError && err instanceof L.SignatureRateLimitError) {
      const wait = Math.max(err.retryAfter || 0, 10000);
      return this._scheduleRetry(gen, wait, 'Sign server (Euler Stream) giới hạn tốc độ (rate limit)' + (this.apiKey ? '' : ' — nên đặt EULER_API_KEY'));
    }
    if (L.PremiumFeatureError && err instanceof L.PremiumFeatureError) {
      return this._scheduleRetry(gen, 60000, 'Sign server từ chối (cần API key/gói trả phí): ' + msg);
    }
    if (L.SignAPIError && err instanceof L.SignAPIError) {
      return this._scheduleRetry(gen, null, `Lỗi sign server (${err.reason || 'Sign Error'})`);
    }
    if (L.AlreadyConnectingError && err instanceof L.AlreadyConnectingError) return;
    return this._scheduleRetry(gen, null, `Không kết nối được: ${msg}`);
  }

  _scheduleRetry(gen, fixedMs, message) {
    if (!this.wanted || gen !== this.gen) return;
    const old = this.conn;
    this.conn = null;
    if (old) { old.removeAllListeners(); old.on('error', () => {}); }
    const wait = fixedMs ?? BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt++;
    this._setStatus({ tiktok: 'error', viewers: 0, message: `${String(message).replace(/[.\s]+$/, '')}. Thử lại sau ${Math.round(wait / 1000)}s` });
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this._attempt(gen).catch((err) => this.log.error('[tiktok] retry lỗi:', err));
    }, wait);
    this.retryTimer.unref?.();
  }

  /** Chống trùng theo common.msgId (TikTok đôi khi gửi lại message). */
  _dup(data) {
    const id = data?.common?.msgId;
    if (!id || id === '0') return false;
    const now = Date.now();
    if (this.seenMsg.has(id)) return true;
    this.seenMsg.set(id, now);
    if (this.seenMsg.size > 5000) {
      for (const [k, t] of this.seenMsg) {
        if (now - t > 120000 || this.seenMsg.size > 4000) this.seenMsg.delete(k);
        else break;
      }
    }
    return false;
  }
}
