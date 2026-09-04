"""Primeiro acesso.

Enquanto não existe nenhum usuário, o sistema não tem como autenticar ninguém —
e portanto não teria como criar o primeiro administrador. Este router resolve
esse ovo-e-galinha e se fecha sozinho: assim que existe um usuário, ele passa a
responder 409 para sempre.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.security import hash_senha
from app.models import Fazenda, Papel, Usuario, UsuarioFazenda
from app.schemas import PrimeiroAcessoRequest, SetupStatusResponse, TokenResponse

router = APIRouter(prefix="/setup", tags=["setup"])


async def _existe_usuario(session: AsyncSession) -> bool:
    total = await session.scalar(select(func.count()).select_from(Usuario))
    return bool(total)


@router.get("/status", response_model=SetupStatusResponse)
async def status_da_instalacao(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SetupStatusResponse:
    """Rota pública, sem token — o frontend consulta antes da tela de login para
    decidir se manda o visitante para o cadastro do primeiro usuário."""
    return SetupStatusResponse(precisa_configuracao=not await _existe_usuario(session))


@router.post(
    "/primeiro-acesso", response_model=TokenResponse, status_code=status.HTTP_201_CREATED
)
async def primeiro_acesso(
    dados: PrimeiroAcessoRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TokenResponse:
    """Cria o primeiro admin master e, opcionalmente, a primeira fazenda.

    Sem fazenda o usuário até é criado, mas não consegue logar — o login precisa
    de uma fazenda para abrir a sessão. Por isso a fazenda vem no mesmo passo.
    """
    if await _existe_usuario(session):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="O sistema já foi configurado",
        )

    usuario = Usuario(
        nome=dados.nome,
        email=dados.email.lower(),
        senha_hash=hash_senha(dados.senha),
        admin_master=True,
    )
    session.add(usuario)

    fazenda = Fazenda(nome=dados.nome_fazenda, proprietario=dados.nome)
    session.add(fazenda)
    await session.flush()

    # O vínculo é redundante para um admin master (ele alcança qualquer fazenda),
    # mas deixa explícito quem responde por esta fazenda se o master for embora.
    session.add(
        UsuarioFazenda(usuario_id=usuario.id, fazenda_id=fazenda.id, papel=Papel.admin)
    )
    await session.commit()

    from app.api.auth import _par_de_tokens

    return _par_de_tokens(usuario, fazenda.id, Papel.admin)
