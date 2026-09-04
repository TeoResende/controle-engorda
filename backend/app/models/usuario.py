import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import Desativavel, criado_em_col, desativado_em_col, uuid_pk

if TYPE_CHECKING:
    from app.models.fazenda import UsuarioFazenda


class Usuario(Desativavel, Base):
    __tablename__ = "usuarios"

    id: Mapped[uuid.UUID] = uuid_pk()
    nome: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    senha_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # Superusuário: enxerga e opera qualquer fazenda, sem precisar de vínculo.
    # Existe para o dono do SaaS administrar os tenants — e para o primeiro
    # acesso, quando ainda não há fazenda nenhuma.
    admin_master: Mapped[bool] = mapped_column(default=False, nullable=False)
    criado_em: Mapped[datetime] = criado_em_col()
    desativado_em: Mapped[datetime | None] = desativado_em_col()

    vinculos: Mapped[list["UsuarioFazenda"]] = relationship(
        back_populates="usuario", cascade="all, delete-orphan"
    )
