"use client";
import { useEffect, useRef, useCallback } from "react";

const WS_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000")
  .replace("http://", "ws://")
  .replace("https://", "wss://");

type WSMessage = { type: string; payload: Record<string, unknown> };
type Handler = (payload: Record<string, unknown>) => void;

export function useRoomWebSocket(
  roomId: string | null,
  handlers: Record<string, Handler>
) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const connect = useCallback(() => {
    if (!roomId) return;
    const ws = new WebSocket(`${WS_BASE}/ws/${roomId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WS connected");
      // Ping to keep alive
      const interval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        } else {
          clearInterval(interval);
        }
      }, 20000);
    };

    ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        const handler = handlersRef.current[msg.type];
        if (handler) handler(msg.payload);
      } catch (e) {
        console.error("WS parse error", e);
      }
    };

    ws.onclose = (ev) => {
      console.log("WS closed", ev.code);
      // Reconnect after 2s if not intentional
      if (ev.code !== 1000) {
        setTimeout(connect, 2000);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [roomId]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close(1000, "unmount");
    };
  }, [connect]);
}
