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

from app.core.db import fixar_tenant, get_session, liberar_tenant
from app.core.log import fazenda_atual_log, usuario_atual_log
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

    @property
    def master(self) -> bool:
        """Lido do banco, não do token: revogar o superusuário tem efeito
        imediato, sem esperar o token de 12h expirar."""
        return self.usuario.admin_master


class SessaoFazenda:
    """Sessão do banco já amarrada a uma fazenda.

    `selecionar()` aplica o filtro por `fazenda_id` e `adicionar()` carimba o
    campo — então esquecer o filtro deixa de ser possível por descuido.
    """

    def __init__(self, session: AsyncSession, fazenda_id: uuid.UUID) -> None:
        self.session = session
        self.fazenda_id = fazenda_id

    def selecionar(self, model: type[T], *, incluir_inativos: bool = False) -> Select:
        """Filtra pela fazenda e, por padrão, esconde os registros desativados.

        Nada é apagado no sistema, então quase toda listagem quer só os ativos —
        o padrão é esse, e ver o histórico é opt-in explícito.
        """
        stmt = select(model).where(model.fazenda_id == self.fazenda_id)
        if not incluir_inativos and hasattr(model, "desativado_em"):
            stmt = stmt.where(model.desativado_em.is_(None))
        return stmt

    async def obter(
        self, model: type[T], id_: uuid.UUID, *, incluir_inativos: bool = True
    ) -> T | None:
        """Busca por id dentro da fazenda. Id de outro tenant devolve None — que
        vira 404, não 403: o cliente não fica sabendo que o registro existe.

        Registro desativado ainda é encontrável por id de propósito: é o que
        permite consultar histórico e reativar.
        """
        return await self.session.scalar(
            self.selecionar(model, incluir_inativos=incluir_inativos).where(model.id == id_)
        )

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
        select(Usuario).where(Usuario.id == usuario_id, Usuario.desativado_em.is_(None))
    )
    if usuario is None:
        raise NAO_AUTENTICADO

    # Quem e de qual fazenda passam a acompanhar toda linha de log desta
    # requisição — é o que permite responder "o que aconteceu com o técnico
    # Carlos ontem à tarde" sem cruzar tabelas.
    usuario_atual_log.set(str(usuario.id))
    fazenda_atual_log.set(str(fazenda_id))

    return Contexto(usuario=usuario, fazenda_id=fazenda_id, papel=papel)


async def sessao_fazenda(
    ctx: Annotated[Contexto, Depends(usuario_atual)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SessaoFazenda:
    # Segunda barreira: a partir daqui o próprio Postgres só enxerga as linhas
    # desta fazenda. Se um filtro da aplicação falhar, a consulta volta vazia em
    # vez de devolver dado de outro cliente.
    await fixar_tenant(session, ctx.fazenda_id)
    return SessaoFazenda(session, ctx.fazenda_id)


def exigir_papel(*papeis: Papel):
    """Dependency de autorização por papel dentro da fazenda do token."""

    async def verificar(ctx: Annotated[Contexto, Depends(usuario_atual)]) -> Contexto:
        if ctx.master:
            return ctx
        if ctx.papel not in papeis:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requer papel: {', '.join(p.value for p in papeis)}",
            )
        return ctx

    return verificar


async def sessao_do_tenant(
    ctx: Annotated[Contexto, Depends(usuario_atual)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AsyncSession:
    """Sessão crua, com a RLS apontada para a fazenda do token.

    Para os poucos endpoints que precisam da sessão direta — gestão de membros,
    dados da própria fazenda — sem abrir mão da segunda barreira.
    """
    await fixar_tenant(session, ctx.fazenda_id)
    return session


async def sessao_global(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AsyncSession:
    """Sessão com a RLS desligada, para operações legitimamente sem tenant.

    São poucas e todas conhecidas: login (que precisa achar os vínculos antes de
    haver fazenda escolhida), primeiro acesso, e a visão de dono do SaaS do
    admin master. **Qualquer endpoint novo que use isto precisa de justificativa
    escrita** — é a porta que contorna o isolamento.
    """
    await liberar_tenant(session)
    return session


CtxDep = Annotated[Contexto, Depends(usuario_atual)]
SessaoDep = Annotated[SessaoFazenda, Depends(sessao_fazenda)]
SessaoTenantDep = Annotated[AsyncSession, Depends(sessao_do_tenant)]
SessaoGlobalDep = Annotated[AsyncSession, Depends(sessao_global)]


# Perfis de acesso usados pelos routers de cadastro (M3):
#   cliente → só leitura; técnico → leitura e escrita de campo; admin → tudo,
#   incluindo gestão de membros e dados da fazenda.
EscritaDep = Annotated[Contexto, Depends(exigir_papel(Papel.admin, Papel.tecnico))]
AdminDep = Annotated[Contexto, Depends(exigir_papel(Papel.admin))]
