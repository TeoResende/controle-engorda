"""M7 — upload de áudio e transcrição."""

import uuid
from datetime import date, datetime, timezone

import pytest

from tests.test_pesagens import payload


@pytest.fixture
def sem_minio(monkeypatch):
    """Guarda o áudio em memória em vez do MinIO.

    O teste é sobre o fluxo — validação, chave por fazenda, status, disparo do
    job. Subir MinIO na suíte tornaria os testes lentos e frágeis sem cobrir
    nada a mais.
    """
    guardados: dict[str, bytes] = {}

    async def guardar(chave, conteudo, tipo):
        guardados[chave] = conteudo

    async def baixar(chave):
        return guardados[chave]

    from app.core import armazenamento

    monkeypatch.setattr(armazenamento, "guardar", guardar)
    monkeypatch.setattr(armazenamento, "baixar", baixar)
    return guardados


@pytest.fixture
def sem_fila(monkeypatch):
    """Registra os jobs enfileirados em vez de falar com o Redis."""
    disparados: list[tuple] = []

    async def enfileirar(job, *args):
        disparados.append((job, *args))

    import app.api.pesagens as modulo

    monkeypatch.setattr(modulo, "enfileirar", enfileirar)
    return disparados


async def _criar_pesagem(client, dados, headers) -> str:
    corpo = payload(animal_id=str(dados["animal_a"].id))
    resposta = await client.post("/pesagens", json=corpo, headers=headers)
    assert resposta.status_code == 201
    return corpo["id"]


async def test_anexar_audio_a_uma_pesagem(client, dados, logar, sem_minio, sem_fila):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    fazenda_id = str(dados["fazenda_a"].id)
    pesagem_id = await _criar_pesagem(client, dados, h)

    resposta = await client.post(
        f"/pesagens/{pesagem_id}/audio",
        files={"arquivo": ("obs.webm", b"conteudo-de-audio", "audio/webm")},
        headers=h,
    )
    assert resposta.status_code == 200, resposta.text
    corpo = resposta.json()
    assert corpo["status_transcricao"] == "pendente"
    # A chave é prefixada por fazenda: cota, expurgo e auditoria por tenant.
    assert corpo["observacao_audio_url"].startswith(f"fazendas/{fazenda_id}/")
    assert sem_minio[corpo["observacao_audio_url"]] == b"conteudo-de-audio"


async def test_upload_dispara_o_job_de_transcricao(client, dados, logar, sem_minio, sem_fila):
    """A transcrição não trava a resposta: o técnico não espera por ela."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    pesagem_id = await _criar_pesagem(client, dados, h)

    await client.post(
        f"/pesagens/{pesagem_id}/audio",
        files={"arquivo": ("obs.webm", b"audio", "audio/webm")},
        headers=h,
    )
    assert sem_fila == [("transcrever_audio", pesagem_id)]


async def test_fila_fora_do_ar_nao_perde_o_audio(client, dados, logar, sem_minio, monkeypatch):
    """Se o Redis cair, o áudio já está guardado e a pesagem fica pendente para
    reprocessar — o técnico não é penalizado por uma falha de infraestrutura."""

    async def explodir(*_):
        raise RuntimeError("redis fora do ar")

    import app.api.pesagens as modulo

    monkeypatch.setattr(modulo, "enfileirar", explodir)

    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    pesagem_id = await _criar_pesagem(client, dados, h)

    resposta = await client.post(
        f"/pesagens/{pesagem_id}/audio",
        files={"arquivo": ("obs.webm", b"audio", "audio/webm")},
        headers=h,
    )
    assert resposta.status_code == 200
    assert resposta.json()["status_transcricao"] == "pendente"
    assert resposta.json()["observacao_audio_url"]


async def test_audio_grande_demais(client, dados, logar, sem_minio, sem_fila):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    pesagem_id = await _criar_pesagem(client, dados, h)

    resposta = await client.post(
        f"/pesagens/{pesagem_id}/audio",
        files={"arquivo": ("obs.webm", b"x" * (3 * 1024 * 1024), "audio/webm")},
        headers=h,
    )
    assert resposta.status_code == 413


async def test_audio_vazio(client, dados, logar, sem_minio, sem_fila):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    pesagem_id = await _criar_pesagem(client, dados, h)

    resposta = await client.post(
        f"/pesagens/{pesagem_id}/audio",
        files={"arquivo": ("obs.webm", b"", "audio/webm")},
        headers=h,
    )
    assert resposta.status_code == 422


async def test_audio_de_pesagem_de_outra_fazenda(client, dados, logar, sem_minio, sem_fila):
    hb = await logar(dados["tecnico"], dados["fazenda_b"].id)
    corpo = payload(animal_id=str(dados["animal_b"].id))
    await client.post("/pesagens", json=corpo, headers=hb)

    ha = await logar(dados["tecnico"], dados["fazenda_a"].id)
    resposta = await client.post(
        f"/pesagens/{corpo['id']}/audio",
        files={"arquivo": ("obs.webm", b"audio", "audio/webm")},
        headers=ha,
    )
    assert resposta.status_code == 404


async def test_baixar_audio(client, dados, logar, sem_minio, sem_fila):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    pesagem_id = await _criar_pesagem(client, dados, h)
    await client.post(
        f"/pesagens/{pesagem_id}/audio",
        files={"arquivo": ("obs.webm", b"som", "audio/webm")},
        headers=h,
    )

    baixado = await client.get(f"/pesagens/{pesagem_id}/audio", headers=h)
    assert baixado.status_code == 200
    assert baixado.content == b"som"


async def test_baixar_audio_inexistente(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    pesagem_id = await _criar_pesagem(client, dados, h)
    assert (await client.get(f"/pesagens/{pesagem_id}/audio", headers=h)).status_code == 404


async def test_cliente_nao_envia_audio(client, dados, logar, sem_minio, sem_fila):
    ht = await logar(dados["tecnico"], dados["fazenda_a"].id)
    pesagem_id = await _criar_pesagem(client, dados, ht)

    hc = await logar(dados["cliente_a"])
    resposta = await client.post(
        f"/pesagens/{pesagem_id}/audio",
        files={"arquivo": ("obs.webm", b"audio", "audio/webm")},
        headers=hc,
    )
    assert resposta.status_code == 403
