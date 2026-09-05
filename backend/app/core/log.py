"""Registro estruturado.

Uma linha por evento, em JSON, no stdout — que é onde o Docker recolhe. JSON e
não texto corrido porque quem lê log de produção lê com filtro: `jq`, Loki,
CloudWatch. Uma frase bonita é ilegível para máquina, e é a máquina que vai
achar a agulha às três da manhã.

**Nada de segredo aqui.** Senha, token e corpo de requisição ficam de fora por
construção: o que se registra é quem, o quê, onde e quanto tempo levou.
"""

import json
import logging
import sys
import time
import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.config import settings

# Acompanha a requisição por toda a pilha, inclusive dentro de funções que não
# recebem o Request — é o que costura as linhas de um mesmo pedido.
id_da_requisicao: ContextVar[str] = ContextVar("id_da_requisicao", default="-")
usuario_atual_log: ContextVar[str] = ContextVar("usuario_atual_log", default="-")
fazenda_atual_log: ContextVar[str] = ContextVar("fazenda_atual_log", default="-")

CAMPOS_PADRAO = {
    "args", "asctime", "created", "exc_info", "exc_text", "filename", "funcName",
    "levelname", "levelno", "lineno", "module", "msecs", "message", "msg", "name",
    "pathname", "process", "processName", "relativeCreated", "stack_info",
    "thread", "threadName", "taskName",
}


class FormatoJson(logging.Formatter):
    def format(self, registro: logging.LogRecord) -> str:
        linha = {
            "hora": self.formatTime(registro, "%Y-%m-%dT%H:%M:%S%z"),
            "nivel": registro.levelname.lower(),
            "origem": registro.name,
            "mensagem": registro.getMessage(),
            "requisicao": id_da_requisicao.get(),
        }

        usuario = usuario_atual_log.get()
        if usuario != "-":
            linha["usuario"] = usuario
        fazenda = fazenda_atual_log.get()
        if fazenda != "-":
            linha["fazenda"] = fazenda

        # Qualquer campo extra passado com `extra={...}` entra na linha.
        for chave, valor in registro.__dict__.items():
            if chave not in CAMPOS_PADRAO and not chave.startswith("_"):
                linha[chave] = valor

        if registro.exc_info:
            linha["excecao"] = self.formatException(registro.exc_info)

        return json.dumps(linha, ensure_ascii=False, default=str)


def configurar() -> None:
    raiz = logging.getLogger()
    raiz.handlers.clear()

    saida = logging.StreamHandler(sys.stdout)
    saida.setFormatter(FormatoJson())
    raiz.addHandler(saida)
    raiz.setLevel(settings.log_level.upper())

    # O uvicorn traz os próprios handlers de texto; sem isto cada requisição
    # apareceria duas vezes, uma em JSON e outra não.
    for nome in ("uvicorn.access", "uvicorn.error", "uvicorn"):
        logger = logging.getLogger(nome)
        logger.handlers.clear()
        logger.propagate = True

    # O access log do uvicorn diria o mesmo que a nossa linha de requisição, com
    # menos: sem duração, sem usuário, sem fazenda. Duas linhas por chamada
    # dobrariam o volume sem acrescentar nada.
    logging.getLogger("uvicorn.access").setLevel("WARNING")

    # O SQLAlchemy em INFO despeja toda consulta; útil para depurar, ruído em
    # produção.
    logging.getLogger("sqlalchemy.engine").setLevel("WARNING")


logger = logging.getLogger("api")


class RegistroDeRequisicoes(BaseHTTPMiddleware):
    """Uma linha por requisição, com duração e identificador de rastreio."""

    async def dispatch(self, requisicao: Request, seguir) -> Response:
        # Aceita o id vindo do proxy, para rastrear a mesma chamada ponta a ponta.
        rastreio = requisicao.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        id_da_requisicao.set(rastreio)
        usuario_atual_log.set("-")
        fazenda_atual_log.set("-")

        comeco = time.perf_counter()
        try:
            resposta = await seguir(requisicao)
        except Exception:
            # Exceção não tratada: registra com pilha e devolve algo que a pessoa
            # possa citar ao pedir ajuda. Sem isto, um 500 some sem rastro.
            duracao = (time.perf_counter() - comeco) * 1000
            logger.exception(
                "erro não tratado",
                extra={
                    "metodo": requisicao.method,
                    "rota": requisicao.url.path,
                    "duracao_ms": round(duracao, 1),
                },
            )
            return JSONResponse(
                status_code=500,
                content={
                    "detail": "Erro interno. Informe o código abaixo ao suporte.",
                    "codigo": rastreio,
                },
                headers={"X-Request-ID": rastreio},
            )

        duracao = (time.perf_counter() - comeco) * 1000
        # /health é chamado a cada poucos segundos pelo Docker; registrá-lo
        # afogaria o log no que menos importa.
        if requisicao.url.path not in ("/health", "/pronto"):
            logger.info(
                "requisição",
                extra={
                    "metodo": requisicao.method,
                    "rota": requisicao.url.path,
                    "status": resposta.status_code,
                    "duracao_ms": round(duracao, 1),
                    # Lento é sintoma: marcar aqui evita ter que cruzar com outro
                    # painel para descobrir o que arrasta.
                    "lenta": duracao > 1000,
                },
            )

        resposta.headers["X-Request-ID"] = rastreio
        return resposta


def registrar_acao(acao: str, **detalhes) -> None:
    """Registra uma ação relevante do negócio.

    Para o que precisa ser explicado depois — exclusão definitiva, troca de
    papel, redefinição de senha. O log é a trilha de auditoria enquanto não
    existir uma tabela própria.
    """
    logger.info(acao, extra={"acao": acao, **detalhes})
