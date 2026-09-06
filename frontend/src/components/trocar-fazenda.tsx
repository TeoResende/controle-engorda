"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";

import { Aviso, Cartao } from "@/components/ui";
import { db } from "@/lib/db";
import { fazendaAtiva, lerSessoes, trocarFazendaAtiva, type Sessao } from "@/lib/sessao";

/**
 * Troca de fazenda **sem internet**.
 *
 * O app baixa uma sessão para cada fazenda do técnico enquanto há rede; trocar
 * passa a ser escolher entre as que já estão no aparelho. Antes disso, trocar
 * exigia emitir token novo — e no curral, onde a troca acontece, não há
 * servidor para emitir.
 *
 * A tela recarrega ao trocar: rebanho, fila e contadores são todos por fazenda,
 * e atualizar cada um na mão deixaria alguma tela para trás mostrando dado da
 * fazenda anterior.
 */
export function TrocarFazenda() {
  const [sessoes, setSessoes] = useState<Sessao[]>([]);
  const [ativa, setAtiva] = useState<string | null>(null);

  useEffect(() => {
    setSessoes(lerSessoes());
    setAtiva(fazendaAtiva());
  }, []);

  const porFazenda = useLiveQuery(async () => {
    const contagens: Record<string, number> = {};
    for (const p of await db.fila.toArray()) {
      contagens[p.fazenda_id] = (contagens[p.fazenda_id] ?? 0) + 1;
    }
    return contagens;
  }, [], {} as Record<string, number>);

  // Com uma fazenda só, o seletor seria ruído.
  if (sessoes.length < 2) return null;

  return (
    <Cartao>
      <h2 className="font-titulo font-extrabold text-verde">Fazenda</h2>
      <p className="mt-0.5 text-sm text-verde/60">
        Você atende {sessoes.length} fazendas. A troca funciona sem internet.
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {sessoes.map((s) => {
          const naFila = porFazenda[s.fazenda_id] ?? 0;
          const atual = s.fazenda_id === ativa;
          return (
            <li key={s.fazenda_id}>
              <button
                onClick={() => {
                  if (atual) return;
                  if (trocarFazendaAtiva(s.fazenda_id)) window.location.reload();
                }}
                aria-current={atual ? "true" : undefined}
                className={`flex min-h-[56px] w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                  atual ? "border-verde bg-lima/20" : "border-borda bg-white"
                }`}
              >
                <span className="min-w-0">
                  <span className="block font-titulo font-bold text-verde">
                    {s.fazenda_nome ?? "Fazenda"}
                  </span>
                  <span className="text-xs text-verde/55">
                    {atual ? "aberta agora" : "tocar para abrir"}
                  </span>
                </span>
                {naFila > 0 && (
                  <span className="ml-3 shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                    {naFila} na fila
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {Object.values(porFazenda).some((n) => n > 0) && (
        <div className="mt-3">
          <Aviso>
            Pesagens pendentes sobem para a fazenda em que foram coletadas, não
            para a que estiver aberta.
          </Aviso>
        </div>
      )}
    </Cartao>
  );
}
