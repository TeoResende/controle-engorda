"""M7 — o job de transcrição e a queda para o Whisper local."""

import uuid

import pytest

from app.models import Pesagem, StatusTranscricao
from tests.test_pesagens import payload


@pytest.fixture
def audio_guardado(monkeypatch):
    from app.core import armazenamento

    async def baixar(_chave):
        return b"audio-falso"

    monkeypatch.setattr(armazenamento, "baixar", baixar)


async def _pesagem_com_audio(client, dados, headers, session, texto_digitado=None) -> str:
    corpo = payload(animal_id=str(dados["animal_a"].id))
    if texto_digitado:
        corpo["observacao_texto"] = texto_digitado
    await client.post("/pesagens", json=corpo, headers=headers)

    pesagem = await session.get(Pesagem, uuid.UUID(corpo["id"]))
    pesagem.observacao_audio_url = "fazendas/x/pesagens/y.webm"
    pesagem.status_transcricao = StatusTranscricao.pendente
    await session.commit()
    return corpo["id"]


async def test_job_grava_o_texto_transcrito(
    client, dados, logar, session, ctx_worker, audio_guardado, monkeypatch
):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    pesagem_id = await _pesagem_com_audio(client, dados, h, session)

    import app.worker as worker

    async def transcrever(_audio, nome="obs.webm"):
        return "bezerro mancando da pata esquerda", "api-externa"

    monkeypatch.setattr(worker, "transcrever", transcrever)

    resultado = await worker.transcrever_audio(ctx_worker, pesagem_id)
    assert resultado == "api-externa"

    lida = (await client.get(f"/pesagens/{pesagem_id}", headers=h)).json()
    assert lida["observacao_texto"] == "bezerro mancando da pata esquerda"
    assert lida["status_transcricao"] == "concluida"


async def test_transcricao_nao_apaga_o_que_o_tecnico_digitou(
    client, dados, logar, session, ctx_worker, audio_guardado, monkeypatch
):
    """Digitou E gravou: os dois valem. Sobrescrever perderia o que ele escreveu
    de propósito."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    pesagem_id = await _pesagem_com_audio(client, dados, h, session, texto_digitado="pata inchada")

    import app.worker as worker

    async def transcrever(_audio, nome="obs.webm"):
        return "está mancando", "whisper-local"

    monkeypatch.setattr(worker, "transcrever", transcrever)
    await worker.transcrever_audio(ctx_worker, pesagem_id)

    lida = (await client.get(f"/pesagens/{pesagem_id}", headers=h)).json()
    assert "pata inchada" in lida["observacao_texto"]
    assert "está mancando" in lida["observacao_texto"]


async def test_falha_marca_status_e_preserva_o_audio(
    client, dados, logar, session, ctx_worker, audio_guardado, monkeypatch
):
    """Áudio continua guardado: dá para reprocessar, e o técnico não perde a
    observação que gravou."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    pesagem_id = await _pesagem_com_audio(client, dados, h, session)

    import app.worker as worker

    async def explodir(_audio, nome="obs.webm"):
        raise RuntimeError("sem API e sem modelo local")

    monkeypatch.setattr(worker, "transcrever", explodir)
    resultado = await worker.transcrever_audio(ctx_worker, pesagem_id)
    assert resultado.startswith("falhou")

    lida = (await client.get(f"/pesagens/{pesagem_id}", headers=h)).json()
    assert lida["status_transcricao"] == "falhou"
    assert lida["observacao_audio_url"]


async def test_pesagem_sem_audio_e_ignorada(client, dados, logar, ctx_worker):
    import app.worker as worker

    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    corpo = payload(animal_id=str(dados["animal_a"].id))
    await client.post("/pesagens", json=corpo, headers=h)

    assert await worker.transcrever_audio(ctx_worker, corpo["id"]) == "sem áudio"


async def test_cai_para_o_whisper_local_quando_a_api_externa_falha(monkeypatch):
    """A ordem é o que faz o fallback valer: local só entra se a externa falhar."""
    import app.transcricao as t

    chamadas = []

    async def api_falha(_audio, _nome):
        chamadas.append("api")
        raise t.FalhaNaTranscricao("sem chave")

    def local_funciona(_audio):
        chamadas.append("local")
        return "texto do whisper local"

    monkeypatch.setattr(t, "_via_api_externa", api_falha)
    monkeypatch.setattr(t, "_via_whisper_local", local_funciona)

    texto, via = await t.transcrever(b"audio")
    assert (texto, via) == ("texto do whisper local", "whisper-local")
    assert chamadas == ["api", "local"]


async def test_api_externa_tem_prioridade(monkeypatch):
    import app.transcricao as t

    chamadas = []

    async def api_ok(_audio, _nome):
        chamadas.append("api")
        return "texto da api"

    def local(_audio):
        chamadas.append("local")
        return "não deveria ser chamado"

    monkeypatch.setattr(t, "_via_api_externa", api_ok)
    monkeypatch.setattr(t, "_via_whisper_local", local)

    texto, via = await t.transcrever(b"audio")
    assert (texto, via) == ("texto da api", "api-externa")
    assert chamadas == ["api"]  # o local nem foi acionado


async def test_sem_chave_configurada_a_api_externa_nem_e_tentada(monkeypatch):
    import app.transcricao as t
    from app.core.config import settings

    monkeypatch.setattr(settings, "transcricao_api_chave", "")
    with pytest.raises(t.FalhaNaTranscricao, match="não configurada"):
        await t._via_api_externa(b"audio", "obs.webm")
