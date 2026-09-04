from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class Pagina(BaseModel, Generic[T]):
    """Envelope de listagem paginada.

    `total` é o total no banco, não o tamanho da página — o dashboard precisa
    dele para paginar sem uma segunda chamada.
    """

    itens: list[T]
    total: int
    limite: int
    deslocamento: int
