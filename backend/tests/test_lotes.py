"""M3 — CRUD de lotes."""


async def test_criar_listar_e_contar_animais(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    novo = await client.post("/lotes", json={"nome": "Lote Novo"}, headers=h)
    assert novo.status_code == 201
    lote_id = novo.json()["id"]

    for i in range(3):
        await client.post(
            "/animais", json={"brinco": f"88{i:02d}", "lote_id": lote_id}, headers=h
        )
    # Um animal vendido não conta como ativo.
    vendido = (
        await client.post("/animais", json={"brinco": "8899", "lote_id": lote_id}, headers=h)
    ).json()
    await client.patch(f"/animais/{vendido['id']}", json={"status": "vendido"}, headers=h)

    lotes = (await client.get("/lotes", headers=h)).json()
    alvo = next(l for l in lotes if l["id"] == lote_id)
    assert alvo["animais_ativos"] == 3


async def test_atualizar_e_remover_lote(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    lote = (await client.post("/lotes", json={"nome": "Temporário"}, headers=h)).json()

    editado = await client.patch(
        f"/lotes/{lote['id']}", json={"nome": "Renomeado", "data_formacao": "2026-01-15"}, headers=h
    )
    assert editado.status_code == 200
    assert editado.json()["nome"] == "Renomeado"
    assert editado.json()["data_formacao"] == "2026-01-15"

    assert (await client.delete(f"/lotes/{lote['id']}", headers=h)).status_code == 204
    # Desativado, não apagado: sai da listagem mas segue legível por id.
    lido = await client.get(f"/lotes/{lote['id']}", headers=h)
    assert lido.status_code == 200
    assert lido.json()["desativado_em"] is not None
    assert lote["id"] not in {l["id"] for l in (await client.get("/lotes", headers=h)).json()}
    assert lote["id"] in {
        l["id"] for l in (await client.get("/lotes?incluir_inativos=true", headers=h)).json()
    }

    voltou = await client.post(f"/lotes/{lote['id']}/reativar", headers=h)
    assert voltou.status_code == 200
    assert lote["id"] in {l["id"] for l in (await client.get("/lotes", headers=h)).json()}


async def test_desativar_lote_nao_mexe_nos_animais(client, dados, logar):
    """Histórico não some porque um lote foi desfeito — e como o lote continua no
    banco, o animal nem perde a referência de onde esteve."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    lote = (await client.post("/lotes", json={"nome": "Será desfeito"}, headers=h)).json()
    animal = (
        await client.post("/animais", json={"brinco": "8700", "lote_id": lote["id"]}, headers=h)
    ).json()

    await client.delete(f"/lotes/{lote['id']}", headers=h)

    sobrevivente = await client.get(f"/animais/{animal['id']}", headers=h)
    assert sobrevivente.status_code == 200
    assert sobrevivente.json()["lote_id"] == lote["id"]


async def test_lotes_nao_atravessam_fazenda(client, dados, logar):
    ha = await logar(dados["tecnico"], dados["fazenda_a"].id)
    hb = await logar(dados["tecnico"], dados["fazenda_b"].id)

    lote_b = (await client.post("/lotes", json={"nome": "Só da B"}, headers=hb)).json()

    assert (await client.get(f"/lotes/{lote_b['id']}", headers=ha)).status_code == 404
    nomes_a = {l["nome"] for l in (await client.get("/lotes", headers=ha)).json()}
    assert "Só da B" not in nomes_a


async def test_cliente_nao_cria_lote(client, dados, logar):
    h = await logar(dados["cliente_a"])
    assert (await client.post("/lotes", json={"nome": "x"}, headers=h)).status_code == 403
    # ...mas lê normalmente.
    assert (await client.get("/lotes", headers=h)).status_code == 200


async def test_formar_lote_movendo_varios_animais(client, dados, logar):
    """Formar um lote é agrupar dezenas de animais — um PATCH por bicho seriam
    dezenas de chamadas e dezenas de chances de parar no meio."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    lote = (await client.post("/lotes", json={"nome": "Lote Formado"}, headers=h)).json()

    ids = []
    for i in range(4):
        criado = await client.post("/animais", json={"brinco": f"66{i:02d}"}, headers=h)
        ids.append(criado.json()["id"])

    resposta = await client.post(
        f"/lotes/{lote['id']}/animais", json={"animal_ids": ids}, headers=h
    )
    assert resposta.status_code == 200
    assert resposta.json()["movidos"] == 4

    listagem = (await client.get(f"/animais?lote_id={lote['id']}", headers=h)).json()
    assert listagem["total"] == 4

    contagem = next(
        l for l in (await client.get("/lotes", headers=h)).json() if l["id"] == lote["id"]
    )
    assert contagem["animais_ativos"] == 4


async def test_mover_ignora_animal_de_outra_fazenda(client, dados, logar):
    """Id de outro tenant é ignorado em silêncio: quem pediu não deveria nem
    saber que ele existe."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    lote = (await client.post("/lotes", json={"nome": "Lote Isolado"}, headers=h)).json()

    resposta = await client.post(
        f"/lotes/{lote['id']}/animais",
        json={"animal_ids": [str(dados["animal_a"].id), str(dados["animal_b"].id)]},
        headers=h,
    )
    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["movidos"] == 1
    assert corpo["ignorados"] == [str(dados["animal_b"].id)]


async def test_tirar_animais_do_lote(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    lote = (await client.post("/lotes", json={"nome": "Lote Temporário"}, headers=h)).json()
    animal = (await client.post("/animais", json={"brinco": "6700"}, headers=h)).json()
    await client.post(f"/lotes/{lote['id']}/animais", json={"animal_ids": [animal["id"]]}, headers=h)

    resposta = await client.request(
        "DELETE",
        f"/lotes/{lote['id']}/animais",
        json={"animal_ids": [animal["id"]]},
        headers=h,
    )
    assert resposta.status_code == 200
    assert resposta.json()["movidos"] == 1

    # O animal continua existindo, agora sem lote.
    lido = (await client.get(f"/animais/{animal['id']}", headers=h)).json()
    assert lido["lote_id"] is None


async def test_mover_animais_de_um_lote_para_outro(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    origem = (await client.post("/lotes", json={"nome": "Origem"}, headers=h)).json()
    destino = (await client.post("/lotes", json={"nome": "Destino"}, headers=h)).json()
    animal = (
        await client.post("/animais", json={"brinco": "6800", "lote_id": origem["id"]}, headers=h)
    ).json()

    await client.post(
        f"/lotes/{destino['id']}/animais", json={"animal_ids": [animal["id"]]}, headers=h
    )

    lido = (await client.get(f"/animais/{animal['id']}", headers=h)).json()
    assert lido["lote_id"] == destino["id"]


async def test_cliente_nao_move_animais(client, dados, logar):
    ht = await logar(dados["tecnico"], dados["fazenda_a"].id)
    lote = (await client.post("/lotes", json={"nome": "Lote Fechado"}, headers=ht)).json()

    hc = await logar(dados["cliente_a"])
    resposta = await client.post(
        f"/lotes/{lote['id']}/animais",
        json={"animal_ids": [str(dados["animal_a"].id)]},
        headers=hc,
    )
    assert resposta.status_code == 403


async def test_lote_de_outra_fazenda_nao_recebe_animais(client, dados, logar):
    hb = await logar(dados["tecnico"], dados["fazenda_b"].id)
    lote_b = (await client.post("/lotes", json={"nome": "Só da B"}, headers=hb)).json()

    ha = await logar(dados["tecnico"], dados["fazenda_a"].id)
    resposta = await client.post(
        f"/lotes/{lote_b['id']}/animais",
        json={"animal_ids": [str(dados["animal_a"].id)]},
        headers=ha,
    )
    assert resposta.status_code == 404
