"""Dependencies de autenticação e isolamento multi-tenant.

Regra central do projeto: **nenhum endpoint filtra por fazenda na mão**. O
`fazenda_id` vem assinado dentro do token e chega ao endpoint já embutido em uma
`SessaoFazenda`, que aplica o filtro sozinha. Endpoint que precise da sessão crua
é exceção e tem que ser justificada.
"""

import uuid
from typing import Annotated, Any, TypeVar

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.security import TokenInvalido, decodificar_token
from app.models import Papel, Usuario

bearer = HTTPBearer(auto_error=False)

T = TypeVar("T")

NAO_AUTENTICADO = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Não autenticado",
    headers={"WWW-Authenticate": "Bearer"},
)


class Contexto:
    """Quem está pedindo, por qual fazenda e com qual papel."""

    def __init__(self, usuario: Usuario, fazenda_id: uuid.UUID, papel: Papel) -> None:
        self.usuario = usuario
        self.fazenda_id = fazenda_id
        self.papel = papel


class SessaoFazenda:
    """Sessão do banco já amarrada a uma fazenda.

    `selecionar()` aplica o filtro por `fazenda_id` e `adicionar()` carimba o
    campo — então esquecer o filtro deixa de ser possível por descuido.
    """

    def __init__(self, session: AsyncSession, fazenda_id: uuid.UUID) -> None:
        self.session = session
        self.fazenda_id = fazenda_id

    def selecionar(self, model: type[T]) -> Select:
        return select(model).where(model.fazenda_id == self.fazenda_id)

    async def obter(self, model: type[T], id_: uuid.UUID) -> T | None:
        """Busca por id dentro da fazenda. Id de outro tenant devolve None — que
        vira 404, não 403: o cliente não fica sabendo que o registro existe."""
        return await self.session.scalar(self.selecionar(model).where(model.id == id_))

    def adicionar(self, obj: Any) -> Any:
        obj.fazenda_id = self.fazenda_id
        self.session.add(obj)
        return obj

    async def commit(self) -> None:
        await self.session.commit()

    async def flush(self) -> None:
        await self.session.flush()


async def usuario_atual(
    credencial: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Contexto:
    if credencial is None:
        raise NAO_AUTENTICADO

    try:
        payload = decodificar_token(credencial.credentials)
    except TokenInvalido as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    try:
        usuario_id = uuid.UUID(payload["sub"])
        fazenda_id = uuid.UUID(payload["fazenda_id"])
        papel = Papel(payload["papel"])
    except (KeyError, ValueError) as exc:
        raise NAO_AUTENTICADO from exc

    usuario = await session.scalar(
        select(Usuario).where(Usuario.id == usuario_id, Usuario.ativo.is_(True))
    )
    if usuario is None:
        raise NAO_AUTENTICADO

    return Contexto(usuario=usuario, fazenda_id=fazenda_id, papel=papel)


async def sessao_fazenda(
    ctx: Annotated[Contexto, Depends(usuario_atual)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SessaoFazenda:
    return SessaoFazenda(session, ctx.fazenda_id)


def exigir_papel(*papeis: Papel):
    """Dependency de autorização por papel dentro da fazenda do token."""

    async def verificar(ctx: Annotated[Contexto, Depends(usuario_atual)]) -> Contexto:
        if ctx.papel not in papeis:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requer papel: {', '.join(p.value for p in papeis)}",
            )
        return ctx

    return verificar


CtxDep = Annotated[Contexto, Depends(usuario_atual)]
SessaoDep = Annotated[SessaoFazenda, Depends(sessao_fazenda)]
