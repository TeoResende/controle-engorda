"""Identidade visual da fazenda: cores e logo."""

import pytest

CORES = {"cor_primaria": "#1B365D", "cor_destaque": "#F2A900", "cor_fundo": "#FAFAF7"}


async def test_admin_define_as_cores(client, dados, logar):
    admin = await logar(dados["admin_a"])
    resposta = await client.patch("/fazendas/atual", json=CORES, headers=admin)

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["cor_primaria"] == "#1B365D"
    assert corpo["cor_destaque"] == "#F2A900"


async def test_cor_invalida_e_recusada(client, dados, logar):
    admin = await logar(dados["admin_a"])
    for valor in ("azul", "#GGG", "#12345", "rgb(0,0,0)"):
        resposta = await client.patch(
            "/fazendas/atual", json={"cor_primaria": valor}, headers=admin
        )
        assert resposta.status_code == 422, valor


async def test_vazio_limpa_a_cor_e_devolve_o_padrao(client, dados, logar):
    """Limpar é diferente de gravar o padrão copiado: assim, se a referência do
    sistema mudar, quem não escolheu cor acompanha."""
    admin = await logar(dados["admin_a"])
    await client.patch("/fazendas/atual", json=CORES, headers=admin)

    resposta = await client.patch("/fazendas/atual", json={"cor_primaria": ""}, headers=admin)
    assert resposta.json()["cor_primaria"] is None


async def test_cliente_e_tecnico_nao_mudam_a_marca(client, dados, logar):
    for usuario, fazenda in ((dados["cliente_a"], None), (dados["tecnico"], dados["fazenda_a"].id)):
        h = await logar(usuario, fazenda)
        resposta = await client.patch("/fazendas/atual", json=CORES, headers=h)
        assert resposta.status_code == 403


async def test_a_marca_nao_atravessa_fazenda(client, dados, logar):
    admin = await logar(dados["admin_a"])
    await client.patch("/fazendas/atual", json=CORES, headers=admin)

    master_b = await logar(dados["master"], dados["fazenda_b"].id)
    outra = (await client.get("/fazendas/atual", headers=master_b)).json()
    assert outra["cor_primaria"] is None


@pytest.fixture
def sem_minio(monkeypatch):
    guardados: dict[str, bytes] = {}

    async def guardar(chave, conteudo, tipo):
        guardados[chave] = conteudo

    async def baixar(chave):
        return guardados[chave]

    async def apagar(chave):
        guardados.pop(chave, None)

    from app.core import armazenamento

    monkeypatch.setattr(armazenamento, "guardar", guardar)
    monkeypatch.setattr(armazenamento, "baixar", baixar)
    monkeypatch.setattr(armazenamento, "apagar", apagar)
    return guardados


async def test_enviar_e_baixar_a_logo(client, dados, logar, sem_minio):
    admin = await logar(dados["admin_a"])
    fazenda_id = str(dados["fazenda_a"].id)

    enviada = await client.post(
        "/fazendas/atual/logo",
        files={"arquivo": ("marca.png", b"\x89PNG-falso", "image/png")},
        headers=admin,
    )
    assert enviada.status_code == 200
    assert enviada.json()["tem_logo"] is True
    # Prefixada por fazenda, como os áudios: facilita cota e expurgo por tenant.
    assert any(c.startswith(f"fazendas/{fazenda_id}/marca/") for c in sem_minio)

    baixada = await client.get("/fazendas/atual/logo", headers=admin)
    assert baixada.status_code == 200
    assert baixada.content == b"\x89PNG-falso"
    assert baixada.headers["content-type"] == "image/png"


async def test_formato_nao_aceito(client, dados, logar, sem_minio):
    admin = await logar(dados["admin_a"])
    resposta = await client.post(
        "/fazendas/atual/logo",
        files={"arquivo": ("marca.pdf", b"%PDF", "application/pdf")},
        headers=admin,
    )
    assert resposta.status_code == 422


async def test_logo_grande_demais(client, dados, logar, sem_minio):
    admin = await logar(dados["admin_a"])
    resposta = await client.post(
        "/fazendas/atual/logo",
        files={"arquivo": ("marca.png", b"x" * (600 * 1024), "image/png")},
        headers=admin,
    )
    assert resposta.status_code == 413


async def test_remover_a_logo(client, dados, logar, sem_minio):
    admin = await logar(dados["admin_a"])
    await client.post(
        "/fazendas/atual/logo",
        files={"arquivo": ("marca.png", b"png", "image/png")},
        headers=admin,
    )

    removida = await client.delete("/fazendas/atual/logo", headers=admin)
    assert removida.status_code == 200
    assert removida.json()["tem_logo"] is False
    assert (await client.get("/fazendas/atual/logo", headers=admin)).status_code == 404


async def test_tecnico_nao_troca_a_logo(client, dados, logar, sem_minio):
    tecnico = await logar(dados["tecnico"], dados["fazenda_a"].id)
    resposta = await client.post(
        "/fazendas/atual/logo",
        files={"arquivo": ("marca.png", b"png", "image/png")},
        headers=tecnico,
    )
    assert resposta.status_code == 403
