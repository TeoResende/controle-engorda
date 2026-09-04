"""Worker arq — jobs assíncronos (transcrição de áudio, recálculo de GMD/alertas).

No M0 o worker apenas sobe e se conecta ao Redis; os jobs reais entram no M7/M8.
"""

import logging

from arq.connections import RedisSettings

from app.core.config import settings

logger = logging.getLogger("worker")


async def ping(ctx: dict) -> str:
    """Job trivial usado para validar que a fila está viva."""
    return "pong"


async def startup(ctx: dict) -> None:
    logger.info("worker arq iniciado — redis em %s", settings.redis_url)


async def shutdown(ctx: dict) -> None:
    logger.info("worker arq encerrado")


class WorkerSettings:
    functions = [ping]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings(host=settings.redis_host, port=settings.redis_port)
