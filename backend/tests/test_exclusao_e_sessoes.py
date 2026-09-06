"""Exclusão definitiva e sessões por fazenda."""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from app.models import Animal, Pesagem


async def _com_historico(session, dados, brinco="4444"):
    animal = Animal(fazenda_id=dados["fazenda_a"].id, brinco=brinco)
    session.add(animal)
    await session.commit()
    for peso in ("200.00", "230.00"):
        session.add(
            Pesagem(
                id=uuid.uuid4(),
                fazenda_id=animal.fazenda_id,
                animal_id=animal.id,
                data=date.today(),
                peso_kg=Decimal(peso),
                coletado_em=datetime.now(timezone.utc),
            )
        )
    await session.commit()
    return animal


async def test_admin_apaga_animal_e_o_historico_junto(client, dados, logar, session):
    """Existe para brinco reciclado e cadastro errado — os únicos casos em que
    manter o registro atrapalha mais do que ajuda."""
    animal = await _com_historico(session, dados)
    admin = await logar(dados["admin_a"])

    resposta = await client.post(
        f"/animais/{animal.id}/excluir",
        json={"brinco": "4444", "motivo": "tag reaproveitada"},
        headers=admin,
    )
    assert resposta.status_code == 204

    assert (await client.get(f"/animais/{animal.id}", headers=admin)).status_code == 404
    from sqlalchemy import func, select

    restantes = await session.scalar(
        select(func.count()).select_from(Pesagem).where(Pesagem.animal_id == animal.id)
    )
    assert restantes == 0


async def test_o_brinco_volta_a_ficar_livre(client, dados, logar, session):
    animal = await _com_historico(session, dados, "4445")
    admin = await logar(dados["admin_a"])
    await client.post(
        f"/animais/{animal.id}/excluir", json={"brinco": "4445"}, headers=admin
    )

    novo = await client.post("/animais", json={"brinco": "4445"}, headers=admin)
    assert novo.status_code == 201


async def test_confirmacao_errada_nao_apaga(client, dados, logar, session):
    """Digitar o brinco é a diferença entre um clique errado e uma decisão."""
    animal = await _com_historico(session, dados, "4446")
    admin = await logar(dados["admin_a"])

    resposta = await client.post(
        f"/animais/{animal.id}/excluir", json={"brinco": "0000"}, headers=admin
    )
    assert resposta.status_code == 400
    assert (await client.get(f"/animais/{animal.id}", headers=admin)).status_code == 200


async def test_tecnico_nao_apaga_definitivamente(client, dados, logar, session):
    animal = await _com_historico(session, dados, "4447")
    tecnico = await logar(dados["tecnico"], dados["fazenda_a"].id)

    resposta = await client.post(
        f"/animais/{animal.id}/excluir", json={"brinco": "4447"}, headers=tecnico
    )
    assert resposta.status_code == 403


async def test_animal_de_outra_fazenda_nao_e_apagavel(client, dados, logar):
    admin = await logar(dados["admin_a"])
    resposta = await client.post(
        f"/animais/{dados['animal_b'].id}/excluir", json={"brinco": "2001"}, headers=admin
    )
    assert resposta.status_code == 404


async def test_sessoes_traz_uma_por_fazenda(client, dados, logar):
    """É o que permite trocar de fazenda sem sinal: emitir token exige servidor,
    e no curral não há."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    sessoes = (await client.get("/auth/sessoes", headers=h)).json()

    assert len(sessoes) == 2
    assert {s["fazenda_nome"] for s in sessoes} == {dados["fazenda_a"].nome, dados["fazenda_b"].nome}
    assert all(s["access_token"] and s["refresh_token"] for s in sessoes)


async def test_cada_sessao_abre_a_propria_fazenda(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    sessoes = (await client.get("/auth/sessoes", headers=h)).json()

    for s in sessoes:
        cabecalho = {"Authorization": f"Bearer {s['access_token']}"}
        eu = (await client.get("/auth/eu", headers=cabecalho)).json()
        assert eu["fazenda_id"] == s["fazenda_id"]


async def test_sessoes_nao_amplia_acesso(client, dados, logar):
    """Só as fazendas que o login já daria, uma de cada vez."""
    h = await logar(dados["cliente_a"])
    sessoes = (await client.get("/auth/sessoes", headers=h)).json()

    assert [s["fazenda_nome"] for s in sessoes] == [dados["fazenda_a"].nome]


async def test_master_recebe_sessao_de_todas(client, dados, logar):
    h = await logar(dados["master"], dados["fazenda_a"].id)
    sessoes = (await client.get("/auth/sessoes", headers=h)).json()

    assert {dados["fazenda_a"].nome, dados["fazenda_b"].nome} <= {s["fazenda_nome"] for s in sessoes}
    assert all(s["papel"] == "admin" for s in sessoes)


async def test_sessoes_exige_estar_logado(client):
    assert (await client.get("/auth/sessoes")).status_code == 401
