"""rls usa uuid, nao texto

Revision ID: 8d0f3edcd4a2
Revises: 10caebc78743
Create Date: 2026-09-05 16:18:38.368498
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '8d0f3edcd4a2'
down_revision: str | None = '10caebc78743'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABELAS = {
    "fazendas": "id",
    "usuario_fazenda": "fazenda_id",
    "lotes": "fazenda_id",
    "animais": "fazenda_id",
    "pesagens": "fazenda_id",
}


def _politica(coluna: str, comparacao: str) -> str:
    return f"""
        USING (
            current_setting('app.ignorar_rls', true) = 'on'
            OR {coluna} {comparacao}
        )
        WITH CHECK (
            current_setting('app.ignorar_rls', true) = 'on'
            OR {coluna} {comparacao}
        )
    """


def upgrade() -> None:
    """Compara UUID com UUID, em vez de converter a coluna para texto.

    `fazenda_id::text = current_setting(...)` obriga o Postgres a converter
    **cada linha** antes de comparar — o índice deixa de servir para busca
    direta e vira apenas filtro, varrendo a tabela inteira. Convertendo o outro
    lado, o índice volta a ser usado como índice.

    `NULLIF` é necessário porque a sessão sem tenant guarda string vazia, e
    `''::uuid` levanta erro em vez de simplesmente não casar.
    """
    comparacao = "= NULLIF(current_setting('app.fazenda_id', true), '')::uuid"
    for tabela, coluna in TABELAS.items():
        op.execute(f"DROP POLICY IF EXISTS isolamento_por_fazenda ON {tabela}")
        op.execute(
            f"CREATE POLICY isolamento_por_fazenda ON {tabela} {_politica(coluna, comparacao)}"
        )


def downgrade() -> None:
    comparacao = "::text = current_setting('app.fazenda_id', true)"
    for tabela, coluna in TABELAS.items():
        op.execute(f"DROP POLICY IF EXISTS isolamento_por_fazenda ON {tabela}")
        op.execute(
            f"CREATE POLICY isolamento_por_fazenda ON {tabela} "
            f"{_politica(coluna, comparacao).replace(coluna + ' ' + comparacao, coluna + comparacao)}"
        )
