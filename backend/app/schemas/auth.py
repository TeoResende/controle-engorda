import uuid

from pydantic import BaseModel, ConfigDict, EmailStr

from app.models import Papel


class FazendaDoUsuario(BaseModel):
    """Fazenda que o usuário pode acessar, e com que papel."""

    model_config = ConfigDict(from_attributes=True)

    fazenda_id: uuid.UUID
    nome: str
    papel: Papel


class LoginRequest(BaseModel):
    email: EmailStr
    senha: str
    # Opcional: quem atende mais de uma fazenda escolhe no login. Omitido,
    # entra na única fazenda que tem — ou recebe 409 se tiver várias.
    fazenda_id: uuid.UUID | None = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    fazenda_id: uuid.UUID
    papel: Papel


class RefreshRequest(BaseModel):
    refresh_token: str


class TrocarFazendaRequest(BaseModel):
    fazenda_id: uuid.UUID


class UsuarioResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    nome: str
    email: EmailStr


class EuResponse(BaseModel):
    usuario: UsuarioResponse
    fazenda_id: uuid.UUID
    papel: Papel
    fazendas: list[FazendaDoUsuario]
