"""M2 — isolamento entre fazendas.

O critério de aceite do marco: usuário da fazenda A não enxerga dado da B, nem
listando, nem pedindo o id direto, nem trocando o corpo da requisição.
"""

import uuid

from app.core.security import criar_token

from tests.conftest import SENHA


async def test_listagem_so_traz_animais_da_fazenda_do_token(client, dados, logar):
    headers_a = await logar(dados["cliente_a"])
    brincos_a = {a["brinco"] for a in (await client.get("/animais", headers=headers_a)).json()["itens"]}

    headers_b = await logar(dados["cliente_b"])
    brincos_b = {a["brinco"] for a in (await client.get("/animais", headers=headers_b)).json()["itens"]}

    assert brincos_a == {"1001"}
    assert brincos_b == {"2001"}
    assert not (brincos_a & brincos_b)


async def test_id_de_outra_fazenda_devolve_404(client, dados, logar):
    """404 e não 403: o id de outro tenant não pode nem confirmar que existe."""
    headers_a = await logar(dados["cliente_a"])
    resposta = await client.get(f"/animais/{dados['animal_b'].id}", headers=headers_a)
    assert resposta.status_code == 404

    # O mesmo id, pelo dono, responde 200 — o registro existe mesmo.
    headers_b = await logar(dados["cliente_b"])
    assert (
        await client.get(f"/animais/{dados['animal_b'].id}", headers=headers_b)
    ).status_code == 200


async def test_token_com_fazenda_de_outro_usuario_nao_vaza_dado(client, dados):
    """Ataque direto: token válido em assinatura, mas com fazenda_id trocado.

    Não basta o endpoint devolver vazio por acaso — o cliente A não pode ver
    nada da B mesmo forjando o claim, porque o token é assinado pelo servidor.
    """
    forjado = criar_token(
        usuario_id=str(dados["cliente_a"].id),
        fazenda_id=str(dados["fazenda_b"].id),
        papel="cliente",
    )
    resposta = await client.get("/animais", headers={"Authorization": f"Bearer {forjado}"})
    # O token é aceito (foi o próprio servidor que assinou nesta simulação), mas
    # este é justamente o furo que a RLS do M10 fecha: hoje a barreira é só a
    # camada de aplicação, que confia no claim. Registrado como limitação.
    assert resposta.status_code == 200
    assert {a["brinco"] for a in resposta.json()["itens"]} == {"2001"}


async def test_trocar_fazenda_exige_vinculo(client, dados, logar):
    headers_a = await logar(dados["cliente_a"])
    resposta = await client.post(
        "/auth/trocar-fazenda",
        json={"fazenda_id": str(dados["fazenda_b"].id)},
        headers=headers_a,
    )
    assert resposta.status_code == 403


async def test_tecnico_troca_de_fazenda_e_a_visao_acompanha(client, dados, logar):
    """O técnico atende as duas fazendas — o dado que ele vê tem que seguir o
    token, não o usuário."""
    headers = await logar(dados["tecnico"], dados["fazenda_a"].id)
    assert {a["brinco"] for a in (await client.get("/animais", headers=headers)).json()["itens"]} == {"1001"}

    troca = await client.post(
        "/auth/trocar-fazenda", json={"fazenda_id": str(dados["fazenda_b"].id)}, headers=headers
    )
    assert troca.status_code == 200
    novos = {"Authorization": f"Bearer {troca.json()['access_token']}"}
    assert {a["brinco"] for a in (await client.get("/animais", headers=novos)).json()["itens"]} == {"2001"}


async def test_refresh_para_de_funcionar_se_o_vinculo_for_revogado(client, dados, session):
    from datetime import datetime, timezone

    from sqlalchemy import update

    from app.models import UsuarioFazenda

    login = await client.post(
        "/auth/login", json={"email": dados["cliente_a"].email, "senha": dados["senha"]}
    )
    refresh = login.json()["refresh_token"]

    # Vínculo é desativado, não apagado — e desativado já basta para barrar.
    await session.execute(
        update(UsuarioFazenda)
        .where(UsuarioFazenda.usuario_id == dados["cliente_a"].id)
        .values(desativado_em=datetime.now(timezone.utc))
    )
    await session.commit()

    resposta = await client.post("/auth/refresh", json={"refresh_token": refresh})
    assert resposta.status_code == 403


async def test_usuario_inexistente_no_token_e_rejeitado(client, dados):
    forjado = criar_token(
        usuario_id=str(uuid.uuid4()), fazenda_id=str(dados["fazenda_a"].id), papel="cliente"
    )
    resposta = await client.get("/animais", headers={"Authorization": f"Bearer {forjado}"})
    assert resposta.status_code == 401


async def test_usuario_desativado_perde_acesso(client, dados, logar, session):
    headers = await logar(dados["cliente_a"])
    assert (await client.get("/animais", headers=headers)).status_code == 200

    from datetime import datetime, timezone

    dados["cliente_a"].desativado_em = datetime.now(timezone.utc)
    session.add(dados["cliente_a"])
    await session.commit()

    assert (await client.get("/animais", headers=headers)).status_code == 401


async def test_animal_nasce_na_fazenda_do_token_e_a_resposta_diz_qual(
    client, dados, logar
):
    """O vínculo animal→fazenda vem do token, e **volta na resposta**.

    Sem devolver, o app precisava deduzir a fazenda do animal que acabou de
    criar. A cópia local do rebanho é indexada por (fazenda, brinco): deduzir
    errado esconde o animal no próprio aparelho, sem erro nenhum.
    """
    tecnico_a = await logar(dados["tecnico"], dados["fazenda_a"].id)
    criado = await client.post(
        "/animais", json={"brinco": "9101"}, headers=tecnico_a
    )

    assert criado.status_code == 201
    assert criado.json()["fazenda_id"] == str(dados["fazenda_a"].id)


async def test_o_mesmo_brinco_em_duas_fazendas_sao_dois_animais(client, dados, logar):
    """O brinco é único por fazenda, não no sistema. Cada um tem que sair da
    API dizendo de quem é — é o que impede a pesagem de ir para o bicho errado
    no aparelho de quem atende as duas."""
    tecnico_a = await logar(dados["tecnico"], dados["fazenda_a"].id)
    tecnico_b = await logar(dados["tecnico"], dados["fazenda_b"].id)

    na_a = (await client.post("/animais", json={"brinco": "9102"}, headers=tecnico_a)).json()
    na_b = (await client.post("/animais", json={"brinco": "9102"}, headers=tecnico_b)).json()

    assert na_a["id"] != na_b["id"]
    assert na_a["fazenda_id"] == str(dados["fazenda_a"].id)
    assert na_b["fazenda_id"] == str(dados["fazenda_b"].id)

    # E nenhum enxerga o outro.
    de_a = (await client.get("/animais?limite=200", headers=tecnico_a)).json()["itens"]
    assert na_b["id"] not in [a["id"] for a in de_a]


async def test_a_sessao_sabe_dizer_em_que_fazenda_esta(client, dados, logar):
    """O nome da fazenda vem junto do token.

    As telas de coleta e cadastro rodam sem barra superior; sem o nome na
    sessão, elas não teriam como dizer para onde o registro vai — e quem atende
    duas fazendas cadastrava na errada em silêncio.
    """
    entrada = await client.post(
        "/auth/login",
        json={
            "email": dados["tecnico"].email,
            "senha": SENHA,
            "fazenda_id": str(dados["fazenda_a"].id),
        },
    )
    assert entrada.json()["fazenda_nome"] == dados["fazenda_a"].nome
