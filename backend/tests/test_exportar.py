"""Exportação em CSV.

O arquivo tem que abrir **direto** no Excel em português: separador `;`, vírgula
decimal e BOM. Sem isso a planilha inteira cai numa coluna só e os acentos
viram lixo — e o produto parece quebrado por um detalhe de formato.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.models import Animal, Pesagem


@pytest.fixture
async def com_pesagens(session, dados):
    animal = dados["animal_a"]
    for dias, peso in ((60, "200.00"), (30, "230.00"), (0, "265.50")):
        d = date.today() - timedelta(days=dias)
        session.add(
            Pesagem(
                id=uuid.uuid4(),
                fazenda_id=animal.fazenda_id,
                animal_id=animal.id,
                data=d,
                peso_kg=Decimal(peso),
                tecnico_id=dados["tecnico"].id,
                coletado_em=datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc),
                observacao_texto="mancando; da pata esquerda" if dias == 0 else None,
            )
        )
    await session.commit()
    return animal


async def test_csv_abre_no_excel_brasileiro(client, dados, logar, com_pesagens):
    h = await logar(dados["cliente_a"])
    resposta = await client.get("/exportar/pesagens.csv", headers=h)

    assert resposta.status_code == 200
    assert "text/csv" in resposta.headers["content-type"]
    assert "attachment" in resposta.headers["content-disposition"]

    texto = resposta.text
    assert texto.startswith("﻿"), "sem BOM o Excel estraga os acentos"
    cabecalho = texto.splitlines()[0]
    assert ";" in cabecalho and "," not in cabecalho


async def test_pesos_saem_com_virgula_decimal(client, dados, logar, com_pesagens):
    h = await logar(dados["cliente_a"])
    texto = (await client.get("/exportar/pesagens.csv", headers=h)).text

    assert "265,50" in texto
    assert "265.50" not in texto


async def test_variacao_e_calculada_no_arquivo(client, dados, logar, com_pesagens):
    """Quem abre a planilha quer ver o ganho sem montar fórmula."""
    h = await logar(dados["cliente_a"])
    linhas = (await client.get("/exportar/pesagens.csv", headers=h)).text.splitlines()

    corpo = [l for l in linhas[1:] if l.startswith("1001")]
    assert len(corpo) == 3
    assert corpo[0].split(";")[5] == ""  # primeira pesagem não tem anterior
    assert corpo[1].split(";")[5] == "30,00"
    assert corpo[2].split(";")[5] == "35,50"


async def test_observacao_com_ponto_e_virgula_nao_quebra_colunas(
    client, dados, logar, com_pesagens
):
    """O separador é `;` e o técnico escreve `;` na observação — sem aspas, a
    linha ganharia uma coluna a mais e desalinharia a planilha inteira."""
    h = await logar(dados["cliente_a"])
    linhas = (await client.get("/exportar/pesagens.csv", headers=h)).text.splitlines()

    import csv as csv_mod

    lidas = list(csv_mod.reader(linhas, delimiter=";"))
    assert all(len(l) == len(lidas[0]) for l in lidas if l)
    assert any("mancando; da pata esquerda" in l for l in lidas)


async def test_exportar_animais(client, dados, logar, com_pesagens):
    h = await logar(dados["cliente_a"])
    texto = (await client.get("/exportar/animais.csv", headers=h)).text

    assert "Brinco;Nome;Raça" in texto
    assert "1001" in texto
    assert "265,50" in texto  # peso atual junto


async def test_exportar_so_de_um_animal(client, dados, logar, com_pesagens, session):
    outro = Animal(fazenda_id=dados["fazenda_a"].id, brinco="4444")
    session.add(outro)
    await session.commit()

    h = await logar(dados["cliente_a"])
    texto = (
        await client.get(f"/exportar/pesagens.csv?animal_id={com_pesagens.id}", headers=h)
    ).text

    assert "1001" in texto
    assert "4444" not in texto


async def test_exportacao_nao_atravessa_fazenda(client, dados, logar, com_pesagens):
    hb = await logar(dados["cliente_b"])
    texto = (await client.get("/exportar/pesagens.csv", headers=hb)).text

    assert "1001" not in texto
    assert len(texto.splitlines()) == 1  # só o cabeçalho


async def test_exportar_observacoes(client, dados, logar, com_pesagens):
    h = await logar(dados["cliente_a"])
    texto = (await client.get("/exportar/observacoes.csv", headers=h)).text

    linhas = texto.splitlines()
    assert len(linhas) == 2  # cabeçalho + a única pesagem com observação
    assert "mancando" in linhas[1]


async def test_exportacao_exige_token(client):
    assert (await client.get("/exportar/animais.csv")).status_code == 401
