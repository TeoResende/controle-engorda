"""M3 — dados da fazenda e gestão de membros."""


async def test_ler_e_editar_a_fazenda_atual(client, dados, logar):
    admin = await logar(dados["admin_a"])
    atual = await client.get("/fazendas/atual", headers=admin)
    assert atual.status_code == 200
    assert atual.json()["id"] == str(dados["fazenda_a"].id)

    editado = await client.patch(
        "/fazendas/atual", json={"proprietario": "Novo Dono"}, headers=admin
    )
    assert editado.status_code == 200
    assert editado.json()["proprietario"] == "Novo Dono"


async def test_so_admin_edita_a_fazenda(client, dados, logar):
    tecnico = await logar(dados["tecnico"], dados["fazenda_a"].id)
    cliente = await logar(dados["cliente_a"])
    assert (await client.patch("/fazendas/atual", json={"nome": "x"}, headers=tecnico)).status_code == 403
    assert (await client.patch("/fazendas/atual", json={"nome": "x"}, headers=cliente)).status_code == 403
    # Leitura continua liberada para os dois.
    assert (await client.get("/fazendas/atual", headers=cliente)).status_code == 200


async def test_criar_fazenda_vincula_quem_criou_como_admin(client, dados, logar):
    h = await logar(dados["cliente_a"])
    nova = await client.post("/fazendas", json={"nome": "Fazenda Recém-Criada"}, headers=h)
    assert nova.status_code == 201

    eu = (await client.get("/auth/eu", headers=h)).json()
    vinculo = next(f for f in eu["fazendas"] if f["fazenda_id"] == nova.json()["id"])
    assert vinculo["papel"] == "admin"

    # O token antigo continua apontando para a fazenda antiga: operar na nova
    # exige trocar de token.
    troca = await client.post(
        "/auth/trocar-fazenda", json={"fazenda_id": nova.json()["id"]}, headers=h
    )
    assert troca.status_code == 200
    novos = {"Authorization": f"Bearer {troca.json()['access_token']}"}
    assert (await client.get("/animais", headers=novos)).json()["total"] == 0


async def test_admin_adiciona_membro_que_ja_consegue_logar(client, dados, logar):
    admin = await logar(dados["admin_a"])
    criado = await client.post(
        "/membros",
        json={
            "nome": "Peão Novo",
            "email": "peao@teste.com",
            "senha": "senha-forte-123",
            "papel": "tecnico",
        },
        headers=admin,
    )
    assert criado.status_code == 201, criado.text

    login = await client.post(
        "/auth/login", json={"email": "peao@teste.com", "senha": "senha-forte-123"}
    )
    assert login.status_code == 200
    assert login.json()["papel"] == "tecnico"
    assert login.json()["fazenda_id"] == str(dados["fazenda_a"].id)


async def test_email_existente_vira_vinculo_novo_sem_trocar_a_senha(client, dados, logar):
    """Mesma pessoa atendendo outra fazenda: vincula, não recria a conta."""
    admin = await logar(dados["admin_a"])
    resposta = await client.post(
        "/membros",
        json={
            "nome": "Nome Diferente",
            "email": dados["cliente_b"].email,
            "senha": "outra-senha-999",
            "papel": "cliente",
        },
        headers=admin,
    )
    assert resposta.status_code == 201
    assert resposta.json()["nome"] == "Cliente B"  # nome original preservado

    # A senha original continua valendo — o admin da fazenda A não manda na conta.
    login = await client.post(
        "/auth/login",
        json={
            "email": dados["cliente_b"].email,
            "senha": dados["senha"],
            "fazenda_id": str(dados["fazenda_a"].id),
        },
    )
    assert login.status_code == 200


async def test_membro_duplicado_na_mesma_fazenda(client, dados, logar):
    admin = await logar(dados["admin_a"])
    resposta = await client.post(
        "/membros",
        json={
            "nome": "Cliente A",
            "email": dados["cliente_a"].email,
            "senha": "qualquer-coisa-1",
            "papel": "cliente",
        },
        headers=admin,
    )
    assert resposta.status_code == 409


async def test_mudar_papel_e_remover_membro(client, dados, logar):
    admin = await logar(dados["admin_a"])
    alvo = str(dados["cliente_a"].id)

    virou = await client.patch(f"/membros/{alvo}", json={"papel": "tecnico"}, headers=admin)
    assert virou.status_code == 200
    assert virou.json()["papel"] == "tecnico"

    assert (await client.delete(f"/membros/{alvo}", headers=admin)).status_code == 204
    # Vínculo desativado, não apagado: o login na fazenda deixa de funcionar...
    login = await client.post(
        "/auth/login", json={"email": dados["cliente_a"].email, "senha": dados["senha"]}
    )
    assert login.status_code == 403

    # ...mas o registro de que a pessoa passou por aqui continua consultável.
    ativos = {m["id"] for m in (await client.get("/membros", headers=admin)).json()}
    assert alvo not in ativos
    historico = (await client.get("/membros?incluir_inativos=true", headers=admin)).json()
    saiu = next(m for m in historico if m["id"] == alvo)
    assert saiu["desativado_em"] is not None


async def test_readicionar_membro_reativa_o_vinculo(client, dados, logar):
    admin = await logar(dados["admin_a"])
    alvo = str(dados["cliente_a"].id)
    await client.delete(f"/membros/{alvo}", headers=admin)

    de_volta = await client.post(
        "/membros",
        json={
            "nome": "Cliente A",
            "email": dados["cliente_a"].email,
            "senha": "irrelevante-aqui-1",
            "papel": "tecnico",
        },
        headers=admin,
    )
    assert de_volta.status_code == 201
    assert de_volta.json()["papel"] == "tecnico"

    login = await client.post(
        "/auth/login", json={"email": dados["cliente_a"].email, "senha": dados["senha"]}
    )
    assert login.status_code == 200


async def test_admin_nao_se_rebaixa_nem_se_remove(client, dados, logar):
    """Senão a fazenda fica sem ninguém capaz de gerir membros."""
    admin = await logar(dados["admin_a"])
    meu_id = str(dados["admin_a"].id)
    assert (
        await client.patch(f"/membros/{meu_id}", json={"papel": "cliente"}, headers=admin)
    ).status_code == 400
    assert (await client.delete(f"/membros/{meu_id}", headers=admin)).status_code == 400


async def test_membros_e_area_de_admin(client, dados, logar):
    tecnico = await logar(dados["tecnico"], dados["fazenda_a"].id)
    assert (await client.get("/membros", headers=tecnico)).status_code == 403


async def test_membro_de_outra_fazenda_nao_e_encontrado(client, dados, logar):
    admin = await logar(dados["admin_a"])
    resposta = await client.patch(
        f"/membros/{dados['cliente_b'].id}", json={"papel": "cliente"}, headers=admin
    )
    assert resposta.status_code == 404


async def test_reativar_membro_devolve_o_acesso(client, dados, logar):
    admin = await logar(dados["admin_a"])
    alvo = str(dados["cliente_a"].id)

    await client.delete(f"/membros/{alvo}", headers=admin)
    assert (
        await client.post(
            "/auth/login", json={"email": dados["cliente_a"].email, "senha": dados["senha"]}
        )
    ).status_code == 403

    voltou = await client.post(f"/membros/{alvo}/reativar", headers=admin)
    assert voltou.status_code == 200
    assert voltou.json()["ativo"] is True

    assert (
        await client.post(
            "/auth/login", json={"email": dados["cliente_a"].email, "senha": dados["senha"]}
        )
    ).status_code == 200


async def test_reativar_exige_admin(client, dados, logar):
    tecnico = await logar(dados["tecnico"], dados["fazenda_a"].id)
    resposta = await client.post(f"/membros/{dados['cliente_a'].id}/reativar", headers=tecnico)
    assert resposta.status_code == 403
