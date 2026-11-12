// Kiểm tra adapter với payload protobuf THẬT của tiktok-live-connector (không cần mạng):
// encode → decode bằng schema v3 mà thư viện dùng, rồi đẩy qua TikTokLiveConnection.processDecodedData
// để chắc chắn tên event + cấu trúc field khớp với normalizer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as TT from 'tiktok-live-connector';
import { normalizeGift, normalizeLike, normalizeChat, normalizeSocial } from '../server/tiktok.js';

// encode của schema đòi object đầy đủ field → lấy giá trị mặc định bằng decode(buffer rỗng) rồi ghép.
const d = (Msg, partial = {}) => ({ ...Msg.decode(new Uint8Array()), ...partial });
const roundTrip = (Msg, partial) => Msg.decode(Msg.encode(d(Msg, partial)).finish());
const user = d(TT.User, { id: '7000000000000000001', displayId: 'nguoi_xem_1', nickname: 'Người Xem 1', avatarThumb: d(TT.ImageModel, { urlList: ['https://example.invalid/a.jpg'] }) });
const giftOf = (p) => d(TT.Gift, p);
const common = (key) => d(TT.CommonMessageData, { displayText: d(TT.MessageCommonText, { key }) });

function collect(conn) {
  const out = [];
  conn.on(TT.WebcastEvent.GIFT, (x) => out.push(normalizeGift(x)));
  conn.on(TT.WebcastEvent.LIKE, (x) => out.push(normalizeLike(x)));
  conn.on(TT.WebcastEvent.CHAT, (x) => out.push(normalizeChat(x)));
  conn.on(TT.WebcastEvent.FOLLOW, (x) => out.push(normalizeSocial('follow', x)));
  conn.on(TT.WebcastEvent.SHARE, (x) => out.push(normalizeSocial('share', x)));
  return out;
}

test('gift streak (type=1): chỉ tính khi repeatEnd, dùng repeatCount cuối', async () => {
  const conn = new TT.TikTokLiveConnection('test_user', {});
  const out = collect(conn);
  const rose = giftOf({ name: 'Rose', diamondCount: 1, type: 1 });
  for (const [repeatCount, repeatEnd] of [[1, 0], [2, 0], [3, 0], [3, 1]]) {
    const data = roundTrip(TT.WebcastGiftMessage, { giftId: '5655', repeatCount, repeatEnd, user, gift: rose });
    await conn.processDecodedData({ type: 'WebcastGiftMessage', data });
  }
  assert.equal(out.length, 4, 'thư viện phát 4 event gift');
  assert.deepEqual(out.filter(Boolean), [{ type: 'gift', userId: 'nguoi_xem_1', nickname: 'Người Xem 1', avatarUrl: 'https://example.invalid/a.jpg', diamonds: 1, repeatCount: 3, giftName: 'Rose' }]);
});

test('gift không-streak (type≠1): tính ngay', async () => {
  const conn = new TT.TikTokLiveConnection('test_user', {});
  const out = collect(conn);
  const data = roundTrip(TT.WebcastGiftMessage, { giftId: '6', repeatCount: 1, repeatEnd: 0, user, gift: giftOf({ name: 'Lion', diamondCount: 29999, type: 2 }) });
  await conn.processDecodedData({ type: 'WebcastGiftMessage', data });
  assert.equal(out[0].diamonds, 29999);
  assert.equal(out[0].repeatCount, 1);
});

test('like / chat / follow / share chuẩn hoá đúng', async () => {
  const conn = new TT.TikTokLiveConnection('test_user', {});
  const out = collect(conn);
  await conn.processDecodedData({ type: 'WebcastLikeMessage', data: roundTrip(TT.WebcastLikeMessage, { count: 15, total: '999', user }) });
  await conn.processDecodedData({ type: 'WebcastChatMessage', data: roundTrip(TT.WebcastChatMessage, { content: 'xin chào', user }) });
  await conn.processDecodedData({ type: 'WebcastSocialMessage', data: roundTrip(TT.WebcastSocialMessage, { user, common: common('pm_main_follow_message_viewer_2') }) });
  await conn.processDecodedData({ type: 'WebcastSocialMessage', data: roundTrip(TT.WebcastSocialMessage, { user, common: common('pm_mt_guidance_share') }) });
  assert.deepEqual(out.map((e) => e.type), ['like', 'chat', 'follow', 'share']);
  assert.equal(out[0].count, 15);
  assert.equal(out[1].comment, 'xin chào');
  assert.ok(out.every((e) => e.userId === 'nguoi_xem_1'));
});
