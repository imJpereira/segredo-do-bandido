from contextlib import asynccontextmanager
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import api.config  # noqa: F401
from api import events
from api.db import init_db
from api.routers import votes


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


app.include_router(votes.router)


@app.get("/health")
def health():
    return {"status": "ok"}
