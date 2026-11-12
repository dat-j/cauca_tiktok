// Bố cục sân khấu logic 1080x1920. Mọi renderer vẽ theo toạ độ logic này.
//
//   y 0..100      : header (tiêu đề + trạng thái)
//   y 106..556    : trời — trái: thông báo quà (≤3 thẻ) + dải toast | phải: bảng xếp hạng top 10 (luôn hiện)
//   y 540         : mặt nước
//   y 566..1452   : VÙNG NGƯỜI CÂU — số hàng cầu tàu & vị trí tính từ số slot server gửi (config.slots)
//   y 1462..1516  : hàng chờ
//   y 1556..1660  : dải hướng dẫn quà
//   y >1670       : VÙNG AN TOÀN (UI TikTok che) — chỉ có nền nước/đáy hồ
//   x >900 & y >1100 : VÙNG AN TOÀN phải-dưới — không đặt nội dung quan trọng

export const W = 1080;
export const H = 1920;
export const SAFE_BOTTOM = 250;
export const SAFE_RIGHT = 180;
export const SAFE_RIGHT_FROM_Y = 1100;

export const HEADER_H = 100;
export const WATER_Y = 540;
export const LB = { x: 690, y: 106, w: 372, h: 450 };
export const NOTICE = { x: 18, y: 112, w: 652, h: 290 };
export const TOAST = { x: 18, cx: 344, y: 410, w: 652 };
export const QUEUE = { x: 20, y: 1462, w: 860, h: 54 };
export const GUIDE = { x: 20, y: H - SAFE_BOTTOM - 114, w: W - SAFE_RIGHT - 40, h: 104 };

// Vùng dành cho người câu (tính cả nhãn tên phía trên và phao phía dưới).
const BAND_TOP = LB.y + LB.h + 10; // dưới bảng xếp hạng → không bao giờ bị che / che bảng
const BAND_BOTTOM = QUEUE.y - 10;
// Kích thước một "người câu" ở tỉ lệ 1 (so với dockY): nhãn tên ở trên, phao ở dưới.
export const UNIT_ABOVE = 146;
export const UNIT_BELOW = 76;
const UNIT_ROW = 221; // khoảng cách hàng đầy đủ (tỉ lệ 1)
export const MAX_COLS = 6;
const STEP_MAX = 148; // khoảng cách cột ở tỉ lệ 1
const X_LEFT = 76;// tâm người câu ngoài cùng bên trái tối thiểu
const X_RIGHT_TOP = 880; // tâm người câu ngoài cùng bên phải (hàng không chạm vùng an toàn phải-dưới)
const X_RIGHT_SAFE = 828; // ... hàng nằm trong vùng y > SAFE_RIGHT_FROM_Y (phao ở x+70 vẫn < 900)

/**
 * Bố cục hiện tại. Gọi configureSlots(n) khi server gửi số slot mới.
 * rows[r] = { dockY, x0, step, cols, dockX0, dockX1 }, scale = tỉ lệ vẽ người câu (≤1).
 */
export const layout = { n: 0, rows: [], scale: 1, pos: [], version: 0 };

export function configureSlots(n) {
  n = Math.max(1, Math.min(60, Math.round(Number(n) || 0)));
  if (n === layout.n) return false;
  const rowsN = Math.ceil(n / MAX_COLS);
  const perRow = Math.ceil(n / rowsN);
  const avail = BAND_BOTTOM - BAND_TOP;
  // khoảng cách hàng: vừa vùng; nếu quá chật thì thu nhỏ người câu
  let spacing = rowsN > 1 ? (avail - UNIT_ABOVE - UNIT_BELOW) / (rowsN - 1) : 0;
  let scale = 1;
  if (rowsN > 1 && spacing < UNIT_ROW) {
    scale = Math.max(0.55, avail / (UNIT_ABOVE + UNIT_BELOW + (rowsN - 1) * UNIT_ROW));
    spacing = (avail - (UNIT_ABOVE + UNIT_BELOW) * scale) / (rowsN - 1);
  }
  spacing = Math.min(spacing, 300);
  const used = (UNIT_ABOVE + UNIT_BELOW) * scale + spacing * (rowsN - 1);
  const top = BAND_TOP + (avail - used) / 2 + UNIT_ABOVE * scale;
  const rows = [];
  let left = n;
  for (let r = 0; r < rowsN; r++) {
    const cols = Math.min(perRow, left);
    left -= cols;
    const dockY = Math.round(top + r * spacing);
    const inSafe = dockY - UNIT_ABOVE * scale > SAFE_RIGHT_FROM_Y - 160;
    const xr = inSafe ? X_RIGHT_SAFE : X_RIGHT_TOP;
    const step = Math.min(STEP_MAX * Math.max(scale, 0.8), cols > 1 ? (xr - X_LEFT) / (cols - 1) : 0);
    const span = step * (cols - 1);
    // so le hàng chẵn/lẻ cho tự nhiên và để phao hàng trên không thẳng hàng với tên hàng dưới
    const stagger = r % 2 ? -1 : 1;
    const room = xr - X_LEFT - span;
    const x0 = X_LEFT + room / 2 + stagger * Math.min(20, room / 2);
    rows.push({ dockY, x0, step, cols, dockX0: inSafe ? 0 : 24, dockX1: inSafe ? 935 : 1056 });
  }
  const pos = [];
  for (let r = 0; r < rows.length; r++) {
    const R = rows[r];
    for (let c = 0; c < R.cols; c++) pos.push({ x: Math.round(R.x0 + c * R.step), dockY: R.dockY, row: r, col: c });
  }
  layout.n = n;
  layout.rows = rows;
  layout.scale = scale;
  layout.pos = pos;
  layout.version++;
  return true;
}

export const slotCount = () => layout.n;
export function slotPos(i) {
  return layout.pos[i] || layout.pos[0];
}
