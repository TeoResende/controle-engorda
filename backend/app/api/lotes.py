import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from app.core.deps import EscritaDep, SessaoDep
from app.models import Animal, Lote, StatusAnimal
from app.schemas import (
    LoteAtualizar,
    LoteComContagem,
    LoteCriar,
    LoteResponse,
    MoverAnimais,
    ResultadoMovimentacao,
)

router = APIRouter(prefix="/lotes", tags=["lotes"])


async def _obter(sessao: SessaoDep, lote_id: uuid.UUID) -> Lote:
    lote = await sessao.obter(Lote, lote_id)
    if lote is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lote não encontrado")
    return lote


@router.get("", response_model=list[LoteComContagem])
async def listar(
    sessao: SessaoDep,
    incluir_inativos: Annotated[bool, Query(description="Traz também os lotes desativados")] = False,
) -> list[LoteComContagem]:
    """Lista os lotes com a contagem de animais ativos — o dashboard sempre
    mostra os dois juntos, e sem isso vira N+1."""
    contagem = (
        select(Animal.lote_id, func.count(Animal.id).label("total"))
        .where(
            Animal.fazenda_id == sessao.fazenda_id,
            Animal.status == StatusAnimal.ativo,
            Animal.desativado_em.is_(None),
        )
        .group_by(Animal.lote_id)
        .subquery()
    )
    stmt = (
        sessao.selecionar(Lote, incluir_inativos=incluir_inativos)
        .add_columns(func.coalesce(contagem.c.total, 0))
        .join(contagem, contagem.c.lote_id == Lote.id, isouter=True)
        .order_by(Lote.nome)
    )
    linhas = await sessao.session.execute(stmt)
    return [
        LoteComContagem(**LoteResponse.model_validate(lote).model_dump(), animais_ativos=total)
        for lote, total in linhas
    ]


@router.post("", response_model=LoteResponse, status_code=status.HTTP_201_CREATED)
async def criar(dados: LoteCriar, sessao: SessaoDep, ctx: EscritaDep) -> Lote:
    lote = sessao.adicionar(Lote(**dados.model_dump()))
    await sessao.commit()
    await sessao.session.refresh(lote)
    return lote


@router.get("/{lote_id}", response_model=LoteResponse)
async def obter(lote_id: uuid.UUID, sessao: SessaoDep) -> Lote:
    return await _obter(sessao, lote_id)


@router.patch("/{lote_id}", response_model=LoteResponse)
async def atualizar(
    lote_id: uuid.UUID, dados: LoteAtualizar, sessao: SessaoDep, ctx: EscritaDep
) -> Lote:
    lote = await _obter(sessao, lote_id)
    for campo, valor in dados.model_dump(exclude_unset=True).items():
        setattr(lote, campo, valor)
    await sessao.commit()
    await sessao.session.refresh(lote)
    return lote


@router.post("/{lote_id}/animais", response_model=ResultadoMovimentacao)
async def mover_para_o_lote(
    lote_id: uuid.UUID,
    dados: MoverAnimais,
    sessao: SessaoDep,
    ctx: EscritaDep,
) -> ResultadoMovimentacao:
    """Põe os animais informados neste lote.

    Só move animal desta fazenda — id de outro tenant é ignorado em silêncio,
    não vira erro: quem pediu não deveria nem saber que ele existe.
    """
    lote = await _obter(sessao, lote_id)

    encontrados = list(
        await sessao.session.scalars(
            sessao.selecionar(Animal).where(Animal.id.in_(dados.animal_ids))
        )
    )
    achados = {a.id for a in encontrados}
    for animal in encontrados:
        animal.lote_id = lote.id

    await sessao.commit()
    return ResultadoMovimentacao(
        movidos=len(encontrados),
        ignorados=[i for i in dados.animal_ids if i not in achados],
    )


@router.delete("/{lote_id}/animais", response_model=ResultadoMovimentacao)
async def tirar_do_lote(
    lote_id: uuid.UUID,
    dados: MoverAnimais,
    sessao: SessaoDep,
    ctx: EscritaDep,
) -> ResultadoMovimentacao:
    """Tira os animais do lote, sem apagar nada — eles ficam sem lote."""
    await _obter(sessao, lote_id)

    encontrados = list(
        await sessao.session.scalars(
            sessao.selecionar(Animal).where(
                Animal.id.in_(dados.animal_ids), Animal.lote_id == lote_id
            )
        )
    )
    for animal in encontrados:
        animal.lote_id = None

    await sessao.commit()
    achados = {a.id for a in encontrados}
    return ResultadoMovimentacao(
        movidos=len(encontrados),
        ignorados=[i for i in dados.animal_ids if i not in achados],
    )


@router.delete("/{lote_id}", status_code=status.HTTP_204_NO_CONTENT)
async def desativar(lote_id: uuid.UUID, sessao: SessaoDep, ctx: EscritaDep) -> None:
    """Desativa o lote. Nada é apagado: os animais continuam apontando para ele,
    e o histórico de qual bicho esteve em qual lote continua legível."""
    lote = await _obter(sessao, lote_id)
    if lote.desativado_em is None:
        lote.desativado_em = datetime.now(timezone.utc)
        await sessao.commit()


@router.post("/{lote_id}/reativar", response_model=LoteResponse)
async def reativar(lote_id: uuid.UUID, sessao: SessaoDep, ctx: EscritaDep) -> Lote:
    lote = await _obter(sessao, lote_id)
    lote.desativado_em = None
    await sessao.commit()
    await sessao.session.refresh(lote)
    return lote
