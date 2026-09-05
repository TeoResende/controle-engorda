"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AvisoInseguro } from "@/components/aviso-inseguro";
import { BarraSuperior, NavegacaoInferior } from "@/components/barra-tecnico";
import { lerSessao } from "@/lib/sessao";
import {
  baixarIdentidade,
  identidadeGuardada,
  type Identidade,
} from "@/lib/sessao-usuario";
import { sincronizarTudo } from "@/lib/sync";

const PUBLICAS = ["/tecnico/login", "/tecnico/offline"];
/** Telas de tarefa: cabeçalho próprio, sem barra nem abas atrapalhando. */
const SEM_MOLDURA = ["/tecnico/coleta", "/tecnico/animal/novo", "/tecnico/gravar"];

export default function LayoutTecnico({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const caminho = usePathname();
  const [pronto, setPronto] = useState(false);
  const [identidade, setIdentidade] = useState<Identidade | null>(null);

  // Service Worker escopado em /tecnico: é o que faz o app ABRIR sem sinal. O
  // dashboard do cliente fica de fora — lá cache agressivo só atrapalharia.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/tecnico" }).catch(() => {
      // Sem HTTPS o registro falha; o app segue, só não abre offline.
    });
  }, []);

  useEffect(() => {
    if (PUBLICAS.includes(caminho)) {
      setPronto(true);
      return;
    }
    if (!lerSessao()) {
      router.replace("/tecnico/login");
      return;
    }
    setPronto(true);
    // Mostra o que está guardado na hora e atualiza em segundo plano.
    void identidadeGuardada().then((i) => i && setIdentidade(i));
    void baixarIdentidade().then((i) => i && setIdentidade(i));
    void sincronizarTudo();
  }, [caminho, router]);

  if (!pronto) return null;

  if (PUBLICAS.includes(caminho)) {
    return (
      <div className="mx-auto w-full max-w-md p-5">
        <AvisoInseguro />
        {children}
      </div>
    );
  }

  const semMoldura = SEM_MOLDURA.some((r) => caminho.startsWith(r));

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-fundo">
      <AvisoInseguro />
      {!semMoldura && <BarraSuperior fazenda={identidade?.fazenda ?? "…"} />}
      <div className="flex-1">{children}</div>
      {!semMoldura && <NavegacaoInferior />}
    </div>
  );
}
