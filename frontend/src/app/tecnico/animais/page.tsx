"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useState } from "react";

import { Lupa, Seta } from "@/components/icones";
import { Cabecalho, Vazio } from "@/components/ui";
import { data as formatarData, peso as formatarPeso } from "@/lib/formato";
import {
  contarODia,
  lerRebanhoEFila,
  ordenarPendentesPrimeiro,
  pesadosHoje,
} from "@/lib/pesados-hoje";

/**
 * Rebanho no aparelho, organizado para conferência.
 *
 * Lê do IndexedDB, não da API: precisa abrir no curral sem sinal, e é a mesma
 * cópia que a tela de coleta usa para resolver o brinco.
 *
 * Quem já foi pesado hoje desce para o fim e fica marcado em verde. A ordem
 * importa mais do que a cor: o técnico rola a lista com o polegar enquanto
 * segura o celular, e o que ele procura é o que ainda falta.
 */
export default function Animais() {
  const [busca, setBusca] = useState("");

  const dados = useLiveQuery(async () => {
    const { animais, fila } = await lerRebanhoEFila();
    return {
      animais,
      pesados: pesadosHoje(animais, fila),
      contagem: contarODia(animais, fila),
    };
  }, [], null);

  if (!dados) {
    return <p className="p-5 text-sm text-verde/60">Carregando…</p>;
  }

  const termo = busca.trim().toLowerCase();
  const filtrados = dados.animais.filter(
    (a) =>
      !termo ||
      a.brinco.toLowerCase().includes(termo) ||
      (a.nome ?? "").toLowerCase().includes(termo),
  );
  const ordenados = ordenarPendentesPrimeiro(filtrados, dados.pesados);
  const { pesados, faltam, total } = dados.contagem;

  return (
    <main className="flex flex-col gap-4 p-5">
      <Cabecalho titulo="Animais" subtitulo={`${total} no aparelho`} />

      {total > 0 && (
        <section
          className="grid grid-cols-2 gap-3"
          aria-label="Conferência do dia"
        >
          <div className="rounded-2xl bg-lima/25 px-4 py-3">
            <p className="font-titulo text-3xl font-extrabold text-verde">{pesados}</p>
            <p className="text-xs font-bold text-verde/70">pesados hoje</p>
          </div>
          <div
            className={`rounded-2xl px-4 py-3 ${
              faltam === 0 ? "bg-lima/25" : "border border-borda bg-white"
            }`}
          >
            <p className="font-titulo text-3xl font-extrabold text-verde">{faltam}</p>
            <p className="text-xs font-bold text-verde/70">
              {faltam === 0 ? "tudo pesado" : "faltam"}
            </p>
          </div>
        </section>
      )}

      <div className="relative">
        <Lupa className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-verde/40" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por brinco ou nome…"
          className="min-h-[56px] w-full rounded-xl border border-borda bg-white pl-11 pr-4 text-verde outline-none focus:border-verde placeholder:text-verde/35"
        />
      </div>

      {ordenados.length === 0 ? (
        <Vazio
          titulo={busca ? "Nada encontrado" : "Rebanho ainda não baixado"}
          descricao={
            busca
              ? `Nenhum animal com “${busca}”.`
              : "Conecte-se uma vez para guardar a cópia do rebanho no aparelho — depois ela funciona sem sinal."
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {ordenados.slice(0, 150).map((a, i) => {
            const feito = dados.pesados.has(a.brinco);
            // Separador só onde a lista realmente vira: entre o último pendente
            // e o primeiro já pesado.
            const primeiroFeito = feito && !dados.pesados.has(ordenados[i - 1]?.brinco ?? "");

            return (
              <li key={a.id}>
                {primeiroFeito && i > 0 && (
                  <p className="mb-2 mt-3 text-xs font-bold uppercase tracking-wider text-verde/45">
                    Já pesados hoje
                  </p>
                )}
                <Link
                  href={`/tecnico/coleta?brinco=${encodeURIComponent(a.brinco)}`}
                  className={`flex min-h-[64px] items-center justify-between rounded-xl border px-4 py-3 transition ${
                    feito
                      ? "border-lima bg-lima/15"
                      : "border-borda bg-white active:bg-verde/4"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    {feito && (
                      <span
                        aria-hidden
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-verde text-xs font-bold text-lima"
                      >
                        ✓
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block font-titulo font-bold text-verde">
                        {a.brinco}
                        {a.nome && <span className="ml-2 font-normal text-verde/70">{a.nome}</span>}
                        {feito && <span className="sr-only"> — já pesado hoje</span>}
                      </span>
                      <span className="block truncate text-xs text-verde/55">
                        {a.ultimo_peso
                          ? `${formatarPeso(a.ultimo_peso)} kg em ${formatarData(a.ultima_pesagem)}`
                          : "Sem pesagem"}
                        {a.raca ? ` · ${a.raca}` : ""}
                      </span>
                    </span>
                  </span>
                  <Seta className="h-5 w-5 shrink-0 text-verde/30" />
                </Link>
              </li>
            );
          })}
          {ordenados.length > 150 && (
            <li className="px-1 text-xs text-verde/50">
              e mais {ordenados.length - 150} — use a busca
            </li>
          )}
        </ul>
      )}
    </main>
  );
}
