import asyncio
from collections import defaultdict

from fastapi import WebSocket

from api.engine import players

_lock = asyncio.Lock()
_connections_by_room: dict[str, set[WebSocket]] = defaultdict(set)
_player_connections: dict[tuple[str, str], WebSocket] = {}
_connection_context: dict[WebSocket, tuple[str, str]] = {}


async def register_connection(room: str, player_id: str, websocket: WebSocket) -> None:
    previous = None
    async with _lock:
        key = (room, player_id)
        previous = _player_connections.get(key)
        _player_connections[key] = websocket
        _connection_context[websocket] = key
        _connections_by_room[room].add(websocket)

        if previous is not None and previous is not websocket:
            _connection_context.pop(previous, None)
            _connections_by_room[room].discard(previous)

    if previous is not None and previous is not websocket:
        try:
            await previous.close()
        except Exception:
            pass


async def unregister_connection(websocket: WebSocket) -> None:
    leave_context = None
    async with _lock:
        key = _connection_context.pop(websocket, None)
        if key is None:
            return

        room, player_id = key
        _connections_by_room[room].discard(websocket)
        if not _connections_by_room[room]:
            _connections_by_room.pop(room, None)

        current = _player_connections.get(key)
        if current is websocket:
            _player_connections.pop(key, None)
            leave_context = (room, player_id)

    if leave_context is not None:
        room, player_id = leave_context
        try:
            await players.leave_room(room, player_id)
        except Exception:
            pass


async def send_snapshot(websocket: WebSocket, snapshot: dict) -> None:
    await websocket.send_json({"type": "snapshot", "data": snapshot})


async def send_error(websocket: WebSocket, message: str) -> None:
    try:
        await websocket.send_json({"type": "error", "data": {"message": message}})
    except Exception:
        pass


async def broadcast_event(event_type: str, data: dict) -> None:
    room = data.get("room")
    if not isinstance(room, str) or not room:
        return

    async with _lock:
        targets = list(_connections_by_room.get(room, set()))

    if not targets:
        return

    envelope = {"type": event_type, "data": data}
    disconnected: list[WebSocket] = []
    for socket in targets:
        try:
            await socket.send_json(envelope)
        except Exception:
            disconnected.append(socket)

    for socket in disconnected:
        await unregister_connection(socket)
