import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import Desativavel, Papel, criado_em_col, desativado_em_col, uuid_pk

if TYPE_CHECKING:
    from app.models.animal import Animal
    from app.models.lote import Lote
    from app.models.usuario import Usuario


class Fazenda(Desativavel, Base):
    __tablename__ = "fazendas"

    id: Mapped[uuid.UUID] = uuid_pk()
    nome: Mapped[str] = mapped_column(String(160), nullable=False)
    proprietario: Mapped[str | None] = mapped_column(String(160))
    endereco: Mapped[str | None] = mapped_column(String(300))
    plano: Mapped[str] = mapped_column(String(40), default="basico", nullable=False)

    # Limites dos alertas. Ficam por fazenda porque a meta de ganho depende do
    # sistema de criação: confinamento e pasto não se comparam com o mesmo
    # número, e um valor fixo no código faria uma das duas parecer sempre ruim.
    gmd_meta: Mapped[Decimal] = mapped_column(
        Numeric(4, 3), default=Decimal("0.500"), nullable=False
    )
    dias_sem_pesagem: Mapped[int] = mapped_column(default=45, nullable=False)

    # --- Identidade visual ---
    # Cores em hex (#RRGGBB). Nulas significam "usar o padrão do sistema" — o
    # que é diferente de guardar o padrão copiado: quando a referência mudar, só
    # quem escolheu uma cor própria fica com a antiga.
    cor_primaria: Mapped[str | None] = mapped_column(String(7))
    cor_destaque: Mapped[str | None] = mapped_column(String(7))
    cor_fundo: Mapped[str | None] = mapped_column(String(7))
    # Chave do objeto no MinIO, como nos áudios das pesagens.
    logo_url: Mapped[str | None] = mapped_column(String(500))
    criado_em: Mapped[datetime] = criado_em_col()
    desativado_em: Mapped[datetime | None] = desativado_em_col()

    @property
    def tem_logo(self) -> bool:
        """A resposta expõe isto e não a chave do objeto: o caminho no MinIO é
        detalhe interno, e a tela só precisa saber se deve buscar a imagem."""
        return bool(self.logo_url)

    vinculos: Mapped[list["UsuarioFazenda"]] = relationship(
        back_populates="fazenda", cascade="all, delete-orphan"
    )
    lotes: Mapped[list["Lote"]] = relationship(back_populates="fazenda")
    animais: Mapped[list["Animal"]] = relationship(back_populates="fazenda")


class UsuarioFazenda(Desativavel, Base):
    """Vínculo N:N — um usuário pode ter papéis diferentes em fazendas diferentes."""

    __tablename__ = "usuario_fazenda"
    __table_args__ = (UniqueConstraint("usuario_id", "fazenda_id", name="uq_usuario_fazenda"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    usuario_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False, index=True
    )
    fazenda_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("fazendas.id", ondelete="CASCADE"), nullable=False, index=True
    )
    papel: Mapped[Papel] = mapped_column(
        SAEnum(Papel, name="papel", native_enum=True), nullable=False
    )
    criado_em: Mapped[datetime] = criado_em_col()
    # Tirar alguém da fazenda desativa o vínculo. Apagar faria as pesagens que
    # essa pessoa registrou perderem a autoria.
    desativado_em: Mapped[datetime | None] = desativado_em_col()

    usuario: Mapped["Usuario"] = relationship(back_populates="vinculos")
    fazenda: Mapped["Fazenda"] = relationship(back_populates="vinculos")
