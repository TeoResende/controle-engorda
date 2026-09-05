"""Exportação de dados em CSV.

Feito para abrir **direto no Excel em português**: separador `;` e vírgula
decimal, porque o Excel pt-BR interpreta `,` como separador de milhar e coloca
uma planilha inteira numa coluna só quando o arquivo vem no padrão americano. O
BOM UTF-8 no início é o que faz o Excel reconhecer os acentos — sem ele, "não"
vira "nÃ£o".

A resposta é montada em memória e não em streaming: uma fazenda com milhares de
animais gera alguns MB, e o ganho de streaming não paga a complexidade de manter
a sessão do banco aberta durante o download.
"""

import csv
import io
import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Query, Response
from sqlalchemy import func, select

from app.core.deps import SessaoDep
from app.models import Animal, Lote, Pesagem, StatusAnimal, Usuario

router = APIRouter(prefix="/exportar", tags=["exportar"])

BOM = "﻿"


def _numero(valor: Decimal | float | None, casas: int = 2) -> str:
    """Vírgula decimal — o Excel pt-BR não entende ponto como decimal."""
    if valor is None:
        return ""
    return f"{Decimal(valor):.{casas}f}".replace(".", ",")


def _data(valor: date | None) -> str:
    return valor.strftime("%d/%m/%Y") if valor else ""


def _csv(cabecalho: list[str], linhas: list[list[Any]], nome: str) -> Response:
    buffer = io.StringIO()
    buffer.write(BOM)
    escritor = csv.writer(buffer, delimiter=";", quoting=csv.QUOTE_MINIMAL)
    escritor.writerow(cabecalho)
    escritor.writerows(linhas)

    return Response(
        content=buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{nome}"'},
    )


@router.get("/animais.csv")
async def exportar_animais(
    sessao: SessaoDep,
    lote_id: uuid.UUID | None = None,
    incluir_inativos: bool = False,
) -> Response:
    """Rebanho com peso atual e ganho médio diário."""
    ultima = (
        select(
            Pesagem.animal_id,
            Pesagem.peso_kg,
            Pesagem.data,
            func.row_number()
            .over(
                partition_by=Pesagem.animal_id,
                order_by=(Pesagem.data.desc(), Pesagem.coletado_em.desc(), Pesagem.id.desc()),
            )
            .label("pos"),
        )
        .where(Pesagem.fazenda_id == sessao.fazenda_id, Pesagem.desativado_em.is_(None))
        .subquery()
    )
    recente = select(ultima).where(ultima.c.pos == 1).subquery()

    consulta = (
        sessao.selecionar(Animal, incluir_inativos=incluir_inativos)
        .add_columns(Lote.nome, recente.c.peso_kg, recente.c.data)
        .join(Lote, Lote.id == Animal.lote_id, isouter=True)
        .join(recente, recente.c.animal_id == Animal.id, isouter=True)
        .order_by(Animal.brinco)
    )
    if lote_id is not None:
        consulta = consulta.where(Animal.lote_id == lote_id)

    linhas = []
    for animal, lote_nome, peso, data_peso in await sessao.session.execute(consulta):
        linhas.append(
            [
                animal.brinco,
                animal.nome or "",
                animal.raca or "",
                animal.porte or "",
                lote_nome or "",
                animal.status.value,
                _data(animal.data_nascimento),
                _numero(animal.peso_nascimento),
                _numero(peso),
                _data(data_peso),
                animal.brinco_mae or "",
                (animal.observacoes or "").replace("\n", " "),
            ]
        )

    return _csv(
        [
            "Brinco",
            "Nome",
            "Raça",
            "Porte",
            "Lote",
            "Situação",
            "Nascimento",
            "Peso ao nascer (kg)",
            "Peso atual (kg)",
            "Data do peso",
            "Brinco da mãe",
            "Observações",
        ],
        linhas,
        f"animais-{date.today():%Y-%m-%d}.csv",
    )


@router.get("/pesagens.csv")
async def exportar_pesagens(
    sessao: SessaoDep,
    animal_id: uuid.UUID | None = None,
    lote_id: uuid.UUID | None = None,
    desde: date | None = None,
    ate: date | None = None,
    limite: Annotated[int, Query(ge=1, le=50000)] = 10000,
) -> Response:
    """Histórico de pesagens, com a variação em relação à anterior do animal."""
    consulta = (
        sessao.selecionar(Pesagem)
        .add_columns(Animal.brinco, Animal.nome, Lote.nome, Usuario.nome)
        .join(Animal, Animal.id == Pesagem.animal_id)
        .join(Lote, Lote.id == Animal.lote_id, isouter=True)
        .join(Usuario, Usuario.id == Pesagem.tecnico_id, isouter=True)
        .order_by(Animal.brinco, Pesagem.data, Pesagem.coletado_em)
        .limit(limite)
    )
    if animal_id is not None:
        consulta = consulta.where(Pesagem.animal_id == animal_id)
    if lote_id is not None:
        consulta = consulta.where(Animal.lote_id == lote_id)
    if desde is not None:
        consulta = consulta.where(Pesagem.data >= desde)
    if ate is not None:
        consulta = consulta.where(Pesagem.data <= ate)

    linhas = []
    anterior: dict[uuid.UUID, Decimal] = {}
    for pesagem, brinco, nome_animal, lote_nome, tecnico in await sessao.session.execute(consulta):
        antes = anterior.get(pesagem.animal_id)
        variacao = (pesagem.peso_kg - antes) if antes is not None else None
        anterior[pesagem.animal_id] = pesagem.peso_kg

        linhas.append(
            [
                brinco,
                nome_animal or "",
                lote_nome or "",
                _data(pesagem.data),
                _numero(pesagem.peso_kg),
                _numero(variacao),
                tecnico or "",
                (pesagem.observacao_texto or "").replace("\n", " "),
                "sim" if pesagem.observacao_audio_url else "não",
                pesagem.coletado_em.strftime("%d/%m/%Y %H:%M"),
            ]
        )

    return _csv(
        [
            "Brinco",
            "Nome",
            "Lote",
            "Data",
            "Peso (kg)",
            "Variação (kg)",
            "Técnico",
            "Observação",
            "Tem áudio",
            "Coletado em",
        ],
        linhas,
        f"pesagens-{date.today():%Y-%m-%d}.csv",
    )


@router.get("/observacoes.csv")
async def exportar_observacoes(sessao: SessaoDep) -> Response:
    """Só as pesagens que trouxeram observação — o registro de campo do rebanho."""
    consulta = (
        sessao.selecionar(Pesagem)
        .add_columns(Animal.brinco, Animal.nome, Usuario.nome)
        .join(Animal, Animal.id == Pesagem.animal_id)
        .join(Usuario, Usuario.id == Pesagem.tecnico_id, isouter=True)
        .where(
            Animal.desativado_em.is_(None),
            (Pesagem.observacao_texto.isnot(None)) | (Pesagem.observacao_audio_url.isnot(None)),
        )
        .order_by(Pesagem.data.desc(), Pesagem.coletado_em.desc())
    )

    linhas = [
        [
            _data(p.data),
            brinco,
            nome or "",
            _numero(p.peso_kg),
            (p.observacao_texto or "").replace("\n", " "),
            "sim" if p.observacao_audio_url else "não",
            p.status_transcricao.value if p.status_transcricao else "",
            tecnico or "",
        ]
        for p, brinco, nome, tecnico in await sessao.session.execute(consulta)
    ]

    return _csv(
        [
            "Data",
            "Brinco",
            "Nome",
            "Peso (kg)",
            "Observação",
            "Tem áudio",
            "Transcrição",
            "Técnico",
        ],
        linhas,
        f"observacoes-{date.today():%Y-%m-%d}.csv",
    )
