"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";

import { Aviso, Botao, Cabecalho, Vazio } from "@/components/ui";
import { filaDaFazenda } from "@/lib/db";
import { fazendaAtiva } from "@/lib/sessao";
import { peso as formatarPeso } from "@/lib/formato";
import { sincronizarTudo } from "@/lib/sync";

/**
 * Fila de sincronização.
 *
 * Existe para o técnico poder responder à única pergunta que importa quando o
 * sinal falta: "o que ainda não subiu?". E para ver o motivo de uma pesagem
 * recusada — erro de dado não se resolve sozinho.
 */
export default function Fila() {
  const [sincronizando, setSincronizando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const fila = useLiveQuery(async () => {
    const fazenda = fazendaAtiva();
    if (!fazenda) return [];
    return (await filaDaFazenda(fazenda).toArray()).sort((a, b) =>
      b.coletado_em.localeCompare(a.coletado_em),
    );
  }, [], []);
  const comErro = fila.filter((p) => p.ultimo_erro);

  async function sincronizarAgora() {
    setSincronizando(true);
    setResultado(null);
    const resumo = await sincronizarTudo();
    setResultado(
      resumo.motivo
        ? // "Requer papel" é o servidor dizendo que esta conta não coleta —
          // problema de permissão, não de rede, e a mensagem tem que separar os
          // dois para ninguém ficar tentando sincronizar sem parar.
          resumo.motivo.includes("papel")
          ? "Esta conta não tem permissão para registrar pesagem. Peça a um administrador para mudar seu papel — o que você coletou continua guardado aqui."
          : `Não deu para sincronizar: ${resumo.motivo}.`
        : `${resumo.enviadas} enviada(s). ${resumo.restantes} na fila.`,
    );
    setSincronizando(false);
  }

  return (
    <main className="flex flex-col gap-4 p-5">
      <Cabecalho
        titulo="Fila de sincronização"
        subtitulo={
          fila.length === 0
            ? "Tudo que você coletou já está no servidor."
            : `${fila.length} pesagem(ns) aguardando envio`
        }
      />

      {fila.length > 0 && (
        <ul className="flex flex-col gap-2">
          {fila.map((p) => (
            <li
              key={p.id}
              className={`rounded-xl border px-4 py-3 ${
                p.ultimo_erro ? "border-red-200 bg-red-50" : "border-borda bg-white"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-titulo font-bold text-verde">Brinco {p.brinco}</span>
                <span className="text-sm text-verde/70">{formatarPeso(p.peso_kg)} kg</span>
              </div>
              {p.audio && !p.audio_enviado && (
                <p className="mt-1 text-xs text-verde/50">com observação em áudio</p>
              )}
              {p.ultimo_erro && (
                <p className="mt-1.5 text-xs text-red-700">
                  Recusada: {p.ultimo_erro} ({p.tentativas} tentativa(s))
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {comErro.length > 0 && (
        <Aviso tom="erro">
          {comErro.length} pesagem(ns) o servidor recusou. Elas ficam aqui até
          serem corrigidas — nada foi perdido.
        </Aviso>
      )}

      <Botao onClick={sincronizarAgora} carregando={sincronizando}>
        {sincronizando ? "Sincronizando…" : "Sincronizar agora"}
      </Botao>
      {resultado && <Aviso>{resultado}</Aviso>}

      {fila.length === 0 && (
        <Vazio
          titulo="Fila vazia"
          descricao="Pesagens ficam guardadas no aparelho até o servidor confirmar o recebimento. Só então a cópia local é apagada."
        />
      )}
    </main>
  );
}
