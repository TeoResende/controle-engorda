from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.animais import router as animais_router
from app.api.auth import router as auth_router
from app.api.fazendas import router as fazendas_router
from app.api.health import router as health_router
from app.api.lotes import router as lotes_router
from app.api.usuarios import router as membros_router

app = FastAPI(
    title="Engorda — API",
    description="Acompanhamento de peso de bezerros em engorda.",
    version="0.1.0",
)

# Em dev o frontend roda em outro host (app.localhost); em produção o Traefik
# serve os dois sob o mesmo domínio e isto pode ser restringido.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(fazendas_router)
app.include_router(membros_router)
app.include_router(lotes_router)
app.include_router(animais_router)


@app.get("/")
async def raiz() -> dict:
    return {"api": "engorda", "versao": "0.1.0", "docs": "/docs"}
