// API base URL — in Tauri dev mode the WebView loads from Vite (port 1420)
// but the Axum API server runs on port 9400. In production/LAN browser mode
// they're the same host.
const PORT = "9400";

function getBaseUrl(): string {
  // If we're in a browser accessing via LAN or the built app serves from 9400
  if (window.location.port === PORT) {
    return `${window.location.protocol}//${window.location.host}`;
  }
  // Tauri dev mode or mismatched port — always use localhost:9400
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
