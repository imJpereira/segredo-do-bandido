import asyncio
from contextlib import closing
import random
import sqlite3
import time

from api import events
from api.config import ROUND_TIME_SECONDS, TIME_PENALTY_SECONDS
from api.db import get_connection

players: dict[str, set[str]] = {}
closed: set[tuple[str, int, int]] = set()
timers: dict[str, asyncio.Task] = {}
watchers: dict[str, asyncio.Task] = {}


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
        if (room, session["current_round"], session["current_attempt"]) in closed:
            raise VoteRejected("Rodada encerrada.")
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

    await events.publish("vote_progress", {"room": room, "voted": voted, "total": len(players[room])})
    await close_round_if_all_voted(room)


def stop_round_timer(room: str) -> None:
    timer = timers.pop(room, None)
    if timer is not None and timer is not asyncio.current_task():
        timer.cancel()


def start_deadline_watcher(room: str) -> None:
    watchers[room] = asyncio.create_task(_end_on_deadline(room))


async def _end_on_deadline(room: str) -> None:
    while True:
        with closing(get_connection()) as conn:
            session = conn.execute(
                "SELECT status, deadline FROM sessions WHERE code = ?", (room,)
            ).fetchone()
        if session is None or session["status"] != "in_progress":
            return
        remaining = session["deadline"] - time.time()
        if remaining <= 0:
            await end_game(room, "lost", "time_expired")
            return
        await asyncio.sleep(min(remaining, 1))


def start_round_timer(room: str) -> None:
    stop_round_timer(room)
    timers[room] = asyncio.create_task(_close_on_timeout(room))


async def _close_on_timeout(room: str) -> None:
    await asyncio.sleep(ROUND_TIME_SECONDS)
    await close_round(room)


async def close_round_if_all_voted(room: str) -> None:
    connected = players.get(room, set())
    if not connected:
        return
    with closing(get_connection()) as conn:
        session = conn.execute(
            "SELECT id, status, current_round, current_attempt FROM sessions WHERE code = ?",
            (room,),
        ).fetchone()
        if session is None or session["status"] != "in_progress":
            return
        voters = {
            row["player_id"]
            for row in conn.execute(
                "SELECT player_id FROM votes WHERE session_id = ? AND round = ? AND attempt = ?",
                (session["id"], session["current_round"], session["current_attempt"]),
            )
        }
    if connected <= voters:
        await close_round(room)


async def close_round(room: str) -> None:
    with closing(get_connection()) as conn, conn:
        session = conn.execute(
            "SELECT id, status, current_round, current_attempt FROM sessions WHERE code = ?",
            (room,),
        ).fetchone()
        if session is None or session["status"] != "in_progress":
            return
        key = (room, session["current_round"], session["current_attempt"])
        if key in closed:
            return
        closed.add(key)

        counts = {
            row["option_id"]: row["n"]
            for row in conn.execute(
                "SELECT option_id, COUNT(*) AS n FROM votes WHERE session_id = ? AND round = ? AND attempt = ? GROUP BY option_id",
                (session["id"], session["current_round"], session["current_attempt"]),
            )
        }
        if not counts:
            conn.execute(
                "UPDATE sessions SET current_attempt = current_attempt + 1 WHERE id = ?",
                (session["id"],),
            )
        else:
            top = max(counts.values())
            winner = random.choice([option for option, n in counts.items() if n == top])
            correct = bool(
                conn.execute("SELECT is_correct FROM options WHERE id = ?", (winner,)).fetchone()[0]
            )

    if not counts:
        start_round_timer(room)
        await publish_question(room)
        return
    stop_round_timer(room)
    await events.publish(
        "round_result",
        {
            "room": room,
            "round": session["current_round"],
            "winning_option_id": winner,
            "correct": correct,
            "counts": counts,
        },
    )
    await advance_game(room, winner, correct)


async def publish_question(room: str) -> None:
    with closing(get_connection()) as conn:
        session = conn.execute(
            "SELECT id, current_round FROM sessions WHERE code = ?", (room,)
        ).fetchone()
        question = conn.execute(
            """
            SELECT q.id, q.text FROM session_questions sq
            JOIN questions q ON q.id = sq.question_id
            WHERE sq.session_id = ? AND sq.question_order = ?
            """,
            (session["id"], session["current_round"]),
        ).fetchone()
        options = conn.execute(
            """
            SELECT id, text FROM options WHERE question_id = ?
              AND id NOT IN (SELECT option_id FROM eliminated_options WHERE session_id = ? AND round = ?)
            ORDER BY id
            """,
            (question["id"], session["id"], session["current_round"]),
        ).fetchall()
    await events.publish(
        "question",
        {
            "room": room,
            "id": question["id"],
            "text": question["text"],
            "round": session["current_round"],
            "options": [{"id": o["id"], "text": o["text"]} for o in options],
        },
    )


async def end_game(room: str, status: str, reason: str | None = None) -> None:
    with closing(get_connection()) as conn, conn:
        ended = conn.execute(
            "UPDATE sessions SET status = ? WHERE code = ? AND status = 'in_progress'",
            (status, room),
        )
    if ended.rowcount == 0:
        return
    stop_round_timer(room)
    if status == "won":
        await events.publish("game_won", {"room": room})
    else:
        await events.publish("game_lost", {"room": room, "reason": reason})


async def open_next_vote(room: str, next_round: bool) -> None:
    with closing(get_connection()) as conn, conn:
        if next_round:
            conn.execute(
                "UPDATE sessions SET current_round = current_round + 1, current_attempt = 1 WHERE code = ?",
                (room,),
            )
        else:
            conn.execute(
                "UPDATE sessions SET current_attempt = current_attempt + 1 WHERE code = ?",
                (room,),
            )
    start_round_timer(room)
    await publish_question(room)


async def advance_game(room: str, winner: int, correct: bool) -> None:
    with closing(get_connection()) as conn, conn:
        session = conn.execute(
            "SELECT id, current_round, deadline FROM sessions WHERE code = ?", (room,)
        ).fetchone()
        current_round = session["current_round"]
        deadline = session["deadline"]
        if not correct:
            deadline -= TIME_PENALTY_SECONDS
            conn.execute("UPDATE sessions SET deadline = ? WHERE id = ?", (deadline, session["id"]))
            conn.execute(
                "INSERT INTO eliminated_options (session_id, round, option_id) VALUES (?, ?, ?)",
                (session["id"], current_round, winner),
            )
            remaining = [
                row["id"]
                for row in conn.execute(
                    """
                    SELECT o.id FROM options o
                    JOIN session_questions sq ON sq.question_id = o.question_id
                    WHERE sq.session_id = ? AND sq.question_order = ?
                      AND o.id NOT IN (
                          SELECT option_id FROM eliminated_options WHERE session_id = ? AND round = ?
                      )
                    ORDER BY o.id
                    """,
                    (session["id"], current_round, session["id"], current_round),
                )
            ]

    if not correct:
        await events.publish(
            "time_penalty",
            {"room": room, "seconds": TIME_PENALTY_SECONDS, "deadline": deadline, "server_now": time.time()},
        )
    if deadline <= time.time():
        await end_game(room, "lost", "time_expired")
        return
    if not correct:
        if len(remaining) > 1:
            await open_next_vote(room, next_round=False)
            return
        await events.publish(
            "round_result",
            {
                "room": room,
                "round": current_round,
                "winning_option_id": remaining[0],
                "correct": True,
                "counts": {},
                "auto": True,
            },
        )

    if current_round == 3:
        await end_game(room, "won")
        return
    await open_next_vote(room, next_round=True)
