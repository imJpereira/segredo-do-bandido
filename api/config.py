import logging
import os


def _int(name: str, default: int, minimum: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except ValueError:
        raise SystemExit(f"Config invalida: {name}={raw!r} deve ser um numero inteiro.")
    if value < minimum:
        raise SystemExit(f"Config invalida: {name}={value} deve ser >= {minimum}.")
    return value


INITIAL_TIME_SECONDS = _int("INITIAL_TIME_SECONDS", 180, 1)
TIME_PENALTY_SECONDS = _int("TIME_PENALTY_SECONDS", 20, 0)
ROUND_TIME_SECONDS = _int("ROUND_TIME_SECONDS", 30, 1)

ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "change-me")
if not ADMIN_PASSWORD.strip():
    raise SystemExit("Config invalida: ADMIN_PASSWORD nao pode ser vazia.")
if ADMIN_PASSWORD == "change-me":
    logging.warning("ADMIN_PASSWORD usa o padrao 'change-me'; troque fora de dev.")
