"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Aviso, Cabecalho, LinkBotao } from "@/components/ui";

/** Tela 4 — Confirmação. */
function Conteudo() {
  const parametros = useSearchParams();
  const brinco = parametros.get("brinco") ?? "";
  const peso = parametros.get("peso") ?? "";
  const sincronizada = parametros.get("sync") === "1";

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-4 rounded-2xl bg-lima/20 py-12 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-lima">
          <span className="text-3xl text-verde">✓</span>
        </div>
        <div>
          <p className="font-titulo text-3xl font-extrabold text-verde">{peso} kg</p>
          <p className="mt-1 text-sm text-verde/70">Brinco {brinco}</p>
        </div>
      </div>

      <Cabecalho titulo="Peso registrado" />

      <Aviso tom={sincronizada ? "sucesso" : "info"}>
        {sincronizada
          ? "Já enviado para o servidor."
          : "Guardado no aparelho. Sobe sozinho assim que o sinal voltar — pode seguir coletando."}
      </Aviso>

      <div className="flex flex-col gap-3">
        <LinkBotao href="/tecnico/ler" variante="destaque">
          Ler o próximo animal
        </LinkBotao>
        <LinkBotao href="/tecnico" variante="neutra">
          Voltar ao início
        </LinkBotao>
      </div>
    </main>
  );
}

export default function Confirmacao() {
  return (
    <Suspense fallback={null}>
      <Conteudo />
    </Suspense>
  );
}
