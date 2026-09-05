"""Limites de alerta por fazenda.

Confinamento e pasto não se comparam com o mesmo número: um valor fixo no código
faria uma das duas parecer sempre ruim.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.models import Animal, Pesagem


@pytest.fixture
async def animal_com_ganho_medio(session, dados):
    """Ganha 0,6 kg/dia — acima do padrão (0,5) e abaixo de uma meta de 0,8."""
    animal = Animal(fazenda_id=dados["fazenda_a"].id, brinco="3001")
    session.add(animal)
    await session.commit()

    for dias, peso in ((100, "200.00"), (0, "260.00")):
        d = date.today() - timedelta(days=dias)
        session.add(
            Pesagem(
                id=uuid.uuid4(),
                fazenda_id=animal.fazenda_id,
                animal_id=animal.id,
                data=d,
                peso_kg=Decimal(peso),
                coletado_em=datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc),
            )
        )
    await session.commit()
    return animal


async def test_meta_padrao_nao_alerta(client, dados, logar, animal_com_ganho_medio):
    h = await logar(dados["cliente_a"])
    d = (await client.get("/metricas/visao-geral", headers=h)).json()

    assert Decimal(d["gmd_meta"]) == Decimal("0.500")
    assert "3001" not in [a["brinco"] for a in d["alertas"]]


async def test_meta_mais_exigente_faz_o_mesmo_animal_alertar(
    client, dados, logar, animal_com_ganho_medio
):
    admin = await logar(dados["admin_a"])
    await client.patch("/fazendas/atual", json={"gmd_meta": "0.800"}, headers=admin)

    h = await logar(dados["cliente_a"])
    d = (await client.get("/metricas/visao-geral", headers=h)).json()

    assert Decimal(d["gmd_meta"]) == Decimal("0.800")
    alerta = next(a for a in d["alertas"] if a["brinco"] == "3001")
    assert alerta["tipo"] == "gmd_baixo"
    assert "0.80" in alerta["mensagem"]


async def test_prazo_sem_pesagem_e_configuravel(client, dados, logar, session):
    parado = Animal(fazenda_id=dados["fazenda_a"].id, brinco="3002")
    session.add(parado)
    await session.commit()
    d = date.today() - timedelta(days=20)
    session.add(
        Pesagem(
            id=uuid.uuid4(),
            fazenda_id=parado.fazenda_id,
            animal_id=parado.id,
            data=d,
            peso_kg=Decimal("250.00"),
            coletado_em=datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc),
        )
    )
    await session.commit()

    cliente = await logar(dados["cliente_a"])
    antes = (await client.get("/metricas/visao-geral", headers=cliente)).json()
    assert "3002" not in [a["brinco"] for a in antes["alertas"] if a["tipo"] == "sem_pesagem"]

    admin = await logar(dados["admin_a"])
    await client.patch("/fazendas/atual", json={"dias_sem_pesagem": 15}, headers=admin)

    depois = (await client.get("/metricas/visao-geral", headers=cliente)).json()
    assert "3002" in [a["brinco"] for a in depois["alertas"] if a["tipo"] == "sem_pesagem"]


async def test_limite_fora_da_faixa_e_recusado(client, dados, logar):
    admin = await logar(dados["admin_a"])
    assert (
        await client.patch("/fazendas/atual", json={"gmd_meta": "0"}, headers=admin)
    ).status_code == 422
    assert (
        await client.patch("/fazendas/atual", json={"dias_sem_pesagem": 0}, headers=admin)
    ).status_code == 422


async def test_cada_fazenda_tem_a_propria_meta(client, dados, logar):
    admin = await logar(dados["admin_a"])
    await client.patch("/fazendas/atual", json={"gmd_meta": "1.200"}, headers=admin)

    master_b = await logar(dados["master"], dados["fazenda_b"].id)
    outra = (await client.get("/metricas/visao-geral", headers=master_b)).json()
    assert Decimal(outra["gmd_meta"]) == Decimal("0.500")
