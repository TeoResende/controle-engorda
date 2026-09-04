"""Dados da fazenda do token, e criação de novas fazendas."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.deps import AdminDep, CtxDep
from app.models import Fazenda, Papel, UsuarioFazenda
from app.schemas import FazendaAtualizar, FazendaCriar, FazendaResponse

router = APIRouter(prefix="/fazendas", tags=["fazendas"])


async def _fazenda_do_token(session: AsyncSession, ctx) -> Fazenda:
    fazenda = await session.get(Fazenda, ctx.fazenda_id)
    if fazenda is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fazenda não encontrada")
    return fazenda


@router.get("/atual", response_model=FazendaResponse)
async def obter_atual(
    ctx: CtxDep, session: Annotated[AsyncSession, Depends(get_session)]
) -> Fazenda:
    """A fazenda é a do token — não existe rota para ler fazenda por id."""
    return await _fazenda_do_token(session, ctx)


@router.patch("/atual", response_model=FazendaResponse)
async def atualizar_atual(
    dados: FazendaAtualizar,
    ctx: AdminDep,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Fazenda:
    fazenda = await _fazenda_do_token(session, ctx)
    for campo, valor in dados.model_dump(exclude_unset=True).items():
        setattr(fazenda, campo, valor)
    await session.commit()
    await session.refresh(fazenda)
    return fazenda


@router.post("", response_model=FazendaResponse, status_code=status.HTTP_201_CREATED)
async def criar(
    dados: FazendaCriar,
    ctx: CtxDep,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Fazenda:
    """Cria uma fazenda e vincula quem criou como admin dela.

    Não existe superusuário global no modelo: o vínculo é o que dá acesso, então
    quem cria precisa sair da chamada já com acesso à fazenda nova. Para operar
    nela, é preciso trocar de token (`POST /auth/trocar-fazenda`).
    """
    fazenda = Fazenda(**dados.model_dump())
    session.add(fazenda)
    await session.flush()
    session.add(
        UsuarioFazenda(usuario_id=ctx.usuario.id, fazenda_id=fazenda.id, papel=Papel.admin)
    )
    await session.commit()
    await session.refresh(fazenda)
    return fazenda
