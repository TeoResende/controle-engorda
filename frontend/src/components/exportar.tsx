"use client";

import { useState } from "react";

import { API_URL } from "@/lib/api";
import { lerSessao } from "@/lib/sessao";

/**
 * Botão de exportação.
 *
 * O download passa por `fetch` e não por `<a href>` porque a rota exige o
 * cabeçalho de autenticação — um link simples chegaria sem token e voltaria 401.
 * O arquivo vira blob e é entregue por um link temporário.
 */
export function BotaoExportar({
  caminho,
  rotulo = "Exportar CSV",
}: {
  /** Caminho da rota, ex.: `/exportar/animais.csv?lote_id=…` */
  caminho: string;
  rotulo?: string;
}) {
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function baixar() {
    setErro(null);
    setBaixando(true);
    try {
      const sessao = lerSessao();
      const resposta = await fetch(`${API_URL}${caminho}`, {
        headers: { Authorization: `Bearer ${sessao?.access_token ?? ""}` },
      });
      if (!resposta.ok) throw new Error(`Erro ${resposta.status}`);

      const blob = await resposta.blob();
      const nome =
        resposta.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ??
        "exportacao.csv";

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = nome;
      link.click();
      // Sem revoke o blob fica na memória da aba até fechar.
      URL.revokeObjectURL(url);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui exportar");
    } finally {
      setBaixando(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        onClick={baixar}
        disabled={baixando}
        className="inline-flex items-center gap-2 rounded-xl border border-borda bg-white px-4 py-2.5 font-titulo text-sm font-bold text-verde transition hover:border-verde/40 disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M5 20h14" />
        </svg>
        {baixando ? "Gerando…" : rotulo}
      </button>
      {erro && <span className="text-xs text-red-700">{erro}</span>}
    </span>
  );
}

/**
 * Impressão / PDF.
 *
 * Usa o motor do próprio navegador ("Salvar como PDF" na caixa de impressão) em
 * vez de uma biblioteca de PDF no servidor: o resultado é melhor, não pesa a
 * imagem do backend com Cairo/Pango, e sai no papel que a pessoa escolher.
 */
export function BotaoImprimir({ rotulo = "Imprimir / PDF" }: { rotulo?: string }) {
  return (
    <button
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-xl border border-borda bg-white px-4 py-2.5 font-titulo text-sm font-bold text-verde transition hover:border-verde/40 print:hidden"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 9V3h12v6" /><rect x="4" y="9" width="16" height="7" rx="1.5" /><path d="M7 16h10v5H7z" />
      </svg>
      {rotulo}
    </button>
  );
}
