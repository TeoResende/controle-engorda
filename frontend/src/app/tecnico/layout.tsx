"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AvisoInseguro } from "@/components/aviso-inseguro";
import { EstadoConexao } from "@/components/estado-conexao";
import { lerSessao } from "@/lib/sessao";
import { sincronizarTudo } from "@/lib/sync";

const PUBLICAS = ["/tecnico/login", "/tecnico/offline"];

export default function LayoutTecnico({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const caminho = usePathname();
  const [pronto, setPronto] = useState(false);

  // Service Worker escopado em /tecnico: é o que faz o app ABRIR sem sinal.
  // O dashboard do cliente fica de fora de propósito — lá cache agressivo só
  // atrapalharia.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/tecnico" }).catch(() => {
      // Sem HTTPS o registro falha; o app segue funcionando, só não abre offline.
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
    // Abriu o app: tenta subir o que ficou da última vez.
    void sincronizarTudo();
  }, [caminho, router]);

  if (!pronto) return null;

  return (
    <div className="flex min-h-screen flex-col">
      <AvisoInseguro />
      {!PUBLICAS.includes(caminho) && <EstadoConexao />}
      <div className="mx-auto w-full max-w-md flex-1 p-5">{children}</div>
    </div>
  );
}
