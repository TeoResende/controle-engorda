"""M8 — números do dashboard.

Os cenários usam pesos redondos de propósito: o valor esperado tem que ser
conferível de cabeça, senão o teste só repete a conta do código.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.models import Animal, Lote, Pesagem, StatusAnimal


async def _pesar(session, animal, dias_atras: int, peso: str, hora: int = 8):
    d = date.today() - timedelta(days=dias_atras)
    session.add(
        Pesagem(
            id=uuid.uuid4(),
            fazenda_id=animal.fazenda_id,
            animal_id=animal.id,
            data=d,
            peso_kg=Decimal(peso),
            coletado_em=datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc)
            + timedelta(hours=hora),
        )
    )
    await session.commit()


@pytest.fixture
async def rebanho(session, dados):
    """Dois animais na fazenda A, com ganho conhecido.

    boi_bom: 200 → 300 kg em 100 dias  → GMD 1,000
    boi_ruim: 200 → 220 kg em 100 dias → GMD 0,200 (abaixo do mínimo)
    """
    lote = Lote(fazenda_id=dados["fazenda_a"].id, nome="Lote Métricas")
    session.add(lote)
    await session.flush()

    bom = Animal(fazenda_id=dados["fazenda_a"].id, brinco="7001", lote_id=lote.id)
    ruim = Animal(fazenda_id=dados["fazenda_a"].id, brinco="7002", lote_id=lote.id)
    session.add_all([bom, ruim])
    await session.commit()

    await _pesar(session, bom, 100, "200.00")
    await _pesar(session, bom, 0, "300.00")
    await _pesar(session, ruim, 100, "200.00")
    await _pesar(session, ruim, 0, "220.00")

    return {"lote": lote, "bom": bom, "ruim": ruim}


async def test_kpis_batem_com_as_pesagens(client, dados, logar, rebanho):
    h = await logar(dados["cliente_a"])
    d = (await client.get("/metricas/visao-geral", headers=h)).json()

    # animal_a do fixture não tem pesagem; só os dois do rebanho contam.
    assert d["animais_pesados"] == 2
    assert Decimal(d["peso_medio"]) == Decimal("260.00")  # (300 + 220) / 2
    assert Decimal(d["gmd_medio"]) == Decimal("0.600")  # (1,000 + 0,200) / 2
    assert Decimal(d["ganho_total_kg"]) == Decimal("120.00")  # 100 + 20
    assert d["ultima_pesagem"] == date.today().isoformat()


async def test_animal_com_uma_pesagem_nao_tem_gmd(client, dados, logar, session, rebanho):
    """GMD nulo, e não zero: zero seria lido como 'não está ganhando peso'."""
    novo = Animal(fazenda_id=dados["fazenda_a"].id, brinco="7003")
    session.add(novo)
    await session.commit()
    await _pesar(session, novo, 0, "250.00")

    h = await logar(dados["cliente_a"])
    d = (await client.get("/metricas/visao-geral", headers=h)).json()

    assert d["animais_pesados"] == 3
    # A média de GMD ignora quem não tem GMD: continua (1,0 + 0,2) / 2.
    assert Decimal(d["gmd_medio"]) == Decimal("0.600")


async def test_duas_pesagens_no_mesmo_dia_dao_resultado_estavel(
    client, dados, logar, session, rebanho
):
    """Repesagem no mesmo dia é normal. Sem desempate definido, o Postgres
    escolheria uma ao acaso e o mesmo dashboard mudaria a cada carga."""
    await _pesar(session, rebanho["bom"], 0, "310.00", hora=15)

    h = await logar(dados["cliente_a"])
    leituras = []
    for _ in range(4):
        d = (await client.get("/metricas/visao-geral", headers=h)).json()
        leituras.append(d["peso_medio"])

    assert len(set(leituras)) == 1
    # A mais recente do dia (15h) é a que vale.
    assert Decimal(leituras[0]) == Decimal("265.00")  # (310 + 220) / 2


async def test_pesagem_desativada_sai_das_contas(client, dados, logar, session, rebanho):
    h = await logar(dados["cliente_a"])
    antes = (await client.get("/metricas/visao-geral", headers=h)).json()
    assert Decimal(antes["peso_medio"]) == Decimal("260.00")

    ultima = await session.scalar(
        __import__("sqlalchemy")
        .select(Pesagem)
        .where(Pesagem.animal_id == rebanho["bom"].id, Pesagem.peso_kg == Decimal("300.00"))
    )
    await client.delete(f"/pesagens/{ultima.id}", headers=await logar(dados["tecnico"], dados["fazenda_a"].id))

    depois = (await client.get("/metricas/visao-geral", headers=h)).json()
    # boi_bom volta a valer 200 (só a primeira pesagem sobrou, sem GMD).
    assert Decimal(depois["peso_medio"]) == Decimal("210.00")  # (200 + 220) / 2


async def test_alerta_de_gmd_baixo(client, dados, logar, rebanho):
    h = await logar(dados["cliente_a"])
    d = (await client.get("/metricas/visao-geral", headers=h)).json()

    baixos = [a for a in d["alertas"] if a["tipo"] == "gmd_baixo"]
    assert [a["brinco"] for a in baixos] == ["7002"]
    assert Decimal(baixos[0]["valor"]) == Decimal("0.200")


async def test_alerta_de_perda_de_peso_vem_antes(client, dados, logar, session, rebanho):
    """Emagrecer é mais grave que ganhar pouco."""
    magro = Animal(fazenda_id=dados["fazenda_a"].id, brinco="7004")
    session.add(magro)
    await session.commit()
    await _pesar(session, magro, 60, "300.00")
    await _pesar(session, magro, 0, "280.00")

    h = await logar(dados["cliente_a"])
    d = (await client.get("/metricas/visao-geral", headers=h)).json()

    assert d["alertas"][0]["tipo"] == "perda_de_peso"
    assert d["alertas"][0]["brinco"] == "7004"


async def test_alerta_de_animal_sem_pesagem_recente(client, dados, logar, session):
    parado = Animal(fazenda_id=dados["fazenda_a"].id, brinco="7005")
    session.add(parado)
    await session.commit()
    await _pesar(session, parado, 200, "250.00")
    await _pesar(session, parado, 120, "300.00")

    h = await logar(dados["cliente_a"])
    d = (await client.get("/metricas/visao-geral", headers=h)).json()

    sem_pesagem = [a for a in d["alertas"] if a["tipo"] == "sem_pesagem"]
    assert "7005" in [a["brinco"] for a in sem_pesagem]


async def test_resumo_por_lote(client, dados, logar, rebanho):
    h = await logar(dados["cliente_a"])
    d = (await client.get("/metricas/visao-geral", headers=h)).json()

    lote = next(l for l in d["lotes"] if l["nome"] == "Lote Métricas")
    assert lote["animais"] == 2
    assert Decimal(lote["peso_medio"]) == Decimal("260.00")
    assert Decimal(lote["gmd_medio"]) == Decimal("0.600")


async def test_serie_agrega_por_mes(client, dados, logar, rebanho):
    h = await logar(dados["cliente_a"])
    d = (await client.get("/metricas/visao-geral", headers=h)).json()

    assert len(d["serie"]) >= 2
    assert d["serie"] == sorted(d["serie"], key=lambda p: p["data"])
    # O último ponto é o mês corrente, com os pesos de hoje.
    assert Decimal(d["serie"][-1]["peso_medio"]) == Decimal("260.00")


async def test_detalhe_do_animal(client, dados, logar, rebanho):
    h = await logar(dados["cliente_a"])
    d = (await client.get(f"/metricas/animal/{rebanho['bom'].id}", headers=h)).json()

    assert d["brinco"] == "7001"
    assert Decimal(d["peso_inicial"]) == Decimal("200.00")
    assert Decimal(d["peso_atual"]) == Decimal("300.00")
    assert Decimal(d["ganho_total"]) == Decimal("100.00")
    assert Decimal(d["gmd"]) == Decimal("1.000")
    assert d["dias_acompanhado"] == 100
    assert len(d["pesagens"]) == 2
    assert d["lote"] == "Lote Métricas"


async def test_metricas_nao_atravessam_fazenda(client, dados, logar, rebanho):
    hb = await logar(dados["cliente_b"])
    d = (await client.get("/metricas/visao-geral", headers=hb)).json()

    assert d["animais_pesados"] == 0
    assert d["lotes"] == [] or all(l["nome"] != "Lote Métricas" for l in d["lotes"])
    assert (
        await client.get(f"/metricas/animal/{rebanho['bom'].id}", headers=hb)
    ).status_code == 404


async def test_animal_desativado_sai_do_dashboard(client, dados, logar, rebanho):
    tecnico = await logar(dados["tecnico"], dados["fazenda_a"].id)
    await client.delete(f"/animais/{rebanho['ruim'].id}", headers=tecnico)

    h = await logar(dados["cliente_a"])
    d = (await client.get("/metricas/visao-geral", headers=h)).json()

    assert d["animais_pesados"] == 1
    assert Decimal(d["peso_medio"]) == Decimal("300.00")
    assert not [a for a in d["alertas"] if a["brinco"] == "7002"]


async def test_o_peso_ao_nascer_entra_na_serie_do_animal(client, session, dados, logar):
    """A curva do animal começava na primeira ida ao curral, escondendo meses de
    crescimento. O peso ao nascer é um peso medido com data — pertence à série."""
    animal = Animal(
        fazenda_id=dados["fazenda_a"].id,
        brinco="7010",
        data_nascimento=date.today() - timedelta(days=300),
        peso_nascimento=Decimal("32"),
    )
    session.add(animal)
    await session.commit()
    await _pesar(session, animal, 60, "200.00")

    h = await logar(dados["cliente_a"])
    serie = (await client.get(f"/metricas/animal/{animal.id}", headers=h)).json()["pesagens"]

    assert [p["origem"] for p in serie] == ["nascimento", "pesagem"]
    assert serie[0]["pesagem_id"] is None
    assert Decimal(serie[0]["peso_kg"]) == Decimal("32")
    # A primeira pesagem passa a ter um anterior: quanto ganhou desde que nasceu.
    assert Decimal(serie[1]["variacao"]) == Decimal("168")


async def test_animal_sem_peso_ao_nascer_nao_ganha_ponto_inventado(
    client, session, dados, logar
):
    animal = Animal(
        fazenda_id=dados["fazenda_a"].id,
        brinco="7011",
        data_nascimento=date.today() - timedelta(days=300),
    )
    session.add(animal)
    await session.commit()
    await _pesar(session, animal, 60, "200.00")

    h = await logar(dados["cliente_a"])
    serie = (await client.get(f"/metricas/animal/{animal.id}", headers=h)).json()["pesagens"]

    assert [p["origem"] for p in serie] == ["pesagem"]
    assert serie[0]["variacao"] is None


async def test_gmd_continua_medido_entre_pesagens(client, session, dados, logar):
    """O peso ao nascer entra na curva, mas **não** no GMD: o indicador é o
    ganho entre pesagens, e mudá-lo em silêncio mexeria nos alertas e nos
    números do rebanho inteiro. Se um dia virar "GMD de vida", que seja decisão
    tomada, não efeito colateral."""
    animal = Animal(
        fazenda_id=dados["fazenda_a"].id,
        brinco="7012",
        data_nascimento=date.today() - timedelta(days=120),
        peso_nascimento=Decimal("30"),
    )
    session.add(animal)
    await session.commit()
    await _pesar(session, animal, 30, "100.00")
    await _pesar(session, animal, 0, "130.00")

    h = await logar(dados["cliente_a"])
    detalhe = (await client.get(f"/metricas/animal/{animal.id}", headers=h)).json()

    assert Decimal(detalhe["peso_inicial"]) == Decimal("100")
    assert Decimal(detalhe["ganho_total"]) == Decimal("30")
    assert detalhe["dias_acompanhado"] == 30
