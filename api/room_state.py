from contextlib import closing
import time

from api.db import get_connection
from api.engine import players


class RoomSnapshotNotFound(Exception):
    pass


def get_room_snapshot(code: str) -> dict:
    with closing(get_connection()) as conn:
        room = conn.execute(
            "SELECT id, code, status, deadline, current_round, current_attempt FROM sessions WHERE code = ?",
            (code,),
        ).fetchone()
        if not room:
            raise RoomSnapshotNotFound("Sala não encontrada.")

        voted_player_rows = conn.execute(
            """
            SELECT player_id FROM votes
            WHERE session_id = ? AND round = ? AND attempt = ?
            ORDER BY player_id
            """,
            (room["id"], room["current_round"], room["current_attempt"]),
        ).fetchall()
        voted_player_ids = [row["player_id"] for row in voted_player_rows]

        question = None
        q_row = conn.execute(
            """
            SELECT q.id, q.text
            FROM session_questions sq
            JOIN questions q ON q.id = sq.question_id
            WHERE sq.session_id = ? AND sq.question_order = ?
            """,
            (room["id"], room["current_round"]),
        ).fetchone()
        if q_row:
            opts = conn.execute(
                "SELECT id, text FROM options WHERE question_id = ? ORDER BY id",
                (q_row["id"],),
            ).fetchall()
            eliminated = conn.execute(
                "SELECT option_id FROM eliminated_options WHERE session_id = ? AND round = ? ORDER BY option_id",
                (room["id"], room["current_round"]),
            ).fetchall()
            question = {
                "id": q_row["id"],
                "text": q_row["text"],
                "round": room["current_round"],
                "attempt": room["current_attempt"],
                "options": [{"id": o["id"], "text": o["text"]} for o in opts],
                "eliminated_options": [e["option_id"] for e in eliminated],
            }

    connected_players = players.connected_players(code)
    return {
        "code": room["code"],
        "status": room["status"],
        "current_round": room["current_round"],
        "current_attempt": room["current_attempt"],
        "deadline": room["deadline"],
        "server_now": time.time(),
        "players": connected_players,
        "vote_progress": {
            "voted": len(voted_player_ids),
            "total": len(connected_players),
            "voted_player_ids": voted_player_ids,
        },
        "question": question,
    }
