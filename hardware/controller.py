import asyncio
import json
import logging
import os
import signal
import time

import aio_pika

from hardware.bomb import Bomb

EXCHANGE_NAME = "game_events"
QUEUE_NAME = "events.gpio"
RECONNECT_DELAY_SECONDS = 3.0

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [gpio] %(levelname)s: %(message)s",
)
logger = logging.getLogger("hardware.controller")


class BombEventHandler:
    def __init__(self, bomb: Bomb) -> None:
        self._bomb = bomb
        self._hits = 0

    async def handle_payload(self, raw_body: bytes) -> None:
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            logger.warning("Ignoring invalid JSON message")
            return

        if not isinstance(payload, dict):
            logger.warning("Ignoring non-object message")
            return

        event_type = payload.get("type")
        data = payload.get("data")
        if not isinstance(event_type, str):
            logger.warning("Ignoring message without valid type")
            return
        if not isinstance(data, dict):
            data = {}

        if event_type == "game_started":
            raw_deadline = data.get("deadline")
            try:
                deadline = float(raw_deadline) if raw_deadline is not None else time.time() + 180.0
            except (TypeError, ValueError):
                logger.warning("Invalid deadline in game_started")
                return
            self._hits = 0
            logger.info("game_started deadline=%.2f", deadline)
            await asyncio.to_thread(self._bomb.start, deadline)
            return

        if event_type == "round_result":
            if not data.get("correct"):
                logger.info("round_result incorrect")
                return
            round_value = data.get("round")
            if isinstance(round_value, int) and 1 <= round_value <= 3:
                self._hits = round_value
            else:
                self._hits = min(self._hits + 1, 3)
            logger.info("round_result correct hits=%d", self._hits)
            await asyncio.to_thread(self._bomb.hit, self._hits)
            return

        if event_type == "time_penalty":
            raw_deadline = data.get("deadline")
            if raw_deadline is not None:
                try:
                    deadline = float(raw_deadline)
                except (TypeError, ValueError):
                    logger.warning("Invalid deadline in time_penalty")
                else:
                    self._bomb.set_deadline(deadline)
            logger.info("time_penalty")
            await asyncio.to_thread(self._bomb.penalty)
            return

        if event_type == "game_won":
            logger.info("game_won")
            await asyncio.to_thread(self._bomb.win)
            return

        if event_type == "game_lost":
            logger.info("game_lost reason=%s", data.get("reason"))
            await asyncio.to_thread(self._bomb.lose)


async def consume_events(rabbitmq_url: str, handler: BombEventHandler, stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        connection = None
        try:
            connection = await aio_pika.connect_robust(rabbitmq_url)
            channel = await connection.channel()
            await channel.set_qos(prefetch_count=1)
            exchange = await channel.declare_exchange(
                EXCHANGE_NAME,
                aio_pika.ExchangeType.FANOUT,
                durable=False,
            )
            queue = await channel.declare_queue(
                QUEUE_NAME,
                durable=False,
                arguments={"x-max-length": 100},
            )
            await queue.bind(exchange)
            logger.info("Connected to RabbitMQ queue=%s", QUEUE_NAME)

            async with queue.iterator() as queue_iter:
                async for message in queue_iter:
                    if stop_event.is_set():
                        break
                    async with message.process():
                        await handler.handle_payload(message.body)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            if stop_event.is_set():
                break
            logger.warning("RabbitMQ connection error: %s", exc)
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=RECONNECT_DELAY_SECONDS)
            except asyncio.TimeoutError:
                pass
        finally:
            if connection is not None and not connection.is_closed:
                await connection.close()


def resolve_rabbitmq_url() -> str:
    explicit = os.getenv("RABBITMQ_URL")
    if explicit:
        return explicit
    user = os.getenv("RABBITMQ_USER", "segredo")
    password = os.getenv("RABBITMQ_PASS", "bandido123")
    return f"amqp://{user}:{password}@localhost:5672/"


async def run_controller() -> None:
    rabbitmq_url = resolve_rabbitmq_url()
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:
            signal.signal(sig, lambda *_: stop_event.set())

    with Bomb() as bomb:
        handler = BombEventHandler(bomb)
        consumer_task = asyncio.create_task(consume_events(rabbitmq_url, handler, stop_event))
        stop_wait_task = asyncio.create_task(stop_event.wait())
        try:
            done, pending = await asyncio.wait(
                {consumer_task, stop_wait_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                exc = task.exception()
                if exc is not None and not isinstance(exc, asyncio.CancelledError):
                    raise exc
        finally:
            logger.info("Shutting down GPIO controller")


def main() -> None:
    try:
        asyncio.run(run_controller())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
