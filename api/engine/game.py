from contextlib import closing
import random
import time

from api import events
from api.config import INITIAL_TIME_SECONDS
from api.db import get_connection
from api.engine.votes import RoomNotFound, players, start_deadline_watcher, start_round_timer


class StartRejected(Exception):
    pass


async def start_game(room: str) -> dict:
    with closing(get_connection()) as conn, conn:
        session = conn.execute(
            "SELECT id, status FROM sessions WHERE code = ?", (room,)
        ).fetchone()
        if session is None:
            raise RoomNotFound("Sala não encontrada.")
        if session["status"] != "lobby":
            raise StartRejected("A sala já foi iniciada.")
        if not players.get(room):
            raise StartRejected("A sala precisa de pelo menos 1 jogador conectado.")

        question_ids = [
            row["id"]
            for row in conn.execute("SELECT id FROM questions WHERE is_active = 1")
        ]
        if len(question_ids) < 3:
            raise StartRejected("São necessárias pelo menos 3 perguntas cadastradas.")

        deadline = time.time() + INITIAL_TIME_SECONDS
        started = conn.execute(
            "UPDATE sessions SET status = 'in_progress', deadline = ? WHERE id = ? AND status = 'lobby'",
            (deadline, session["id"]),
        )
        if started.rowcount == 0:
            raise StartRejected("A sala já foi iniciada.")

        drawn = random.sample(question_ids, 3)
        for order, question_id in enumerate(drawn, start=1):
            conn.execute(
                "INSERT INTO session_questions (session_id, question_order, question_id) VALUES (?, ?, ?)",
                (session["id"], order, question_id),
            )

        first = conn.execute(
            "SELECT id, text FROM questions WHERE id = ?", (drawn[0],)
        ).fetchone()
        options = conn.execute(
            "SELECT id, text FROM options WHERE question_id = ? ORDER BY id", (drawn[0],)
        ).fetchall()

    question = {
        "id": first["id"],
        "text": first["text"],
        "round": 1,
        "options": [{"id": o["id"], "text": o["text"]} for o in options],
    }
    now = time.time()
    await events.publish("game_started", {"room": room, "deadline": deadline, "server_now": now})
    await events.publish("question", {"room": room, **question})
    start_round_timer(room)
    start_deadline_watcher(room)
    return {"code": room, "status": "in_progress", "deadline": deadline, "server_now": now}
