"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Caixa, Engrenagem, Grade, Pessoa } from "@/components/icones";
import { apiAuth } from "@/lib/api";
import { iniciais } from "@/lib/formato";
import { limparSessao, salvarSessao, type Sessao } from "@/lib/sessao";
import { ROTULO_PAPEL } from "@/lib/sessao-usuario";

type Eu = {
  usuario: { nome: string };
  papel: string;
  fazenda_id: string;
  fazendas: { fazenda_id: string; nome: string }[];
};

const ITENS = [
  { href: "/dashboard", rotulo: "Visão geral", Icone: Grade },
  { href: "/dashboard/animais", rotulo: "Animais", Icone: Pessoa },
  { href: "/dashboard/lotes", rotulo: "Lotes", Icone: Caixa },
  { href: "/dashboard/configuracoes", rotulo: "Configurações", Icone: Engrenagem },
];

export function BarraLateral() {
  const caminho = usePathname();
  const router = useRouter();
  const [eu, setEu] = useState<Eu | null>(null);
  const [trocando, setTrocando] = useState(false);

  useEffect(() => {
    apiAuth<Eu>("/auth/eu").then(setEu).catch(() => setEu(null));
  }, []);

  async function trocarFazenda(fazenda_id: string) {
    // Trocar de fazenda é trocar de token: o fazenda_id viaja assinado dentro
    // dele, e nenhum endpoint de dados aceita a fazenda vinda do cliente.
    const nova = await apiAuth<Sessao>("/auth/trocar-fazenda", {
      method: "POST",
      body: JSON.stringify({ fazenda_id }),
    });
    salvarSessao(nova);
    setTrocando(false);
    router.refresh();
    window.location.reload();
  }

  const atual = eu?.fazendas.find((f) => f.fazenda_id === eu.fazenda_id);

  return (
    <aside className="flex w-60 shrink-0 flex-col justify-between bg-verde px-4 py-5">
      <div>
        <div className="px-2">
          <p className="font-titulo font-extrabold text-fundo">{atual?.nome ?? "…"}</p>
          {eu && eu.fazendas.length > 1 && (
            <button
              onClick={() => setTrocando((v) => !v)}
              className="mt-0.5 text-xs text-fundo/60 hover:text-fundo"
            >
              Trocar fazenda ⌄
            </button>
          )}
        </div>

        {trocando && eu && (
          <ul className="mt-2 flex flex-col gap-1 rounded-xl bg-fundo/10 p-2">
            {eu.fazendas.map((f) => (
              <li key={f.fazenda_id}>
                <button
                  onClick={() => trocarFazenda(f.fazenda_id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                    f.fazenda_id === eu.fazenda_id ? "font-bold text-lima" : "text-fundo/80"
                  }`}
                >
                  {f.nome}
                </button>
              </li>
            ))}
          </ul>
        )}

        <nav className="mt-6 flex flex-col gap-1">
          {ITENS.map(({ href, rotulo, Icone }) => {
            const ativo = href === "/dashboard" ? caminho === href : caminho.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={ativo ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold ${
                  ativo ? "bg-fundo/12 text-lima" : "text-fundo/70 hover:text-fundo"
                }`}
              >
                <Icone className="h-5 w-5" />
                {rotulo}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-fundo/15 pt-4">
        <div className="flex items-center gap-3 px-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lima font-titulo text-sm font-extrabold text-verde">
            {eu ? iniciais(eu.usuario.nome) : "—"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-fundo">{eu?.usuario.nome ?? ""}</p>
            <p className="text-xs text-fundo/60">{ROTULO_PAPEL[eu?.papel ?? ""] ?? ""}</p>
          </div>
        </div>
        <button
          onClick={() => {
            limparSessao();
            router.replace("/dashboard/login");
          }}
          className="mt-3 px-2 text-xs text-fundo/50 underline hover:text-fundo"
        >
          Sair
        </button>
      </div>
    </aside>
  );
}
