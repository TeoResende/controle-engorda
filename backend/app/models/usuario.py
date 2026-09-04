import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import criado_em_col, uuid_pk

if TYPE_CHECKING:
    from app.models.fazenda import UsuarioFazenda


class Usuario(Base):
    __tablename__ = "usuarios"

    id: Mapped[uuid.UUID] = uuid_pk()
    nome: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    senha_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    ativo: Mapped[bool] = mapped_column(default=True, nullable=False)
    criado_em: Mapped[datetime] = criado_em_col()

    vinculos: Mapped[list["UsuarioFazenda"]] = relationship(
        back_populates="usuario", cascade="all, delete-orphan"
    )
