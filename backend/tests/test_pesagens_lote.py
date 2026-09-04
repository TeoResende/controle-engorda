"""M4 — envio em lote: é assim que a fila do celular sobe quando a conexão volta."""

import uuid
from datetime import date, datetime, timezone

from tests.test_pesagens import payload


async def test_lote_registra_tudo_de_uma_vez(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    fila = [payload(animal_id=str(dados["animal_a"].id), peso_kg=f"3{i:02d}.00") for i in range(5)]

    resposta = await client.post("/pesagens/lote", json=fila, headers=h)
    assert resposta.status_code == 200
    corpo = resposta.json()
    assert (corpo["criadas"], corpo["duplicadas"], corpo["erros"]) == (5, 0, 0)


async def test_lote_reenviado_nao_duplica(client, dados, logar):
    """O celular só apaga a cópia local depois da confirmação — se a resposta se
    perde, ele manda a mesma fila de novo."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    fila = [payload(animal_id=str(dados["animal_a"].id)) for _ in range(3)]

    primeira = (await client.post("/pesagens/lote", json=fila, headers=h)).json()
    segunda = (await client.post("/pesagens/lote", json=fila, headers=h)).json()

    assert primeira["criadas"] == 3
    assert segunda["duplicadas"] == 3
    assert segunda["criadas"] == 0
    assert (
        await client.get(f"/pesagens?animal_id={dados['animal_a'].id}", headers=h)
    ).json()["total"] == 3


async def test_item_ruim_nao_derruba_a_fila(client, dados, logar):
    """Uma pesagem inválida no meio não pode travar a sincronização do dia."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    fila = [
        payload(animal_id=str(dados["animal_a"].id), peso_kg="300.00"),
        payload(brinco="0000"),  # brinco válido, animal inexistente
        payload(animal_id=str(dados["animal_b"].id)),  # animal de outra fazenda
        payload(animal_id=str(dados["animal_a"].id), peso_kg="305.00"),
    ]

    corpo = (await client.post("/pesagens/lote", json=fila, headers=h)).json()
    assert corpo["criadas"] == 2
    assert corpo["erros"] == 2

    situacoes = [r["situacao"] for r in corpo["resultados"]]
    assert situacoes == ["criada", "erro", "erro", "criada"]
    # O erro volta explicado, para o app poder mostrar ao técnico.
    assert "brinco" in corpo["resultados"][1]["detalhe"]


async def test_lote_parcialmente_ja_enviado(client, dados, logar):
    """Cenário real: a conexão caiu no meio do envio anterior."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    fila = [payload(animal_id=str(dados["animal_a"].id)) for _ in range(4)]

    await client.post("/pesagens/lote", json=fila[:2], headers=h)
    corpo = (await client.post("/pesagens/lote", json=fila, headers=h)).json()

    assert corpo["duplicadas"] == 2
    assert corpo["criadas"] == 2
    assert (
        await client.get(f"/pesagens?animal_id={dados['animal_a'].id}", headers=h)
    ).json()["total"] == 4


async def test_lote_grande_demais(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    fila = [payload(animal_id=str(dados["animal_a"].id)) for _ in range(501)]
    assert (await client.post("/pesagens/lote", json=fila, headers=h)).status_code == 413


async def test_lote_vazio(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    corpo = (await client.post("/pesagens/lote", json=[], headers=h)).json()
    assert (corpo["criadas"], corpo["duplicadas"], corpo["erros"]) == (0, 0, 0)
