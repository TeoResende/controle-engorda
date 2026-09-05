"""row level security

Revision ID: 3e0c66336837
Revises: 682ebecaeba1
Create Date: 2026-09-05 04:20:51.394415
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '3e0c66336837'
down_revision: str | None = '682ebecaeba1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Tabelas que pertencem a uma fazenda. `usuarios` fica de fora: a conta é global
# e o login precisa encontrá-la antes de existir fazenda escolhida — quem
# controla o acesso ali é `usuario_fazenda`.
TABELAS = [
    "fazendas",
    "usuario_fazenda",
    "lotes",
    "animais",
    "pesagens",
]

# `fazendas` se identifica pela própria chave; as demais pela coluna fazenda_id.
COLUNA = {"fazendas": "id"}


def _criar_papel_da_aplicacao() -> None:
    """Cria o papel restrito com que a aplicação fala com o banco.

    Sem ele a RLS não protege nada: **superusuário do Postgres ignora políticas
    de linha**, inclusive com FORCE. O usuário que cria as tabelas é dono e
    normalmente superusuário — então a aplicação precisa de outro, sem esses
    poderes.
    """
    from app.core.config import settings

    usuario = settings.postgres_app_user
    senha = settings.postgres_app_password.replace("'", "''")

    op.execute(
        f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{usuario}') THEN
                CREATE ROLE {usuario} LOGIN PASSWORD '{senha}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
            ELSE
                ALTER ROLE {usuario} WITH LOGIN PASSWORD '{senha}' NOSUPERUSER;
            END IF;
        END $$;
        """
    )
    op.execute(f"GRANT USAGE ON SCHEMA public TO {usuario}")
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {usuario}"
    )
    op.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {usuario}")
    # Tabelas criadas por migrations futuras já nascem acessíveis — senão a
    # aplicação quebraria no deploy seguinte, e o motivo seria difícil de achar.
    op.execute(
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {usuario}"
    )
    op.execute(
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {usuario}"
    )


def upgrade() -> None:
    """Row-Level Security: a segunda barreira do isolamento multi-tenant.

    A primeira é a aplicação (`SessaoFazenda`, que filtra sozinha). Esta existe
    para o dia em que a primeira falhar — um endpoint novo que use a sessão
    crua, um JOIN esquecido, uma consulta escrita às pressas. Com ela, o erro
    vira "nenhum resultado" em vez de "dados de outro cliente".

    A política lê `app.fazenda_id`, que a aplicação fixa por transação. Sem esse
    ajuste, nenhuma linha é visível — falha fechada, que é como uma barreira de
    segurança deve falhar.
    """
    _criar_papel_da_aplicacao()

    for tabela in TABELAS:
        coluna = COLUNA.get(tabela, "fazenda_id")
        op.execute(f"ALTER TABLE {tabela} ENABLE ROW LEVEL SECURITY")
        # FORCE faz a política valer inclusive para o dono da tabela — sem isto
        # o usuário da aplicação, que é o dono, passaria por cima dela e a
        # proteção seria decorativa.
        op.execute(f"ALTER TABLE {tabela} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY isolamento_por_fazenda ON {tabela}
            USING (
                current_setting('app.ignorar_rls', true) = 'on'
                OR {coluna}::text = current_setting('app.fazenda_id', true)
            )
            WITH CHECK (
                current_setting('app.ignorar_rls', true) = 'on'
                OR {coluna}::text = current_setting('app.fazenda_id', true)
            )
            """
        )

    # animal_brinco_historico não tem fazenda_id: o vínculo é pelo animal, e a
    # política acompanha o que a RLS de `animais` já decidiu.
    op.execute("ALTER TABLE animal_brinco_historico ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE animal_brinco_historico FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY isolamento_por_fazenda ON animal_brinco_historico
        USING (
            current_setting('app.ignorar_rls', true) = 'on'
            OR EXISTS (SELECT 1 FROM animais a WHERE a.id = animal_id)
        )
        WITH CHECK (
            current_setting('app.ignorar_rls', true) = 'on'
            OR EXISTS (SELECT 1 FROM animais a WHERE a.id = animal_id)
        )
        """
    )


def downgrade() -> None:
    for tabela in [*TABELAS, "animal_brinco_historico"]:
        op.execute(f"DROP POLICY IF EXISTS isolamento_por_fazenda ON {tabela}")
        op.execute(f"ALTER TABLE {tabela} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {tabela} DISABLE ROW LEVEL SECURITY")
