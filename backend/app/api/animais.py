"""CRUD de animais.

Duas regras próprias do domínio moram aqui: o brinco só é único entre os animais
**ativos** da fazenda (brinco de animal vendido pode ser reaproveitado), e toda
troca de brinco é registrada em `animal_brinco_historico` — o brinco cai, some
ou é substituído, e o rastro do animal não pode se perder junto.
"""

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core.deps import EscritaDep, SessaoDep
from app.models import Animal, AnimalBrincoHistorico, Lote, StatusAnimal
from app.schemas import (
    AnimalAtualizar,
    AnimalCriar,
    AnimalResponse,
    BrincoHistoricoResponse,
    Pagina,
)

router = APIRouter(prefix="/animais", tags=["animais"])

BRINCO_DUPLICADO = HTTPException(
    status_code=status.HTTP_409_CONFLICT,
    detail="Já existe um animal ativo com este brinco nesta fazenda",
)


async def _obter(sessao: SessaoDep, animal_id: uuid.UUID) -> Animal:
    animal = await sessao.obter(Animal, animal_id)
    if animal is None:
        # 404 e não 403: id de outra fazenda não pode confirmar que existe.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Animal não encontrado")
    return animal


async def _validar_lote(sessao: SessaoDep, lote_id: uuid.UUID | None) -> None:
    """Lote de outra fazenda não pode ser referenciado — a FK sozinha não impede,
    porque ela não conhece o tenant."""
    if lote_id is None:
        return
    if await sessao.obter(Lote, lote_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Lote não encontrado"
        )


@router.get("", response_model=Pagina[AnimalResponse])
async def listar(
    sessao: SessaoDep,
    brinco: Annotated[str | None, Query(description="Busca parcial pelo brinco")] = None,
    lote_id: uuid.UUID | None = None,
    status_animal: StatusAnimal | None = None,
    limite: Annotated[int, Query(ge=1, le=200)] = 50,
    deslocamento: Annotated[int, Query(ge=0)] = 0,
) -> Pagina[AnimalResponse]:
    filtros = []
    if brinco:
        filtros.append(Animal.brinco.ilike(f"%{brinco}%"))
    if lote_id is not None:
        filtros.append(Animal.lote_id == lote_id)
    if status_animal is not None:
        filtros.append(Animal.status == status_animal)

    base = sessao.selecionar(Animal).where(*filtros)
    total = await sessao.session.scalar(
        select(func.count()).select_from(base.subquery())
    )
    itens = await sessao.session.scalars(
        base.order_by(Animal.brinco).limit(limite).offset(deslocamento)
    )
    return Pagina[AnimalResponse](
        itens=[AnimalResponse.model_validate(a) for a in itens],
        total=total or 0,
        limite=limite,
        deslocamento=deslocamento,
    )


@router.get("/por-brinco/{brinco}", response_model=AnimalResponse)
async def obter_por_brinco(brinco: str, sessao: SessaoDep) -> Animal:
    """Busca pelo número do brinco — é por aqui que a tela de coleta resolve o
    animal depois da leitura NFC (`/tecnico/coleta?brinco=1234`)."""
    animal = await sessao.session.scalar(
        sessao.selecionar(Animal).where(
            Animal.brinco == brinco, Animal.status == StatusAnimal.ativo
        )
    )
    if animal is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Nenhum animal ativo com este brinco"
        )
    return animal


@router.post("", response_model=AnimalResponse, status_code=status.HTTP_201_CREATED)
async def criar(dados: AnimalCriar, sessao: SessaoDep, ctx: EscritaDep) -> Animal:
    await _validar_lote(sessao, dados.lote_id)

    animal = sessao.adicionar(Animal(**dados.model_dump()))
    try:
        await sessao.flush()
    except IntegrityError as exc:
        await sessao.session.rollback()
        raise BRINCO_DUPLICADO from exc

    sessao.session.add(AnimalBrincoHistorico(animal_id=animal.id, brinco=animal.brinco))
    await sessao.commit()
    await sessao.session.refresh(animal)
    return animal


@router.get("/{animal_id}", response_model=AnimalResponse)
async def obter(animal_id: uuid.UUID, sessao: SessaoDep) -> Animal:
    return await _obter(sessao, animal_id)


@router.get("/{animal_id}/brincos", response_model=list[BrincoHistoricoResponse])
async def historico_de_brincos(
    animal_id: uuid.UUID, sessao: SessaoDep
) -> list[AnimalBrincoHistorico]:
    await _obter(sessao, animal_id)  # garante que o animal é desta fazenda
    resultado = await sessao.session.scalars(
        select(AnimalBrincoHistorico)
        .where(AnimalBrincoHistorico.animal_id == animal_id)
        .order_by(AnimalBrincoHistorico.vinculado_em)
    )
    return list(resultado)


@router.patch("/{animal_id}", response_model=AnimalResponse)
async def atualizar(
    animal_id: uuid.UUID, dados: AnimalAtualizar, sessao: SessaoDep, ctx: EscritaDep
) -> Animal:
    animal = await _obter(sessao, animal_id)
    campos = dados.model_dump(exclude_unset=True)

    if "lote_id" in campos:
        await _validar_lote(sessao, campos["lote_id"])

    brinco_novo = campos.get("brinco")
    trocou_brinco = brinco_novo is not None and brinco_novo != animal.brinco

    # O vínculo aberto é lido ANTES de mexer no animal: se a leitura viesse
    # depois, o autoflush do SELECT dispararia o UPDATE do brinco e a violação de
    # unicidade escaparia por fora do try abaixo.
    vinculo_aberto = None
    if trocou_brinco:
        vinculo_aberto = await sessao.session.scalar(
            select(AnimalBrincoHistorico).where(
                AnimalBrincoHistorico.animal_id == animal.id,
                AnimalBrincoHistorico.desvinculado_em.is_(None),
            )
        )

    for campo, valor in campos.items():
        setattr(animal, campo, valor)

    try:
        await sessao.flush()
    except IntegrityError as exc:
        await sessao.session.rollback()
        raise BRINCO_DUPLICADO from exc

    if trocou_brinco:
        if vinculo_aberto is not None:
            vinculo_aberto.desvinculado_em = datetime.now(timezone.utc)
        sessao.session.add(AnimalBrincoHistorico(animal_id=animal.id, brinco=brinco_novo))

    await sessao.commit()

    await sessao.session.refresh(animal)
    return animal


@router.delete("/{animal_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remover(animal_id: uuid.UUID, sessao: SessaoDep, ctx: EscritaDep) -> None:
    """Apagar animal apaga o histórico de peso dele junto (cascade). Para tirar
    do rebanho sem perder o histórico, use PATCH com `status` = vendido/morto."""
    animal = await _obter(sessao, animal_id)
    await sessao.session.delete(animal)
    await sessao.commit()
