// API base URL — in Tauri dev mode the WebView loads from Vite (port 1420)
// but the Axum API server runs on the configured CLAUDE_HIVE_PORT. In
// production/LAN browser mode they're the same host.
declare const __HIVE_PORT__: string;
const PORT = __HIVE_PORT__;

function getBaseUrl(): string {
  // If we're in a browser accessing via LAN or the built app serves on the same port
  if (window.location.port === PORT) {
    return `${window.location.protocol}//${window.location.host}`;
  }
  // Tauri dev mode or mismatched port — connect to the API server
  return `http://localhost:${PORT}`;
}

function getWsUrl(): string {
  if (window.location.port === PORT) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  }
  return `ws://localhost:${PORT}/ws`;
}

export const api = {
  get baseUrl() {
    return getBaseUrl();
  },
  get wsUrl() {
    return getWsUrl();
  },
};
