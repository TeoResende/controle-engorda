"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useState } from "react";

import { Lupa, Seta } from "@/components/icones";
import { Aviso, Cabecalho } from "@/components/ui";
import { db } from "@/lib/db";
import { data as formatarData, peso as formatarPeso } from "@/lib/formato";

/**
 * Rebanho no aparelho.
 *
 * Lê do IndexedDB, não da API: precisa abrir no curral sem sinal, e é a mesma
 * cópia que a tela de coleta usa para resolver o brinco.
 */
export default function Animais() {
  const [busca, setBusca] = useState("");

  const animais = useLiveQuery(async () => {
    const todos = await db.animais.orderBy("brinco").toArray();
    const termo = busca.trim().toLowerCase();
    if (!termo) return todos;
    return todos.filter(
      (a) =>
        a.brinco.toLowerCase().includes(termo) ||
        (a.nome ?? "").toLowerCase().includes(termo),
    );
  }, [busca], []);

  return (
    <main className="flex flex-col gap-4 p-5">
      <Cabecalho titulo="Animais" subtitulo={`${animais.length} no aparelho`} />

      <div className="relative">
        <Lupa className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-verde/40" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por brinco ou nome…"
          className="min-h-[56px] w-full rounded-xl border border-verde/15 bg-white pl-11 pr-4 text-verde outline-none focus:border-verde placeholder:text-verde/35"
        />
      </div>

      {animais.length === 0 ? (
        <Aviso>
          {busca
            ? "Nenhum animal com esse brinco ou nome."
            : "O rebanho ainda não foi baixado. Conecte-se uma vez para guardar a cópia no aparelho."}
        </Aviso>
      ) : (
        <ul className="flex flex-col gap-2">
          {animais.slice(0, 100).map((a) => (
            <li key={a.id}>
              <Link
                href={`/tecnico/coleta?brinco=${encodeURIComponent(a.brinco)}`}
                className="flex items-center justify-between rounded-xl border border-verde/8 bg-white px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-titulo font-bold text-verde">
                    {a.brinco}
                    {a.nome && <span className="ml-2 font-normal text-verde/70">{a.nome}</span>}
                  </p>
                  <p className="truncate text-xs text-verde/55">
                    {a.ultimo_peso
                      ? `${formatarPeso(a.ultimo_peso)} kg em ${formatarData(a.ultima_pesagem)}`
                      : "Sem pesagem"}
                    {a.raca ? ` · ${a.raca}` : ""}
                  </p>
                </div>
                <Seta className="h-5 w-5 shrink-0 text-verde/30" />
              </Link>
            </li>
          ))}
          {animais.length > 100 && (
            <li className="px-1 text-xs text-verde/50">
              e mais {animais.length - 100} — use a busca
            </li>
          )}
        </ul>
      )}
    </main>
  );
}
