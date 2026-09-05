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

from app.core.deps import AdminDep, EscritaDep, SessaoDep
from app.core.log import registrar_acao
from app.models import Animal, AnimalBrincoHistorico, Lote, Pesagem, StatusAnimal
from app.schemas import (
    AnimalAtualizar,
    AnimalCriar,
    AnimalResponse,
    BrincoHistoricoResponse,
    ExclusaoDefinitiva,
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
    incluir_inativos: Annotated[bool, Query(description="Traz também os desativados")] = False,
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

    base = sessao.selecionar(Animal, incluir_inativos=incluir_inativos).where(*filtros)
    total = await sessao.session.scalar(
        select(func.count()).select_from(base.subquery())
    )

    # Último peso vem junto: a tela de coleta precisa dele para mostrar a
    # referência, e o app do técnico guarda isso no aparelho para funcionar sem
    # sinal. Buscar por animal seria N+1 num rebanho de milhares.
    ultima = (
        select(
            Pesagem.animal_id,
            Pesagem.peso_kg,
            Pesagem.data,
            func.row_number()
            .over(
                partition_by=Pesagem.animal_id,
                order_by=(Pesagem.data.desc(), Pesagem.coletado_em.desc(), Pesagem.id.desc()),
            )
            .label("pos"),
        )
        .where(Pesagem.fazenda_id == sessao.fazenda_id, Pesagem.desativado_em.is_(None))
        .subquery()
    )
    recente = select(ultima).where(ultima.c.pos == 1).subquery()

    linhas = await sessao.session.execute(
        base.add_columns(recente.c.peso_kg, recente.c.data)
        .join(recente, recente.c.animal_id == Animal.id, isouter=True)
        .order_by(Animal.brinco)
        .limit(limite)
        .offset(deslocamento)
    )

    itens = []
    for animal, peso, data_peso in linhas:
        resposta = AnimalResponse.model_validate(animal)
        resposta.ultimo_peso = peso
        resposta.ultima_pesagem = data_peso
        itens.append(resposta)

    return Pagina[AnimalResponse](
        itens=itens, total=total or 0, limite=limite, deslocamento=deslocamento
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
async def desativar(animal_id: uuid.UUID, sessao: SessaoDep, ctx: EscritaDep) -> None:
    """Desativa o animal — as pesagens dele continuam no banco.

    `status` (vendido/morto/transferido) diz por que o animal saiu do rebanho;
    a desativação diz que o registro saiu de circulação. Os dois são
    independentes, e nenhum dos dois apaga série de peso.
    """
    animal = await _obter(sessao, animal_id)
    if animal.desativado_em is None:
        animal.desativado_em = datetime.now(timezone.utc)
        await sessao.commit()


@router.post("/{animal_id}/excluir", status_code=status.HTTP_204_NO_CONTENT)
async def excluir_definitivamente(
    animal_id: uuid.UUID,
    dados: ExclusaoDefinitiva,
    sessao: SessaoDep,
    ctx: AdminDep,
) -> None:
    """Apaga o animal e todo o histórico dele. **Não tem volta.**

    Existe para o caso do brinco reciclado e do cadastro errado: uma tag
    reaproveitada num animal cadastrado por engano deixaria dois registros
    disputando a mesma identidade, e o índice parcial impediria o novo de
    existir enquanto o velho estivesse ativo.

    Desativar resolve quase tudo e é o caminho normal — por isso esta rota é de
    **admin**, exige o brinco digitado como confirmação e fica registrada no
    log com quem pediu, quantas pesagens foram junto e por quê. Enquanto não
    houver tabela de auditoria, o log é a trilha.
    """
    animal = await _obter(sessao, animal_id)

    if dados.brinco.strip() != animal.brinco:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Digite o brinco {animal.brinco} para confirmar a exclusão",
        )

    pesagens = await sessao.session.scalar(
        select(func.count()).select_from(Pesagem).where(Pesagem.animal_id == animal_id)
    )

    registrar_acao(
        "animal excluído definitivamente",
        animal_id=str(animal_id),
        brinco=animal.brinco,
        pesagens_apagadas=pesagens or 0,
        motivo=dados.motivo,
        por=str(ctx.usuario.id),
    )

    # As pesagens e o histórico de brinco vão junto, por cascata.
    await sessao.session.delete(animal)
    await sessao.commit()


@router.post("/{animal_id}/reativar", response_model=AnimalResponse)
async def reativar(animal_id: uuid.UUID, sessao: SessaoDep, ctx: EscritaDep) -> Animal:
    """Reativar pode esbarrar em brinco já reaproveitado por outro animal — daí
    o 409, que obriga a decidir qual dos dois fica com a tag."""
    animal = await _obter(sessao, animal_id)
    animal.desativado_em = None
    try:
        await sessao.commit()
    except IntegrityError as exc:
        await sessao.session.rollback()
        raise BRINCO_DUPLICADO from exc
    await sessao.session.refresh(animal)
    return animal
