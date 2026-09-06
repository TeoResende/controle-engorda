"""Configuração global do produto — ver `app/models/sistema.py`."""

from pydantic import BaseModel


class SistemaResponse(BaseModel):
    """O que a tela precisa saber sem baixar a imagem.

    `versao_do_icone` é o instante da última troca. Serve de cache-buster: sem
    ele, trocar o ícone não mudaria o endereço e o navegador continuaria
    mostrando o antigo até o cache expirar.
    """

    tem_icone: bool
    versao_do_icone: int
