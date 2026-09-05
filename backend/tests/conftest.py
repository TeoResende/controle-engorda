"""Fixtures dos testes.

Os testes rodam contra um banco Postgres separado (`<db>_test`), criado e
destruído a cada sessão de teste — nunca contra o banco de desenvolvimento.
Postgres de verdade, e não SQLite, porque partes do schema são específicas do
Postgres (índice parcial do brinco, tipos ENUM nativos).
"""

import uuid
from collections.abc import AsyncIterator

import pytest
from asyncpg import connect as asyncpg_connect
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.db import Base, get_session
from app.core.security import hash_senha
from app.main import app
from app.models import Animal, Fazenda, Lote, Papel, Usuario, UsuarioFazenda

BANCO_TESTE = f"{settings.postgres_db}_test"
URL_TESTE = (
    f"postgresql+asyncpg://{settings.postgres_user}:{settings.postgres_password}"
    f"@{settings.postgres_host}:{settings.postgres_port}/{BANCO_TESTE}"
)

SENHA = "senha-de-teste"


async def _recriar_banco() -> None:
    conn = await asyncpg_connect(
        user=settings.postgres_user,
        password=settings.postgres_password,
        host=settings.postgres_host,
        port=settings.postgres_port,
        database="postgres",
    )
    try:
        await conn.execute(
            f'SELECT pg_terminate_backend(pid) FROM pg_stat_activity '
            f"WHERE datname = '{BANCO_TESTE}' AND pid <> pg_backend_pid()"
        )
        await conn.execute(f'DROP DATABASE IF EXISTS "{BANCO_TESTE}"')
        await conn.execute(f'CREATE DATABASE "{BANCO_TESTE}"')
    finally:
        await conn.close()


@pytest.fixture(scope="session")
async def engine():
    await _recriar_banco()
    eng = create_async_engine(URL_TESTE)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest.fixture
async def session(engine) -> AsyncIterator[AsyncSession]:
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as s:
        yield s


@pytest.fixture
async def client(engine, session) -> AsyncIterator[AsyncClient]:
    async def _get_session() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = _get_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://teste") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
async def dados(session):
    """Duas fazendas com dados próprios, mais os usuários de cada uma.

    O técnico atende as duas — é o caso que mais fácil vaza se o isolamento
    depender de filtro escrito à mão no endpoint.
    """
    sufixo = uuid.uuid4().hex[:8]

    fazenda_a = Fazenda(nome=f"Fazenda A {sufixo}")
    fazenda_b = Fazenda(nome=f"Fazenda B {sufixo}")
    session.add_all([fazenda_a, fazenda_b])
    await session.flush()

    senha = hash_senha(SENHA)
    cliente_a = Usuario(nome="Cliente A", email=f"a-{sufixo}@teste.com", senha_hash=senha)
    cliente_b = Usuario(nome="Cliente B", email=f"b-{sufixo}@teste.com", senha_hash=senha)
    tecnico = Usuario(nome="Técnico", email=f"t-{sufixo}@teste.com", senha_hash=senha)
    session.add_all([cliente_a, cliente_b, tecnico])
    await session.flush()

    admin_a = Usuario(nome="Admin A", email=f"adm-{sufixo}@teste.com", senha_hash=senha)
    master = Usuario(
        nome="Master", email=f"m-{sufixo}@teste.com", senha_hash=senha, admin_master=True
    )
    session.add_all([admin_a, master])
    await session.flush()

    session.add_all(
        [
            UsuarioFazenda(usuario_id=admin_a.id, fazenda_id=fazenda_a.id, papel=Papel.admin),
            UsuarioFazenda(usuario_id=cliente_a.id, fazenda_id=fazenda_a.id, papel=Papel.cliente),
            UsuarioFazenda(usuario_id=cliente_b.id, fazenda_id=fazenda_b.id, papel=Papel.cliente),
            UsuarioFazenda(usuario_id=tecnico.id, fazenda_id=fazenda_a.id, papel=Papel.tecnico),
            UsuarioFazenda(usuario_id=tecnico.id, fazenda_id=fazenda_b.id, papel=Papel.tecnico),
        ]
    )

    lote_a = Lote(fazenda_id=fazenda_a.id, nome="Lote A")
    lote_b = Lote(fazenda_id=fazenda_b.id, nome="Lote B")
    session.add_all([lote_a, lote_b])
    await session.flush()

    animal_a = Animal(fazenda_id=fazenda_a.id, brinco="1001", lote_id=lote_a.id)
    animal_b = Animal(fazenda_id=fazenda_b.id, brinco="2001", lote_id=lote_b.id)
    session.add_all([animal_a, animal_b])
    await session.commit()

    return {
        "fazenda_a": fazenda_a,
        "fazenda_b": fazenda_b,
        "admin_a": admin_a,
        "master": master,
        "cliente_a": cliente_a,
        "cliente_b": cliente_b,
        "tecnico": tecnico,
        "animal_a": animal_a,
        "animal_b": animal_b,
        "senha": SENHA,
    }


@pytest.fixture
def logar(client):
    """Devolve os headers de Authorization já prontos para um usuário."""

    async def _logar(usuario, fazenda_id=None) -> dict[str, str]:
        corpo = {"email": usuario.email, "senha": SENHA}
        if fazenda_id is not None:
            corpo["fazenda_id"] = str(fazenda_id)
        resposta = await client.post("/auth/login", json=corpo)
        assert resposta.status_code == 200, resposta.text
        return {"Authorization": f"Bearer {resposta.json()['access_token']}"}

    return _logar


@pytest.fixture
def ctx_worker(session):
    """`ctx` do arq apontando para a sessão do teste.

    Sem isso o job abriria uma sessão para o banco de desenvolvimento e não
    enxergaria nada do que o teste preparou.
    """

    class SessaoEmprestada:
        async def __aenter__(self):
            return session

        async def __aexit__(self, *_):
            return False

    return {"sessao_factory": SessaoEmprestada}
