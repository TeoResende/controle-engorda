"""Acesso à fila do worker a partir da API."""

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from app.core.config import settings


async def conectar() -> ArqRedis:
    return await create_pool(
        RedisSettings(host=settings.redis_host, port=settings.redis_port)
    )


async def enfileirar(job: str, *args) -> None:
    """Dispara um job. Falha aqui não pode derrubar a requisição do técnico —
    quem chama decide o que fazer, mas o dado dele já está salvo."""
    fila = await conectar()
    try:
        await fila.enqueue_job(job, *args)
    finally:
        await fila.aclose()
