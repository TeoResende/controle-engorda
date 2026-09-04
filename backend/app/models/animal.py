import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum as SAEnum
from sqlalchemy import Date, ForeignKey, Index, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import StatusAnimal, criado_em_col, uuid_pk

if TYPE_CHECKING:
    from app.models.fazenda import Fazenda
    from app.models.lote import Lote
    from app.models.pesagem import Pesagem


class Animal(Base):
    __tablename__ = "animais"
    __table_args__ = (
        # Um brinco físico só pode estar em um animal ATIVO por fazenda. O índice
        # é parcial de propósito: o brinco pode ser reaproveitado depois que o
        # animal sai do rebanho (vendido/morto), sem apagar o histórico.
        Index(
            "uq_animal_brinco_ativo",
            "fazenda_id",
            "brinco",
            unique=True,
            postgresql_where=text("status = 'ativo'"),
        ),
        Index("ix_animais_fazenda_lote", "fazenda_id", "lote_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    fazenda_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("fazendas.id", ondelete="CASCADE"), nullable=False, index=True
    )
    brinco: Mapped[str] = mapped_column(String(20), nullable=False)
    nome: Mapped[str | None] = mapped_column(String(120))
    raca: Mapped[str | None] = mapped_column(String(80))
    porte: Mapped[str | None] = mapped_column(String(40))
    brinco_mae: Mapped[str | None] = mapped_column(String(20))
    data_nascimento: Mapped[date | None] = mapped_column(Date)
    peso_nascimento: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    lote_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("lotes.id", ondelete="SET NULL")
    )
    status: Mapped[StatusAnimal] = mapped_column(
        SAEnum(StatusAnimal, name="status_animal", native_enum=True),
        default=StatusAnimal.ativo,
        nullable=False,
    )
    observacoes: Mapped[str | None] = mapped_column(Text)
    criado_em: Mapped[datetime] = criado_em_col()

    fazenda: Mapped["Fazenda"] = relationship(back_populates="animais")
    lote: Mapped["Lote | None"] = relationship(back_populates="animais")
    pesagens: Mapped[list["Pesagem"]] = relationship(back_populates="animal")
    brincos: Mapped[list["AnimalBrincoHistorico"]] = relationship(
        back_populates="animal", cascade="all, delete-orphan"
    )


class AnimalBrincoHistorico(Base):
    """Histórico de troca de brinco — brinco cai, some ou é substituído, e o
    rastro do animal não pode se perder junto."""

    __tablename__ = "animal_brinco_historico"
    __table_args__ = (Index("ix_brinco_historico_brinco", "brinco"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    animal_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("animais.id", ondelete="CASCADE"), nullable=False, index=True
    )
    brinco: Mapped[str] = mapped_column(String(20), nullable=False)
    vinculado_em: Mapped[datetime] = criado_em_col()
    desvinculado_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    animal: Mapped["Animal"] = relationship(back_populates="brincos")
