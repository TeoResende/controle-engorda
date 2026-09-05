"""Troca e redefinição de senha.

Sem isto, um técnico entrava com a senha que o administrador digitou por ele e
nunca podia trocá-la — numa fazenda com rotatividade de peão, a senha de quem
saiu continuaria valendo.
"""

from app.core.security import verificar_senha
from app.models import Usuario


async def _login(client, usuario, senha, fazenda_id=None):
    corpo = {"email": usuario.email, "senha": senha}
    if fazenda_id:
        corpo["fazenda_id"] = str(fazenda_id)
    return await client.post("/auth/login", json=corpo)


async def test_trocar_a_propria_senha(client, dados, logar, session):
    h = await logar(dados["cliente_a"])
    resposta = await client.post(
        "/auth/senha",
        json={"senha_atual": dados["senha"], "senha_nova": "senha-nova-forte"},
        headers=h,
    )
    assert resposta.status_code == 204

    assert (await _login(client, dados["cliente_a"], dados["senha"])).status_code == 401
    assert (await _login(client, dados["cliente_a"], "senha-nova-forte")).status_code == 200


async def test_senha_atual_errada_barra_a_troca(client, dados, logar):
    """Celular esquecido desbloqueado não pode virar conta tomada."""
    h = await logar(dados["cliente_a"])
    resposta = await client.post(
        "/auth/senha",
        json={"senha_atual": "chute", "senha_nova": "senha-nova-forte"},
        headers=h,
    )
    assert resposta.status_code == 400
    assert "atual" in resposta.json()["detail"].lower()


async def test_senha_nova_igual_a_atual(client, dados, logar):
    h = await logar(dados["cliente_a"])
    resposta = await client.post(
        "/auth/senha",
        json={"senha_atual": dados["senha"], "senha_nova": dados["senha"]},
        headers=h,
    )
    assert resposta.status_code == 400


async def test_senha_curta_e_recusada(client, dados, logar):
    h = await logar(dados["cliente_a"])
    resposta = await client.post(
        "/auth/senha",
        json={"senha_atual": dados["senha"], "senha_nova": "1234"},
        headers=h,
    )
    assert resposta.status_code == 422


async def test_trocar_senha_exige_estar_logado(client, dados):
    resposta = await client.post(
        "/auth/senha", json={"senha_atual": "x", "senha_nova": "senha-nova-forte"}
    )
    assert resposta.status_code == 401


async def test_admin_redefine_senha_de_quem_so_atende_esta_fazenda(client, dados, logar):
    admin = await logar(dados["admin_a"])
    resposta = await client.post(
        f"/membros/{dados['cliente_a'].id}/senha",
        json={"senha_nova": "redefinida-pelo-admin"},
        headers=admin,
    )
    assert resposta.status_code == 204
    assert (await _login(client, dados["cliente_a"], "redefinida-pelo-admin")).status_code == 200


async def test_admin_nao_redefine_senha_de_quem_atende_outra_fazenda(client, dados, logar):
    """Redefinir senha é tomar a conta. Se a pessoa também trabalha em outra
    fazenda, o admin daqui estaria ganhando acesso aos dados de lá."""
    admin = await logar(dados["admin_a"])
    # O técnico do fixture atende A e B.
    resposta = await client.post(
        f"/membros/{dados['tecnico'].id}/senha",
        json={"senha_nova": "tentativa-de-tomada"},
        headers=admin,
    )
    assert resposta.status_code == 403
    assert "outra fazenda" in resposta.json()["detail"]

    # A senha original continua valendo.
    assert (
        await _login(client, dados["tecnico"], dados["senha"], dados["fazenda_a"].id)
    ).status_code == 200


async def test_admin_master_redefine_senha_de_quem_quer(client, dados, logar):
    master = await logar(dados["master"], dados["fazenda_a"].id)
    resposta = await client.post(
        f"/membros/{dados['tecnico'].id}/senha",
        json={"senha_nova": "redefinida-pelo-master"},
        headers=master,
    )
    assert resposta.status_code == 204
    assert (
        await _login(client, dados["tecnico"], "redefinida-pelo-master", dados["fazenda_a"].id)
    ).status_code == 200


async def test_admin_comum_nao_redefine_senha_de_admin_master(client, dados, logar, session):
    from app.models import Papel, UsuarioFazenda

    session.add(
        UsuarioFazenda(
            usuario_id=dados["master"].id, fazenda_id=dados["fazenda_a"].id, papel=Papel.admin
        )
    )
    await session.commit()

    admin = await logar(dados["admin_a"])
    resposta = await client.post(
        f"/membros/{dados['master'].id}/senha",
        json={"senha_nova": "tentativa-no-master"},
        headers=admin,
    )
    assert resposta.status_code == 403


async def test_tecnico_nao_redefine_senha_de_ninguem(client, dados, logar):
    tecnico = await logar(dados["tecnico"], dados["fazenda_a"].id)
    resposta = await client.post(
        f"/membros/{dados['cliente_a'].id}/senha",
        json={"senha_nova": "nao-deveria-passar"},
        headers=tecnico,
    )
    assert resposta.status_code == 403


async def test_a_senha_e_guardada_com_hash(client, dados, logar, session):
    """Nunca em texto puro — nem no banco, nem em log."""
    h = await logar(dados["cliente_a"])
    await client.post(
        "/auth/senha",
        json={"senha_atual": dados["senha"], "senha_nova": "outra-senha-forte"},
        headers=h,
    )

    usuario = await session.get(Usuario, dados["cliente_a"].id)
    await session.refresh(usuario)
    assert "outra-senha-forte" not in usuario.senha_hash
    assert usuario.senha_hash.startswith("$2b$")
    assert verificar_senha("outra-senha-forte", usuario.senha_hash)
