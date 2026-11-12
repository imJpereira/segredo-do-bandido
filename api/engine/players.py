from contextlib import closing

from api import events
from api.db import get_connection
from api.engine.votes import RoomNotFound, players

MAX_PLAYERS = 30

nicknames: dict[str, dict[str, str]] = {}


class JoinRejected(Exception):
    pass


def connected_players(room: str) -> list[dict]:
    return [
        {"player_id": player_id, "nickname": nickname}
        for player_id, nickname in nicknames.get(room, {}).items()
        if player_id in players.get(room, set())
    ]


async def join_room(room: str, player_id: str, nickname: str) -> None:
    nickname = nickname.strip()
    if not nickname:
        raise JoinRejected("O apelido é obrigatório.")
    with closing(get_connection()) as conn:
        session = conn.execute("SELECT status FROM sessions WHERE code = ?", (room,)).fetchone()
    if session is None:
        raise RoomNotFound("Sala não encontrada.")

    known = nicknames.setdefault(room, {})
    if player_id not in known:
        if session["status"] != "lobby":
            raise JoinRejected("A partida já começou.")
        if len(known) >= MAX_PLAYERS:
            raise JoinRejected(f"A sala está cheia ({MAX_PLAYERS} jogadores).")
        known[player_id] = nickname
    players.setdefault(room, set()).add(player_id)
    await events.publish("lobby_update", {"room": room, "players": connected_players(room)})


async def leave_room(room: str, player_id: str) -> None:
    players.get(room, set()).discard(player_id)
    await events.publish("lobby_update", {"room": room, "players": connected_players(room)})
