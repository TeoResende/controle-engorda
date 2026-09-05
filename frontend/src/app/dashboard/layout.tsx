"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { lerSessao } from "@/lib/sessao";

/**
 * Área do cliente.
 *
 * Sem Service Worker de propósito: aqui o dado é analítico e precisa estar
 * atualizado. Cache agressivo faria o pecuarista tomar decisão com número
 * velho — o oposto do que o app do técnico precisa.
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
  return <div className="mx-auto w-full max-w-3xl p-5">{children}</div>;
}
