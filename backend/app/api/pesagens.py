"""Registro de pesagens.

Este é o endpoint que o app offline alimenta, e a regra que manda aqui é a
**idempotência pelo UUID gerado no celular**: o técnico registra no curral sem
sinal, a fila local reenvia quando a conexão volta, e reenvio não pode virar
registro duplicado. Um mesmo `id` sempre aponta para a mesma pesagem.
"""

import uuid
from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core import armazenamento
from app.core.config import settings
from app.core.deps import CtxDep, EscritaDep, SessaoDep
from app.core.fila import enfileirar
from app.models import Animal, Pesagem, StatusAnimal, StatusTranscricao
from app.schemas import (
    Pagina,
    PesagemAtualizar,
    PesagemCriar,
    PesagemResponse,
    RespostaLote,
    ResultadoEnvio,
)

import logging

logger = logging.getLogger("pesagens")

router = APIRouter(prefix="/pesagens", tags=["pesagens"])

# Uma pesagem coletada "amanhã" só pode ser relógio errado no aparelho. Aceitamos
# um dia de folga para não rejeitar coleta legítima por fuso horário.
FOLGA_DATA_FUTURA = 1


class ErroDePesagem(Exception):
    """Pesagem recusada por regra de negócio, com mensagem para o técnico."""


async def _resolver_animal(sessao: SessaoDep, dados: PesagemCriar) -> Animal:
    if dados.animal_id is not None:
        animal = await sessao.obter(Animal, dados.animal_id)
        if animal is None:
            raise ErroDePesagem("Animal não encontrado nesta fazenda")
        return animal

    animal = await sessao.session.scalar(
        sessao.selecionar(Animal).where(
            Animal.brinco == dados.brinco, Animal.status == StatusAnimal.ativo
        )
    )
    if animal is None:
        raise ErroDePesagem(f"Nenhum animal ativo com o brinco {dados.brinco}")
    return animal


def _validar_data(dados: PesagemCriar) -> None:
    limite = date.today().toordinal() + FOLGA_DATA_FUTURA
    if dados.data.toordinal() > limite:
        raise ErroDePesagem("Data da pesagem está no futuro")


async def _registrar(
    sessao: SessaoDep, ctx, dados: PesagemCriar
) -> tuple[Pesagem, bool]:
    """Grava a pesagem. Devolve (pesagem, criada_agora).

    Se o `id` já existe, o registro guardado é devolvido **sem alteração**: a
    verdade é o que chegou primeiro. Corrigir peso é `PATCH`, com o mesmo id —
    reenviar conteúdo diferente sob o mesmo id seria um bug do cliente, e
    sobrescrever em silêncio esconderia esse bug.
    """
    existente = await sessao.obter(Pesagem, dados.id)
    if existente is not None:
        return existente, False

    _validar_data(dados)
    animal = await _resolver_animal(sessao, dados)

    pesagem = sessao.adicionar(
        Pesagem(
            id=dados.id,
            animal_id=animal.id,
            data=dados.data,
            peso_kg=dados.peso_kg,
            observacao_texto=dados.observacao_texto,
            latitude=dados.latitude,
            longitude=dados.longitude,
            coletado_em=dados.coletado_em,
            # Autoria vem do token, nunca do corpo: o aparelho não escolhe em
            # nome de quem assina a pesagem.
            tecnico_id=ctx.usuario.id,
        )
    )
    try:
        await sessao.flush()
    except IntegrityError:
        # Corrida: dois envios do mesmo id ao mesmo tempo (a fila reenviou
        # enquanto a primeira tentativa ainda estava em voo). Quem perdeu a
        # corrida lê o registro do vencedor.
        await sessao.session.rollback()
        guardada = await sessao.obter(Pesagem, dados.id)
        if guardada is None:
            raise
        return guardada, False

    return pesagem, True


@router.post("", response_model=PesagemResponse)
async def registrar(
    dados: PesagemCriar,
    sessao: SessaoDep,
    ctx: EscritaDep,
    resposta: Response = None,  # type: ignore[assignment]
) -> Pesagem:
    """Registra uma pesagem. **201** se criou agora, **200** se o id já existia."""
    try:
        pesagem, criada = await _registrar(sessao, ctx, dados)
    except ErroDePesagem as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    await sessao.commit()
    await sessao.session.refresh(pesagem)
    if criada:
        resposta.status_code = status.HTTP_201_CREATED
    return pesagem


@router.post("/lote", response_model=RespostaLote)
async def registrar_lote(
    itens: list[PesagemCriar],
    sessao: SessaoDep,
    ctx: EscritaDep,
) -> RespostaLote:
    """Descarrega a fila do celular de uma vez.

    Item a item de propósito: uma pesagem inválida no meio da fila não pode
    impedir as outras de subir, senão um registro ruim trava a sincronização do
    dia inteiro no aparelho.
    """
    if len(itens) > 500:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Envie no máximo 500 pesagens por vez",
        )

    resultados: list[ResultadoEnvio] = []
    criadas = duplicadas = erros = 0

    for item in itens:
        try:
            pesagem, criada = await _registrar(sessao, ctx, item)
        except ErroDePesagem as exc:
            erros += 1
            resultados.append(
                ResultadoEnvio(id=item.id, situacao="erro", detalhe=str(exc))
            )
            continue

        await sessao.commit()
        await sessao.session.refresh(pesagem)
        if criada:
            criadas += 1
        else:
            duplicadas += 1
        resultados.append(
            ResultadoEnvio(
                id=item.id,
                situacao="criada" if criada else "duplicada",
                pesagem=PesagemResponse.model_validate(pesagem),
            )
        )

    return RespostaLote(
        criadas=criadas, duplicadas=duplicadas, erros=erros, resultados=resultados
    )


@router.get("", response_model=Pagina[PesagemResponse])
async def listar(
    sessao: SessaoDep,
    animal_id: uuid.UUID | None = None,
    lote_id: uuid.UUID | None = None,
    desde: date | None = None,
    ate: date | None = None,
    incluir_inativas: Annotated[bool, Query(description="Traz também as desativadas")] = False,
    limite: Annotated[int, Query(ge=1, le=500)] = 100,
    deslocamento: Annotated[int, Query(ge=0)] = 0,
) -> Pagina[PesagemResponse]:
    filtros = []
    if animal_id is not None:
        filtros.append(Pesagem.animal_id == animal_id)
    if lote_id is not None:
        filtros.append(
            Pesagem.animal_id.in_(
                select(Animal.id).where(
                    Animal.fazenda_id == sessao.fazenda_id, Animal.lote_id == lote_id
                )
            )
        )
    if desde is not None:
        filtros.append(Pesagem.data >= desde)
    if ate is not None:
        filtros.append(Pesagem.data <= ate)

    base = sessao.selecionar(Pesagem, incluir_inativos=incluir_inativas).where(*filtros)
    total = await sessao.session.scalar(select(func.count()).select_from(base.subquery()))
    itens = await sessao.session.scalars(
        # Mais recente primeiro: é assim que a tela de histórico do animal lê.
        base.order_by(Pesagem.data.desc(), Pesagem.coletado_em.desc())
        .limit(limite)
        .offset(deslocamento)
    )
    return Pagina[PesagemResponse](
        itens=[PesagemResponse.model_validate(p) for p in itens],
        total=total or 0,
        limite=limite,
        deslocamento=deslocamento,
    )


async def _obter(sessao: SessaoDep, pesagem_id: uuid.UUID) -> Pesagem:
    pesagem = await sessao.obter(Pesagem, pesagem_id)
    if pesagem is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pesagem não encontrada")
    return pesagem


@router.post("/{pesagem_id}/audio", response_model=PesagemResponse)
async def enviar_audio(
    pesagem_id: uuid.UUID,
    sessao: SessaoDep,
    ctx: EscritaDep,
    arquivo: Annotated[UploadFile, File(description="Observação em áudio (webm/opus)")],
) -> Pesagem:
    """Anexa o áudio de observação a uma pesagem já registrada.

    Em duas etapas de propósito (pesagem primeiro, áudio depois): a pesagem é o
    dado que não pode se perder e sobe em JSON pequeno; o áudio é pesado e pode
    falhar no meio sem levar o peso junto. É a ordem que o motor de sync do
    celular segue.
    """
    pesagem = await _obter(sessao, pesagem_id)

    conteudo = await arquivo.read()
    if not conteudo:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Áudio vazio"
        )
    if len(conteudo) > settings.audio_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Áudio acima de {settings.audio_max_bytes // 1024} KB. "
                f"Grave no máximo {settings.audio_max_segundos}s."
            ),
        )

    chave = armazenamento.chave_do_audio(sessao.fazenda_id, pesagem.id)
    await armazenamento.guardar(chave, conteudo, arquivo.content_type or "audio/webm")

    pesagem.observacao_audio_url = chave
    pesagem.status_transcricao = StatusTranscricao.pendente
    await sessao.commit()

    # A transcrição é job do worker: o técnico não espera por ela. Se a fila
    # estiver fora do ar, o áudio já está guardado e a pesagem fica 'pendente'
    # para ser reprocessada.
    try:
        await enfileirar("transcrever_audio", str(pesagem.id))
    except Exception:  # noqa: BLE001
        logger.exception("não consegui enfileirar a transcrição de %s", pesagem.id)

    await sessao.session.refresh(pesagem)
    return pesagem


@router.get("/{pesagem_id}/audio")
async def baixar_audio(pesagem_id: uuid.UUID, sessao: SessaoDep) -> Response:
    """Devolve o áudio gravado. O arquivo é servido pela API, e não por link
    direto do MinIO, para o isolamento por fazenda continuar valendo."""
    pesagem = await _obter(sessao, pesagem_id)
    if not pesagem.observacao_audio_url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sem áudio")

    conteudo = await armazenamento.baixar(pesagem.observacao_audio_url)
    return Response(content=conteudo, media_type="audio/webm")


@router.post("/{pesagem_id}/transcrever", response_model=PesagemResponse)
async def reprocessar_transcricao(
    pesagem_id: uuid.UUID, sessao: SessaoDep, ctx: EscritaDep
) -> Pesagem:
    """Reenfileira a transcrição — para quando ela falhou e o áudio segue lá."""
    pesagem = await _obter(sessao, pesagem_id)
    if not pesagem.observacao_audio_url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sem áudio")

    pesagem.status_transcricao = StatusTranscricao.pendente
    await sessao.commit()
    await enfileirar("transcrever_audio", str(pesagem.id))
    await sessao.session.refresh(pesagem)
    return pesagem


@router.get("/{pesagem_id}", response_model=PesagemResponse)
async def obter(pesagem_id: uuid.UUID, sessao: SessaoDep) -> Pesagem:
    return await _obter(sessao, pesagem_id)


@router.patch("/{pesagem_id}", response_model=PesagemResponse)
async def corrigir(
    pesagem_id: uuid.UUID, dados: PesagemAtualizar, sessao: SessaoDep, ctx: EscritaDep
) -> Pesagem:
    pesagem = await _obter(sessao, pesagem_id)
    for campo, valor in dados.model_dump(exclude_unset=True).items():
        setattr(pesagem, campo, valor)
    await sessao.commit()
    await sessao.session.refresh(pesagem)
    return pesagem


@router.delete("/{pesagem_id}", status_code=status.HTTP_204_NO_CONTENT)
async def desativar(pesagem_id: uuid.UUID, sessao: SessaoDep, ctx: EscritaDep) -> None:
    """Desativa a pesagem — ela sai da série de peso mas continua no banco.

    Peso é o produto do sistema: uma leitura errada tem que ser rastreável
    depois de retirada, não sumir.
    """
    pesagem = await _obter(sessao, pesagem_id)
    if pesagem.desativado_em is None:
        pesagem.desativado_em = datetime.now(timezone.utc)
        await sessao.commit()


@router.post("/{pesagem_id}/reativar", response_model=PesagemResponse)
async def reativar(pesagem_id: uuid.UUID, sessao: SessaoDep, ctx: EscritaDep) -> Pesagem:
    pesagem = await _obter(sessao, pesagem_id)
    pesagem.desativado_em = None
    await sessao.commit()
    await sessao.session.refresh(pesagem)
    return pesagem
