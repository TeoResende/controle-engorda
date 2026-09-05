"""Verificações de subida em produção.

O pior modo de falha do projeto é **silencioso**: com a `SECRET_KEY` do
repositório — que é pública — qualquer pessoa assina um token de admin master
válido, e nada no sistema dá sinal disso. Recusar a subida é barulhento e custa
dois minutos; deixar passar custa os dados.
"""

import pytest

from app.core.config import Settings, conferir_para_producao


def _config(**ajustes) -> Settings:
    base = {
        "secret_key": "u" * 48,
        "postgres_password": "senha-real-do-banco",
        "postgres_app_password": "senha-real-do-app",
        "minio_root_password": "senha-real-do-minio",
        "cors_origens": "https://app.fazenda.com.br",
    }
    return Settings(**{**base, **ajustes})


def test_configuracao_completa_passa():
    assert conferir_para_producao(_config()) == []


@pytest.mark.parametrize(
    "campo,valor",
    [
        ("secret_key", "troque-esta-chave-em-producao"),
        ("postgres_password", "engorda_dev_senha"),
        ("postgres_app_password", "engorda_app_dev"),
        ("minio_root_password", "minioadmin_dev"),
    ],
)
def test_cada_segredo_de_exemplo_e_recusado(campo, valor):
    """Estão todos no `.env.example`, e o repositório é público."""
    problemas = conferir_para_producao(_config(**{campo: valor}))
    assert any(campo.upper() in p for p in problemas)


def test_chave_curta_e_recusada():
    """Chave curta é adivinhável por força bruta fora do sistema, sem deixar
    rastro nenhum no log."""
    problemas = conferir_para_producao(_config(secret_key="curta-demais"))
    assert any("32 caracteres" in p for p in problemas)


def test_cors_aberto_e_recusado():
    problemas = conferir_para_producao(_config(cors_origens="*"))
    assert any("CORS" in p for p in problemas)


def test_o_padrao_e_desenvolvimento():
    """Quem clona e roda na própria máquina não é barrado."""
    assert Settings().em_producao is False


@pytest.mark.parametrize("valor", ["producao", "PRODUCAO", "produção", "production"])
def test_variacoes_de_producao_sao_reconhecidas(valor):
    """Digitar 'production' ou 'produção' não pode desligar a verificação em
    silêncio — seria o mesmo que não tê-la."""
    assert Settings(ambiente=valor).em_producao is True
