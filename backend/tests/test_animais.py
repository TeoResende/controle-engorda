"""M3 — CRUD de animais, incluindo as duas regras de domínio: unicidade do
brinco só entre ativos, e histórico de troca de brinco."""

import uuid


async def test_criar_e_ler_animal(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    resposta = await client.post(
        "/animais",
        json={"brinco": "9001", "nome": "Mimoso", "raca": "Nelore", "peso_nascimento": "34.5"},
        headers=h,
    )
    assert resposta.status_code == 201, resposta.text
    criado = resposta.json()
    assert criado["brinco"] == "9001"
    assert criado["status"] == "ativo"

    lido = await client.get(f"/animais/{criado['id']}", headers=h)
    assert lido.status_code == 200
    assert lido.json()["nome"] == "Mimoso"


async def test_criar_registra_o_brinco_no_historico(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    criado = (await client.post("/animais", json={"brinco": "9002"}, headers=h)).json()

    historico = (await client.get(f"/animais/{criado['id']}/brincos", headers=h)).json()
    assert len(historico) == 1
    assert historico[0]["brinco"] == "9002"
    assert historico[0]["desvinculado_em"] is None


async def test_brinco_duplicado_entre_ativos_e_rejeitado(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    await client.post("/animais", json={"brinco": "9003"}, headers=h)
    resposta = await client.post("/animais", json={"brinco": "9003"}, headers=h)
    assert resposta.status_code == 409


async def test_brinco_pode_ser_reaproveitado_apos_o_animal_sair(client, dados, logar):
    """Brinco físico é reutilizável: o animal saiu do rebanho, a tag volta."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    primeiro = (await client.post("/animais", json={"brinco": "9004"}, headers=h)).json()

    assert (await client.post("/animais", json={"brinco": "9004"}, headers=h)).status_code == 409

    vendido = await client.patch(
        f"/animais/{primeiro['id']}", json={"status": "vendido"}, headers=h
    )
    assert vendido.status_code == 200

    segundo = await client.post("/animais", json={"brinco": "9004"}, headers=h)
    assert segundo.status_code == 201
    assert segundo.json()["id"] != primeiro["id"]


async def test_mesmo_brinco_em_fazendas_diferentes_e_permitido(client, dados, logar):
    """A unicidade é por fazenda — duas fazendas podem ter um brinco 0001."""
    ha = await logar(dados["tecnico"], dados["fazenda_a"].id)
    hb = await logar(dados["tecnico"], dados["fazenda_b"].id)
    assert (await client.post("/animais", json={"brinco": "9005"}, headers=ha)).status_code == 201
    assert (await client.post("/animais", json={"brinco": "9005"}, headers=hb)).status_code == 201


async def test_troca_de_brinco_fecha_o_anterior_no_historico(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    animal = (await client.post("/animais", json={"brinco": "9006"}, headers=h)).json()

    trocado = await client.patch(f"/animais/{animal['id']}", json={"brinco": "9007"}, headers=h)
    assert trocado.status_code == 200
    assert trocado.json()["brinco"] == "9007"

    historico = (await client.get(f"/animais/{animal['id']}/brincos", headers=h)).json()
    assert [b["brinco"] for b in historico] == ["9006", "9007"]
    assert historico[0]["desvinculado_em"] is not None
    assert historico[1]["desvinculado_em"] is None


async def test_troca_para_brinco_ja_usado_e_rejeitada(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    await client.post("/animais", json={"brinco": "9008"}, headers=h)
    outro = (await client.post("/animais", json={"brinco": "9009"}, headers=h)).json()

    resposta = await client.patch(f"/animais/{outro['id']}", json={"brinco": "9008"}, headers=h)
    assert resposta.status_code == 409


async def test_busca_por_brinco_para_a_tela_de_coleta(client, dados, logar):
    h = await logar(dados["cliente_a"])
    resposta = await client.get("/animais/por-brinco/1001", headers=h)
    assert resposta.status_code == 200
    assert resposta.json()["id"] == str(dados["animal_a"].id)

    assert (await client.get("/animais/por-brinco/0000", headers=h)).status_code == 404


async def test_busca_por_brinco_nao_atravessa_fazenda(client, dados, logar):
    h = await logar(dados["cliente_a"])
    # 2001 existe, mas na fazenda B.
    assert (await client.get("/animais/por-brinco/2001", headers=h)).status_code == 404


async def test_animal_nao_pode_apontar_para_lote_de_outra_fazenda(client, dados, logar, session):
    from app.models import Lote

    lote_b = await session.scalar(
        __import__("sqlalchemy").select(Lote).where(Lote.fazenda_id == dados["fazenda_b"].id)
    )
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    resposta = await client.post(
        "/animais", json={"brinco": "9010", "lote_id": str(lote_b.id)}, headers=h
    )
    assert resposta.status_code == 422


async def test_cliente_nao_escreve(client, dados, logar):
    h = await logar(dados["cliente_a"])
    assert (await client.post("/animais", json={"brinco": "9011"}, headers=h)).status_code == 403
    assert (
        await client.patch(f"/animais/{dados['animal_a'].id}", json={"nome": "x"}, headers=h)
    ).status_code == 403
    assert (await client.delete(f"/animais/{dados['animal_a'].id}", headers=h)).status_code == 403


async def test_listagem_pagina_e_filtra(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    for i in range(5):
        await client.post("/animais", json={"brinco": f"77{i:02d}"}, headers=h)

    pagina = (await client.get("/animais?limite=2&deslocamento=0", headers=h)).json()
    assert len(pagina["itens"]) == 2
    assert pagina["total"] >= 6

    filtrado = (await client.get("/animais?brinco=770", headers=h)).json()
    assert filtrado["total"] == 5
    assert all(a["brinco"].startswith("770") for a in filtrado["itens"])


async def test_remover_animal(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    animal = (await client.post("/animais", json={"brinco": "9012"}, headers=h)).json()
    assert (await client.delete(f"/animais/{animal['id']}", headers=h)).status_code == 204
    assert (await client.get(f"/animais/{animal['id']}", headers=h)).status_code == 404


async def test_animal_de_outra_fazenda_nao_e_editavel(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    assert (
        await client.patch(f"/animais/{dados['animal_b'].id}", json={"nome": "x"}, headers=h)
    ).status_code == 404
    assert (await client.delete(f"/animais/{dados['animal_b'].id}", headers=h)).status_code == 404
