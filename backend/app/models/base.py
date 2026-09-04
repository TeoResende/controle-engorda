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


class Papel(str, enum.Enum):
    tecnico = "tecnico"
    cliente = "cliente"
    admin = "admin"


class StatusAnimal(str, enum.Enum):
    ativo = "ativo"
    vendido = "vendido"
    morto = "morto"
    transferido = "transferido"


class StatusTranscricao(str, enum.Enum):
    pendente = "pendente"
    processando = "processando"
    concluida = "concluida"
    falhou = "falhou"
