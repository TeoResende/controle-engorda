import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Session

from app.core.config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True, future=True)

SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    """Base declarativa compartilhada por todos os models (M1)."""


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


# Chaves guardadas em `session.info` — ver o ouvinte de `after_begin` abaixo.
_TENANT = "app_fazenda_id"
_IGNORAR = "app_ignorar_rls"


@event.listens_for(Session, "after_begin")
def _aplicar_tenant_na_transacao(session: Session, transacao, conexao) -> None:
    """Reaplica o tenant a cada transação nova da mesma sessão.

    `set_config(..., true)` vale só **dentro da transação** — o que é o
    comportamento certo, porque a conexão volta ao pool sem guardar o tenant de
    quem a usou antes. Mas significa que, depois de um `commit`, a transação
    seguinte nasce sem tenant: o endpoint gravava e, ao reler o que gravou, não
    encontrava mais nada.

    Por isso o tenant fica anotado na sessão e é reaplicado aqui, uma vez por
    transação, enquanto a sessão durar.
    """
    if session.info.get(_IGNORAR):
        conexao.execute(text("SELECT set_config('app.ignorar_rls', 'on', true)"))
        return

    fazenda_id = session.info.get(_TENANT)
    if fazenda_id:
        conexao.execute(
            text("SELECT set_config('app.fazenda_id', :valor, true)"),
            {"valor": str(fazenda_id)},
        )


async def fixar_tenant(session: AsyncSession, fazenda_id: uuid.UUID | None) -> None:
    """Diz ao Postgres de qual fazenda é esta sessão.

    A Row-Level Security do banco lê `app.fazenda_id` para decidir quais linhas
    existem. Sem isso, uma consulta que escape do filtro da aplicação volta
    vazia em vez de devolver dados de outro cliente — que é exatamente o
    comportamento que se quer de uma segunda barreira.
    """
    session.info[_TENANT] = str(fazenda_id) if fazenda_id else None
    session.info.pop(_IGNORAR, None)
    # A transação corrente pode já ter começado antes desta chamada.
    if session.in_transaction():
        await session.execute(
            text("SELECT set_config('app.fazenda_id', :valor, true)"),
            {"valor": str(fazenda_id) if fazenda_id else ""},
        )


async def liberar_tenant(session: AsyncSession) -> None:
    """Desliga o filtro para esta sessão.

    Usado só onde a operação é legitimamente global — login, primeiro acesso,
    visão de dono do SaaS, jobs do worker, seed.
    """
    session.info[_IGNORAR] = True
    session.info.pop(_TENANT, None)
    if session.in_transaction():
        await session.execute(text("SELECT set_config('app.ignorar_rls', 'on', true)"))


@asynccontextmanager
async def visao_global(session: AsyncSession) -> AsyncIterator[None]:
    """Desliga a RLS por um trecho, e a religa ao sair.

    Existe para as perguntas que **precisam** atravessar tenants — "esta pessoa
    também trabalha em outra fazenda?" é o caso: a resposta certa depende de ver
    o que a RLS esconde, e sem isto a contagem volta zero e a verificação de
    segurança passa em silêncio, que é o pior desfecho possível.

    Use com moderação e sempre no menor trecho possível.
    """
    tenant = session.info.get(_TENANT)
    try:
        await liberar_tenant(session)
        yield
    finally:
        session.info.pop(_IGNORAR, None)
        await fixar_tenant(session, tenant)
