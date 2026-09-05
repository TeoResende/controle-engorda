"""Dados da fazenda do token, criação de fazendas e visão de admin master."""

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import armazenamento
from app.core.config import settings
from app.core.deps import AdminDep, CtxDep, SessaoGlobalDep, SessaoTenantDep
from app.models import Fazenda, Papel, UsuarioFazenda
from app.schemas import FazendaAtualizar, FazendaCriar, FazendaResponse

router = APIRouter(prefix="/fazendas", tags=["fazendas"])


async def _fazenda_do_token(session: AsyncSession, ctx) -> Fazenda:
    fazenda = await session.get(Fazenda, ctx.fazenda_id)
    if fazenda is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fazenda não encontrada")
    return fazenda


@router.get("/atual", response_model=FazendaResponse)
async def obter_atual(ctx: CtxDep, session: SessaoTenantDep) -> Fazenda:
    """A fazenda é a do token — não existe rota para ler fazenda por id."""
    return await _fazenda_do_token(session, ctx)


@router.patch("/atual", response_model=FazendaResponse)
async def atualizar_atual(
    dados: FazendaAtualizar,
    ctx: AdminDep,
    session: SessaoTenantDep,
) -> Fazenda:
    fazenda = await _fazenda_do_token(session, ctx)

    for campo, valor in dados.model_dump(exclude_unset=True).items():
        # Cor vazia significa "voltar ao padrão do sistema", e isso é ausência
        # de valor — não a string "". Guardar "" faria a tela pintar tudo de
        # preto ao tentar interpretar uma cor que não existe.
        if campo.startswith("cor_") and valor == "":
            valor = None
        setattr(fazenda, campo, valor)

    await session.commit()
    await session.refresh(fazenda)
    return fazenda


@router.get("", response_model=list[FazendaResponse])
async def listar_todas(
    ctx: CtxDep,
    session: SessaoGlobalDep,
    incluir_inativas: bool = False,
) -> list[Fazenda]:
    """Todas as fazendas do sistema — só para o admin master.

    Um usuário comum enxerga as fazendas dele em `GET /auth/eu`; esta rota é a
    visão de dono do SaaS.
    """
    if not ctx.master:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Requer admin master"
        )
    stmt = select(Fazenda).order_by(Fazenda.nome)
    if not incluir_inativas:
        stmt = stmt.where(Fazenda.desativado_em.is_(None))
    return list(await session.scalars(stmt))


TIPOS_DE_IMAGEM = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/svg+xml": "svg",
}


@router.post("/atual/logo", response_model=FazendaResponse)
async def enviar_logo(
    ctx: AdminDep,
    session: SessaoTenantDep,
    arquivo: Annotated[UploadFile, File(description="Logo da fazenda")],
) -> Fazenda:
    """Guarda a logo da fazenda.

    Vai para o MinIO e não para o banco, pela mesma razão dos áudios: blob em
    Postgres encarece backup e replicação. E é servida pela API, não por link
    direto, para o isolamento por fazenda continuar valendo também nos arquivos.
    """
    extensao = TIPOS_DE_IMAGEM.get(arquivo.content_type or "")
    if extensao is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Formato não aceito. Use PNG, JPG, WEBP ou SVG.",
        )

    conteudo = await arquivo.read()
    if not conteudo:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Arquivo vazio")
    if len(conteudo) > settings.logo_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Arquivo acima de {settings.logo_max_bytes // 1024} KB.",
        )

    fazenda = await _fazenda_do_token(session, ctx)
    chave = armazenamento.chave_da_logo(fazenda.id, extensao)
    await armazenamento.guardar(chave, conteudo, arquivo.content_type or "image/png")

    fazenda.logo_url = chave
    await session.commit()
    await session.refresh(fazenda)
    return fazenda


@router.get("/atual/logo")
async def baixar_logo(ctx: CtxDep, session: SessaoTenantDep) -> Response:
    fazenda = await _fazenda_do_token(session, ctx)
    if not fazenda.logo_url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sem logo")

    conteudo = await armazenamento.baixar(fazenda.logo_url)
    tipo = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "webp": "image/webp",
        "svg": "image/svg+xml",
    }[fazenda.logo_url.rsplit(".", 1)[-1]]
    # Cache curto: a logo muda raramente, mas quando muda ninguém quer esperar.
    return Response(content=conteudo, media_type=tipo, headers={"Cache-Control": "max-age=300"})


@router.delete("/atual/logo", response_model=FazendaResponse)
async def remover_logo(ctx: AdminDep, session: SessaoTenantDep) -> Fazenda:
    """Volta a exibir o nome da fazenda no lugar da imagem."""
    fazenda = await _fazenda_do_token(session, ctx)
    if fazenda.logo_url:
        await armazenamento.apagar(fazenda.logo_url)
        fazenda.logo_url = None
        await session.commit()
        await session.refresh(fazenda)
    return fazenda


@router.post("", response_model=FazendaResponse, status_code=status.HTTP_201_CREATED)
async def criar(
    dados: FazendaCriar,
    ctx: CtxDep,
    session: SessaoGlobalDep,
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


@router.delete("/atual", status_code=status.HTTP_204_NO_CONTENT)
async def desativar_atual(ctx: CtxDep, session: SessaoGlobalDep) -> None:
    """Desativa a fazenda inteira. Só admin master: é uma decisão de dono do
    SaaS, não do admin do tenant — e nada é apagado, os dados continuam lá."""
    if not ctx.master:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Requer admin master"
        )
    fazenda = await _fazenda_do_token(session, ctx)
    if fazenda.desativado_em is None:
        fazenda.desativado_em = datetime.now(timezone.utc)
        await session.commit()


@router.post("/{fazenda_id}/reativar", response_model=FazendaResponse)
async def reativar(
    fazenda_id: uuid.UUID,
    ctx: CtxDep,
    session: SessaoGlobalDep,
) -> Fazenda:
    if not ctx.master:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Requer admin master"
        )
    fazenda = await session.get(Fazenda, fazenda_id)
    if fazenda is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fazenda não encontrada")
    fazenda.desativado_em = None
    await session.commit()
    await session.refresh(fazenda)
    return fazenda
