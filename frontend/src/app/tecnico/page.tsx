"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Brinco, Mais, Sincronizar } from "@/components/icones";
import { Cartao } from "@/components/ui";
import { apiAuth } from "@/lib/api";
import { db, gravarMeta, lerMeta } from "@/lib/db";
import { identidadeGuardada, ROTULO_PAPEL, type Identidade } from "@/lib/sessao-usuario";

type ResumoDoDia = { pesadas_hoje: number; lote_ativo: string | null };

/** Tela 1 — Início. */
export default function Inicio() {
  const [identidade, setIdentidade] = useState<Identidade | null>(null);
  const [hoje, setHoje] = useState<ResumoDoDia | null>(null);
  const pendentes = useLiveQuery(() => db.fila.count(), [], 0);

  useEffect(() => {
    void identidadeGuardada().then((i) => i && setIdentidade(i));

    // Números do dia: mostra o último valor conhecido enquanto busca, para a
    // tela não piscar vazia — e para ela dizer algo mesmo offline.
    void lerMeta<ResumoDoDia>("resumo_do_dia").then((r) => r && setHoje(r));
    apiAuth<ResumoDoDia>("/metricas/hoje")
      .then((r) => {
        setHoje(r);
        void gravarMeta("resumo_do_dia", r);
      })
      .catch(() => {
        /* offline: fica o último conhecido */
      });
  }, []);

  return (
    <main className="flex flex-col gap-5 p-5">
      <div>
        <h1 className="font-titulo text-3xl font-extrabold text-verde">
          Olá, {identidade?.nome?.split(" ")[0] ?? ""}
        </h1>
        <p className="text-sm text-verde/60">
          {ROTULO_PAPEL[identidade?.papel ?? ""] ?? ""}
        </p>
      </div>

      <section className="flex flex-col items-center gap-3 rounded-2xl bg-verde px-5 py-7 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-fundo/10">
          <Brinco className="h-8 w-8 text-lima" />
        </span>
        <div>
          <h2 className="font-titulo text-xl font-extrabold text-fundo">Coleta rápida</h2>
          <p className="mt-1 text-sm text-fundo/70">
            Aproxime o celular do brinco para começar
          </p>
        </div>
        <Link
          href="/tecnico/ler"
          className="mt-1 flex min-h-[56px] w-full items-center justify-center rounded-xl bg-lima px-5 font-titulo font-bold text-verde"
        >
          Ler brinco (NFC)
        </Link>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/tecnico/animal/novo"
          className="flex flex-col gap-3 rounded-2xl border border-verde/8 bg-white px-4 py-4"
        >
          <Mais className="h-6 w-6 text-verde" />
          <span className="font-titulo text-sm font-bold text-verde">Novo animal</span>
        </Link>

        <Link
          href="/tecnico/fila"
          className="relative flex flex-col gap-3 rounded-2xl border border-verde/8 bg-white px-4 py-4"
        >
          <Sincronizar className="h-6 w-6 text-verde" />
          <span className="font-titulo text-sm font-bold text-verde">Fila de sincronização</span>
          {pendentes > 0 && (
            <span className="absolute right-3 top-3 flex h-6 min-w-6 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white">
              {pendentes}
            </span>
          )}
        </Link>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-verde/50">Hoje</h2>
        <div className="grid grid-cols-2 gap-3">
          <Cartao className="p-4">
            <p className="font-titulo text-3xl font-extrabold text-verde">
              {hoje?.pesadas_hoje ?? "—"}
            </p>
            <p className="mt-0.5 text-xs text-verde/60">animais pesados</p>
          </Cartao>
          <Cartao className="p-4">
            <p className="font-titulo text-lg font-extrabold text-verde">
              {hoje?.lote_ativo ?? "—"}
            </p>
            <p className="mt-0.5 text-xs text-verde/60">lote ativo</p>
          </Cartao>
        </div>
      </section>
    </main>
  );
}
