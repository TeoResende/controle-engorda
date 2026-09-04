import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models import StatusAnimal


class AnimalCriar(BaseModel):
    # O brinco é o número gravado na tag NTAG213 (4 dígitos no padrão atual),
    # mas o campo aceita até 20 para não travar mudança de padrão de brinco.
    brinco: str = Field(min_length=1, max_length=20)
    nome: str | None = Field(default=None, max_length=120)
    raca: str | None = Field(default=None, max_length=80)
    porte: str | None = Field(default=None, max_length=40)
    brinco_mae: str | None = Field(default=None, max_length=20)
    data_nascimento: date | None = None
    peso_nascimento: Decimal | None = Field(default=None, gt=0, le=200)
    lote_id: uuid.UUID | None = None
    observacoes: str | None = None


class AnimalAtualizar(BaseModel):
    brinco: str | None = Field(default=None, min_length=1, max_length=20)
    nome: str | None = Field(default=None, max_length=120)
    raca: str | None = Field(default=None, max_length=80)
    porte: str | None = Field(default=None, max_length=40)
    brinco_mae: str | None = Field(default=None, max_length=20)
    data_nascimento: date | None = None
    peso_nascimento: Decimal | None = Field(default=None, gt=0, le=200)
    lote_id: uuid.UUID | None = None
    status: StatusAnimal | None = None
    observacoes: str | None = None


class AnimalResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    brinco: str
    nome: str | None
    raca: str | None
    porte: str | None
    brinco_mae: str | None
    data_nascimento: date | None
    peso_nascimento: Decimal | None
    lote_id: uuid.UUID | None
    status: StatusAnimal
    observacoes: str | None
    criado_em: datetime


class BrincoHistoricoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    brinco: str
    vinculado_em: datetime
    desvinculado_em: datetime | None
