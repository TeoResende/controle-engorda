"""configuracao do sistema

Revision ID: a1c47f0b9e21
Revises: 8d0f3edcd4a2
Create Date: 2026-09-06 00:20:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "a1c47f0b9e21"
down_revision: str | None = "8d0f3edcd4a2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "configuracao_sistema",
        sa.Column("chave", sa.String(length=60), nullable=False),
        sa.Column("valor", sa.String(length=500), nullable=True),
        sa.Column(
            "atualizado_em",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("chave"),
    )

    # **Sem RLS de propósito.** A tabela não pertence a fazenda nenhuma: o ícone
    # do aplicativo é do produto. Ativar a política aqui esconderia a linha de
    # toda requisição sem tenant declarado — inclusive da tela de login, que é
    # justamente onde o ícone precisa aparecer.
    #
    # O GRANT explícito é redundante com o ALTER DEFAULT PRIVILEGES da migration
    # da RLS, mas custa nada e protege o caso de o padrão ter sido criado por
    # outro dono.
    from app.core.config import settings

    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON configuracao_sistema "
        f"TO {settings.postgres_app_user}"
    )


def downgrade() -> None:
    op.drop_table("configuracao_sistema")
