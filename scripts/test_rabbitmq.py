"""Script de teste do RabbitMQ (BAG-77).

Publica uma mensagem em uma fila de teste e a consome em seguida para validar
que o broker esta ativo, aceitando conexoes e autenticando corretamente.

Uso:
    python scripts/test_rabbitmq.py
"""

import asyncio
import json
import os
import time

import aio_pika

DEFAULT_URL = "amqp://segredo:bandido123@localhost:5672/"
TEST_QUEUE = "test.bag77"


async def main() -> None:
    url = os.getenv("RABBITMQ_URL", DEFAULT_URL)
    print(f"Conectando ao RabbitMQ em {url.split('@')[-1]}...")

    connection = await aio_pika.connect_robust(url, timeout=10)
    async with connection:
        channel = await connection.channel()
        queue = await channel.declare_queue(TEST_QUEUE, durable=False, auto_delete=True)

        payload = {
            "type": "ping",
            "source": "scripts/test_rabbitmq.py",
            "timestamp": time.time(),
        }
        body = json.dumps(payload).encode("utf-8")

        await channel.default_exchange.publish(
            aio_pika.Message(body=body, content_type="application/json"),
            routing_key=TEST_QUEUE,
        )
        print(f"Mensagem publicada na fila '{TEST_QUEUE}': {payload}")

        incoming = await queue.get(timeout=5)
        await incoming.ack()
        received = json.loads(incoming.body.decode("utf-8"))
        print(f"Mensagem consumida da fila '{TEST_QUEUE}': {received}")

        await queue.delete(if_unused=False, if_empty=False)

        if received != payload:
            raise SystemExit(f"ERRO: payload recebido difere do enviado: {received}")

    print("OK: RabbitMQ publicou e consumiu a mensagem com sucesso!")


if __name__ == "__main__":
    asyncio.run(main())
