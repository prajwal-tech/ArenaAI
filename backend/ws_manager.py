import asyncio
from typing import Dict, Set
from fastapi import WebSocket
import json
import logging

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        # room_id -> set of websockets
        self.rooms: Dict[str, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room_id: str):
        await websocket.accept()
        if room_id not in self.rooms:
            self.rooms[room_id] = set()
        self.rooms[room_id].add(websocket)
        logger.info(f"WS connected to room {room_id}, total={len(self.rooms[room_id])}")

    def disconnect(self, websocket: WebSocket, room_id: str):
        if room_id in self.rooms:
            self.rooms[room_id].discard(websocket)
            if not self.rooms[room_id]:
                del self.rooms[room_id]
        logger.info(f"WS disconnected from room {room_id}")

    async def broadcast(self, room_id: str, event_type: str, payload: dict):
        if room_id not in self.rooms:
            return
        message = json.dumps({"type": event_type, "payload": payload})
        dead = set()
        for ws in list(self.rooms.get(room_id, [])):
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.rooms[room_id].discard(ws)

    async def send_personal(self, websocket: WebSocket, event_type: str, payload: dict):
        try:
            await websocket.send_text(json.dumps({"type": event_type, "payload": payload}))
        except Exception as e:
            logger.error(f"Failed to send personal message: {e}")


manager = ConnectionManager()
