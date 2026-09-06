"""Ícone do aplicativo — configuração global, não por fazenda.

A distinção que estes testes protegem: a **logo** identifica o cliente dentro
do produto e é de cada fazenda; o **ícone** identifica o produto e é um só por
instalação, porque o manifesto do PWA é do domínio.

E há um detalhe que só parece detalhe: a rota do ícone **é pública**. Favicon e
ícones de manifesto são buscados pelo próprio navegador, sem cabeçalho de
autenticação nenhum. Exigir token ali repetiria, no ícone, o mesmo defeito
silencioso que manteve a logo da fazenda invisível (seção 8.9).
"""

import pytest


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


async def test_a_configuracao_e_publica(client):
    """A tela de login precisa dela antes de existir token."""
    resposta = await client.get("/sistema")
    assert resposta.status_code == 200
    assert resposta.json()["tem_icone"] is False


async def test_o_icone_e_publico_e_cai_no_padrao(client):
    """Sem token e sem ícone configurado, devolve o que vem com o produto — e
    não 404, para o endereço no manifesto ser sempre o mesmo."""
    resposta = await client.get("/sistema/icone")
    assert resposta.status_code == 200
    assert resposta.headers["content-type"] == "image/png"
    assert resposta.content.startswith(b"\x89PNG")


async def test_so_o_admin_master_troca_o_icone(client, dados, logar, sem_minio):
    """Vale para todas as fazendas: um admin de fazenda mexendo nele mudaria o
    produto para todo mundo."""
    for usuario in (dados["admin_a"], dados["tecnico"], dados["cliente_a"]):
        cabecalho = await logar(usuario, dados["fazenda_a"].id)
        resposta = await client.post(
            "/sistema/icone",
            files={"arquivo": ("icone.png", b"\x89PNG-falso", "image/png")},
            headers=cabecalho,
        )
        assert resposta.status_code == 403


async def test_master_troca_e_o_icone_novo_e_servido_sem_token(
    client, dados, logar, sem_minio
):
    master = await logar(dados["master"], dados["fazenda_a"].id)

    enviado = await client.post(
        "/sistema/icone",
        files={"arquivo": ("icone.png", b"\x89PNG-novo", "image/png")},
        headers=master,
    )
    assert enviado.status_code == 200
    assert enviado.json()["tem_icone"] is True
    assert "sistema/icone.png" in sem_minio

    baixado = await client.get("/sistema/icone")
    assert baixado.status_code == 200
    assert baixado.content == b"\x89PNG-novo"


async def test_trocar_de_formato_nao_deixa_objeto_orfao(client, dados, logar, sem_minio):
    master = await logar(dados["master"], dados["fazenda_a"].id)
    await client.post(
        "/sistema/icone",
        files={"arquivo": ("icone.png", b"png", "image/png")},
        headers=master,
    )
    await client.post(
        "/sistema/icone",
        files={"arquivo": ("icone.svg", b"<svg/>", "image/svg+xml")},
        headers=master,
    )

    assert "sistema/icone.svg" in sem_minio
    assert "sistema/icone.png" not in sem_minio


async def test_remover_volta_ao_icone_do_produto(client, dados, logar, sem_minio):
    master = await logar(dados["master"], dados["fazenda_a"].id)
    await client.post(
        "/sistema/icone",
        files={"arquivo": ("icone.png", b"\x89PNG-novo", "image/png")},
        headers=master,
    )

    removido = await client.delete("/sistema/icone", headers=master)
    assert removido.status_code == 200
    assert removido.json()["tem_icone"] is False

    padrao = await client.get("/sistema/icone")
    assert padrao.content.startswith(b"\x89PNG")
    assert padrao.content != b"\x89PNG-novo"


async def test_formato_nao_aceito_e_tamanho_maximo(client, dados, logar, sem_minio):
    master = await logar(dados["master"], dados["fazenda_a"].id)

    recusado = await client.post(
        "/sistema/icone",
        files={"arquivo": ("icone.pdf", b"%PDF", "application/pdf")},
        headers=master,
    )
    assert recusado.status_code == 422

    grande = await client.post(
        "/sistema/icone",
        files={"arquivo": ("icone.png", b"x" * (600 * 1024), "image/png")},
        headers=master,
    )
    assert grande.status_code == 413


async def test_a_versao_muda_quando_o_icone_muda(client, dados, logar, sem_minio):
    """Sem isso, trocar o ícone não mudaria o endereço e o navegador continuaria
    mostrando o antigo até o cache expirar."""
    master = await logar(dados["master"], dados["fazenda_a"].id)
    antes = (await client.get("/sistema")).json()["versao_do_icone"]

    await client.post(
        "/sistema/icone",
        files={"arquivo": ("icone.png", b"png", "image/png")},
        headers=master,
    )

    depois = (await client.get("/sistema")).json()["versao_do_icone"]
    assert depois > antes
