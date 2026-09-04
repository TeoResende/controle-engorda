import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import Papel


class MembroCriar(BaseModel):
    """Cria (ou reaproveita) um usuário e o vincula à fazenda do token."""

    nome: str = Field(min_length=2, max_length=160)
    email: EmailStr
    senha: str = Field(min_length=8, max_length=200)
    papel: Papel


class MembroAtualizar(BaseModel):
    papel: Papel


class MembroResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    nome: str
    email: EmailStr
    papel: Papel
    ativo: bool
    criado_em: datetime
