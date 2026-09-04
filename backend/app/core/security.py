"""Hash de senha. O JWT em si entra no M2.

Usamos a lib `bcrypt` diretamente, sem passlib: a passlib está sem manutenção e
quebra com bcrypt >= 4.1.
"""

import base64
import hashlib

import bcrypt


def _preparar(senha: str) -> bytes:
    """bcrypt ignora tudo além de 72 bytes — e a lib nova levanta erro em vez de
    truncar em silêncio. Passamos todas as senhas por SHA-256 + base64 primeiro,
    o que dá sempre 44 bytes, sem limite de tamanho para o usuário."""
    digest = hashlib.sha256(senha.encode("utf-8")).digest()
    return base64.b64encode(digest)


def hash_senha(senha: str) -> str:
    return bcrypt.hashpw(_preparar(senha), bcrypt.gensalt()).decode("utf-8")


def verificar_senha(senha: str, senha_hash: str) -> bool:
    return bcrypt.checkpw(_preparar(senha), senha_hash.encode("utf-8"))
