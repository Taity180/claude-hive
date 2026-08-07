import { useEffect, useRef, useCallback } from "react";
import { useHubStore } from "../stores/hubStore";
import { api } from "../api";
import type { WsEvent } from "../types";

// Native desktop notifications used to fire here on every status change,
// question, and hub_notify call. They were removed: the hub is already
// always-on-top and pinned across virtual desktops, and the tray badge counts
// sessions needing attention — so a toast for the same event was a third
// notification of something already visible in two places.
//
// The events themselves still flow; only the OS-level toast is gone.

export function useWebSocket() {
  const wsRef = useRef<WebSocket | undefined>(undefined);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const handleWsEvent = useHubStore((s) => s.handleWsEvent);

  const connect = useCallback(() => {
    const ws = new WebSocket(api.wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      fetch(`${api.baseUrl}/api/sessions`)
        .then((r) => r.json())
        .then((sessions) => useHubStore.getState().setSessions(sessions))
        .catch(() => {});
      // A session can be blocked on a question asked before this dashboard
      // opened (or while it was reconnecting), and the asking event is long
      // gone from the WebSocket. Fetch whatever is still outstanding.
      fetch(`${api.baseUrl}/api/questions`)
        .then((r) => r.json())
        .then((questions) => useHubStore.getState().setPendingQuestions(questions))
        .catch(() => {});
    };

    ws.onmessage = (event) => {
      try {
        const wsEvent: WsEvent = JSON.parse(event.data);
        handleWsEvent(wsEvent);
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      wsRef.current = undefined;
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [handleWsEvent]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, [connect]);
}
