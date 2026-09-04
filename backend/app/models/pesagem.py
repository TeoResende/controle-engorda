import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, Enum as SAEnum
from sqlalchemy import ForeignKey, Index, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import Desativavel, StatusTranscricao, desativado_em_col

if TYPE_CHECKING:
    from app.models.animal import Animal
    from app.models.fazenda import Fazenda
    from app.models.usuario import Usuario


class Pesagem(Desativavel, Base):
    __tablename__ = "pesagens"
    __table_args__ = (
        # Consulta central do dashboard: série de peso de um animal no tempo.
        Index("ix_pesagens_animal_data", "animal_id", "data"),
        Index("ix_pesagens_fazenda_data", "fazenda_id", "data"),
    )

    # Sem default: o id vem do celular do técnico, gerado offline. É ele que
    # torna o envio idempotente (M4) — reenviar a mesma pesagem não duplica.
    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)

    fazenda_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("fazendas.id", ondelete="CASCADE"), nullable=False, index=True
    )
    animal_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("animais.id", ondelete="CASCADE"), nullable=False, index=True
    )
    data: Mapped[date] = mapped_column(Date, nullable=False)
    peso_kg: Mapped[Decimal] = mapped_column(Numeric(7, 2), nullable=False)

    observacao_texto: Mapped[str | None] = mapped_column(Text)
    observacao_audio_url: Mapped[str | None] = mapped_column(String(500))
    status_transcricao: Mapped[StatusTranscricao | None] = mapped_column(
        SAEnum(StatusTranscricao, name="status_transcricao", native_enum=True)
    )

    tecnico_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL")
    )
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))

    # coletado_em = quando o técnico registrou no curral (pode ser dias antes);
    # sincronizado_em = quando o servidor recebeu. A diferença entre os dois é o
    # tempo que o aparelho passou sem sinal.
    coletado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sincronizado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Pesagem errada é desativada, nunca apagada: a série de peso do animal é o
    # produto do sistema e precisa ser auditável.
    desativado_em: Mapped[datetime | None] = desativado_em_col()

    animal: Mapped["Animal"] = relationship(back_populates="pesagens")
    fazenda: Mapped["Fazenda"] = relationship()
    tecnico: Mapped["Usuario | None"] = relationship()
