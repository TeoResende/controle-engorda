"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";

import { apiAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { data as formatarData, peso as formatarPeso } from "@/lib/formato";

/**
 * Últimas pesagens do animal, na tela de coleta.
 *
 * Serve para o técnico ver na hora se o que ele acabou de registrar entrou — e
 * para comparar o peso novo com o histórico antes de salvar, que é como se pega
 * erro de digitação (um 55 no lugar de 550).
 *
 * As da fila local aparecem primeiro e marcadas: são dele, ainda não subiram, e
 * some-las aqui faria parecer que o registro se perdeu.
 */
type PesagemServidor = { id: string; data: string; peso_kg: string };

export function UltimasPesagens({
  animalId,
  brinco,
}: {
  animalId: string | null;
  brinco: string;
}) {
  const [doServidor, setDoServidor] = useState<PesagemServidor[] | null>(null);
  const [offline, setOffline] = useState(false);

  const naFila = useLiveQuery(
    () => db.fila.where("brinco").equals(brinco).reverse().sortBy("coletado_em"),
    [brinco],
    [],
  );

  useEffect(() => {
    if (!animalId) {
      setDoServidor([]);
      return;
    }
    apiAuth<{ itens: PesagemServidor[] }>(`/pesagens?animal_id=${animalId}&limite=5`)
      .then((p) => setDoServidor(p.itens))
      .catch(() => {
        // Sem sinal a lista fica só com o que está no aparelho. É o esperado —
        // não é erro e não vale assustar o técnico com aviso vermelho.
        setOffline(true);
        setDoServidor([]);
      });
  }, [animalId]);

  const temAlgo = naFila.length > 0 || (doServidor?.length ?? 0) > 0;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-bold uppercase tracking-wider text-verde/50">
        Últimas pesagens
      </h2>

      {doServidor === null ? (
        <p className="px-1 py-2 text-sm text-verde/45">Carregando…</p>
      ) : !temAlgo ? (
        <p className="rounded-xl bg-verde/4 px-4 py-3 text-sm text-verde/55">
          {offline
            ? "Sem sinal — o histórico aparece quando a conexão voltar."
            : "Este animal ainda não tem pesagem registrada."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {naFila.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-xl border border-lima/50 bg-lima/10 px-4 py-2.5"
            >
              <span className="text-sm text-verde/70">{formatarData(p.data)}</span>
              <span className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase text-verde/50">na fila</span>
                <span className="font-titulo font-bold text-verde">
                  {formatarPeso(p.peso_kg)} kg
                </span>
              </span>
            </li>
          ))}
          {(doServidor ?? []).map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-xl border border-verde/8 bg-white px-4 py-2.5"
            >
              <span className="text-sm text-verde/70">{formatarData(p.data)}</span>
              <span className="font-titulo font-bold text-verde">
                {formatarPeso(p.peso_kg)} kg
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
