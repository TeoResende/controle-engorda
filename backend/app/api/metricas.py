"""Números do dashboard do cliente."""

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.core.deps import SessaoDep
from app.schemas.metricas import DetalheAnimal, VisaoGeral
from app.servicos import metricas

router = APIRouter(prefix="/metricas", tags=["métricas"])


@router.get("/visao-geral", response_model=VisaoGeral)
async def visao_geral(
    sessao: SessaoDep,
    meses: Annotated[int, Query(ge=1, le=36, description="Janela da série")] = 6,
) -> VisaoGeral:
    return await metricas.visao_geral(sessao.session, sessao.fazenda_id, meses)


@router.get("/animal/{animal_id}", response_model=DetalheAnimal)
async def detalhe_animal(animal_id: uuid.UUID, sessao: SessaoDep) -> DetalheAnimal:
    detalhe = await metricas.detalhe_animal(sessao.session, sessao.fazenda_id, animal_id)
    if detalhe is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Animal não encontrado")
    return detalhe
