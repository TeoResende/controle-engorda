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
 * **Trocar funciona nas duas telas** — o técnico está em campo, passa de um
 * curral para outro e não vai voltar ao menu para isso. O que a troca não pode
 * é levar junto o que já foi digitado: o mesmo brinco resolve para outro animal
 * na outra fazenda, e o peso digitado iria para o bicho errado. Por isso
 * `temRascunho`: com algo preenchido, a troca pergunta antes e descarta.
 */
export function FazendaDaTarefa({
  acao,
  temRascunho = false,
  aviso,
}: {
  /** O verbo da tela: "Cadastrando em", "Pesando em". */
  acao: string;
  /** Há algo digitado que a troca vai descartar (peso, observação, brinco). */
  temRascunho?: boolean;
  /** O que dizer antes de descartar. Sem isto a pergunta seria genérica. */
  aviso?: string;
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
        {varias && (
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
                  // O que já foi digitado não atravessa a troca: na outra
                  // fazenda o mesmo brinco é outro animal.
                  if (temRascunho && !window.confirm(aviso ?? "Trocar de fazenda descarta o que você digitou aqui. Continuar?")) {
                    return;
                  }
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
