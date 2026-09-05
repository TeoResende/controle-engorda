"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { BarraLateral } from "@/components/barra-lateral";
import { lerSessao } from "@/lib/sessao";

/**
 * Área do cliente.
 *
 * Sem Service Worker de propósito: aqui o dado é analítico e precisa estar
 * atualizado. Cache agressivo faria o pecuarista decidir com número velho — o
 * oposto do que o app do técnico precisa.
 */
export default function LayoutDashboard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const caminho = usePathname();
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    if (caminho === "/dashboard/login") {
      setPronto(true);
      return;
    }
    if (!lerSessao()) {
      router.replace("/dashboard/login");
      return;
    }
    setPronto(true);
  }, [caminho, router]);

  if (!pronto) return null;

  if (caminho === "/dashboard/login") {
    return <div className="mx-auto w-full max-w-md p-5">{children}</div>;
  }

  return (
    <div className="flex min-h-screen">
      <BarraLateral />
      <main className="min-w-0 flex-1 overflow-x-hidden p-6">{children}</main>
    </div>
  );
}
