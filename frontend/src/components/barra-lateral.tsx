"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Balao, Caixa, Engrenagem, Grade, Pessoa } from "@/components/icones";
import { LogoFazenda } from "@/components/logo-fazenda";
import { apiAuth } from "@/lib/api";
import { baixarMarca, marcaGuardada } from "@/lib/marca";
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
  { href: "/dashboard/observacoes", rotulo: "Observações", Icone: Balao },
  { href: "/dashboard/configuracoes", rotulo: "Configurações", Icone: Engrenagem },
];

/**
 * Navegação do dashboard.
 *
 * Em telas largas é uma coluna fixa; abaixo de `lg` vira gaveta, porque 240px
 * de barra lateral num celular de 375px não deixam nada para o conteúdo. A
 * gaveta fecha ao navegar e no Esc, e o fundo escuro é clicável — nada pior que
 * um menu que não se sabe como sair.
 */
export function BarraLateral({
  aberta,
  aoFechar,
}: {
  aberta: boolean;
  aoFechar: () => void;
}) {
  const caminho = usePathname();
  const router = useRouter();
  const [eu, setEu] = useState<Eu | null>(null);
  const [trocando, setTrocando] = useState(false);

  useEffect(() => {
    apiAuth<Eu>("/auth/eu").then(setEu).catch(() => setEu(null));
    // Mantém cores e nome em dia; a logo se vira sozinha em <LogoFazenda>.
    void marcaGuardada();
    void baixarMarca();
  }, []);

  useEffect(() => {
    if (!aberta) return;
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberta, aoFechar]);

  async function trocarFazenda(fazenda_id: string) {
    // Trocar de fazenda é trocar de token: o fazenda_id viaja assinado dentro
    // dele, e nenhum endpoint de dados aceita a fazenda vinda do cliente.
    const nova = await apiAuth<Sessao>("/auth/trocar-fazenda", {
      method: "POST",
      body: JSON.stringify({ fazenda_id }),
    });
    salvarSessao(nova);
    window.location.reload();
  }

  const atual = eu?.fazendas.find((f) => f.fazenda_id === eu.fazenda_id);

  return (
    <>
      {aberta && (
        <button
          onClick={aoFechar}
          aria-label="Fechar menu"
          className="fixed inset-0 z-30 bg-verde/40 backdrop-blur-[1px] lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col justify-between bg-verde px-4 py-5 transition-transform lg:sticky lg:top-0 lg:z-0 lg:h-screen lg:w-60 lg:translate-x-0 ${
          aberta ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-2">
            {/* Logo e nome juntos: a logo pode ser um símbolo sem nome, e quem
                atende mais de uma fazenda precisa ler de qual está operando. */}
            <LogoFazenda
              alt=""
              className="mb-2 max-h-9 max-w-full object-contain object-left"
            />
            <p className="font-titulo font-extrabold text-fundo">{atual?.nome ?? "…"}</p>
            {eu && eu.fazendas.length > 1 && (
              <button
                onClick={() => setTrocando((v) => !v)}
                aria-expanded={trocando}
                className="mt-0.5 text-xs text-fundo/60 transition hover:text-fundo"
              >
                Trocar fazenda {trocando ? "⌃" : "⌄"}
              </button>
            )}
          </div>

          {trocando && eu && (
            <ul className="mt-2 flex flex-col gap-1 rounded-xl bg-fundo/10 p-2">
              {eu.fazendas.map((f) => (
                <li key={f.fazenda_id}>
                  <button
                    onClick={() => trocarFazenda(f.fazenda_id)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                      f.fazenda_id === eu.fazenda_id
                        ? "font-bold text-lima"
                        : "text-fundo/80 hover:bg-fundo/10"
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
                  onClick={aoFechar}
                  aria-current={ativo ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                    ativo ? "bg-fundo/12 text-lima" : "text-fundo/70 hover:bg-fundo/8 hover:text-fundo"
                  }`}
                >
                  <Icone className="h-5 w-5 shrink-0" />
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
            className="mt-3 px-2 text-xs text-fundo/50 underline transition hover:text-fundo"
          >
            Sair
          </button>
        </div>
      </aside>
    </>
  );
}

/** Cabeçalho só de celular: abre a gaveta. */
export function BarraMovel({ aoAbrir }: { aoAbrir: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-borda bg-white px-4 py-3 lg:hidden">
      <button
        onClick={aoAbrir}
        aria-label="Abrir menu"
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-borda text-verde"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <span className="font-titulo font-extrabold text-verde">Engorda</span>
    </header>
  );
}
