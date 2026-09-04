"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Botao({
  variante = "primaria",
  children,
  ...resto
}: { variante?: "primaria" | "destaque" | "neutra" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const estilos = {
    primaria: "bg-verde text-fundo",
    destaque: "bg-lima text-verde",
    neutra: "bg-white text-verde border border-verde/20",
  }[variante];
  return (
    <button
      // min-h alto de propósito: o alvo é o dedo de quem está de luva, no curral.
      className={`min-h-[56px] w-full rounded-xl px-5 py-4 font-titulo text-base font-bold transition active:scale-[0.99] disabled:opacity-50 ${estilos}`}
      {...resto}
    >
      {children}
    </button>
  );
}

export function LinkBotao({
  href,
  variante = "primaria",
  children,
}: {
  href: string;
  variante?: "primaria" | "destaque" | "neutra";
  children: ReactNode;
}) {
  const estilos = {
    primaria: "bg-verde text-fundo",
    destaque: "bg-lima text-verde",
    neutra: "bg-white text-verde border border-verde/20",
  }[variante];
  return (
    <Link
      href={href}
      className={`flex min-h-[56px] items-center justify-center rounded-xl px-5 py-4 font-titulo text-base font-bold ${estilos}`}
    >
      {children}
    </Link>
  );
}

export function Campo({
  rotulo,
  dica,
  sufixo,
  ...resto
}: { rotulo: string; dica?: string; sufixo?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-titulo text-sm font-bold text-verde">{rotulo}</span>
      <div className="relative">
        <input
          className="min-h-[56px] w-full rounded-xl border border-verde/20 bg-white px-4 text-lg text-verde outline-none focus:border-verde"
          {...resto}
        />
        {sufixo && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-verde/50">
            {sufixo}
          </span>
        )}
      </div>
      {dica && <span className="text-xs text-verde/50">{dica}</span>}
    </label>
  );
}

export function Aviso({
  tom = "info",
  children,
}: {
  tom?: "info" | "erro" | "sucesso";
  children: ReactNode;
}) {
  const estilos = {
    info: "bg-verde/5 text-verde",
    erro: "bg-red-50 text-red-700",
    sucesso: "bg-lima/20 text-verde",
  }[tom];
  return (
    <p role={tom === "erro" ? "alert" : undefined} className={`rounded-xl px-4 py-3 text-sm ${estilos}`}>
      {children}
    </p>
  );
}

export function Cabecalho({ titulo, subtitulo }: { titulo: string; subtitulo?: string }) {
  return (
    <header>
      <h1 className="font-titulo text-2xl font-extrabold text-verde">{titulo}</h1>
      {subtitulo && <p className="mt-1 text-sm text-verde/70">{subtitulo}</p>}
    </header>
  );
}
