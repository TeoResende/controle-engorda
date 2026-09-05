"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { RegistrarWorker } from "@/components/registrar-worker";
import { api } from "@/lib/api";

type SetupStatus = { precisa_configuracao: boolean };

export default function Home() {
  const router = useRouter();
  const [verificando, setVerificando] = useState(true);

  // Instalação nova não tem usuário nenhum — e sem usuário não há como logar.
  // Nesse caso o visitante vai direto para a criação do primeiro admin.
  useEffect(() => {
    api<SetupStatus>("/setup/status")
      .then(({ precisa_configuracao }) => {
        if (precisa_configuracao) {
          router.replace("/primeiro-acesso");
        } else {
          setVerificando(false);
        }
      })
      .catch(() => setVerificando(false)); // API fora do ar: segue para as telas
  }, [router]);

  if (verificando) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <RegistrarWorker />
        <p className="text-sm text-verde/60">Carregando…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <RegistrarWorker />
      <div>
        <h1 className="font-titulo text-3xl font-extrabold text-verde">Engorda</h1>
        <p className="mt-1 text-sm text-verde/70">
          Acompanhamento de peso de bezerros
        </p>
      </div>

      <nav className="flex flex-col gap-3">
        <Link
          href="/tecnico"
          className="rounded-xl bg-verde px-5 py-4 font-titulo font-bold text-fundo"
        >
          Sou técnico de campo
        </Link>
        <Link
          href="/dashboard"
          className="rounded-xl bg-lima px-5 py-4 font-titulo font-bold text-verde"
        >
          Sou cliente
        </Link>
      </nav>
    </main>
  );
}
