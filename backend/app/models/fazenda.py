import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import Papel, criado_em_col, uuid_pk

if TYPE_CHECKING:
    from app.models.animal import Animal
    from app.models.lote import Lote
    from app.models.usuario import Usuario


class Fazenda(Base):
    __tablename__ = "fazendas"

    id: Mapped[uuid.UUID] = uuid_pk()
    nome: Mapped[str] = mapped_column(String(160), nullable=False)
    proprietario: Mapped[str | None] = mapped_column(String(160))
    endereco: Mapped[str | None] = mapped_column(String(300))
    plano: Mapped[str] = mapped_column(String(40), default="basico", nullable=False)
    criado_em: Mapped[datetime] = criado_em_col()

    vinculos: Mapped[list["UsuarioFazenda"]] = relationship(
        back_populates="fazenda", cascade="all, delete-orphan"
    )
    lotes: Mapped[list["Lote"]] = relationship(back_populates="fazenda")
    animais: Mapped[list["Animal"]] = relationship(back_populates="fazenda")


class UsuarioFazenda(Base):
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

    usuario: Mapped["Usuario"] = relationship(back_populates="vinculos")
    fazenda: Mapped["Fazenda"] = relationship(back_populates="vinculos")
