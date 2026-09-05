"""Armazenamento de arquivos no MinIO (S3-compatível).

O áudio da observação não vai para o Postgres: são dezenas de KB por pesagem, e
um banco com blobs fica caro de backup e de replicar. O que o banco guarda é a
chave do objeto.
"""

import asyncio
import functools
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import settings


@functools.lru_cache
def _cliente() -> Any:
    return boto3.client(
        "s3",
        endpoint_url=settings.minio_endpoint,
        aws_access_key_id=settings.minio_root_user,
        aws_secret_access_key=settings.minio_root_password,
        config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
        region_name="us-east-1",
    )


def chave_do_audio(fazenda_id, pesagem_id) -> str:
    """Prefixo por fazenda: facilita cota, expurgo e auditoria por tenant."""
    return f"fazendas/{fazenda_id}/pesagens/{pesagem_id}.webm"


async def guardar(chave: str, conteudo: bytes, tipo: str) -> None:
    # boto3 é síncrono; jogamos para uma thread para não travar o event loop.
    await asyncio.to_thread(
        _cliente().put_object,
        Bucket=settings.minio_bucket,
        Key=chave,
        Body=conteudo,
        ContentType=tipo,
    )


async def baixar(chave: str) -> bytes:
    def _ler() -> bytes:
        resposta = _cliente().get_object(Bucket=settings.minio_bucket, Key=chave)
        return resposta["Body"].read()

    return await asyncio.to_thread(_ler)


def baixar_sync(chave: str) -> bytes:
    """Versão síncrona, para o worker."""
    resposta = _cliente().get_object(Bucket=settings.minio_bucket, Key=chave)
    return resposta["Body"].read()


async def existe(chave: str) -> bool:
    def _checar() -> bool:
        try:
            _cliente().head_object(Bucket=settings.minio_bucket, Key=chave)
            return True
        except ClientError:
            return False

    return await asyncio.to_thread(_checar)


async def apagar(chave: str) -> None:
    await asyncio.to_thread(
        _cliente().delete_object, Bucket=settings.minio_bucket, Key=chave
    )


def chave_da_logo(fazenda_id, extensao: str = "png") -> str:
    """Prefixo por fazenda, como nos áudios: facilita cota e expurgo por tenant."""
    return f"fazendas/{fazenda_id}/marca/logo.{extensao}"
