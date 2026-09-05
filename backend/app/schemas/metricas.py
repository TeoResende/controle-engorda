import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel


class PontoDaSerie(BaseModel):
    data: date
    peso_medio: Decimal
    animais: int


class ResumoLote(BaseModel):
    lote_id: uuid.UUID | None
    nome: str
    animais: int
    peso_medio: Decimal | None
    gmd_medio: Decimal | None


class Alerta(BaseModel):
    """Algo que o pecuarista precisa olhar."""

    tipo: str  # gmd_baixo | sem_pesagem | perda_de_peso
    animal_id: uuid.UUID
    brinco: str
    mensagem: str
    valor: Decimal | None = None


class ResumoDoDia(BaseModel):
    """O que o técnico precisa ver ao abrir o app."""

    pesadas_hoje: int
    lote_ativo: str | None
    lote_ativo_id: uuid.UUID | None


class VisaoGeral(BaseModel):
    animais_ativos: int
    animais_pesados: int
    peso_medio: Decimal | None
    gmd_medio: Decimal | None
    ganho_total_kg: Decimal | None
    ultima_pesagem: date | None
    serie: list[PontoDaSerie]
    lotes: list[ResumoLote]
    alertas: list[Alerta]


class PesagemDaSerie(BaseModel):
    data: date
    peso_kg: Decimal
    # Variação em relação à pesagem anterior. Nula na primeira, que não tem
    # anterior — zero ali seria lido como "não ganhou nada".
    variacao: Decimal | None
    tecnico_nome: str | None
    observacao_texto: str | None
    tem_audio: bool


class DetalheAnimal(BaseModel):
    animal_id: uuid.UUID
    brinco: str
    nome: str | None
    raca: str | None
    porte: str | None
    brinco_mae: str | None
    data_nascimento: date | None
    idade_meses: int | None
    peso_nascimento: Decimal | None
    observacoes: str | None
    lote_id: uuid.UUID | None
    lote: str | None
    status: str
    peso_atual: Decimal | None
    peso_inicial: Decimal | None
    ganho_total: Decimal | None
    gmd: Decimal | None
    dias_acompanhado: int | None
    pesagens: list[PesagemDaSerie]
