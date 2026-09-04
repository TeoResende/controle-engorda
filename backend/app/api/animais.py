"""Listagem de animais.

No M2 esta rota existe para provar o isolamento multi-tenant na prática; o CRUD
completo entra no M3.
"""

import uuid

from fastapi import APIRouter, HTTPException, status

from app.core.deps import SessaoDep
from app.models import Animal
from app.schemas import AnimalResponse

router = APIRouter(prefix="/animais", tags=["animais"])


@router.get("", response_model=list[AnimalResponse])
async def listar(sessao: SessaoDep) -> list[Animal]:
    # Sem filtro de fazenda escrito aqui: quem aplica é a SessaoFazenda.
    resultado = await sessao.session.scalars(
        sessao.selecionar(Animal).order_by(Animal.brinco)
    )
    return list(resultado)


@router.get("/{animal_id}", response_model=AnimalResponse)
async def obter(animal_id: uuid.UUID, sessao: SessaoDep) -> Animal:
    animal = await sessao.obter(Animal, animal_id)
    if animal is None:
        # 404 e não 403 de propósito: um id de outra fazenda não deve revelar
        # que o registro existe.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Animal não encontrado")
    return animal
