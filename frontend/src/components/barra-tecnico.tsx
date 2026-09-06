"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Casa, Brinco, Pessoa, Reticencias, SemSinal } from "@/components/icones";
import { LogoFazenda } from "@/components/logo-fazenda";
import { contarFila } from "@/lib/pesados-hoje";
import { sincronizar } from "@/lib/sync";

/**
 * Barra superior: fazenda e estado da conexão.
 *
 * Estar offline é o estado NORMAL aqui, não uma falha — a etiqueta informa sem
 * alarmar. O que não pode faltar é a fila: é o que o técnico não pode perder.
 */
export function BarraSuperior({ fazenda }: { fazenda: string }) {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const atualizar = () => setOnline(navigator.onLine);
    atualizar();
    const aoVoltar = () => {
      setOnline(true);
      void sincronizar(); // voltou o sinal: sobe a fila sem o técnico pedir
    };
    window.addEventListener("online", aoVoltar);
    window.addEventListener("offline", atualizar);
    return () => {
      window.removeEventListener("online", aoVoltar);
      window.removeEventListener("offline", atualizar);
    };
  }, []);

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-borda bg-white px-4 py-3">
      <Link href="/tecnico/mais" className="flex min-w-0 items-center gap-2">
        <LogoFazenda
          alt={fazenda}
          className="max-h-7 max-w-[9rem] object-contain object-left"
          alternativa={
            <>
              <Casa className="h-5 w-5 shrink-0 text-verde" />
              <span className="truncate font-titulo font-extrabold text-verde">{fazenda}</span>
            </>
          }
        />
      </Link>
      <EtiquetaConexao online={online} />
    </header>
  );
}

export function EtiquetaConexao({ online }: { online: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
        online ? "bg-lima/25 text-verde" : "bg-amber-100 text-amber-900"
      }`}
    >
      {online ? (
        <>
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-verde" />
          Online
        </>
      ) : (
        <>
          <SemSinal className="h-3.5 w-3.5" />
          Offline
        </>
      )}
    </span>
  );
}

const ABAS = [
  { href: "/tecnico", rotulo: "Início", Icone: Casa },
  { href: "/tecnico/ler", rotulo: "Coleta", Icone: Brinco },
  { href: "/tecnico/animais", rotulo: "Animais", Icone: Pessoa },
  { href: "/tecnico/mais", rotulo: "Mais", Icone: Reticencias },
];

/** Navegação inferior — alcançável com o polegar, de uma mão só. */
export function NavegacaoInferior() {
  const caminho = usePathname();
  const pendentes = useLiveQuery(contarFila, [], 0);

  return (
    <nav
      className="sticky bottom-0 z-10 flex border-t border-borda bg-white"
      // Barra de gestos do Android come o rodapé; sem isto o alvo de toque das
      // abas fica embaixo dela.
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {ABAS.map(({ href, rotulo, Icone }) => {
        const ativa = href === "/tecnico" ? caminho === href : caminho.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={ativa ? "page" : undefined}
            className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-bold transition ${
              ativa ? "text-verde" : "text-verde/40 hover:text-verde/70"
            }`}
          >
            <Icone className="h-6 w-6" />
            {rotulo}
            {href === "/tecnico/mais" && pendentes > 0 && (
              <span className="absolute right-[22%] top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                {pendentes}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
