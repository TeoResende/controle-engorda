from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.animais import router as animais_router
from app.api.auth import router as auth_router
from app.api.exportar import router as exportar_router
from app.api.fazendas import router as fazendas_router
from app.api.health import router as health_router
from app.api.lotes import router as lotes_router
from app.api.metricas import router as metricas_router
from app.api.pesagens import router as pesagens_router
from app.api.setup import router as setup_router
import logging

from app.core.config import ConfiguracaoInsegura, conferir_para_producao, settings
from app.core.log import RegistroDeRequisicoes, configurar
from app.api.usuarios import router as membros_router

configurar()

# Recusa subir em produção com segredo de exemplo. Falhar aqui é barulhento e
# custa dois minutos; deixar passar é silencioso e custa os dados.
if settings.em_producao and (problemas := conferir_para_producao()):
    for problema in problemas:
        logging.getLogger("api").critical("configuração insegura", extra={"problema": problema})
    raise ConfiguracaoInsegura(
        "Configuração insegura para produção:\n  - " + "\n  - ".join(problemas)
    )

app = FastAPI(
    title="Engorda — API",
    description="Acompanhamento de peso de bezerros em engorda.",
    version="0.1.0",
    # Documentação interativa só fora de produção: ela não é uma falha de
    # segurança, mas entrega o mapa completo da API a quem estiver sondando.
    docs_url=None if settings.em_producao else "/docs",
    redoc_url=None,
    openapi_url=None if settings.em_producao else "/openapi.json",
)

# Em desenvolvimento o frontend roda em outro host; em produção ele é servido do
# mesmo domínio da API (rota /api), e aí `CORS_ORIGENS` deve listar só o domínio
# real — porta aberta sem necessidade é porta aberta.
# Antes do CORS: assim o identificador de rastreio existe mesmo em requisição
# rejeitada por origem.
app.add_middleware(RegistroDeRequisicoes)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origens_permitidas,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    # O navegador guarda o preflight por 10 minutos em vez de repeti-lo a cada
    # chamada — sensível no celular, onde cada ida à rede custa.
    max_age=600,
)


@app.get("/pronto", include_in_schema=False)
async def pronto(requisicao: Request) -> dict:
    """Diagnóstico de proxy: mostra como a requisição chegou até aqui.

    Existe porque "o app abre mas os links saem em http" é um sintoma comum e
    difícil de diagnosticar às cegas — aqui dá para ver se o proxy está mesmo
    repassando o esquema.
    """
    if settings.em_producao:
        # Em produção devolve só o essencial para conferir o proxy: os demais
        # campos ecoam cabeçalhos e o IP de quem chamou.
        return {"esquema": requisicao.url.scheme}

    return {
        "esquema": requisicao.url.scheme,
        "host": requisicao.headers.get("host"),
        "x_forwarded_proto": requisicao.headers.get("x-forwarded-proto"),
        "x_forwarded_for": requisicao.headers.get("x-forwarded-for"),
        "cliente": requisicao.client.host if requisicao.client else None,
    }

app.include_router(health_router)
app.include_router(setup_router)
app.include_router(auth_router)
app.include_router(fazendas_router)
app.include_router(membros_router)
app.include_router(lotes_router)
app.include_router(animais_router)
app.include_router(pesagens_router)
app.include_router(metricas_router)
app.include_router(exportar_router)


@app.get("/")
async def raiz() -> dict:
    return {"api": "engorda", "versao": "0.1.0", "docs": "/docs"}
