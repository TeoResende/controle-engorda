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
    assert (await client.get(f"/lotes/{lote['id']}", headers=h)).status_code == 404


async def test_apagar_lote_nao_apaga_os_animais(client, dados, logar):
    """Regra do domínio: histórico de peso não some porque um lote foi desfeito."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    lote = (await client.post("/lotes", json={"nome": "Será desfeito"}, headers=h)).json()
    animal = (
        await client.post("/animais", json={"brinco": "8700", "lote_id": lote["id"]}, headers=h)
    ).json()

    await client.delete(f"/lotes/{lote['id']}", headers=h)

    sobrevivente = await client.get(f"/animais/{animal['id']}", headers=h)
    assert sobrevivente.status_code == 200
    assert sobrevivente.json()["lote_id"] is None


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
