"""Worker arq — jobs assíncronos.

O que roda aqui é o que o técnico não pode ficar esperando: a transcrição do
áudio acontece depois que a pesagem já está a salvo no banco, e a resposta do
upload não depende dela.
"""

import logging
import uuid

from arq.connections import RedisSettings
from sqlalchemy import select

from app.core.config import settings
from app.core.db import SessionLocal, liberar_tenant
from app.core.log import configurar
from app.core import armazenamento
from app.models import Pesagem, StatusTranscricao
from app.transcricao import transcrever

logger = logging.getLogger("worker")


async def ping(ctx: dict) -> str:
    """Job trivial usado para validar que a fila está viva."""
    return "pong"


async def transcrever_audio(ctx: dict, pesagem_id: str) -> str:
    """Transcreve o áudio de uma pesagem e grava o texto nela.

    Idempotente por desenho: reprocessar a mesma pesagem apenas reescreve o
    mesmo campo. O arq pode reentregar o job se o worker morrer no meio.
    """
    # A fábrica vem do ctx (posta no startup) para o job ser testável contra o
    # banco de teste — o arq mantém o ctx justamente para dependências assim.
    fabrica = ctx.get("sessao_factory", SessionLocal)

    async with fabrica() as sessao:
        # O job recebe só o id da pesagem e atende todas as fazendas — não há
        # tenant a fixar. É uma das poucas operações legitimamente globais.
        await liberar_tenant(sessao)
        pesagem = await sessao.scalar(
            select(Pesagem).where(Pesagem.id == uuid.UUID(pesagem_id))
        )
        if pesagem is None or not pesagem.observacao_audio_url:
            return "sem áudio"

        pesagem.status_transcricao = StatusTranscricao.processando
        await sessao.commit()

        try:
            audio = await armazenamento.baixar(pesagem.observacao_audio_url)
            texto, via = await transcrever(audio)
        except Exception as exc:  # noqa: BLE001
            logger.exception("falha ao transcrever %s", pesagem_id)
            pesagem.status_transcricao = StatusTranscricao.falhou
            await sessao.commit()
            # O áudio continua guardado: dá para reprocessar depois, e o técnico
            # não perde a observação que gravou.
            return f"falhou: {exc}"

        # Se o técnico digitou algo E gravou áudio, os dois valem. Sobrescrever o
        # que ele escreveu seria perder informação que ele digitou de propósito.
        if pesagem.observacao_texto and pesagem.observacao_texto.strip():
            pesagem.observacao_texto = f"{pesagem.observacao_texto.strip()}\n(áudio) {texto}"
        else:
            pesagem.observacao_texto = texto

        pesagem.status_transcricao = StatusTranscricao.concluida
        await sessao.commit()
        logger.info("pesagem %s transcrita via %s", pesagem_id, via)
        return via


async def startup(ctx: dict) -> None:
    configurar()
    ctx["sessao_factory"] = SessionLocal
    logger.info("worker arq iniciado — redis em %s", settings.redis_url)


async def shutdown(ctx: dict) -> None:
    logger.info("worker arq encerrado")


class WorkerSettings:
    functions = [ping, transcrever_audio]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings(host=settings.redis_host, port=settings.redis_port)
    # Transcrição local em CPU é lenta; o default de 300s não basta.
    job_timeout = 600
    max_tries = 3
