import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models import StatusAnimal


class AnimalResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    brinco: str
    nome: str | None
    raca: str | None
    porte: str | None
    data_nascimento: date | None
    peso_nascimento: Decimal | None
    lote_id: uuid.UUID | None
    status: StatusAnimal
    criado_em: datetime
