import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class FazendaCriar(BaseModel):
    nome: str = Field(min_length=2, max_length=160)
    proprietario: str | None = Field(default=None, max_length=160)
    endereco: str | None = Field(default=None, max_length=300)


class FazendaAtualizar(BaseModel):
    nome: str | None = Field(default=None, min_length=2, max_length=160)
    proprietario: str | None = Field(default=None, max_length=160)
    endereco: str | None = Field(default=None, max_length=300)
    # Meta de ganho médio diário e prazo sem pesagem, que definem os alertas.
    gmd_meta: Decimal | None = Field(default=None, gt=0, le=5)
    dias_sem_pesagem: int | None = Field(default=None, ge=1, le=365)
    # Hex de 6 dígitos. String vazia limpa a cor e devolve o padrão do sistema.
    cor_primaria: str | None = Field(default=None, pattern=r"^(#[0-9A-Fa-f]{6})?$")
    cor_destaque: str | None = Field(default=None, pattern=r"^(#[0-9A-Fa-f]{6})?$")
    cor_fundo: str | None = Field(default=None, pattern=r"^(#[0-9A-Fa-f]{6})?$")


class FazendaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    nome: str
    proprietario: str | None
    endereco: str | None
    plano: str
    gmd_meta: Decimal
    dias_sem_pesagem: int
    cor_primaria: str | None
    cor_destaque: str | None
    cor_fundo: str | None
    tem_logo: bool = False
    criado_em: datetime
    desativado_em: datetime | None
