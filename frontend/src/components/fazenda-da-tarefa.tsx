"use client";

import { useEffect, useState } from "react";

import { Casa } from "@/components/icones";
import { fazendaAtiva, lerSessoes, trocarFazendaAtiva, type Sessao } from "@/lib/sessao";

/**
 * Em que fazenda esta tarefa vai cair.
 *
 * As telas de coleta e de cadastro rodam **sem a moldura** — sem barra
 * superior, sem abas — porque são telas de tarefa, com o técnico de uma mão só.
 * O efeito colateral era grave: nada na tela dizia a que fazenda o animal
 * estava sendo vinculado. Quem atende duas cadastrava na que por acaso estivesse
 * aberta, sem erro nenhum e sem como perceber depois — o animal simplesmente
 * não aparecia no rebanho onde deveria estar.
 *
 * O vínculo continua vindo do token, como manda o isolamento multi-tenant: o
 * que muda é que ele fica **à vista**, e trocável antes de começar.
 *
 * `podeTrocar` é decidido por tela, não por gosto:
 *
 * - **cadastro**: pode. É a escolha de onde o animal nasce, e ela precisa
 *   acontecer antes de salvar.
 * - **coleta**: não. Trocar no meio faria o mesmo brinco resolver para outro
 *   animal, e o peso já digitado iria para o bicho errado. Lá a troca é antes
 *   de entrar, pelo seletor em *Mais*.
 */
export function FazendaDaTarefa({
  acao,
  podeTrocar = false,
}: {
  /** O verbo da tela: "Cadastrando em", "Pesando em". */
  acao: string;
  podeTrocar?: boolean;
}) {
  const [sessoes, setSessoes] = useState<Sessao[]>([]);
  const [ativa, setAtiva] = useState<string | null>(null);
  const [escolhendo, setEscolhendo] = useState(false);

  useEffect(() => {
    setSessoes(lerSessoes());
    setAtiva(fazendaAtiva());
  }, []);

  const atual = sessoes.find((s) => s.fazenda_id === ativa);
  if (!atual) return null;

  const nome = atual.fazenda_nome ?? "esta fazenda";
  const varias = sessoes.length > 1;

  return (
    <div className="rounded-xl border border-borda bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-sm text-verde/70">
          <Casa className="h-4 w-4 shrink-0 text-verde/50" />
          <span className="min-w-0">
            {acao} <span className="font-titulo font-bold text-verde">{nome}</span>
          </span>
        </p>
        {podeTrocar && varias && (
          <button
            type="button"
            onClick={() => setEscolhendo((v) => !v)}
            className="shrink-0 rounded-lg border border-borda px-3 py-1.5 text-xs font-bold text-verde"
          >
            {escolhendo ? "Cancelar" : "Trocar"}
          </button>
        )}
      </div>

      {escolhendo && (
        <ul className="mt-3 flex flex-col gap-2">
          {sessoes.map((s) => (
            <li key={s.fazenda_id}>
              <button
                type="button"
                onClick={() => {
                  if (s.fazenda_id === ativa) return setEscolhendo(false);
                  // Recarrega em vez de só trocar o estado: rebanho, fila e
                  // contadores são todos por fazenda, e atualizar cada um na
                  // mão deixaria alguma parte da tela com dado da anterior.
                  if (trocarFazendaAtiva(s.fazenda_id)) window.location.reload();
                }}
                aria-current={s.fazenda_id === ativa ? "true" : undefined}
                className={`min-h-[56px] w-full rounded-xl border px-4 py-3 text-left font-titulo font-bold transition ${
                  s.fazenda_id === ativa
                    ? "border-verde bg-lima/20 text-verde"
                    : "border-borda bg-white text-verde"
                }`}
              >
                {s.fazenda_nome ?? "Fazenda"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
