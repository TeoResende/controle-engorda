import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class LoteCriar(BaseModel):
    nome: str = Field(min_length=1, max_length=120)
    data_formacao: date | None = None


class LoteAtualizar(BaseModel):
    nome: str | None = Field(default=None, min_length=1, max_length=120)
    data_formacao: date | None = None


class LoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    nome: str
    data_formacao: date | None
    criado_em: datetime


class LoteComContagem(LoteResponse):
    animais_ativos: int
