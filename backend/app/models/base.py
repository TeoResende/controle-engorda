"""Tipos e mixins compartilhados pelos models."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import Mapped, mapped_column


def uuid_pk() -> Mapped[uuid.UUID]:
    """PK UUID gerada na aplicação.

    UUID (e não serial) porque a pesagem nasce no celular do técnico, offline, e
    precisa de um id estável antes de existir no servidor. Mantemos o mesmo tipo
    nas demais tabelas por consistência.
    """
    return mapped_column(primary_key=True, default=uuid.uuid4)


def criado_em_col() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def desativado_em_col() -> Mapped["datetime | None"]:
    """Marca de desativação (soft delete).

    Nada é apagado neste sistema: histórico de peso, autoria de pesagem e rastro
    de brinco precisam sobreviver à saída de um animal, de um lote ou de um
    funcionário. `desativado_em is None` significa ativo.
    """
    return mapped_column(DateTime(timezone=True), default=None, index=True)


class Desativavel:
    """Mixin de leitura para quem tem `desativado_em`."""

    desativado_em: Mapped[datetime | None]

    @property
    def ativo(self) -> bool:
        return self.desativado_em is None


class Papel(str, enum.Enum):
    tecnico = "tecnico"
    cliente = "cliente"
    admin = "admin"


class StatusAnimal(str, enum.Enum):
    """Situação do animal no rebanho.

    É ortogonal à desativação: `status` diz por que o animal saiu do rebanho,
    `desativado_em` diz que o registro foi retirado de circulação no sistema.
    """

    ativo = "ativo"
    vendido = "vendido"
    morto = "morto"
    transferido = "transferido"


class StatusTranscricao(str, enum.Enum):
    pendente = "pendente"
    processando = "processando"
    concluida = "concluida"
    falhou = "falhou"
