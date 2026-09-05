"use client";

import { useEffect, useState } from "react";

import { API_URL } from "@/lib/api";
import { lerSessao } from "@/lib/sessao";

/**
 * Ouvir o áudio original da observação.
 *
 * O `<audio src>` não carrega direto da API: a rota exige cabeçalho de
 * autenticação, e um src simples chegaria sem token. Buscamos como blob e
 * tocamos a partir de uma URL local — e só quando a pessoa pede, para não
 * baixar dezenas de áudios ao abrir a página.
 *
 * A transcrição é conveniência; o áudio é o registro. Quando o técnico fala
 * "mancando da pata **esquerda**" e o modelo escreve "direita", é aqui que se
 * descobre.
 */
export function AudioObservacao({ pesagemId }: { pesagemId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  async function carregar() {
    setErro(null);
    setCarregando(true);
    try {
      const sessao = lerSessao();
      const resposta = await fetch(`${API_URL}/pesagens/${pesagemId}/audio`, {
        headers: { Authorization: `Bearer ${sessao?.access_token ?? ""}` },
      });
      if (!resposta.ok) throw new Error("Áudio indisponível");
      setUrl(URL.createObjectURL(await resposta.blob()));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui carregar o áudio");
    } finally {
      setCarregando(false);
    }
  }

  if (url) {
    return <audio controls src={url} className="h-9 w-full max-w-xs" />;
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={carregar}
        disabled={carregando}
        className="inline-flex items-center gap-1.5 rounded-lg bg-verde/8 px-2.5 py-1.5 text-xs font-bold text-verde transition hover:bg-verde/12 disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" />
        </svg>
        {carregando ? "Carregando…" : "Ouvir"}
      </button>
      {erro && <span className="text-xs text-red-700">{erro}</span>}
    </span>
  );
}
