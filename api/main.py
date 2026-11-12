from contextlib import asynccontextmanager
import os
import secrets
import sqlite3

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import api.config  # noqa: F401
from api import events
from api.db import get_connection, init_db


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    await events.setup()
    yield
    await events.close()


app = FastAPI(title="Segredo do Bandido", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5500").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


class OptionIn(BaseModel):
    text: str = ""
    is_correct: bool = False


class QuestionIn(BaseModel):
    text: str = ""
    options: list[OptionIn] = []


def validate_question(payload: QuestionIn) -> str:
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="O enunciado é obrigatório.")
    if len(payload.options) != 4:
        raise HTTPException(status_code=422, detail="A pergunta deve ter exatamente 4 opções.")
    if any(not opt.text.strip() for opt in payload.options):
        raise HTTPException(status_code=422, detail="Todas as opções devem ter texto.")
    if sum(opt.is_correct for opt in payload.options) != 1:
        raise HTTPException(status_code=422, detail="A pergunta deve ter exatamente 1 opção correta.")
    return text


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/questions", status_code=201)
def create_question(payload: QuestionIn):
    text = validate_question(payload)

    with get_connection() as conn:
        cur = conn.execute("INSERT INTO questions (text) VALUES (?)", (text,))
        question_id = cur.lastrowid
        options = []
        for opt in payload.options:
            opt_text = opt.text.strip()
            opt_cur = conn.execute(
                "INSERT INTO options (question_id, text, is_correct) VALUES (?, ?, ?)",
                (question_id, opt_text, int(opt.is_correct)),
            )
            options.append({"id": opt_cur.lastrowid, "text": opt_text})

    return {"id": question_id, "text": text, "options": options}


@app.get("/questions")
def list_questions():
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, text FROM questions WHERE is_active = 1 ORDER BY id"
        ).fetchall()
        questions = []
        for row in rows:
            opts = conn.execute(
                "SELECT id, text FROM options WHERE question_id = ? ORDER BY id",
                (row["id"],),
            ).fetchall()
            questions.append(
                {
                    "id": row["id"],
                    "text": row["text"],
                    "options": [{"id": o["id"], "text": o["text"]} for o in opts],
                }
            )
    return questions


@app.get("/questions/{question_id}")
def get_question(question_id: int):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, text FROM questions WHERE id = ? AND is_active = 1",
            (question_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pergunta não encontrada.")
        opts = conn.execute(
            "SELECT id, text FROM options WHERE question_id = ? ORDER BY id",
            (question_id,),
        ).fetchall()
    return {
        "id": row["id"],
        "text": row["text"],
        "options": [{"id": o["id"], "text": o["text"]} for o in opts],
    }


@app.put("/questions/{question_id}")
def update_question(question_id: int, payload: QuestionIn):
    text = validate_question(payload)

    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM questions WHERE id = ? AND is_active = 1",
            (question_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pergunta não encontrada.")

        conn.execute(
            "UPDATE questions SET text = ? WHERE id = ?",
            (text, question_id),
        )
        existing_opts = conn.execute(
            "SELECT id FROM options WHERE question_id = ? ORDER BY id",
            (question_id,),
        ).fetchall()

        options = []
        for existing_opt, opt in zip(existing_opts, payload.options):
            opt_text = opt.text.strip()
            conn.execute(
                "UPDATE options SET text = ?, is_correct = ? WHERE id = ?",
                (opt_text, int(opt.is_correct), existing_opt["id"]),
            )
            options.append({"id": existing_opt["id"], "text": opt_text})

    return {"id": question_id, "text": text, "options": options}


@app.delete("/questions/{question_id}", status_code=204)
def delete_question(question_id: int):
    with get_connection() as conn:
        cur = conn.execute(
            "UPDATE questions SET is_active = 0 WHERE id = ? AND is_active = 1",
            (question_id,),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Pergunta não encontrada.")


@app.post("/rooms", status_code=201)
def create_room():
    with get_connection() as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM questions WHERE is_active = 1"
        ).fetchone()[0]
        if count < 3:
            raise HTTPException(
                status_code=422,
                detail="São necessárias pelo menos 3 perguntas cadastradas para abrir uma sala.",
            )

        while True:
            code = str(secrets.randbelow(9000) + 1000)
            try:
                conn.execute("INSERT INTO sessions (code) VALUES (?)", (code,))
                break
            except sqlite3.IntegrityError:
                continue

    return {"code": code, "status": "lobby"}

