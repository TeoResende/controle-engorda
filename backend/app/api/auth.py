import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.db import get_session
from app.core.deps import CtxDep
from app.core.security import (
    TokenInvalido,
    criar_token,
    decodificar_token,
    verificar_senha,
)
from app.models import Usuario, UsuarioFazenda
from app.schemas import (
    EuResponse,
    FazendaDoUsuario,
    LoginRequest,
    RefreshRequest,
    TokenResponse,
    TrocarFazendaRequest,
)

router = APIRouter(prefix="/auth", tags=["auth"])

CREDENCIAL_INVALIDA = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED, detail="E-mail ou senha inválidos"
)


async def _vinculos(session: AsyncSession, usuario_id: uuid.UUID) -> list[UsuarioFazenda]:
    resultado = await session.scalars(
        select(UsuarioFazenda)
        .options(joinedload(UsuarioFazenda.fazenda))
        .where(UsuarioFazenda.usuario_id == usuario_id)
    )
    return list(resultado)


def _par_de_tokens(usuario_id: uuid.UUID, vinculo: UsuarioFazenda) -> TokenResponse:
    dados = {
        "usuario_id": str(usuario_id),
        "fazenda_id": str(vinculo.fazenda_id),
        "papel": vinculo.papel.value,
    }
    return TokenResponse(
        access_token=criar_token(**dados, tipo="access"),
        refresh_token=criar_token(**dados, tipo="refresh"),
        fazenda_id=vinculo.fazenda_id,
        papel=vinculo.papel,
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    dados: LoginRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TokenResponse:
    usuario = await session.scalar(
        select(Usuario).where(Usuario.email == dados.email.lower(), Usuario.ativo.is_(True))
    )
    # Verifica a senha mesmo com usuário inexistente seria o ideal contra
    # enumeração por tempo; aqui a mensagem já é a mesma nos dois casos.
    if usuario is None or not verificar_senha(dados.senha, usuario.senha_hash):
        raise CREDENCIAL_INVALIDA

    vinculos = await _vinculos(session, usuario.id)
    if not vinculos:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuário não está vinculado a nenhuma fazenda",
        )

    if dados.fazenda_id is not None:
        escolhido = next((v for v in vinculos if v.fazenda_id == dados.fazenda_id), None)
        if escolhido is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Usuário não tem acesso a esta fazenda",
            )
    elif len(vinculos) == 1:
        escolhido = vinculos[0]
    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "mensagem": "Informe fazenda_id: o usuário atende mais de uma fazenda",
                "fazendas": [
                    {"fazenda_id": str(v.fazenda_id), "nome": v.fazenda.nome, "papel": v.papel.value}
                    for v in vinculos
                ],
            },
        )

    return _par_de_tokens(usuario.id, escolhido)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    dados: RefreshRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TokenResponse:
    try:
        payload = decodificar_token(dados.refresh_token, tipo_esperado="refresh")
    except TokenInvalido as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    usuario_id = uuid.UUID(payload["sub"])
    fazenda_id = uuid.UUID(payload["fazenda_id"])

    # O vínculo é relido do banco: acesso revogado depois que o refresh foi
    # emitido tem que invalidar a renovação.
    vinculo = await session.scalar(
        select(UsuarioFazenda).where(
            UsuarioFazenda.usuario_id == usuario_id,
            UsuarioFazenda.fazenda_id == fazenda_id,
        )
    )
    if vinculo is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Acesso à fazenda foi revogado"
        )

    return _par_de_tokens(usuario_id, vinculo)


@router.post("/trocar-fazenda", response_model=TokenResponse)
async def trocar_fazenda(
    dados: TrocarFazendaRequest,
    ctx: CtxDep,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TokenResponse:
    """Emite um novo par de tokens para outra fazenda do mesmo usuário.

    Trocar de fazenda é trocar de token — o `fazenda_id` nunca vem do corpo da
    requisição em endpoints de dados.
    """
    vinculo = await session.scalar(
        select(UsuarioFazenda).where(
            UsuarioFazenda.usuario_id == ctx.usuario.id,
            UsuarioFazenda.fazenda_id == dados.fazenda_id,
        )
    )
    if vinculo is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Usuário não tem acesso a esta fazenda"
        )
    return _par_de_tokens(ctx.usuario.id, vinculo)


@router.get("/eu", response_model=EuResponse)
async def eu(ctx: CtxDep, session: Annotated[AsyncSession, Depends(get_session)]) -> EuResponse:
    vinculos = await _vinculos(session, ctx.usuario.id)
    return EuResponse(
        usuario=ctx.usuario,
        fazenda_id=ctx.fazenda_id,
        papel=ctx.papel,
        fazendas=[
            FazendaDoUsuario(fazenda_id=v.fazenda_id, nome=v.fazenda.nome, papel=v.papel)
            for v in vinculos
        ],
    )
