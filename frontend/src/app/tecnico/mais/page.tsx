"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Brinco, Seta, Sincronizar } from "@/components/icones";
import { Cabecalho, Cartao } from "@/components/ui";
import { db, lerMeta } from "@/lib/db";
import { limparSessao } from "@/lib/sessao";
import { identidadeGuardada, ROTULO_PAPEL, type Identidade } from "@/lib/sessao-usuario";

export default function MaisOpcoes() {
  const router = useRouter();
  const [identidade, setIdentidade] = useState<Identidade | null>(null);
  const [ultima, setUltima] = useState<string | null>(null);
  const pendentes = useLiveQuery(() => db.fila.count(), [], 0);
  const rebanho = useLiveQuery(() => db.animais.count(), [], 0);

  useEffect(() => {
    void identidadeGuardada().then((i) => i && setIdentidade(i));
    void lerMeta<string>("ultima_sincronizacao").then((v) => v && setUltima(v));
  }, []);

  return (
    <main className="flex flex-col gap-4 p-5">
      <Cabecalho titulo="Mais" />

      <Cartao>
        <p className="font-titulo text-lg font-extrabold text-verde">{identidade?.nome ?? "—"}</p>
        <p className="text-sm text-verde/60">
          {ROTULO_PAPEL[identidade?.papel ?? ""] ?? ""} · {identidade?.fazenda ?? ""}
        </p>
      </Cartao>

      <ul className="flex flex-col gap-2">
        <li>
          <Link
            href="/tecnico/fila"
            className="flex items-center justify-between rounded-xl border border-borda bg-white px-4 py-4"
          >
            <span className="flex items-center gap-3">
              <Sincronizar className="h-5 w-5 text-verde" />
              <span className="font-titulo font-bold text-verde">Fila de sincronização</span>
            </span>
            <span className="flex items-center gap-2">
              {pendentes > 0 && (
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                  {pendentes}
                </span>
              )}
              <Seta className="h-5 w-5 text-verde/30" />
            </span>
          </Link>
        </li>
        <li>
          <Link
            href="/tecnico/gravar"
            className="flex items-center justify-between rounded-xl border border-borda bg-white px-4 py-4"
          >
            <span className="flex items-center gap-3">
              <Brinco className="h-5 w-5 text-verde" />
              <span className="font-titulo font-bold text-verde">Gravar tag de um brinco</span>
            </span>
            <Seta className="h-5 w-5 text-verde/30" />
          </Link>
        </li>
      </ul>

      <Cartao>
        <p className="text-xs font-bold uppercase tracking-wider text-verde/50">No aparelho</p>
        <dl className="mt-2 flex flex-col gap-1 text-sm text-verde/80">
          <div className="flex justify-between">
            <dt>Animais guardados</dt>
            <dd className="font-bold">{rebanho}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Pesagens na fila</dt>
            <dd className="font-bold">{pendentes}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Última sincronização</dt>
            <dd className="font-bold">
              {ultima ? new Date(ultima).toLocaleString("pt-BR") : "nunca"}
            </dd>
          </div>
        </dl>
      </Cartao>

      <button
        onClick={() => {
          limparSessao();
          router.replace("/tecnico/login");
        }}
        className="py-3 text-sm font-bold text-verde/60 underline"
      >
        Sair da conta
      </button>
    </main>
  );
}
