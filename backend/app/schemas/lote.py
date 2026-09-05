import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class LoteCriar(BaseModel):
    nome: str = Field(min_length=1, max_length=120)
    data_formacao: date | None = None


class LoteAtualizar(BaseModel):
    nome: str | None = Field(default=None, min_length=1, max_length=120)
    data_formacao: date | None = None


class LoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    nome: str
    data_formacao: date | None
    criado_em: datetime
    desativado_em: datetime | None


class LoteComContagem(LoteResponse):
    animais_ativos: int


class MoverAnimais(BaseModel):
    """Move um conjunto de animais de uma vez.

    Formar um lote é agrupar dezenas de animais; um PATCH por bicho seria uma
    dezena de chamadas e uma dezena de chances de parar no meio.
    """

    animal_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class ResultadoMovimentacao(BaseModel):
    movidos: int
    # Ids que não existem nesta fazenda, ou já estavam onde se pediu.
    ignorados: list[uuid.UUID]
