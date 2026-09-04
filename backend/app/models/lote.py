import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import criado_em_col, uuid_pk

if TYPE_CHECKING:
    from app.models.animal import Animal
    from app.models.fazenda import Fazenda


class Lote(Base):
    __tablename__ = "lotes"

    id: Mapped[uuid.UUID] = uuid_pk()
    fazenda_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("fazendas.id", ondelete="CASCADE"), nullable=False, index=True
    )
    nome: Mapped[str] = mapped_column(String(120), nullable=False)
    data_formacao: Mapped[date | None] = mapped_column(Date)
    criado_em: Mapped[datetime] = criado_em_col()

    fazenda: Mapped["Fazenda"] = relationship(back_populates="lotes")
    animais: Mapped[list["Animal"]] = relationship(back_populates="lote")
