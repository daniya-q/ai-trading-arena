import { useBtcStore } from "@/store/btcStore";

/*
  Binance public trade stream — no auth required.
  Each message: { p: "priceString", T: timestampMs, ... }
*/
const WS_URL =
  "wss://stream.binance.com:9443/ws/btcusdt@trade";

const RECONNECT_DELAY_MS = 5000;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null =
  null;
let started = false;

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function connect() {
  clearReconnectTimer();

  ws = new WebSocket(WS_URL);

  ws.onmessage = (event: MessageEvent) => {
    try {
      const data = JSON.parse(
        event.data as string
      ) as { p?: string; T?: number };

      const price = parseFloat(data.p ?? "");

      if (!isNaN(price) && price > 0) {
        useBtcStore
          .getState()
          .updateBtcPrice(price);
      }
    } catch {
      // Ignore malformed frames
    }
  };

  ws.onclose = () => {
    reconnectTimer = setTimeout(
      connect,
      RECONNECT_DELAY_MS
    );
  };

  ws.onerror = () => {
    // onclose fires after onerror, which schedules reconnect
    ws?.close();
  };
}

/**
 * Start the Binance BTC/USDT trade WebSocket.
 * Safe to call multiple times — only opens one connection.
 */
export function startBtcWebSocket() {
  if (started) return;
  started = true;
  connect();
}
