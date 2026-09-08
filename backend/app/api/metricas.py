"""Números do dashboard do cliente."""

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.core.deps import CtxDep, SessaoDep
from app.schemas.metricas import (
    CurvaAlinhada,
    DetalheAnimal,
    ObservacaoRecente,
    PontoDaSerie,
    ResumoDoDia,
    VisaoGeral,
)
from app.servicos import metricas

router = APIRouter(prefix="/metricas", tags=["métricas"])


@router.get("/visao-geral", response_model=VisaoGeral)
async def visao_geral(
    sessao: SessaoDep,
    meses: Annotated[int, Query(ge=1, le=36, description="Janela da série")] = 6,
) -> VisaoGeral:
    return await metricas.visao_geral(sessao.session, sessao.fazenda_id, meses)


@router.get("/curva-periodo", response_model=list[PontoDaSerie])
async def curva_periodo(
    sessao: SessaoDep,
    desde: date | None = None,
    ate: date | None = None,
) -> list[PontoDaSerie]:
    """Peso médio do rebanho no calendário, recortado por período (aba \"Por
    data\"). Sem `desde`, usa os últimos 6 meses."""
    return await metricas._serie(sessao.session, sessao.fazenda_id, meses=6, desde=desde, ate=ate)


@router.get("/curva-alinhada", response_model=CurvaAlinhada)
async def curva_alinhada(
    sessao: SessaoDep,
    eixo: Annotated[str, Query(pattern="^(dof|idade)$")] = "dof",
    lote_id: uuid.UUID | None = None,
    animais: Annotated[str | None, Query(description="Ids de animal separados por vírgula")] = None,
    agregar: bool = False,
) -> CurvaAlinhada:
    """Curvas alinhadas por dias de acompanhamento (`dof`) ou de vida (`idade`).
    Escopo: `animais` (seleção), senão `lote_id`, senão todos. `agregar` devolve
    a média em vez de uma linha por animal."""
    ids = None
    if animais:
        try:
            ids = [uuid.UUID(x) for x in animais.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(status_code=422, detail="Lista de animais inválida")
    return await metricas.curva_alinhada(
        sessao.session, sessao.fazenda_id, eixo=eixo, lote_id=lote_id, animais_ids=ids, agregar=agregar
    )


@router.get("/observacoes", response_model=list[ObservacaoRecente])
async def observacoes(
    sessao: SessaoDep,
    limite: Annotated[int, Query(ge=1, le=200)] = 30,
) -> list[ObservacaoRecente]:
    """Observações das pesagens, das mais recentes para as mais antigas."""
    return await metricas.observacoes_recentes(sessao.session, sessao.fazenda_id, limite)


@router.get("/hoje", response_model=ResumoDoDia)
async def resumo_do_dia(sessao: SessaoDep, ctx: CtxDep) -> ResumoDoDia:
    """Contadores da tela inicial do técnico."""
    return await metricas.resumo_do_dia(sessao.session, sessao.fazenda_id, ctx.usuario.id)


@router.get("/animal/{animal_id}", response_model=DetalheAnimal)
async def detalhe_animal(animal_id: uuid.UUID, sessao: SessaoDep) -> DetalheAnimal:
    detalhe = await metricas.detalhe_animal(sessao.session, sessao.fazenda_id, animal_id)
    if detalhe is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Animal não encontrado")
    return detalhe
