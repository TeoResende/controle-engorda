from fastapi import APIRouter, Response, status
from redis.asyncio import Redis
from sqlalchemy import text

from app.core.config import settings
from app.core.db import engine

router = APIRouter(tags=["infra"])


async def _check_postgres() -> tuple[bool, str]:
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True, "ok"
    except Exception as exc:  # noqa: BLE001 — health check reporta o erro, não propaga
        return False, str(exc)


async def _check_redis() -> tuple[bool, str]:
    redis = Redis.from_url(settings.redis_url)
    try:
        await redis.ping()
        return True, "ok"
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)
    finally:
        await redis.aclose()


@router.get("/health")
async def health(response: Response) -> dict:
    """Health check com dependências: usado pelo docker compose e pelo Traefik."""
    pg_ok, pg_detail = await _check_postgres()
    redis_ok, redis_detail = await _check_redis()

    todo_ok = pg_ok and redis_ok
    if not todo_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {
        "status": "ok" if todo_ok else "degradado",
        "servicos": {
            "postgres": {"ok": pg_ok, "detalhe": pg_detail},
            "redis": {"ok": redis_ok, "detalhe": redis_detail},
        },
    }
