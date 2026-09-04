"""Membros da fazenda do token.

Usuário é global (um e-mail, uma senha) mas o acesso é por vínculo. Então
"remover da fazenda" apaga o vínculo, nunca o usuário — que pode atender outras
fazendas.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.db import get_session
from app.core.deps import AdminDep
from app.core.security import hash_senha
from app.models import Usuario, UsuarioFazenda
from app.schemas import MembroAtualizar, MembroCriar, MembroResponse

router = APIRouter(prefix="/membros", tags=["membros"])


def _resposta(vinculo: UsuarioFazenda) -> MembroResponse:
    u = vinculo.usuario
    return MembroResponse(
        id=u.id, nome=u.nome, email=u.email, papel=vinculo.papel, ativo=u.ativo, criado_em=u.criado_em
    )


async def _vinculo(session: AsyncSession, fazenda_id, usuario_id) -> UsuarioFazenda | None:
    return await session.scalar(
        select(UsuarioFazenda)
        .options(joinedload(UsuarioFazenda.usuario))
        .where(
            UsuarioFazenda.fazenda_id == fazenda_id,
            UsuarioFazenda.usuario_id == usuario_id,
        )
    )


@router.get("", response_model=list[MembroResponse])
async def listar(
    ctx: AdminDep, session: Annotated[AsyncSession, Depends(get_session)]
) -> list[MembroResponse]:
    vinculos = await session.scalars(
        select(UsuarioFazenda)
        .options(joinedload(UsuarioFazenda.usuario))
        .where(UsuarioFazenda.fazenda_id == ctx.fazenda_id)
    )
    return [_resposta(v) for v in vinculos]


@router.post("", response_model=MembroResponse, status_code=status.HTTP_201_CREATED)
async def criar(
    dados: MembroCriar,
    ctx: AdminDep,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MembroResponse:
    email = dados.email.lower()
    usuario = await session.scalar(select(Usuario).where(Usuario.email == email))

    if usuario is None:
        usuario = Usuario(nome=dados.nome, email=email, senha_hash=hash_senha(dados.senha))
        session.add(usuario)
        await session.flush()
    else:
        # E-mail já existe: é a mesma pessoa atendendo outra fazenda. Vincula sem
        # tocar em nome nem senha — o admin desta fazenda não manda na conta dela.
        if await _vinculo(session, ctx.fazenda_id, usuario.id) is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Este usuário já é membro da fazenda",
            )

    vinculo = UsuarioFazenda(usuario_id=usuario.id, fazenda_id=ctx.fazenda_id, papel=dados.papel)
    session.add(vinculo)
    await session.commit()

    vinculo = await _vinculo(session, ctx.fazenda_id, usuario.id)
    return _resposta(vinculo)


@router.patch("/{usuario_id}", response_model=MembroResponse)
async def atualizar_papel(
    usuario_id: uuid.UUID,
    dados: MembroAtualizar,
    ctx: AdminDep,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MembroResponse:
    vinculo = await _vinculo(session, ctx.fazenda_id, usuario_id)
    if vinculo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membro não encontrado")

    if usuario_id == ctx.usuario.id and dados.papel != vinculo.papel:
        # Sem isso, o último admin consegue se rebaixar e deixar a fazenda sem
        # ninguém capaz de gerir membros.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Um admin não pode mudar o próprio papel",
        )

    vinculo.papel = dados.papel
    await session.commit()
    return _resposta(vinculo)


@router.delete("/{usuario_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remover(
    usuario_id: uuid.UUID,
    ctx: AdminDep,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    if usuario_id == ctx.usuario.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Um admin não pode remover a si mesmo da fazenda",
        )

    vinculo = await _vinculo(session, ctx.fazenda_id, usuario_id)
    if vinculo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membro não encontrado")

    # Apaga o vínculo, não o usuário: ele pode atender outras fazendas, e as
    # pesagens que ele registrou continuam apontando para ele.
    await session.delete(vinculo)
    await session.commit()
