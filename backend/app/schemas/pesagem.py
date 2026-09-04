import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import StatusTranscricao


class PesagemCriar(BaseModel):
    """Pesagem como o celular do técnico a envia.

    O `id` é **gerado no cliente**, antes de existir internet: é ele que torna o
    envio idempotente. Reenviar a mesma pesagem — porque o app não recebeu a
    confirmação, porque o sinal caiu no meio, porque a fila foi processada duas
    vezes — não pode criar um segundo registro.
    """

    id: uuid.UUID

    # Um dos dois identifica o animal. `brinco` existe porque o aparelho pode ter
    # lido a tag de um animal que ele ainda não sincronizou e cujo UUID não
    # conhece; `animal_id` tem prioridade quando os dois vêm.
    animal_id: uuid.UUID | None = None
    brinco: str | None = Field(default=None, max_length=20)

    data: date
    peso_kg: Decimal = Field(gt=0, le=2000)
    observacao_texto: str | None = None
    latitude: Decimal | None = Field(default=None, ge=-90, le=90)
    longitude: Decimal | None = Field(default=None, ge=-180, le=180)

    # Quando o técnico registrou no curral. Vem do relógio do aparelho, que pode
    # estar errado — por isso `sincronizado_em` é carimbado pelo servidor.
    coletado_em: datetime

    @model_validator(mode="after")
    def _exige_identificacao_do_animal(self) -> "PesagemCriar":
        if self.animal_id is None and not self.brinco:
            raise ValueError("Informe animal_id ou brinco")
        return self


class PesagemAtualizar(BaseModel):
    """Correção de uma pesagem já registrada.

    Corrigir é editar este registro, não mandar outro: uma segunda pesagem com
    id novo viraria um segundo ponto na série de peso do animal.
    """

    data: date | None = None
    peso_kg: Decimal | None = Field(default=None, gt=0, le=2000)
    observacao_texto: str | None = None


class PesagemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    animal_id: uuid.UUID
    data: date
    peso_kg: Decimal
    observacao_texto: str | None
    observacao_audio_url: str | None
    status_transcricao: StatusTranscricao | None
    tecnico_id: uuid.UUID | None
    latitude: Decimal | None
    longitude: Decimal | None
    coletado_em: datetime
    sincronizado_em: datetime
    desativado_em: datetime | None


class ResultadoEnvio(BaseModel):
    """Resultado de uma pesagem dentro de um envio em lote."""

    id: uuid.UUID
    situacao: str  # criada | duplicada | erro
    detalhe: str | None = None
    pesagem: PesagemResponse | None = None


class RespostaLote(BaseModel):
    """O lote é processado item a item, de propósito.

    Uma pesagem inválida no meio da fila não pode impedir as outras de subir —
    senão um registro ruim trava a sincronização do dia inteiro no celular.
    """

    criadas: int
    duplicadas: int
    erros: int
    resultados: list[ResultadoEnvio]
