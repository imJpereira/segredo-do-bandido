from contextlib import asynccontextmanager
import os

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


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/questions", status_code=201)
def create_question(payload: QuestionIn):
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="O enunciado é obrigatório.")
    if len(payload.options) != 4:
        raise HTTPException(status_code=422, detail="A pergunta deve ter exatamente 4 opções.")
    if any(not opt.text.strip() for opt in payload.options):
        raise HTTPException(status_code=422, detail="Todas as opções devem ter texto.")
    if sum(opt.is_correct for opt in payload.options) != 1:
        raise HTTPException(status_code=422, detail="A pergunta deve ter exatamente 1 opção correta.")

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
