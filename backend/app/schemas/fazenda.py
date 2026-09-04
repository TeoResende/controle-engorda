import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class FazendaCriar(BaseModel):
    nome: str = Field(min_length=2, max_length=160)
    proprietario: str | None = Field(default=None, max_length=160)
    endereco: str | None = Field(default=None, max_length=300)


class FazendaAtualizar(BaseModel):
    nome: str | None = Field(default=None, min_length=2, max_length=160)
    proprietario: str | None = Field(default=None, max_length=160)
    endereco: str | None = Field(default=None, max_length=300)


class FazendaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    nome: str
    proprietario: str | None
    endereco: str | None
    plano: str
    criado_em: datetime
    desativado_em: datetime | None
