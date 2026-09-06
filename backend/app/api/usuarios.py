"""Membros da fazenda do token.

Usuário é global (um e-mail, uma senha) mas o acesso é por vínculo. Então
"remover da fazenda" apaga o vínculo, nunca o usuário — que pode atender outras
fazendas.
"""

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.deps import AdminDep, CtxDep, SessaoGlobalDep, SessaoTenantDep
from app.core.db import visao_global
from app.core.security import hash_senha
from app.core.log import registrar_acao
from app.models import Fazenda, Usuario, UsuarioFazenda
from app.schemas import (
    MembroAtualizar,
    MembroCriar,
    MembroResponse,
    RedefinirSenhaRequest,
    VinculoAtualizar,
    VinculoDoUsuario,
)

router = APIRouter(prefix="/membros", tags=["membros"])


def _resposta(vinculo: UsuarioFazenda) -> MembroResponse:
    u = vinculo.usuario
    return MembroResponse(
        id=u.id,
        nome=u.nome,
        email=u.email,
        papel=vinculo.papel,
        # `ativo` aqui é do vínculo com ESTA fazenda: a pessoa pode seguir ativa
        # no sistema e ter saído só desta fazenda.
        ativo=vinculo.ativo and u.ativo,
        admin_master=u.admin_master,
        criado_em=u.criado_em,
        desativado_em=vinculo.desativado_em,
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
    ctx: AdminDep,
    session: SessaoTenantDep,
    incluir_inativos: Annotated[bool, Query(description="Traz também os removidos")] = False,
) -> list[MembroResponse]:
    stmt = (
        select(UsuarioFazenda)
        .options(joinedload(UsuarioFazenda.usuario))
        .where(UsuarioFazenda.fazenda_id == ctx.fazenda_id)
    )
    if not incluir_inativos:
        stmt = stmt.where(UsuarioFazenda.desativado_em.is_(None))
    return [_resposta(v) for v in await session.scalars(stmt)]


@router.post("", response_model=MembroResponse, status_code=status.HTTP_201_CREATED)
async def criar(
    dados: MembroCriar,
    ctx: AdminDep,
    session: SessaoTenantDep,
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
        existente = await _vinculo(session, ctx.fazenda_id, usuario.id)
        if existente is not None:
            if existente.ativo:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Este usuário já é membro da fazenda",
                )
            # Alguém que saiu e voltou reativa o vínculo antigo, mantendo o
            # histórico de quando entrou pela primeira vez.
            existente.desativado_em = None
            existente.papel = dados.papel
            await session.commit()
            return _resposta(existente)

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
    session: SessaoTenantDep,
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

    if vinculo.usuario.admin_master and not ctx.master:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Só um admin master pode alterar outro admin master",
        )

    vinculo.papel = dados.papel
    await session.commit()
    return _resposta(vinculo)


@router.post("/{usuario_id}/senha", status_code=status.HTTP_204_NO_CONTENT)
async def redefinir_senha(
    usuario_id: uuid.UUID,
    dados: RedefinirSenhaRequest,
    ctx: AdminDep,
    session: SessaoTenantDep,
) -> None:
    """Redefine a senha de um membro que esqueceu a dele.

    **Só vale para quem atende exclusivamente esta fazenda.** Redefinir senha é
    tomar a conta: quem faz isso passa a poder entrar como a pessoa. Se ela
    também trabalha em outra fazenda, o admin daqui estaria ganhando acesso a
    dados de lá — por isso, nesse caso, só um admin master pode.
    """
    vinculo = await _vinculo(session, ctx.fazenda_id, usuario_id)
    if vinculo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membro não encontrado")

    if vinculo.usuario.admin_master and not ctx.master:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Só um admin master pode redefinir a senha de outro admin master",
        )

    if not ctx.master:
        # A pergunta é justamente sobre o que está FORA desta fazenda: sob a
        # RLS a contagem voltaria zero sempre, e esta verificação de segurança
        # passaria em silêncio.
        async with visao_global(session):
            outras = await session.scalar(
                select(func.count(UsuarioFazenda.id)).where(
                    UsuarioFazenda.usuario_id == usuario_id,
                    UsuarioFazenda.fazenda_id != ctx.fazenda_id,
                    UsuarioFazenda.desativado_em.is_(None),
                )
            )
        if outras:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Esta pessoa também atende outra fazenda. Redefinir a senha daria "
                    "acesso aos dados de lá — peça a um admin master."
                ),
            )

    vinculo.usuario.senha_hash = hash_senha(dados.senha_nova)
    await session.commit()


@router.post("/{usuario_id}/reativar", response_model=MembroResponse)
async def reativar(
    usuario_id: uuid.UUID,
    ctx: AdminDep,
    session: SessaoTenantDep,
) -> MembroResponse:
    """Devolve o acesso a quem tinha saído da fazenda.

    Reativa o vínculo antigo em vez de criar outro, para o registro de quando a
    pessoa entrou pela primeira vez continuar de pé.
    """
    vinculo = await _vinculo(session, ctx.fazenda_id, usuario_id)
    if vinculo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membro não encontrado")

    vinculo.desativado_em = None
    await session.commit()
    return _resposta(vinculo)


@router.delete("/{usuario_id}", status_code=status.HTTP_204_NO_CONTENT)
async def desativar(
    usuario_id: uuid.UUID,
    ctx: AdminDep,
    session: SessaoTenantDep,
) -> None:
    """Tira o membro desta fazenda desativando o vínculo.

    Nada é apagado: nem o vínculo (é o registro de que a pessoa trabalhou aqui),
    nem o usuário — que pode atender outras fazendas e assinou pesagens.
    """
    if usuario_id == ctx.usuario.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Um admin não pode remover a si mesmo da fazenda",
        )

    vinculo = await _vinculo(session, ctx.fazenda_id, usuario_id)
    if vinculo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membro não encontrado")

    if vinculo.usuario.admin_master:
        # O admin master não se rebaixa nem é rebaixado por admin de fazenda.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Um admin master não pode ser removido de uma fazenda",
        )

    if vinculo.desativado_em is None:
        vinculo.desativado_em = datetime.now(timezone.utc)
        await session.commit()


# --- Uma pessoa, várias fazendas ------------------------------------------
#
# As rotas acima são todas da fazenda do token: é assim que um admin administra
# a equipe *dele*. As de baixo cruzam fazendas de propósito, e por isso usam
# `SessaoGlobalDep` — a justificativa escrita que a seção 8.8 exige:
#
# Um técnico atende várias fazendas do mesmo grupo, e um cliente pode ser dono
# de mais de uma. Montar isso só com as rotas por tenant obrigava a trocar de
# fazenda uma por uma e recadastrar a pessoa em cada, com uma senha nova que
# seria ignorada — trabalhoso o bastante para o operador desistir e criar duas
# contas para a mesma pessoa, partindo a autoria das pesagens em duas.
#
# Só o **admin master** alcança estas rotas. Dizer a um admin da fazenda A que
# fulano também trabalha na fazenda B vazaria a existência de outro cliente.


def _so_master(ctx) -> None:
    if not ctx.master:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Requer admin master: o vínculo com outras fazendas é do dono do sistema",
        )


async def _usuario_alvo(session: AsyncSession, usuario_id: uuid.UUID) -> Usuario:
    usuario = await session.get(Usuario, usuario_id)
    if usuario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado")
    if usuario.admin_master:
        # Não é restrição por segurança, é para a tela não mentir: o master
        # alcança toda fazenda ativa sem vínculo nenhum, então dar ou tirar
        # vínculo dele não mudaria o acesso em nada.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Admin master já alcança todas as fazendas, sem vínculo",
        )
    return usuario


@router.get("/{usuario_id}/fazendas", response_model=list[VinculoDoUsuario])
async def fazendas_do_usuario(
    usuario_id: uuid.UUID,
    ctx: CtxDep,
    session: SessaoGlobalDep,
) -> list[VinculoDoUsuario]:
    """Em que fazendas esta pessoa trabalha, e com que papel."""
    _so_master(ctx)
    await _usuario_alvo(session, usuario_id)

    vinculos = await session.scalars(
        select(UsuarioFazenda)
        .options(joinedload(UsuarioFazenda.fazenda))
        .where(UsuarioFazenda.usuario_id == usuario_id)
    )
    return [
        VinculoDoUsuario(
            fazenda_id=v.fazenda_id,
            fazenda_nome=v.fazenda.nome,
            papel=v.papel,
            ativo=v.ativo,
        )
        for v in sorted(vinculos, key=lambda v: v.fazenda.nome)
    ]


@router.put("/{usuario_id}/fazendas/{fazenda_id}", response_model=VinculoDoUsuario)
async def vincular_a_fazenda(
    usuario_id: uuid.UUID,
    fazenda_id: uuid.UUID,
    dados: VinculoAtualizar,
    ctx: CtxDep,
    session: SessaoGlobalDep,
) -> VinculoDoUsuario:
    """Dá acesso da pessoa a uma fazenda, ou muda o papel dela ali.

    `PUT` e não `POST` porque a operação é "esta pessoa tem este papel nesta
    fazenda": repetir a chamada não cria vínculo em dobro, e quem já saiu volta
    reativando o vínculo antigo — o registro de quando entrou pela primeira vez
    continua valendo.
    """
    _so_master(ctx)
    await _usuario_alvo(session, usuario_id)

    fazenda = await session.get(Fazenda, fazenda_id)
    if fazenda is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fazenda não encontrada")
    if fazenda.desativado_em is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Fazenda desativada. Reative antes de dar acesso a alguém.",
        )

    vinculo = await _vinculo(session, fazenda_id, usuario_id)
    if vinculo is None:
        vinculo = UsuarioFazenda(usuario_id=usuario_id, fazenda_id=fazenda_id, papel=dados.papel)
        session.add(vinculo)
    else:
        vinculo.papel = dados.papel
        vinculo.desativado_em = None
    await session.commit()

    registrar_acao(
        "vinculo_concedido",
        usuario=str(usuario_id),
        fazenda=str(fazenda_id),
        papel=dados.papel.value,
    )
    return VinculoDoUsuario(
        fazenda_id=fazenda_id, fazenda_nome=fazenda.nome, papel=dados.papel, ativo=True
    )


@router.delete("/{usuario_id}/fazendas/{fazenda_id}", status_code=status.HTTP_204_NO_CONTENT)
async def desvincular_da_fazenda(
    usuario_id: uuid.UUID,
    fazenda_id: uuid.UUID,
    ctx: CtxDep,
    session: SessaoGlobalDep,
) -> None:
    """Tira o acesso da pessoa àquela fazenda — desativando o vínculo, não
    apagando: as pesagens que ela registrou continuam apontando para ela."""
    _so_master(ctx)
    await _usuario_alvo(session, usuario_id)

    vinculo = await _vinculo(session, fazenda_id, usuario_id)
    if vinculo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vínculo não encontrado")

    if vinculo.desativado_em is None:
        vinculo.desativado_em = datetime.now(timezone.utc)
        await session.commit()
        registrar_acao("vinculo_removido", usuario=str(usuario_id), fazenda=str(fazenda_id))
