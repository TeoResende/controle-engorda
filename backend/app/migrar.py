"""Aplica as migrations pendentes na subida do container.

Existe para que instalar em outro servidor seja `docker compose up` e mais nada.
Sem isso, quem sobe o projeto e abre o navegador vê erro 500 em vez da tela de
primeiro acesso — e o motivo (faltou um comando que estava no README) é o tipo
de coisa que faz o produto parecer quebrado logo no primeiro contato.

O backend e o worker sobem juntos, então os dois chegariam aqui ao mesmo tempo.
Um **advisory lock** do Postgres resolve: o segundo espera o primeiro terminar e
encontra tudo pronto, em vez de os dois tentarem criar as mesmas tabelas.
"""

import logging

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

from app.core.config import settings

logger = logging.getLogger("migrar")

# Número arbitrário, mas fixo: o que importa é os dois processos usarem o mesmo.
TRAVA = 918_273_645


def aplicar() -> None:
    # Conexão administrativa e síncrona: migrations precisam de DDL, e o Alembic
    # é síncrono por natureza.
    url = settings.database_url_admin.replace("+asyncpg", "")
    engine = create_engine(url, isolation_level="AUTOCOMMIT")

    with engine.connect() as conexao:
        logger.info("aguardando a vez de migrar…")
        conexao.execute(text("SELECT pg_advisory_lock(:trava)"), {"trava": TRAVA})
        try:
            config = Config("alembic.ini")
            config.set_main_option("script_location", "app/migrations")
            command.upgrade(config, "head")
            logger.info("migrations em dia")
        finally:
            conexao.execute(text("SELECT pg_advisory_unlock(:trava)"), {"trava": TRAVA})

    engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s")
    aplicar()
