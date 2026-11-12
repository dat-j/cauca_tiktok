// Kết nối WebSocket tới server, tự reconnect với backoff luỹ thừa + jitter.
// Mọi dữ liệu nhận được đi qua onRaw(chuỗi JSON) → handleMessage (giống mock).

export function connectWS({ url, onRaw, onConn }) {
  let ws = null;
  let attempt = 0;
  let timer = null;
  let lastMsgAt = 0;

  function schedule() {
    clearTimeout(timer);
    const base = Math.min(15000, 800 * 2 ** attempt);
    const delay = Math.round(base * (0.75 + Math.random() * 0.5));
    attempt++;
    onConn({ state: 'closed', retryAt: Date.now() + delay });
    timer = setTimeout(open, delay);
  }

  function open() {
    onConn({ state: 'connecting', retryAt: 0 });
    lastMsgAt = Date.now();
    try {
      ws = new WebSocket(url);
    } catch (e) {
      console.warn('[overlay] WS lỗi khởi tạo', e);
      schedule();
      return;
    }
    ws.onopen = () => {
      attempt = 0;
      lastMsgAt = Date.now();
      onConn({ state: 'open', retryAt: 0 });
    };
    ws.onmessage = (ev) => {
      lastMsgAt = Date.now();
      if (typeof ev.data === 'string') onRaw(ev.data);
    };
    ws.onclose = () => {
      ws = null;
      schedule();
    };
    ws.onerror = () => {
      try { ws && ws.close(); } catch { /* bỏ qua */ }
    };
  }

  // Tab ngủ dậy / mạng chập chờn: nếu socket treo ở CONNECTING quá lâu thì thử lại.
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.CONNECTING && Date.now() - lastMsgAt > 20000) {
      try { ws.close(); } catch { /* bỏ qua */ }
    }
  }, 5000);

  open();
}

export function defaultWsUrl(params) {
  const override = params.get('ws');
  if (override) return override;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}
