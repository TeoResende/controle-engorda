"""M2 — login, tokens e proteção de endpoint."""

import uuid

import pytest

from app.core.security import criar_token, hash_senha, verificar_senha


async def test_login_devolve_par_de_tokens(client, dados):
    resposta = await client.post(
        "/auth/login", json={"email": dados["cliente_a"].email, "senha": dados["senha"]}
    )
    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["token_type"] == "bearer"
    assert corpo["access_token"] and corpo["refresh_token"]
    assert corpo["fazenda_id"] == str(dados["fazenda_a"].id)
    assert corpo["papel"] == "cliente"


async def test_login_com_senha_errada(client, dados):
    resposta = await client.post(
        "/auth/login", json={"email": dados["cliente_a"].email, "senha": "errada"}
    )
    assert resposta.status_code == 401


async def test_login_com_email_inexistente(client, dados):
    resposta = await client.post(
        "/auth/login", json={"email": "ninguem@teste.com", "senha": dados["senha"]}
    )
    assert resposta.status_code == 401


async def test_usuario_com_duas_fazendas_precisa_escolher(client, dados):
    """O técnico atende A e B: sem fazenda_id, o login não pode adivinhar."""
    resposta = await client.post(
        "/auth/login", json={"email": dados["tecnico"].email, "senha": dados["senha"]}
    )
    assert resposta.status_code == 409
    detalhe = resposta.json()["detail"]
    assert len(detalhe["fazendas"]) == 2

    resposta = await client.post(
        "/auth/login",
        json={
            "email": dados["tecnico"].email,
            "senha": dados["senha"],
            "fazenda_id": str(dados["fazenda_b"].id),
        },
    )
    assert resposta.status_code == 200
    assert resposta.json()["fazenda_id"] == str(dados["fazenda_b"].id)


async def test_login_em_fazenda_sem_vinculo(client, dados):
    resposta = await client.post(
        "/auth/login",
        json={
            "email": dados["cliente_a"].email,
            "senha": dados["senha"],
            "fazenda_id": str(dados["fazenda_b"].id),
        },
    )
    assert resposta.status_code == 403


async def test_endpoint_protegido_exige_token(client, dados):
    assert (await client.get("/animais")).status_code == 401
    assert (
        await client.get("/animais", headers={"Authorization": "Bearer lixo"})
    ).status_code == 401


async def test_access_token_nao_serve_como_refresh(client, dados, logar):
    resposta = await client.post(
        "/auth/login", json={"email": dados["cliente_a"].email, "senha": dados["senha"]}
    )
    access = resposta.json()["access_token"]
    # Trocar o tipo do token não pode ser suficiente para renovar sessão.
    assert (await client.post("/auth/refresh", json={"refresh_token": access})).status_code == 401


async def test_refresh_renova_o_par(client, dados):
    login = await client.post(
        "/auth/login", json={"email": dados["cliente_a"].email, "senha": dados["senha"]}
    )
    refresh = login.json()["refresh_token"]
    resposta = await client.post("/auth/refresh", json={"refresh_token": refresh})
    assert resposta.status_code == 200
    assert resposta.json()["fazenda_id"] == str(dados["fazenda_a"].id)


async def test_token_assinado_com_outra_chave_e_rejeitado(client, dados):
    import jwt

    payload = {
        "sub": str(dados["cliente_a"].id),
        "fazenda_id": str(dados["fazenda_a"].id),
        "papel": "cliente",
        "tipo": "access",
        "exp": 4102444800,
    }
    forjado = jwt.encode(payload, "chave-do-atacante", algorithm="HS256")
    resposta = await client.get("/animais", headers={"Authorization": f"Bearer {forjado}"})
    assert resposta.status_code == 401


async def test_eu_lista_as_fazendas_do_usuario(client, dados, logar):
    headers = await logar(dados["tecnico"], dados["fazenda_a"].id)
    resposta = await client.get("/auth/eu", headers=headers)
    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["papel"] == "tecnico"
    assert corpo["fazenda_id"] == str(dados["fazenda_a"].id)
    assert len(corpo["fazendas"]) == 2


@pytest.mark.parametrize("senha", ["curta", "x" * 200])
def test_hash_de_senha_aceita_qualquer_tamanho(senha):
    """bcrypt corta em 72 bytes; o pré-hash SHA-256 remove esse limite."""
    h = hash_senha(senha)
    assert verificar_senha(senha, h)
    assert not verificar_senha(senha + "!", h)
