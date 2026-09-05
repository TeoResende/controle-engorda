"""Fixtures dos testes.

Os testes rodam contra um banco Postgres separado (`<db>_test`), criado e
destruído a cada sessão de teste — nunca contra o banco de desenvolvimento.
Postgres de verdade, e não SQLite, porque partes do schema são específicas do
Postgres (índice parcial do brinco, tipos ENUM nativos).
"""

import os
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


def _url(usuario: str, senha: str) -> str:
    return (
        f"postgresql+asyncpg://{usuario}:{senha}"
        f"@{settings.postgres_host}:{settings.postgres_port}/{BANCO_TESTE}"
    )


# A suíte roda com o **papel restrito**, o mesmo da aplicação. Com o
# superusuário a Row-Level Security seria ignorada e os testes de isolamento
# passariam sem provar nada.
URL_TESTE = _url(settings.postgres_app_user, settings.postgres_app_password)
URL_TESTE_ADMIN = _url(settings.postgres_user, settings.postgres_password)

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
    """Banco de teste montado pelas **migrations**, não por `create_all`.

    É mais lento, e é o preço de testar o schema que vai para produção: as
    políticas de Row-Level Security e o papel restrito nascem nas migrations, e
    com `create_all` os testes de isolamento rodariam contra um banco sem
    nenhuma das duas coisas — passando sem provar nada.
    """
    await _recriar_banco()

    import subprocess

    resultado = subprocess.run(
        ["alembic", "upgrade", "head"],
        cwd="/app",
        capture_output=True,
        text=True,
        env={**os.environ, "POSTGRES_DB": BANCO_TESTE},
    )
    assert resultado.returncode == 0, resultado.stderr

    eng = create_async_engine(URL_TESTE)
    yield eng
    await eng.dispose()


@pytest.fixture(scope="session")
async def engine_admin():
    """Conexão administrativa, para preparar e conferir dados nos testes."""
    eng = create_async_engine(URL_TESTE_ADMIN)
    yield eng
    await eng.dispose()


@pytest.fixture
async def session(engine, engine_admin) -> AsyncIterator[AsyncSession]:
    """Sessão de **preparo e conferência** dos testes.

    Usa a conexão administrativa de propósito: as fixtures montam dados de duas
    fazendas de uma vez, e a Row-Level Security — que existe justamente para
    impedir isso — barraria o preparo.

    É separada da sessão que o app usa. Fossem a mesma, desligar a RLS aqui a
    desligaria também para os endpoints sob teste, e os testes de isolamento
    passariam sem provar nada.
    """
    maker = async_sessionmaker(engine_admin, class_=AsyncSession, expire_on_commit=False)
    async with maker() as s:
        yield s


@pytest.fixture
async def client(engine, session) -> AsyncIterator[AsyncClient]:
    """Cliente HTTP falando com o app através do **papel restrito**.

    Cada requisição abre a própria sessão, como em produção — é o que faz a RLS
    valer de verdade durante os testes.
    """
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def _get_session() -> AsyncIterator[AsyncSession]:
        async with maker() as s:
            yield s

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
