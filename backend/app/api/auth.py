import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.deps import CtxDep, SessaoGlobalDep
from app.core.security import (
    TokenInvalido,
    criar_token,
    decodificar_token,
    hash_senha,
    verificar_senha,
)
from app.models import Fazenda, Papel, Usuario, UsuarioFazenda
from app.schemas import (
    EuResponse,
    FazendaDoUsuario,
    LoginRequest,
    RefreshRequest,
    TokenResponse,
    TrocarFazendaRequest,
    TrocarSenhaRequest,
)

router = APIRouter(prefix="/auth", tags=["auth"])

CREDENCIAL_INVALIDA = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED, detail="E-mail ou senha inválidos"
)


async def _vinculos(session: AsyncSession, usuario_id: uuid.UUID) -> list[UsuarioFazenda]:
    """Vínculos ativos do usuário. Vínculo desativado não dá acesso a nada."""
    resultado = await session.scalars(
        select(UsuarioFazenda)
        .options(joinedload(UsuarioFazenda.fazenda))
        .where(
            UsuarioFazenda.usuario_id == usuario_id,
            UsuarioFazenda.desativado_em.is_(None),
            UsuarioFazenda.fazenda.has(Fazenda.desativado_em.is_(None)),
        )
    )
    return list(resultado)


async def _fazendas_do_master(session: AsyncSession) -> list[Fazenda]:
    """O superusuário alcança qualquer fazenda ativa, com ou sem vínculo."""
    resultado = await session.scalars(
        select(Fazenda).where(Fazenda.desativado_em.is_(None)).order_by(Fazenda.nome)
    )
    return list(resultado)


def _par_de_tokens(
    usuario: Usuario, fazenda_id: uuid.UUID, papel: Papel
) -> TokenResponse:
    dados = {
        "usuario_id": str(usuario.id),
        "fazenda_id": str(fazenda_id),
        "papel": papel.value,
        "master": usuario.admin_master,
    }
    return TokenResponse(
        access_token=criar_token(**dados, tipo="access"),
        refresh_token=criar_token(**dados, tipo="refresh"),
        fazenda_id=fazenda_id,
        papel=papel,
        admin_master=usuario.admin_master,
    )


async def _escolher_fazenda(
    session: AsyncSession, usuario: Usuario, fazenda_id: uuid.UUID | None
) -> tuple[uuid.UUID, Papel]:
    """Resolve em qual fazenda a sessão vai abrir, e com qual papel.

    Superusuário entra em qualquer fazenda como admin; os demais só nas que
    têm vínculo ativo. Com mais de uma opção e nenhuma escolhida, 409 com a
    lista — o cliente é quem decide.
    """
    if usuario.admin_master:
        opcoes = [(f.id, f.nome, Papel.admin) for f in await _fazendas_do_master(session)]
    else:
        opcoes = [(v.fazenda_id, v.fazenda.nome, v.papel) for v in await _vinculos(session, usuario.id)]

    if not opcoes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Nenhuma fazenda disponível para este usuário"
                if not usuario.admin_master
                else "Ainda não existe fazenda cadastrada"
            ),
        )

    if fazenda_id is not None:
        escolhida = next((o for o in opcoes if o[0] == fazenda_id), None)
        if escolhida is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Usuário não tem acesso a esta fazenda",
            )
        return escolhida[0], escolhida[2]

    if len(opcoes) == 1:
        return opcoes[0][0], opcoes[0][2]

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "mensagem": "Informe fazenda_id: o usuário atende mais de uma fazenda",
            "fazendas": [
                {"fazenda_id": str(fid), "nome": nome, "papel": papel.value}
                for fid, nome, papel in opcoes[:100]
            ],
        },
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    dados: LoginRequest,
    session: SessaoGlobalDep,
) -> TokenResponse:
    usuario = await session.scalar(
        select(Usuario).where(
            Usuario.email == dados.email.lower(), Usuario.desativado_em.is_(None)
        )
    )
    # Verifica a senha mesmo com usuário inexistente seria o ideal contra
    # enumeração por tempo; aqui a mensagem já é a mesma nos dois casos.
    if usuario is None or not verificar_senha(dados.senha, usuario.senha_hash):
        raise CREDENCIAL_INVALIDA

    fazenda_id, papel = await _escolher_fazenda(session, usuario, dados.fazenda_id)
    return _par_de_tokens(usuario, fazenda_id, papel)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    dados: RefreshRequest,
    session: SessaoGlobalDep,
) -> TokenResponse:
    try:
        payload = decodificar_token(dados.refresh_token, tipo_esperado="refresh")
    except TokenInvalido as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    usuario_id = uuid.UUID(payload["sub"])
    fazenda_id = uuid.UUID(payload["fazenda_id"])

    usuario = await session.scalar(
        select(Usuario).where(Usuario.id == usuario_id, Usuario.desativado_em.is_(None))
    )
    if usuario is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuário inativo")

    # O acesso é relido do banco: vínculo desativado depois que o refresh foi
    # emitido tem que invalidar a renovação.
    try:
        fazenda_id, papel = await _escolher_fazenda(session, usuario, fazenda_id)
    except HTTPException as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Acesso à fazenda foi revogado"
        ) from exc

    return _par_de_tokens(usuario, fazenda_id, papel)


@router.post("/trocar-fazenda", response_model=TokenResponse)
async def trocar_fazenda(
    dados: TrocarFazendaRequest,
    ctx: CtxDep,
    session: SessaoGlobalDep,
) -> TokenResponse:
    """Emite um novo par de tokens para outra fazenda do mesmo usuário.

    Trocar de fazenda é trocar de token — o `fazenda_id` nunca vem do corpo da
    requisição em endpoints de dados.
    """
    fazenda_id, papel = await _escolher_fazenda(session, ctx.usuario, dados.fazenda_id)
    return _par_de_tokens(ctx.usuario, fazenda_id, papel)


@router.post("/senha", status_code=status.HTTP_204_NO_CONTENT)
async def trocar_senha(
    dados: TrocarSenhaRequest,
    ctx: CtxDep,
    session: SessaoGlobalDep,
) -> None:
    """Troca a própria senha.

    Os tokens já emitidos continuam valendo até expirar — trocar a senha não
    derruba a sessão do técnico que está no curral. Revogação imediata exigiria
    uma denylist em Redis, o mesmo custo já anotado para o token de 12h.
    """
    if not verificar_senha(dados.senha_atual, ctx.usuario.senha_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Senha atual incorreta"
        )
    if dados.senha_atual == dados.senha_nova:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="A nova senha é igual à atual"
        )

    usuario = await session.get(Usuario, ctx.usuario.id)
    usuario.senha_hash = hash_senha(dados.senha_nova)
    await session.commit()


@router.get("/eu", response_model=EuResponse)
async def eu(ctx: CtxDep, session: SessaoGlobalDep) -> EuResponse:
    if ctx.master:
        fazendas = [
            FazendaDoUsuario(fazenda_id=f.id, nome=f.nome, papel=Papel.admin)
            for f in await _fazendas_do_master(session)
        ]
    else:
        fazendas = [
            FazendaDoUsuario(fazenda_id=v.fazenda_id, nome=v.fazenda.nome, papel=v.papel)
            for v in await _vinculos(session, ctx.usuario.id)
        ]
    return EuResponse(
        usuario=ctx.usuario,
        fazenda_id=ctx.fazenda_id,
        papel=ctx.papel,
        admin_master=ctx.master,
        fazendas=fazendas,
    )
