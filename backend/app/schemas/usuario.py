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
    admin_master: bool
    criado_em: datetime
    # Data em que o vínculo com esta fazenda foi desativado.
    desativado_em: datetime | None


class VinculoDoUsuario(BaseModel):
    """Uma fazenda que a pessoa atende, e com que papel.

    Só o admin master enxerga esta lista: dizer a um admin da fazenda A que
    fulano também trabalha na fazenda B vazaria a existência de outro cliente.
    """

    fazenda_id: uuid.UUID
    fazenda_nome: str
    papel: Papel
    ativo: bool


class VinculoAtualizar(BaseModel):
    papel: Papel
