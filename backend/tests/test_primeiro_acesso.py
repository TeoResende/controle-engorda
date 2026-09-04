"""Primeiro acesso: sistema vazio precisa conseguir criar o primeiro usuário."""

import pytest
from sqlalchemy import delete

from app.models import Animal, Fazenda, Lote, Pesagem, Usuario, UsuarioFazenda


@pytest.fixture
async def sistema_vazio(session):
    """Zera o banco de teste: é o estado de uma instalação recém-subida."""
    for model in (Pesagem, Animal, Lote, UsuarioFazenda, Usuario, Fazenda):
        await session.execute(delete(model))
    await session.commit()


async def test_status_indica_que_precisa_configurar(client, sistema_vazio):
    resposta = await client.get("/setup/status")
    assert resposta.status_code == 200
    assert resposta.json()["precisa_configuracao"] is True


async def test_status_e_publico_e_nao_pede_token(client, dados):
    """O frontend consulta antes de qualquer login."""
    resposta = await client.get("/setup/status")
    assert resposta.status_code == 200
    assert resposta.json()["precisa_configuracao"] is False


async def test_primeiro_acesso_cria_master_ja_logado(client, sistema_vazio):
    resposta = await client.post(
        "/setup/primeiro-acesso",
        json={
            "nome": "Dono do Sistema",
            "email": "dono@fazenda.com",
            "senha": "primeira-senha-1",
            "nome_fazenda": "Fazenda Inicial",
        },
    )
    assert resposta.status_code == 201, resposta.text
    corpo = resposta.json()
    assert corpo["admin_master"] is True
    assert corpo["papel"] == "admin"

    # O token devolvido já opera, sem passar pelo login.
    headers = {"Authorization": f"Bearer {corpo['access_token']}"}
    eu = (await client.get("/auth/eu", headers=headers)).json()
    assert eu["usuario"]["email"] == "dono@fazenda.com"
    assert [f["nome"] for f in eu["fazendas"]] == ["Fazenda Inicial"]

    assert (await client.get("/setup/status")).json()["precisa_configuracao"] is False


async def test_primeiro_acesso_se_fecha_depois_de_configurado(client, sistema_vazio):
    corpo = {
        "nome": "Primeiro",
        "email": "primeiro@fazenda.com",
        "senha": "primeira-senha-1",
        "nome_fazenda": "Fazenda Um",
    }
    assert (await client.post("/setup/primeiro-acesso", json=corpo)).status_code == 201

    corpo["email"] = "invasor@fazenda.com"
    segunda = await client.post("/setup/primeiro-acesso", json=corpo)
    assert segunda.status_code == 409


async def test_primeiro_acesso_bloqueado_com_sistema_ja_populado(client, dados):
    resposta = await client.post(
        "/setup/primeiro-acesso",
        json={
            "nome": "Invasor",
            "email": "invasor@fazenda.com",
            "senha": "senha-do-invasor",
            "nome_fazenda": "Fazenda Pirata",
        },
    )
    assert resposta.status_code == 409


async def test_o_master_criado_consegue_logar_de_novo(client, sistema_vazio):
    await client.post(
        "/setup/primeiro-acesso",
        json={
            "nome": "Dono",
            "email": "dono2@fazenda.com",
            "senha": "primeira-senha-1",
            "nome_fazenda": "Fazenda Dois",
        },
    )
    login = await client.post(
        "/auth/login", json={"email": "dono2@fazenda.com", "senha": "primeira-senha-1"}
    )
    assert login.status_code == 200
    assert login.json()["admin_master"] is True
