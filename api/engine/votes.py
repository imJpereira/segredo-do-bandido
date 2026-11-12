from contextlib import closing
import sqlite3
import time

from api import events
from api.db import get_connection

players: dict[str, set[str]] = {}


class VoteRejected(Exception):
    pass


class RoomNotFound(VoteRejected):
    pass


async def register_vote(room: str, player_id: str, option_id: int) -> None:
    with closing(get_connection()) as conn, conn:
        session = conn.execute(
            "SELECT id, status, deadline, current_round, current_attempt FROM sessions WHERE code = ?",
            (room,),
        ).fetchone()
        if session is None:
            raise RoomNotFound("Sala não encontrada.")
        if session["status"] != "in_progress":
            raise VoteRejected("Sala fora de votação.")
        if player_id not in players.get(room, set()):
            raise VoteRejected("Jogador não pertence à sala.")
        if session["deadline"] is not None and time.time() > session["deadline"]:
            raise VoteRejected("Votação encerrada.")

        valid_option = conn.execute(
            """
            SELECT 1 FROM options o
            JOIN session_questions sq ON sq.question_id = o.question_id
            WHERE o.id = ? AND sq.session_id = ? AND sq.question_order = ?
              AND o.id NOT IN (
                  SELECT option_id FROM eliminated_options WHERE session_id = ? AND round = ?
              )
            """,
            (option_id, session["id"], session["current_round"], session["id"], session["current_round"]),
        ).fetchone()
        if valid_option is None:
            raise VoteRejected("Opção inválida ou eliminada.")

        try:
            conn.execute(
                "INSERT INTO votes (session_id, round, attempt, player_id, option_id) VALUES (?, ?, ?, ?, ?)",
                (session["id"], session["current_round"], session["current_attempt"], player_id, option_id),
            )
        except sqlite3.IntegrityError:
            raise VoteRejected("Jogador já votou nesta tentativa.")

        voted = conn.execute(
            "SELECT COUNT(*) FROM votes WHERE session_id = ? AND round = ? AND attempt = ?",
            (session["id"], session["current_round"], session["current_attempt"]),
        ).fetchone()[0]

    await events.publish("vote_progress", {"voted": voted, "total": len(players[room])})
