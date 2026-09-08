"use client";

import { useEffect, useMemo, useState } from "react";

import { Lupa } from "@/components/icones";
import { apiAuth } from "@/lib/api";

type AnimalItem = { id: string; brinco: string; nome: string | null };

/**
 * Modal para escolher animais do gráfico clicando numa lista.
 *
 * A busca por brinco (no card) resolve quando você já sabe o número; esta lista
 * resolve quando você quer **varrer o rebanho** e ir marcando. As duas mexem na
 * mesma seleção — a modal é só outra porta para o mesmo conjunto.
 *
 * Carrega o rebanho ativo (até 200) e filtra no cliente: para os volumes deste
 * sistema é instantâneo, e evita uma ida à rede a cada tecla.
 */
export function ModalSelecaoAnimais({
  selecionados,
  onAlternar,
  teto,
  aoFechar,
}: {
  selecionados: { id: string; brinco: string }[];
  onAlternar: (a: { id: string; brinco: string }) => void;
  teto: number;
  aoFechar: () => void;
}) {
  const [animais, setAnimais] = useState<AnimalItem[] | null>(null);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    apiAuth<{ itens: AnimalItem[] }>("/animais?status_animal=ativo&limite=200")
      .then((r) => setAnimais(r.itens))
      .catch(() => setAnimais([]));
  }, []);

  // Fecha no Esc.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const idsSelecionados = new Set(selecionados.map((a) => a.id));
  const cheio = selecionados.length >= teto;

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (animais ?? []).filter(
      (a) => !t || a.brinco.toLowerCase().includes(t) || (a.nome ?? "").toLowerCase().includes(t),
    );
  }, [animais, busca]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-verde/40 p-0 backdrop-blur-[1px] sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Escolher animais"
      onClick={aoFechar}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl bg-card sm:rounded-2xl"
        style={{ background: "rgb(var(--cor-fundo))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-borda px-4 py-3">
          <div>
            <h3 className="font-titulo font-extrabold text-verde">Escolher animais</h3>
            <p className="text-xs text-verde/55">
              {selecionados.length}/{teto} escolhidos — clique para marcar ou tirar.
            </p>
          </div>
          <button onClick={aoFechar} className="rounded-lg border border-borda bg-white px-3 py-1.5 text-sm font-bold text-verde">
            Concluir
          </button>
        </div>

        <div className="border-b border-borda px-4 py-2">
          <div className="relative">
            <Lupa className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-verde/40" />
            <input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Filtrar por brinco ou nome…"
              className="w-full rounded-xl border border-borda bg-white py-2 pl-9 pr-3 text-sm text-verde outline-none focus:border-verde placeholder:text-verde/35"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {animais === null ? (
            <p className="px-3 py-8 text-center text-sm text-verde/50">Carregando…</p>
          ) : filtrados.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-verde/50">Nenhum animal encontrado.</p>
          ) : (
            <ul className="flex flex-col">
              {filtrados.map((a) => {
                const marcado = idsSelecionados.has(a.id);
                const bloqueado = !marcado && cheio;
                return (
                  <li key={a.id}>
                    <button
                      onClick={() => onAlternar({ id: a.id, brinco: a.brinco })}
                      disabled={bloqueado}
                      aria-pressed={marcado}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                        marcado ? "bg-lima/25 text-verde" : "text-verde hover:bg-verde/5"
                      } disabled:opacity-35`}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                          marcado ? "border-verde bg-verde text-fundo" : "border-borda bg-white"
                        }`}
                        aria-hidden
                      >
                        {marcado ? "✓" : ""}
                      </span>
                      <span className="font-bold">{a.brinco}</span>
                      {a.nome && <span className="text-verde/60">· {a.nome}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {cheio && (
          <p className="border-t border-borda px-4 py-2 text-xs text-verde/55">
            Limite de {teto} atingido — tire um para escolher outro.
          </p>
        )}
      </div>
    </div>
  );
}
