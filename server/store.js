// Lưu bảng xếp hạng mọi thời đại vào data/leaderboard.json.
// - Ghi atomic: ghi file tạm rồi rename đè.
// - Debounce: gộp nhiều thay đổi liên tiếp thành 1 lần ghi.
// - File hỏng / không đọc được: đổi tên sang .corrupt-<ts> và bắt đầu rỗng, không crash.

import fs from 'node:fs';
import path from 'node:path';

export class LeaderboardStore {
  constructor(file, { debounceMs = 2000, log = console } = {}) {
    this.file = file;
    this.debounceMs = debounceMs;
    this.log = log;
    this.timer = null;
    this.pending = null;
  }

  /** @returns {Record<string, object>} */
  load() {
    let raw;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') this.log.warn(`[store] Không đọc được ${this.file}: ${err.message}`);
      return {};
    }
    try {
      const data = JSON.parse(raw);
      const entries = data && typeof data === 'object' ? data.allTime ?? data : null;
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('sai cấu trúc');
      const out = {};
      for (const [id, e] of Object.entries(entries)) {
        if (!e || typeof e !== 'object' || !Number.isFinite(e.score)) continue;
        out[id] = {
          userId: String(e.userId ?? id),
          nickname: String(e.nickname ?? id),
          avatarUrl: String(e.avatarUrl ?? ''),
          score: e.score,
          rodTier: Number.isInteger(e.rodTier) ? e.rodTier : 1,
          bestCatch: e.bestCatch && typeof e.bestCatch === 'object' ? { name: String(e.bestCatch.name), emoji: String(e.bestCatch.emoji), points: Number(e.bestCatch.points) || 0 } : null,
        };
      }
      return out;
    } catch (err) {
      const bad = `${this.file}.corrupt-${Date.now()}`;
      this.log.warn(`[store] ${this.file} hỏng (${err.message}) → chuyển sang ${path.basename(bad)}, bắt đầu bảng trống`);
      try { fs.renameSync(this.file, bad); } catch { /* bỏ qua */ }
      return {};
    }
  }

  /** Lên lịch ghi (debounce). */
  save(allTime) {
    this.pending = allTime;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
    this.timer.unref?.();
  }

  /** Ghi ngay (đồng bộ) nếu còn thay đổi chưa lưu. */
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.pending) return;
    const data = this.pending;
    this.pending = null;
    const json = JSON.stringify({ version: 1, savedAt: new Date().toISOString(), allTime: data }, null, 1);
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, json, 'utf8');
      this._renameWithRetry(tmp, this.file);
    } catch (err) {
      this.log.error(`[store] Lỗi ghi ${this.file}: ${err.message}`);
      try { fs.unlinkSync(tmp); } catch { /* bỏ qua */ }
      this.pending = this.pending ?? data; // thử lại lần sau
    }
  }

  // Windows: rename có thể lỗi EPERM/EBUSY tạm thời (antivirus, OneDrive) → thử lại vài lần.
  _renameWithRetry(from, to) {
    for (let i = 0; ; i++) {
      try { fs.renameSync(from, to); return; } catch (err) {
        if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
        const until = Date.now() + 30 * (i + 1);
        while (Date.now() < until) { /* chờ ngắn */ }
      }
    }
  }
}
