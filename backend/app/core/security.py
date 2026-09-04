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


# --- JWT -------------------------------------------------------------------
#
# O access token tem validade longa (~12h) de propósito: o técnico passa o dia
# em campo sem sinal e o app precisa continuar operando offline. A renovação só
# faz falta na hora de sincronizar — quando já existe internet de novo.

from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import jwt

from app.core.config import settings

ALGORITMO = "HS256"

TipoToken = Literal["access", "refresh"]


class TokenInvalido(Exception):
    """Token ausente, expirado, adulterado ou do tipo errado."""


def criar_token(
    *,
    usuario_id: str,
    fazenda_id: str,
    papel: str,
    master: bool = False,
    tipo: TipoToken = "access",
) -> str:
    agora = datetime.now(timezone.utc)
    if tipo == "access":
        expira = agora + timedelta(minutes=settings.access_token_expire_minutes)
    else:
        expira = agora + timedelta(days=settings.refresh_token_expire_days)

    payload: dict[str, Any] = {
        "sub": usuario_id,
        # fazenda_id viaja DENTRO do token, assinado. É o que impede o cliente de
        # escolher o tenant que quer ler — ver app/core/deps.py.
        "fazenda_id": fazenda_id,
        "papel": papel,
        # Superusuário: o claim evita reler a flag do banco a cada requisição,
        # mas quem manda de verdade é o `usuarios.admin_master` — a dependency
        # relê o usuário e usa o valor do banco.
        "master": master,
        "tipo": tipo,
        "iat": agora,
        "exp": expira,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITMO)


def decodificar_token(token: str, *, tipo_esperado: TipoToken = "access") -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITMO])
    except jwt.ExpiredSignatureError as exc:
        raise TokenInvalido("token expirado") from exc
    except jwt.PyJWTError as exc:
        raise TokenInvalido("token inválido") from exc

    if payload.get("tipo") != tipo_esperado:
        raise TokenInvalido(f"esperado token do tipo '{tipo_esperado}'")
    return payload
