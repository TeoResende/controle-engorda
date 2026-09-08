"""Curvas do dashboard: filtro de período e alinhamento por idade/DOF."""

from datetime import date, timedelta
from decimal import Decimal

from app.models import Animal, Pesagem
import uuid
from datetime import datetime, timezone


async def _pesar(session, animal, data: date, peso: str):
    session.add(Pesagem(
        id=uuid.uuid4(), fazenda_id=animal.fazenda_id, animal_id=animal.id,
        data=data, peso_kg=Decimal(peso),
        coletado_em=datetime.combine(data, datetime.min.time(), tzinfo=timezone.utc),
    ))
    await session.commit()


async def test_curva_periodo_recorta_por_data(client, session, dados, logar):
    a = Animal(fazenda_id=dados["fazenda_a"].id, brinco="C100")
    session.add(a); await session.commit()
    await _pesar(session, a, date(2026, 3, 10), "200")
    await _pesar(session, a, date(2026, 6, 10), "260")

    h = await logar(dados["cliente_a"])
    tudo = (await client.get("/metricas/curva-periodo", headers=h)).json()
    recorte = (await client.get("/metricas/curva-periodo?desde=2026-05-01&ate=2026-07-01", headers=h)).json()

    meses_recorte = [p["data"][:7] for p in recorte]
    assert "2026-06" in meses_recorte
    assert "2026-03" not in meses_recorte  # ficou fora do período
    assert len(recorte) <= len(tudo)


async def test_dof_alinha_todos_no_dia_zero(client, session, dados, logar):
    """Dois animais com primeiras pesagens em datas diferentes começam ambos no
    dia 0 no eixo de acompanhamento."""
    a = Animal(fazenda_id=dados["fazenda_a"].id, brinco="C201")
    b = Animal(fazenda_id=dados["fazenda_a"].id, brinco="C202")
    session.add_all([a, b]); await session.commit()
    await _pesar(session, a, date(2026, 1, 1), "180")
    await _pesar(session, a, date(2026, 2, 1), "210")
    await _pesar(session, b, date(2026, 3, 1), "190")  # entrou dois meses depois
    await _pesar(session, b, date(2026, 4, 1), "220")

    h = await logar(dados["cliente_a"])
    ids = f"{a.id},{b.id}"
    curva = (await client.get(f"/metricas/curva-alinhada?eixo=dof&animais={ids}", headers=h)).json()

    assert curva["eixo"] == "dof"
    assert len(curva["linhas"]) == 2
    for linha in curva["linhas"]:
        assert linha["pontos"][0]["dia"] == 0  # todos começam no zero


async def test_idade_exclui_sem_nascimento_e_conta(client, session, dados, logar):
    com = Animal(fazenda_id=dados["fazenda_a"].id, brinco="C301",
                 data_nascimento=date(2025, 1, 1))
    sem = Animal(fazenda_id=dados["fazenda_a"].id, brinco="C302")  # sem nascimento
    session.add_all([com, sem]); await session.commit()
    await _pesar(session, com, date(2025, 7, 1), "200")
    await _pesar(session, sem, date(2025, 7, 1), "200")

    h = await logar(dados["cliente_a"])
    ids = f"{com.id},{sem.id}"
    curva = (await client.get(f"/metricas/curva-alinhada?eixo=idade&animais={ids}", headers=h)).json()

    assert curva["sem_nascimento"] == 1
    assert [l["rotulo"] for l in curva["linhas"]] == ["C301"]
    # 2025-01-01 → 2025-07-01 = 181 dias de vida
    assert curva["linhas"][0]["pontos"][0]["dia"] == 181


async def test_agregar_devolve_uma_linha_media(client, session, dados, logar):
    a = Animal(fazenda_id=dados["fazenda_a"].id, brinco="C401")
    b = Animal(fazenda_id=dados["fazenda_a"].id, brinco="C402")
    session.add_all([a, b]); await session.commit()
    await _pesar(session, a, date(2026, 1, 1), "200")
    await _pesar(session, b, date(2026, 1, 1), "300")

    h = await logar(dados["cliente_a"])
    curva = (await client.get("/metricas/curva-alinhada?eixo=dof&agregar=true", headers=h)).json()
    assert len(curva["linhas"]) == 1
    assert curva["linhas"][0]["rotulo"] == "Média"
    assert Decimal(curva["linhas"][0]["pontos"][0]["peso_kg"]) == Decimal("250.00")
