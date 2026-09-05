"""Transcrição do áudio de observação.

Duas vias, nesta ordem: API externa e, se ela falhar ou não estiver configurada,
Whisper rodando na própria VPS. A ordem importa — a API externa é mais rápida e
não consome CPU do servidor, mas depende de rede e de crédito; o Whisper local
não depende de nada além da máquina, e é isso que faz dele um fallback de
verdade.

Nada disso roda na requisição do técnico: a transcrição é um job do worker,
disparado só depois que a pesagem já está a salvo no banco.
"""

import ctypes
import gc
import logging

import httpx

from app.core.config import settings

logger = logging.getLogger("transcricao")

_modelo_local = None

# Vocabulário de contexto passado ao modelo antes de transcrever.
#
# O Whisper foi treinado em fala geral e não conhece o jargão do curral: sem
# isto, "carrapato" vira "cara-pato", "cocho" vira "coxo" e "brinco" vira
# "brinquedo". Uma frase de exemplo com os termos certos inclina o modelo para o
# domínio — é barato, não exige treino e melhora justamente as palavras que
# importam para quem lê a observação depois.
CONTEXTO = (
    "Observação de campo em fazenda de gado de corte. "
    "Termos comuns: brinco, bezerro, novilha, boi, cocho, carrapato, "
    "berne, bicheira, casco, claudicação, mancando, apartado, lote, "
    "pasto, confinamento, vermifugado, vacinado, arroba, ganho de peso, "
    "magro, gordo, pelo, chifre, orelha, pata, pescoço, úbere."
)


class FalhaNaTranscricao(Exception):
    pass


async def _via_api_externa(audio: bytes, nome: str) -> str:
    if not settings.transcricao_api_chave:
        raise FalhaNaTranscricao("API externa não configurada")

    async with httpx.AsyncClient(timeout=settings.transcricao_timeout_s) as cliente:
        resposta = await cliente.post(
            settings.transcricao_api_url,
            headers={"Authorization": f"Bearer {settings.transcricao_api_chave}"},
            files={"file": (nome, audio, "audio/webm")},
            data={
                "model": settings.transcricao_api_modelo,
                "language": "pt",
                # O mesmo vocabulário do caminho local: as duas vias precisam
                # devolver o mesmo jargão, senão a qualidade da observação
                # dependeria de qual delas atendeu.
                "prompt": CONTEXTO,
            },
        )
    if resposta.status_code >= 400:
        raise FalhaNaTranscricao(f"API externa devolveu {resposta.status_code}")

    texto = resposta.json().get("text", "").strip()
    if not texto:
        raise FalhaNaTranscricao("API externa devolveu texto vazio")
    return texto


def _carregar_modelo_local():
    """Carrega o modelo uma vez por processo — carregar a cada job seria inviável.

    O import é preguiçoso de propósito: quem tem a API externa configurada e
    funcionando nunca paga o custo de carregar o faster-whisper na memória.
    """
    global _modelo_local
    if _modelo_local is None:
        from faster_whisper import WhisperModel

        logger.info("carregando whisper local (%s)", settings.whisper_modelo_local)
        _modelo_local = WhisperModel(
            settings.whisper_modelo_local, device="cpu", compute_type="int8"
        )
    return _modelo_local


def _descarregar_modelo() -> None:
    """Devolve a memória do modelo.

    ~480 MB no worker, medido. Quando o Whisper é apenas plano B, mantê-lo
    carregado significa que **uma única** falha da API externa — crédito
    vencido, rede instável por um minuto — prende essa memória até alguém
    reiniciar o worker. Recarregar custa ~10 s, e o caminho é raro por
    definição.
    """
    global _modelo_local
    if _modelo_local is None:
        return

    _modelo_local = None
    gc.collect()

    # `gc.collect()` sozinho não resolve: ele libera os objetos, mas o alocador
    # do glibc guarda as arenas e o processo continua ocupando a memória aos
    # olhos do sistema — medido, 533 MB viravam 533 MB. `malloc_trim` devolve as
    # arenas livres ao sistema operacional e leva o mesmo caso a 174 MB.
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except (OSError, AttributeError):
        # Fora do glibc (Alpine, por exemplo) não existe; o modelo já foi
        # liberado de qualquer forma.
        pass

    logger.info("modelo local descarregado")


def _via_whisper_local(audio: bytes) -> str:
    import io

    modelo = _carregar_modelo_local()
    segmentos, _ = modelo.transcribe(
        io.BytesIO(audio),
        language="pt",
        # Corta o silêncio antes e depois — o técnico costuma tocar o botão
        # antes de falar e soltar depois.
        vad_filter=True,
        initial_prompt=CONTEXTO,
        # Observação é frase solta, não continuação da anterior. Sem isto o
        # modelo tenta emendar com o texto que veio antes e inventa.
        condition_on_previous_text=False,
    )
    texto = " ".join(s.text.strip() for s in segmentos).strip()

    if not settings.manter_whisper_na_memoria:
        _descarregar_modelo()

    if not texto:
        raise FalhaNaTranscricao("Whisper local não encontrou fala no áudio")
    return texto


async def transcrever(audio: bytes, nome: str = "observacao.webm") -> tuple[str, str]:
    """Devolve (texto, via). `via` é 'api-externa' ou 'whisper-local'."""
    try:
        return await _via_api_externa(audio, nome), "api-externa"
    except Exception as exc:  # noqa: BLE001 — qualquer falha cai para o local
        logger.warning("API externa falhou (%s); usando Whisper local", exc)

    import asyncio

    # O Whisper local é CPU-bound e bloquearia o event loop do worker.
    texto = await asyncio.to_thread(_via_whisper_local, audio)
    return texto, "whisper-local"


def preaquecer() -> None:
    """Baixa o modelo local antecipadamente.

    Vale rodar no deploy: sem isso, o primeiro áudio a cair no fallback dispara o
    download do modelo — justamente quando a rede já demonstrou não estar
    confiável. Baixar é o que importa; se o modelo não deve ficar carregado, ele
    é liberado em seguida.
    """
    _carregar_modelo_local()
    logger.info("modelo local pronto", extra={"arquivo_baixado": True})

    if not settings.manter_whisper_na_memoria:
        _descarregar_modelo()


async def conferir_configuracao() -> dict:
    """Diz qual via será usada e se a externa responde.

    Existe para conferir **antes** de confiar nela: com a chave configurada e o
    serviço fora do ar, o sintoma seria só lentidão e memória subindo, sem nada
    que apontasse a causa.
    """
    resultado = {
        "via_preferida": "api-externa" if settings.transcricao_api_chave else "whisper-local",
        "api_configurada": bool(settings.transcricao_api_chave),
        "url": settings.transcricao_api_url,
        "modelo_local": settings.whisper_modelo_local,
        "mantem_modelo_na_memoria": settings.manter_whisper_na_memoria,
    }

    if settings.transcricao_api_chave:
        # Um segundo de silêncio: o menor áudio válido que prova o caminho.
        import struct, wave, io

        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(struct.pack("<h", 0) * 16000)
        try:
            await _via_api_externa(buffer.getvalue(), "teste.wav")
            resultado["api_responde"] = True
        except FalhaNaTranscricao as exc:
            # Texto vazio é resposta legítima para silêncio — o que se está
            # conferindo é se a chamada foi aceita.
            resultado["api_responde"] = "vazio" in str(exc)
            resultado["detalhe"] = str(exc)
        except Exception as exc:  # noqa: BLE001
            resultado["api_responde"] = False
            resultado["detalhe"] = str(exc)

    return resultado


if __name__ == "__main__":
    import asyncio
    import json
    import sys

    logging.basicConfig(level=logging.INFO)

    if "--conferir" in sys.argv:
        print(json.dumps(asyncio.run(conferir_configuracao()), indent=2, ensure_ascii=False))
    else:
        preaquecer()
