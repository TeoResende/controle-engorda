"""Configuração que vale para o sistema inteiro.

Hoje é o ícone do aplicativo. Ele não é a logo da fazenda (seção 8.9): a logo
identifica o cliente dentro do produto, e cada fazenda tem a sua; o ícone
identifica o **produto** — é o que o navegador põe na aba e o que o Android
grava na tela inicial. O manifesto do PWA é do domínio, então esse ícone é um
só por instalação.
"""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Response, UploadFile, status
from sqlalchemy import select

from app.core import armazenamento
from app.core.config import settings
from app.core.deps import CtxDep, SessaoGlobalDep
from app.core.log import registrar_acao
from app.models.sistema import CHAVE_ICONE, ConfiguracaoSistema
from app.schemas import SistemaResponse

router = APIRouter(prefix="/sistema", tags=["sistema"])

TIPOS_DE_IMAGEM = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/svg+xml": "svg",
}
TIPO_POR_EXTENSAO = {v: k for k, v in TIPOS_DE_IMAGEM.items()}

ICONE_PADRAO = Path(__file__).resolve().parent.parent / "estaticos" / "icone-padrao.png"


def _versao(registro: ConfiguracaoSistema | None) -> int:
    """Instante da última troca, em milissegundos.

    Milissegundos e não segundos: duas trocas dentro do mesmo segundo dariam a
    mesma versão, o endereço não mudaria e o navegador continuaria mostrando o
    ícone antigo.
    """
    return int(registro.atualizado_em.timestamp() * 1000) if registro else 0


async def _icone(session) -> ConfiguracaoSistema | None:
    return await session.scalar(
        select(ConfiguracaoSistema).where(ConfiguracaoSistema.chave == CHAVE_ICONE)
    )


@router.get("", response_model=SistemaResponse)
async def configuracao(session: SessaoGlobalDep) -> SistemaResponse:
    """Rota pública: a tela de login precisa dela antes de existir token."""
    registro = await _icone(session)
    tem = bool(registro and registro.valor)
    return SistemaResponse(
        tem_icone=tem,
        # Serve de cache-buster: trocado o ícone, o endereço muda e o navegador
        # busca de novo em vez de mostrar o antigo por mais um dia.
        versao_do_icone=_versao(registro),
    )


@router.get("/icone")
async def baixar_icone(session: SessaoGlobalDep) -> Response:
    """**Rota pública, e tem que ser.**

    Favicon e ícones do manifesto são buscados pelo próprio navegador, que não
    manda cabeçalho de autenticação nenhum — foi exatamente assim que a logo da
    fazenda ficou invisível por semanas (seção 8.9). Aqui não há o que proteger:
    o ícone do produto é público por definição, igual ao de qualquer site.

    Sem ícone configurado, devolve o padrão em vez de 404: assim o endereço no
    manifesto e no `<link rel="icon">` é sempre o mesmo e sempre funciona.
    """
    registro = await _icone(session)
    if registro and registro.valor:
        conteudo = await armazenamento.baixar(registro.valor)
        tipo = TIPO_POR_EXTENSAO.get(registro.valor.rsplit(".", 1)[-1], "image/png")
        return Response(
            content=conteudo, media_type=tipo, headers={"Cache-Control": "max-age=300"}
        )

    return Response(
        content=ICONE_PADRAO.read_bytes(),
        media_type="image/png",
        headers={"Cache-Control": "max-age=300"},
    )


@router.post("/icone", response_model=SistemaResponse)
async def enviar_icone(
    ctx: CtxDep,
    session: SessaoGlobalDep,
    arquivo: Annotated[UploadFile, File(description="Ícone do aplicativo")],
) -> SistemaResponse:
    """Só o admin master troca o ícone: ele vale para todas as fazendas, e um
    admin de fazenda mexendo nele mudaria o produto para todo mundo."""
    if not ctx.master:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Requer admin master"
        )

    extensao = TIPOS_DE_IMAGEM.get(arquivo.content_type or "")
    if extensao is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Formato não aceito. Use PNG, JPG, WEBP ou SVG.",
        )

    conteudo = await arquivo.read()
    if not conteudo:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Arquivo vazio"
        )
    if len(conteudo) > settings.logo_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Arquivo acima de {settings.logo_max_bytes // 1024} KB.",
        )

    chave = f"sistema/icone.{extensao}"
    await armazenamento.guardar(chave, conteudo, arquivo.content_type or "image/png")

    registro = await _icone(session)
    if registro is None:
        registro = ConfiguracaoSistema(chave=CHAVE_ICONE)
        session.add(registro)
    anterior = registro.valor
    registro.valor = chave
    await session.commit()
    await session.refresh(registro)

    # Trocar de formato deixaria o objeto antigo órfão no MinIO.
    if anterior and anterior != chave:
        await armazenamento.apagar(anterior)

    registrar_acao("icone_do_sistema_trocado", chave=chave, bytes=len(conteudo))
    return SistemaResponse(
        tem_icone=True, versao_do_icone=_versao(registro)
    )


@router.delete("/icone", response_model=SistemaResponse)
async def remover_icone(ctx: CtxDep, session: SessaoGlobalDep) -> SistemaResponse:
    """Volta ao ícone que vem com o produto."""
    if not ctx.master:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Requer admin master"
        )

    registro = await _icone(session)
    if registro and registro.valor:
        await armazenamento.apagar(registro.valor)
        registro.valor = None
        await session.commit()
        await session.refresh(registro)
        registrar_acao("icone_do_sistema_removido")

    versao = _versao(registro)
    return SistemaResponse(tem_icone=False, versao_do_icone=versao)
