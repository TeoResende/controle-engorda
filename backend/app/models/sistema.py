"""Configuração do sistema inteiro — não de uma fazenda.

A identidade visual da seção 8.9 é **por fazenda**: cada cliente vê a própria
marca. O ícone do aplicativo é diferente: ele é do produto, não do cliente. O
manifesto do PWA é do domínio, e o ícone que o Android grava na tela inicial e
o que o navegador põe na aba são um só por instalação — não há como variá-los
por tenant sem um domínio por cliente.

Daí uma tabela de chave e valor, global e sem RLS. Ela nasce com uma chave só
(`icone`), mas é o lugar natural para o que vier depois e valer para todos:
nome do produto, texto de rodapé, endereço de suporte.
"""

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ConfiguracaoSistema(Base):
    __tablename__ = "configuracao_sistema"

    chave: Mapped[str] = mapped_column(String(60), primary_key=True)
    valor: Mapped[str | None] = mapped_column(String(500), default=None)
    atualizado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


#: Chave do ícone do aplicativo. O valor é a chave do objeto no MinIO.
CHAVE_ICONE = "icone"
