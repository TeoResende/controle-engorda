"""Superusuário: enxerga e opera qualquer fazenda, e não é rebaixável."""


async def test_master_ve_todas_as_fazendas_sem_vinculo(client, dados, logar):
    """O master do fixture não tem vínculo com fazenda nenhuma."""
    h = await logar(dados["master"], dados["fazenda_a"].id)
    eu = (await client.get("/auth/eu", headers=h)).json()
    assert eu["admin_master"] is True
    nomes = {f["nome"] for f in eu["fazendas"]}
    assert {dados["fazenda_a"].nome, dados["fazenda_b"].nome} <= nomes


async def test_master_opera_qualquer_fazenda(client, dados, logar):
    ha = await logar(dados["master"], dados["fazenda_a"].id)
    assert {a["brinco"] for a in (await client.get("/animais", headers=ha)).json()["itens"]} == {"1001"}

    troca = await client.post(
        "/auth/trocar-fazenda", json={"fazenda_id": str(dados["fazenda_b"].id)}, headers=ha
    )
    assert troca.status_code == 200
    hb = {"Authorization": f"Bearer {troca.json()['access_token']}"}
    assert {a["brinco"] for a in (await client.get("/animais", headers=hb)).json()["itens"]} == {"2001"}


async def test_master_escreve_mesmo_sem_vinculo(client, dados, logar):
    h = await logar(dados["master"], dados["fazenda_a"].id)
    assert (await client.post("/animais", json={"brinco": "6001"}, headers=h)).status_code == 201
    assert (await client.get("/membros", headers=h)).status_code == 200


async def test_login_de_master_sem_escolher_fazenda_lista_todas(client, dados):
    resposta = await client.post(
        "/auth/login", json={"email": dados["master"].email, "senha": dados["senha"]}
    )
    assert resposta.status_code == 409
    nomes = {f["nome"] for f in resposta.json()["detail"]["fazendas"]}
    assert {dados["fazenda_a"].nome, dados["fazenda_b"].nome} <= nomes


async def test_listar_todas_as_fazendas_e_so_do_master(client, dados, logar):
    master = await logar(dados["master"], dados["fazenda_a"].id)
    todas = await client.get("/fazendas", headers=master)
    assert todas.status_code == 200
    assert len(todas.json()) >= 2

    admin = await logar(dados["admin_a"])
    assert (await client.get("/fazendas", headers=admin)).status_code == 403


async def test_admin_de_fazenda_nao_remove_nem_rebaixa_o_master(client, dados, logar, session):
    """O admin master não se rebaixa nem é rebaixado por admin de tenant."""
    from app.models import Papel, UsuarioFazenda

    # Dá ao master um vínculo com a fazenda A, para o admin ter o que tentar mexer.
    session.add(
        UsuarioFazenda(
            usuario_id=dados["master"].id, fazenda_id=dados["fazenda_a"].id, papel=Papel.admin
        )
    )
    await session.commit()

    admin = await logar(dados["admin_a"])
    alvo = str(dados["master"].id)
    assert (
        await client.patch(f"/membros/{alvo}", json={"papel": "cliente"}, headers=admin)
    ).status_code == 403
    assert (await client.delete(f"/membros/{alvo}", headers=admin)).status_code == 403


async def test_master_desativado_perde_o_superpoder_na_hora(client, dados, logar, session):
    """A flag é lida do banco, não do token: não espera o token de 12h expirar."""
    from datetime import datetime, timezone

    h = await logar(dados["master"], dados["fazenda_a"].id)
    assert (await client.get("/fazendas", headers=h)).status_code == 200

    dados["master"].desativado_em = datetime.now(timezone.utc)
    session.add(dados["master"])
    await session.commit()

    assert (await client.get("/fazendas", headers=h)).status_code == 401


async def test_master_desativa_e_reativa_fazenda(client, dados, logar):
    h = await logar(dados["master"], dados["fazenda_b"].id)
    assert (await client.delete("/fazendas/atual", headers=h)).status_code == 204

    # Fazenda desativada some das opções de login.
    login = await client.post(
        "/auth/login",
        json={
            "email": dados["cliente_b"].email,
            "senha": dados["senha"],
            "fazenda_id": str(dados["fazenda_b"].id),
        },
    )
    assert login.status_code == 403

    ha = await logar(dados["master"], dados["fazenda_a"].id)
    voltou = await client.post(f"/fazendas/{dados['fazenda_b'].id}/reativar", headers=ha)
    assert voltou.status_code == 200
    assert (
        await client.post(
            "/auth/login",
            json={
                "email": dados["cliente_b"].email,
                "senha": dados["senha"],
                "fazenda_id": str(dados["fazenda_b"].id),
            },
        )
    ).status_code == 200


async def test_admin_comum_nao_desativa_a_propria_fazenda(client, dados, logar):
    admin = await logar(dados["admin_a"])
    assert (await client.delete("/fazendas/atual", headers=admin)).status_code == 403


async def test_master_desativa_e_reativa_fazenda_por_id(client, dados, logar):
    """Sem a rota por id, desligar uma fazenda exigia trocar de token para
    entrar nela primeiro — passo sem sentido numa tela que lista todas."""
    master = await logar(dados["master"], dados["fazenda_a"].id)
    outra = str(dados["fazenda_b"].id)

    desativada = await client.delete(f"/fazendas/{outra}", headers=master)
    assert desativada.status_code == 204

    ativas = await client.get("/fazendas", headers=master)
    assert outra not in [f["id"] for f in ativas.json()]

    todas = await client.get("/fazendas?incluir_inativas=true", headers=master)
    assert outra in [f["id"] for f in todas.json()]

    reativada = await client.post(f"/fazendas/{outra}/reativar", headers=master)
    assert reativada.status_code == 200
    assert reativada.json()["desativado_em"] is None


async def test_admin_de_fazenda_nao_desativa_outra(client, dados, logar):
    admin = await logar(dados["admin_a"], dados["fazenda_a"].id)
    resposta = await client.delete(f"/fazendas/{dados['fazenda_b'].id}", headers=admin)
    assert resposta.status_code == 403


async def test_desativar_fazenda_inexistente_e_404(client, dados, logar):
    master = await logar(dados["master"], dados["fazenda_a"].id)
    resposta = await client.delete(
        "/fazendas/00000000-0000-0000-0000-000000000000", headers=master
    )
    assert resposta.status_code == 404
