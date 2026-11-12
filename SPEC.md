# Game Câu Cá TikTok Live — SPEC (hợp đồng chung giữa các agent)

Game overlay dọc 1080x1920 cho TikTok LIVE. Người xem tương tác (tặng quà, like, follow, comment) → nhận cần câu + mồi → nhân vật của họ tự câu cá trên màn hình → cộng điểm → bảng xếp hạng.
TikTok Live Studio capture trang overlay (nguồn Link/Browser hoặc Window Capture).

Toàn bộ text hiển thị cho người xem: **tiếng Việt**. Nội dung game là nguyên bản (không sao chép game có sẵn). Không dùng asset ngoài: vẽ bằng Canvas 2D thủ tục + emoji.

## 1. Stack & cấu trúc

- Node 22, ESM (`"type": "module"`), không build step. Deps: `express`, `ws`, `tiktok-live-connector`. Test: `node --test`.
- Frontend: vanilla JS ES modules + Canvas 2D, không framework, không CDN (phải chạy offline).

```
package.json            [BACKEND]
server/                 [BACKEND]
  index.js              express + ws, khởi động (PORT mặc định 3000)
  config.js             bảng cân bằng: rods, baits, fish, quy đổi quà
  game.js               engine thuần (không I/O, nhận clock + rng inject được để test)
  tiktok.js             adapter tiktok-live-connector -> sự kiện chuẩn hoá
  store.js              lưu data/leaderboard.json (ghi debounce, atomic)
test/                   [BACKEND] unit test cho game.js
public/admin.html       [BACKEND] bảng điều khiển (tự chứa, JS inline)
public/index.html       [FRONTEND] overlay
public/js/**, public/css/**  [FRONTEND]
```

Mỗi agent CHỈ sửa file thuộc phần mình. Cần đổi hợp đồng → ghi vào báo cáo cuối, không tự sửa SPEC.

## 2. Luật chơi (server là nguồn sự thật duy nhất; client chỉ render)

Người chơi định danh bằng `userId` (uniqueId TikTok), có `nickname`, `avatarUrl`.

**Cần câu (rod)** — vĩnh viễn trong phiên, chỉ nâng lên, quyết định theo giá trị kim cương của MỘT lần tặng (diamondCount × repeatCount):

| tier | id | tên | ngưỡng kim cương | thời gian câu | luck |
|---|---|---|---|---|---|
| 1 | bamboo | Cần Tre | 0 (miễn phí) | 9s | 1.0 |
| 2 | iron | Cần Sắt | ≥5 | 8s | 1.15 |
| 3 | silver | Cần Bạc | ≥30 | 7s | 1.3 |
| 4 | gold | Cần Vàng | ≥100 | 6s | 1.5 |
| 5 | diamond | Cần Kim Cương | ≥500 | 5s | 1.8 |
| 6 | legend | Cần Huyền Thoại | ≥2000 | 4s | 2.2 |

**Mồi (bait)** — tiêu hao, 1 mồi = 1 lần quăng. Kho mồi theo tier `{1..6: count}`; luôn dùng mồi tier cao nhất trước. Mồi quyết định bảng tỉ lệ độ hiếm cá.
- Quà: tier mồi = tier cần tương ứng ngưỡng của lần tặng đó; số mồi = `clamp(ceil(diamonds / giá_mồi_tier), 1, 50)` với giá mồi tier 1..6 = 1,2,6,20,60,200 kim cương.
- Miễn phí (mồi tier 1): comment đầu tiên trong phiên +2; follow +3; share +2; mỗi 30 like tích luỹ của người đó +1.

**Cá** — 6 độ hiếm: common, uncommon, rare, epic, legendary, mythic. Mỗi loài: `id, name, emoji, rarity, minPoints, maxPoints`. Tối thiểu 24 loài (tên Việt: cá rô, cá chép, cá lóc, cá ngừ, cá mập, rồng biển...), thêm vài "rác" (ủng rách, lon) 0–1 điểm ở common. Điểm tăng theo cấp số: common ~1–10 … mythic ~5.000–20.000. Tỉ lệ độ hiếm theo tier mồi, nhân `luck` của cần cho các bậc rare trở lên rồi chuẩn hoá. Kỳ vọng điểm/kim cương phải TĂNG theo tier (quà lớn luôn lợi hơn) — có unit test khẳng định điều này.

**Vòng câu**: có mồi + đang rảnh → tự quăng (`cast`) → sau `thời gian câu` → `catch` → nghỉ 1s → lặp. Hết mồi → idle. Tối đa `GAME.maxSlots` người câu đồng thời trên màn hình (hiện **24**, slot 0..maxSlots-1 — tham số duy nhất ở `server/config.js`, gửi cho overlay qua `config.slots`); người khác xếp hàng chờ, ưu tiên rod tier cao rồi FIFO; người idle >20s khi có hàng chờ thì nhường slot.

**Xếp hạng**: điểm phiên (`score`) + bảng mọi thời đại (lưu file). Top 10. Kèm `bestCatch` mỗi người.

## 3. HTTP API

- `GET /` overlay, `GET /admin` bảng điều khiển.
- `GET /api/state` → snapshot (giống message `state`).
- `POST /api/connect {username}` / `POST /api/disconnect` — kết nối TikTok LIVE.
- `POST /api/simulate` — giả sự kiện, body là 1 sự kiện chuẩn hoá:
  `{type:"gift", userId, nickname, diamonds, giftName, repeatCount}` | `{type:"like", userId, nickname, count}` | `{type:"follow"|"share", userId, nickname}` | `{type:"chat", userId, nickname, comment}`
- `POST /api/simulate/burst {players, durationSec}` — sinh ngẫu nhiên nhiều người/quà để load test.
- `POST /api/reset {scope:"session"|"all"}`.

Admin: nhập username + nút kết nối, trạng thái, các nút giả lập (quà theo từng tier, like, follow, burst), reset.

## 4. WebSocket `ws://host/ws` (server → client, JSON `{type, ...}`)

```
state        {players:[Player], leaderboard:[LbEntry], allTime:[LbEntry], status:Status, config:{slots,rods,baits,fish,free}, serverTime}
             gửi khi client vừa nối; client phải dựng lại toàn bộ từ đây (reconnect an toàn)
player       {player:Player}                      // vào slot / đổi cần / đổi mồi / idle
player_leave {userId, slot}
gift         {userId, nickname, avatarUrl, giftName, diamonds, rodTier, rodUpgraded, baitTier, baitCount}
cast         {userId, slot, baitTier, durationMs, endsAt}
catch        {userId, slot, fish:{id,name,emoji,rarity}, points, score, isBest}
leaderboard  {leaderboard:[LbEntry], allTime:[LbEntry]}   // throttle ≤ 2 lần/giây
toast        {kind:"follow"|"share"|"join"|"info", text}
status       {status:Status}

Player  = {userId, nickname, avatarUrl, slot (0..config.slots-1 | null nếu đang chờ), rodTier, bait:{"1":n,...}, baitTotal, score, state:"idle"|"casting"|"waiting", castEndsAt|null}
LbEntry = {rank, userId, nickname, avatarUrl, score, rodTier, bestCatch:{name,emoji,points}|null}
Status  = {tiktok:"disconnected"|"connecting"|"connected"|"error", username, viewers, message, queueLength}
```

Thời gian là epoch ms theo đồng hồ server; client hiệu chỉnh lệch bằng `serverTime`.

### 4.1 Làm rõ hợp đồng (bổ sung sau bước tích hợp/QA, 2026-11-12 — đã đối chiếu với code thật hai phía)

- **Kim cương**: trong `POST /api/simulate` (và sự kiện chuẩn hoá từ TikTok) `diamonds` là giá **mỗi** quà; tổng của lần tặng = `diamonds × repeatCount`. Trong message WS `gift`, `diamonds` là **tổng** đã nhân. Tier cần/mồi và số mồi tính theo tổng này.
- **`config` trong `state`** = `{slots, rods:[{tier,id,name,minDiamonds,castMs,luck}], baits:[{tier,name,price}], fish:[{id,name,emoji,rarity,minPoints,maxPoints}], free:{firstComment,follow,share,likesPerBait}}`. `free` lấy từ `server/config.js` (`FREE_BAIT`); overlay vẽ dải hướng dẫn từ số này (mặc định phía client chỉ dùng khi server không gửi). `slots` = `GAME.maxSlots` (bổ sung 2026-11-12): overlay tự dàn số hàng cầu tàu/vị trí theo số này, không hard-code.
- **`Player.state`**: `"waiting"` = đang ở hàng chờ (`slot: null`); `"idle"` = có slot nhưng đang nghỉ/hết mồi; `"casting"` = đang câu (`castEndsAt` khác null). Danh sách `players` trong `state` = người đang ngồi + hàng chờ (đã sắp theo ưu tiên); người đã nhường slot và hết mồi không còn trong danh sách (client nhận `player_leave` và xoá).
- **Mồi miễn phí**: comment đầu tiên/phiên +2; follow thưởng **1 lần/người/phiên**; share +2, tối đa **5 lần/người/phiên**; mỗi 30 like tích luỹ +1. Tất cả là mồi tier 1.
- **Thứ tự message**: khi quăng, `player` (đã trừ mồi, `state:"casting"`) đi **trước** `cast`; khi câu xong, `catch` đi trước rồi mới `player` (state `idle`). `gift` đi trước `player`/`cast` của lần nhận mồi đó.
- **Reset** (`POST /api/reset`): server phát lại một `state` đầy đủ (client dựng lại từ đầu) rồi một `toast` kind `info`. `scope:"all"` xoá cả all-time và ghi file ngay.
- **Khởi động lại server**: phiên (người chơi, điểm phiên, hàng chờ) KHÔNG được lưu — chỉ bảng all-time được lưu ở `data/leaderboard.json` (ghi debounce 2s; tắt bằng Ctrl+C/đóng cửa sổ thì ghi ngay trước khi thoát).
- **Giới hạn bộ nhớ khi live dài** (`GAME` trong `server/config.js`): map người xem được dọn khi vượt `maxTrackedUsers` (chỉ dọn người 0 điểm, hết mồi, không ngồi/chờ, im lặng ≥10 phút); all-time giữ tối đa `allTimeMaxEntries` người điểm cao nhất; tập msgId chống trùng của adapter TikTok ≤ ~5000.
- Nickname/comment/giftName là dữ liệu không tin cậy: admin chỉ dùng `textContent`, overlay vẽ bằng Canvas (không có DOM HTML từ dữ liệu người dùng).

## 5. Overlay (frontend)

- Sân khấu logic 1080x1920, scale vừa cửa sổ (giữ tỉ lệ, canh giữa), nền trang đen. `?bg=transparent` để nền trong suốt nếu cần.
- Bố cục: trên cùng tiêu đề + trạng thái; vùng trời/bờ; `config.slots` vị trí câu (hiện 24 = 4 hàng cầu tàu × 6, bố cục tính theo số slot) có avatar tròn + tên + icon cần theo tier + số mồi; vùng nước có cá bơi nền; bảng xếp hạng top 10 gọn luôn hiển thị (góc phải trên, phía trên vùng người câu — không che người câu); dải hướng dẫn dưới cùng ("Tặng quà để nhận cần & mồi xịn!" + bảng quy đổi xoay vòng). Chừa an toàn ~250px dưới cùng và ~180px bên phải-dưới vì UI TikTok che.
- Hiệu ứng: dây câu + phao nhấp nhô khi casting, thanh tiến độ; cá bật lên + điểm bay khi catch; màu/hào quang theo độ hiếm; legendary/mythic → banner toàn màn hình ≤ ~2s (có thời gian nghỉ giữa các lần) rồi thu thành dải nhỏ ở vùng toast + rung + hạt; thông báo quà nổi bật theo tier; top 3 có vương miện.
- Nền: chu kỳ ngày → hoàng hôn → đêm → bình minh (`?tod=day|sunset|night|dawn` cố định, `?cycle=<giây>`), lớp tĩnh dựng sẵn ra canvas đệm.
- 60fps ở 1080x1920 với đủ slot người câu + burst (`?res=full&debug=1` để đo; `window.__overlay.frameStats()`); giới hạn số hạt; avatar lỗi tải → fallback chữ cái đầu trên nền màu.
- WS tự reconnect (backoff), dựng lại từ `state`.
- `?mock=1`: không cần server, tự sinh sự kiện đúng schema mục 4 để demo/test độc lập.
