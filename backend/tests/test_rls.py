"""M10 — Row-Level Security: a segunda barreira do isolamento.

A primeira é a aplicação (`SessaoFazenda`, que filtra sozinha). Estes testes
simulam a **falha** dessa primeira barreira — consultas sem filtro nenhum, como
um endpoint escrito às pressas faria — e exigem que o banco devolva vazio em vez
de dados de outro cliente.
"""

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.db import fixar_tenant, liberar_tenant
from app.models import Animal, Lote, Pesagem


@pytest.fixture
async def sessao_app(engine):
    """Sessão com o papel restrito — o mesmo que a aplicação usa em produção."""
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s


async def test_o_papel_da_aplicacao_nao_e_superusuario(sessao_app):
    """Superusuário do Postgres **ignora RLS**, inclusive com FORCE. Se a
    aplicação conectasse como superusuário, todas as políticas seriam
    decorativas — e nada nos avisaria."""
    linha = await sessao_app.execute(
        text("SELECT current_user, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)")
    )
    usuario, superusuario = linha.one()
    assert superusuario is False, f"{usuario} é superusuário: a RLS não protege nada"


async def test_sem_tenant_nada_e_visivel(sessao_app, dados):
    """Falha fechada: sem fazenda declarada, o banco não mostra linha nenhuma."""
    for modelo in (Animal, Lote, Pesagem):
        assert (await sessao_app.scalars(select(modelo))).all() == []


async def test_consulta_sem_filtro_so_traz_a_fazenda_do_tenant(sessao_app, dados):
    """O caso que a RLS existe para cobrir: alguém escreve `select(Animal)` sem
    filtrar por fazenda. O banco filtra por baixo."""
    await fixar_tenant(sessao_app, dados["fazenda_a"].id)

    brincos = {a.brinco for a in await sessao_app.scalars(select(Animal))}
    assert brincos == {"1001"}
    assert "2001" not in brincos


async def test_buscar_pelo_id_de_outra_fazenda_nao_devolve_nada(sessao_app, dados):
    """Nem sabendo o id exato: o registro simplesmente não existe para este tenant."""
    await fixar_tenant(sessao_app, dados["fazenda_a"].id)
    assert await sessao_app.get(Animal, dados["animal_b"].id) is None

    await fixar_tenant(sessao_app, dados["fazenda_b"].id)
    sessao_app.expunge_all()
    assert await sessao_app.get(Animal, dados["animal_b"].id) is not None


async def test_contagem_sem_filtro_nao_vaza_o_tamanho_do_outro_rebanho(sessao_app, dados):
    """Contagem também vaza: saber que a outra fazenda tem 5 mil cabeças já é
    informação de negócio."""
    from sqlalchemy import func

    await fixar_tenant(sessao_app, dados["fazenda_a"].id)
    total = await sessao_app.scalar(select(func.count()).select_from(Animal))
    assert total == 1


async def test_nao_da_para_gravar_em_outra_fazenda(sessao_app, dados):
    """`WITH CHECK`: escrever carimbando outro tenant é recusado pelo banco."""
    await fixar_tenant(sessao_app, dados["fazenda_a"].id)

    sessao_app.add(Lote(fazenda_id=dados["fazenda_b"].id, nome="Invasor"))
    with pytest.raises(DBAPIError):
        await sessao_app.flush()
    await sessao_app.rollback()


async def test_nao_da_para_mover_um_registro_para_outra_fazenda(sessao_app, dados):
    await fixar_tenant(sessao_app, dados["fazenda_a"].id)

    animal = await sessao_app.get(Animal, dados["animal_a"].id)
    animal.fazenda_id = dados["fazenda_b"].id
    with pytest.raises(DBAPIError):
        await sessao_app.flush()
    await sessao_app.rollback()


async def test_apagar_de_outra_fazenda_nao_afeta_nada(sessao_app, dados, session):
    """DELETE sem WHERE de fazenda: some com o próprio rebanho, não com o alheio."""
    from sqlalchemy import delete, func

    await fixar_tenant(sessao_app, dados["fazenda_a"].id)
    await sessao_app.execute(delete(Animal))
    await sessao_app.commit()

    # A fazenda B continua intacta — conferido pela conexão administrativa.
    restantes = await session.scalar(
        select(func.count()).select_from(Animal).where(Animal.fazenda_id == dados["fazenda_b"].id)
    )
    assert restantes == 1


async def test_o_tenant_sobrevive_ao_commit(sessao_app, dados):
    """`set_config` é local à transação. Sem reaplicar a cada transação nova, o
    endpoint gravava e, ao reler o que gravou, não encontrava mais nada."""
    await fixar_tenant(sessao_app, dados["fazenda_a"].id)

    lote = Lote(fazenda_id=dados["fazenda_a"].id, nome="Depois do commit")
    sessao_app.add(lote)
    await sessao_app.commit()

    # Nova transação, mesma sessão: o tenant tem que continuar valendo.
    assert await sessao_app.get(Lote, lote.id) is not None
    assert (await sessao_app.scalars(select(Animal))).all() != []


async def test_o_tenant_nao_vaza_entre_sessoes(engine, dados):
    """Conexão devolvida ao pool não pode carregar o tenant de quem a usou."""
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async with maker() as primeira:
        await fixar_tenant(primeira, dados["fazenda_a"].id)
        assert (await primeira.scalars(select(Animal))).all() != []

    async with maker() as segunda:
        # Sem declarar tenant: não pode herdar o da sessão anterior.
        assert (await segunda.scalars(select(Animal))).all() == []


async def test_liberar_o_tenant_e_explicito(sessao_app, dados):
    """A saída existe, mas tem que ser pedida — não é o padrão."""
    assert (await sessao_app.scalars(select(Animal))).all() == []

    await liberar_tenant(sessao_app)
    brincos = {a.brinco for a in await sessao_app.scalars(select(Animal))}
    assert {"1001", "2001"} <= brincos


async def test_tenant_inexistente_nao_ve_nada(sessao_app, dados):
    await fixar_tenant(sessao_app, uuid.uuid4())
    assert (await sessao_app.scalars(select(Animal))).all() == []
