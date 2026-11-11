import json
import os

import aio_pika

EXCHANGE = "game_events"
QUEUE = "events.gpio"
QUEUE_MAX_LENGTH = 100
EVENT_TYPES = {
    "lobby_update",
    "game_started",
    "question",
    "vote_progress",
    "round_result",
    "time_penalty",
    "game_won",
    "game_lost",
}

_connection = None
_exchange = None


async def setup():
    global _connection, _exchange
    _connection = await aio_pika.connect_robust(os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/"))
    channel = await _connection.channel()
    _exchange = await channel.declare_exchange(EXCHANGE, aio_pika.ExchangeType.FANOUT, durable=False)
    queue = await channel.declare_queue(QUEUE, durable=False, arguments={"x-max-length": QUEUE_MAX_LENGTH})
    await queue.bind(_exchange)


async def close():
    await _connection.close()


async def publish(event_type: str, data: dict):
    if event_type not in EVENT_TYPES:
        raise ValueError(f"Evento desconhecido: {event_type}")
    body = json.dumps({"type": event_type, "data": data}).encode()
    await _exchange.publish(aio_pika.Message(body, content_type="application/json"), routing_key="")
