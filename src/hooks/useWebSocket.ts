import { useEffect, useRef, useCallback } from "react";
import { useHubStore } from "../stores/hubStore";
import { api } from "../api";
import type { WsEvent } from "../types";

async function showNotification(title: string, body: string) {
  try {
    const { isPermissionGranted, requestPermission, sendNotification } =
      await import("@tauri-apps/plugin-notification");
    let permitted = await isPermissionGranted();
    if (!permitted) {
      const permission = await requestPermission();
      permitted = permission === "granted";
    }
    if (permitted) {
      sendNotification({ title, body });
    }
  } catch {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    } else if (
      "Notification" in window &&
      Notification.permission !== "denied"
    ) {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        new Notification(title, { body });
      }
    }
  }
}

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
    };

    ws.onmessage = (event) => {
      try {
        const wsEvent: WsEvent = JSON.parse(event.data);
        handleWsEvent(wsEvent);

        if (wsEvent.type === "notification") {
          showNotification(wsEvent.title, wsEvent.body);
        } else if (
          wsEvent.type === "statusChanged" &&
          (wsEvent.status === "waiting_for_input" || wsEvent.status === "error")
        ) {
          const session = useHubStore
            .getState()
            .sessions.find((s) => s.id === wsEvent.sessionId);
          const name = session?.projectName ?? "Session";
          const detail = wsEvent.detail ?? wsEvent.status.replace(/_/g, " ");
          showNotification(name, detail);
        }
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
