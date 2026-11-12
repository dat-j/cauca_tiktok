# Hồ Câu Thần Tốc — game câu cá cho TikTok LIVE

Người xem comment / thả tim / follow / share / tặng quà → nhận cần + mồi → nhân vật của họ tự câu cá trên màn hình → cộng điểm → bảng xếp hạng. Overlay dọc 1080×1920, chạy trên máy bạn, đưa vào TikTok LIVE Studio.

## 1. Chạy

Cần **Node.js 20 trở lên** (đã thử với Node 22). Tải bản LTS tại https://nodejs.org nếu máy chưa có.

- Cách nhanh: nhấp đúp **`start.bat`**. Lần đầu nó tự chạy `npm install`, sau đó bật server và mở trang điều khiển `http://127.0.0.1:3000/admin`.
- Hoặc mở terminal trong thư mục này: `npm install` (lần đầu) rồi `npm start`.

| Trang | Địa chỉ |
|---|---|
| Overlay (đưa vào Live Studio) | `http://127.0.0.1:3000/` |
| Bảng điều khiển | `http://127.0.0.1:3000/admin` |

Tắt server: bấm `Ctrl+C` hoặc đóng cửa sổ đen. Bảng xếp hạng **mọi thời đại** lưu ở `data/leaderboard.json` và còn nguyên khi bật lại; **phiên** đang chơi (người đang câu, điểm phiên) thì không lưu.

Cổng 3000 đang bận? Chạy `set PORT=3001` rồi `start.bat` (hoặc `npm start`), và dùng cổng mới ở mọi địa chỉ phía trên.

## 2. Thử trước khi lên LIVE (trang /admin)

1. Mở overlay `http://127.0.0.1:3000/` ở một cửa sổ và `/admin` ở cửa sổ khác.
2. Mục **Giả lập sự kiện**: bấm các nút quà theo tier (1, 5, 30, 100, 500, 2000 kim cương), **+30 like**, **Follow**, **Share**, **Comment**. Nút **Người mới** đổi sang một người xem khác.
3. **Burst**: sinh nhiều người cùng lúc (vd 40 người / 20 giây) để xem hàng chờ và hiệu ứng.
4. **Reset phiên**: xoá phiên hiện tại, giữ bảng mọi thời đại. **Xoá toàn bộ**: xoá cả bảng mọi thời đại. Nên bấm **Xoá toàn bộ** sau khi thử, trước buổi LIVE thật.

Thêm `?debug=1` vào địa chỉ overlay để xem FPS. `?mock=1` cho overlay tự chạy dữ liệu giả, không cần server.
Nền tự chuyển ngày → hoàng hôn → đêm → bình minh (một vòng ~8 phút). Muốn cố định: `?tod=day` / `sunset` / `night` / `dawn`; đổi độ dài vòng: `?cycle=300` (giây).
Sau khi cập nhật code: F5 cửa sổ overlay (server gửi `Cache-Control: no-cache` nên F5 luôn lấy bản mới).

Luật quy đổi:
- Quà (tính theo tổng kim cương của một lần tặng): ≥5 Cần Sắt, ≥30 Cần Bạc, ≥100 Cần Vàng, ≥500 Cần Kim Cương, ≥2000 Cần Huyền Thoại. Cần chỉ nâng lên, không hạ.
- Miễn phí: comment đầu tiên +2 mồi, follow +3 (1 lần/phiên), share +2 (tối đa 5 lần/phiên), mỗi 30 tim +1.
- Tối đa **24** người câu cùng lúc (4 hàng cầu tàu); người khác xếp hàng (cần xịn được ưu tiên). Muốn đổi số chỗ: sửa `GAME.maxSlots` trong `server/config.js` rồi khởi động lại server và F5 cửa sổ overlay — overlay tự dàn lại bố cục.
- Muốn chỉnh các con số: sửa `server/config.js` rồi khởi động lại server. Dải hướng dẫn trên overlay tự cập nhật theo.

## 3. Kết nối kênh TikTok

1. Bắt đầu phát LIVE trên TikTok trước (game chỉ nối được khi kênh đang LIVE).
2. Trong `/admin`, nhập username kênh (không cần `@`) → **Kết nối**. Trạng thái chuyển sang `connected` và overlay hiện `LIVE · @tên_kênh`.
3. Nếu kênh chưa LIVE, server tự thử lại mỗi 30 giây. Mất mạng thì nó cũng tự nối lại.

Có thể cho server tự kết nối lúc khởi động: `set TIKTOK_USERNAME=ten_kenh` trước khi chạy `start.bat`.

**Khi nào cần `EULER_API_KEY`?** Thư viện `tiktok-live-connector` (không chính thức, không thuộc TikTok) phải nhờ máy chủ ký Euler Stream để kết nối. Không có key vẫn chạy được, nhưng bị giới hạn lượt dùng miễn phí. Nếu `/admin` báo *rate limit* hoặc *cần API key/gói trả phí*, tạo key tại https://www.eulerstream.com rồi chạy:

```
set EULER_API_KEY=key_cua_ban
start.bat
```

Đừng chia sẻ key cho ai. Thư viện này đọc dữ liệu LIVE theo cách không chính thức, nên có thể ngừng chạy khi TikTok thay đổi hệ thống.

## 4. Đưa overlay vào TikTok LIVE Studio (Windows)

Máy này cài **TikTok LIVE Studio 1.39.6** tại `C:\Program Files\TikTok LIVE Studio` (theo registry Uninstall và thư mục `1.39.6`). Tên menu bên dưới lấy từ file ngôn ngữ của chính app (`resources\app\locales\Live_Studio\vi-VN.json` / `en.json`). Chúng tôi **chưa bấm thử trong app** (không đăng nhập, không phát LIVE), nên vị trí nút có thể khác một chút.

> **Cập nhật 2026-11-12:** chủ kênh đã thử trên máy này — nguồn **Liên kết** của LIVE Studio 1.39.6 **không nhận địa chỉ localhost / 127.0.0.1**. Dùng **Cách B** (Quay màn hình cửa sổ). Cách A chỉ giữ lại để tham khảo.

### Cách A: nguồn Liên kết (Link) — KHÔNG dùng được với localhost

1. Bật server (`start.bat`), để cửa sổ chạy suốt buổi LIVE.
2. Trong LIVE Studio, chọn bố cục **Màn hình dọc** (Portrait).
3. **Thêm nguồn** (Add source) → **Liên kết** (Link). Dán `http://127.0.0.1:3000/`.
4. Trong **Cài đặt** của nguồn, nếu có mục **Độ phân giải tùy chỉnh** (Custom resolution), đặt **1080 × 1920**. Kéo nguồn cho phủ kín khung dọc.
5. Cảnh game (trời, hồ nước) phủ kín toàn khung 9:16 và không trong suốt. Muốn camera hiện lên thì đặt nguồn camera **phía trên** nguồn Liên kết, thu nhỏ vào một góc. `?bg=transparent` chỉ làm trong suốt phần viền đen ngoài khung 9:16 (khi nguồn bị đặt sai tỉ lệ), không làm trong suốt cảnh game.

Chưa kiểm chứng trên máy này:
- Khung dọc của LIVE Studio có đúng 1080×1920 không.
- Nguồn Liên kết có hỗ trợ nền trong suốt và WebSocket tới `127.0.0.1` không.
- Overlay có giữ được 60fps bên trong LIVE Studio không.

Một số hướng dẫn bên thứ ba (không phải tài liệu chính thức của TikTok) có báo nguồn Link đôi khi bị treo hoặc hiển thị sai kích thước. Gặp lỗi đó thì dùng Cách B.

### Cách B (cách chính): Quay màn hình cửa sổ (Window capture)

1. Mở overlay thành một cửa sổ riêng, không thanh địa chỉ, bằng Edge ở chế độ app. Nhấn Win+R rồi dán:
   ```
   msedge --app=http://127.0.0.1:3000/ --window-size=540,990
   ```
   Overlay tự co giãn và giữ tỉ lệ 9:16. Cửa sổ to hơn thì ảnh nét hơn; màn hình 1440p trở lên có thể dùng `--window-size=1080,1940`.
2. Trong LIVE Studio: **Thêm nguồn** → **Quay màn hình cửa sổ** (Window capture) → chọn cửa sổ "Hồ Câu Thần Tốc — Overlay". Cắt hoặc kéo cho vừa khung dọc.
3. **Đừng thu nhỏ (minimize) cửa sổ overlay.** Chính LIVE Studio cũng cảnh báo cửa sổ bị thu nhỏ sẽ mất tín hiệu, còn trình duyệt thì ngừng vẽ khi cửa sổ bị ẩn. Có thể để nó nằm sau cửa sổ khác, nhưng nên thử trước vì có máy vẫn bị giảm khung hình.

### Chừa chỗ cho giao diện TikTok

Overlay đã chừa khoảng 250px ở dưới và 180px ở góc phải dưới (nơi TikTok hiện bình luận/nút), nên đừng kéo giãn lệch tỉ lệ.

## 5. Sự cố thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| Overlay góc trên hiện "Mất kết nối · thử lại…" | Server đang tắt. Bật lại `start.bat`, overlay tự nối lại và dựng lại đúng trạng thái. |
| `/admin` báo "@kênh hiện chưa LIVE" | Bắt đầu LIVE trước. Server tự thử lại mỗi 30s. |
| Báo rate limit / sign server | Đặt `EULER_API_KEY` (mục 3). |
| Bảng xếp hạng còn dữ liệu thử | `/admin` → **Xoá toàn bộ**. |
| Cổng 3000 bận | `set PORT=3001` rồi chạy lại. |

## Dành cho người phát triển

- `npm test`: unit test cho engine, adapter TikTok, độ bền API.
- Hợp đồng server ↔ overlay: `SPEC.md`.
