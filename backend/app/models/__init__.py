"""Models SQLAlchemy. O import de todos aqui é o que faz o autogenerate do
Alembic enxergar as tabelas."""

from app.models.animal import Animal, AnimalBrincoHistorico
from app.models.base import Papel, StatusAnimal, StatusTranscricao
from app.models.fazenda import Fazenda, UsuarioFazenda
from app.models.lote import Lote
from app.models.pesagem import Pesagem
from app.models.sistema import CHAVE_ICONE, ConfiguracaoSistema
from app.models.usuario import Usuario

__all__ = [
    "Animal",
    "AnimalBrincoHistorico",
    "CHAVE_ICONE",
    "ConfiguracaoSistema",
    "Fazenda",
    "Lote",
    "Papel",
    "Pesagem",
    "StatusAnimal",
    "StatusTranscricao",
    "Usuario",
    "UsuarioFazenda",
]
