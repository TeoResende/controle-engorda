import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field

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
    # Nome da fazenda do token. Sem ele, a sessão nascida do login não sabia
    # dizer em que fazenda o técnico está — só as baixadas por `/auth/sessoes`
    # traziam o nome, e a tela mostrava "Fazenda" genérico justamente onde
    # saber disso decide para onde vai o cadastro.
    fazenda_nome: str | None = None
    papel: Papel
    admin_master: bool = False


class SessaoDaFazenda(BaseModel):
    """Uma sessão pronta para cada fazenda que o usuário atende."""

    fazenda_id: uuid.UUID
    fazenda_nome: str
    papel: Papel
    access_token: str
    refresh_token: str


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
    admin_master: bool = False
    # Para o admin master, são todas as fazendas ativas do sistema.
    fazendas: list[FazendaDoUsuario]


class SetupStatusResponse(BaseModel):
    precisa_configuracao: bool


class PrimeiroAcessoRequest(BaseModel):
    nome: str = Field(min_length=2, max_length=160)
    email: EmailStr
    senha: str = Field(min_length=8, max_length=200)
    nome_fazenda: str = Field(min_length=2, max_length=160)


class TrocarSenhaRequest(BaseModel):
    """Troca da própria senha.

    Exige a senha atual: sem isso, um celular esquecido desbloqueado vira uma
    conta tomada. Não é burocracia — é a única barreira entre "acesso ao
    aparelho" e "acesso permanente à conta".
    """

    senha_atual: str
    senha_nova: str = Field(min_length=8, max_length=200)


class RedefinirSenhaRequest(BaseModel):
    """Redefinição feita por um administrador, para quem esqueceu a senha."""

    senha_nova: str = Field(min_length=8, max_length=200)
