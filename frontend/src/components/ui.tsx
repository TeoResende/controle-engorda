"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/* Alvos de toque com no mínimo 56px: o dedo é de quem está de luva, no curral. */
const ALTURA = "min-h-[56px]";

const VARIANTES = {
  primaria: "bg-verde text-fundo",
  destaque: "bg-lima text-verde",
  neutra: "bg-white text-verde border border-verde/15",
} as const;

type Variante = keyof typeof VARIANTES;

export function Botao({
  variante = "primaria",
  children,
  ...resto
}: { variante?: Variante } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`${ALTURA} w-full rounded-xl px-5 font-titulo text-base font-bold transition active:scale-[0.99] disabled:opacity-50 ${VARIANTES[variante]}`}
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
  variante?: Variante;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`${ALTURA} flex w-full items-center justify-center rounded-xl px-5 font-titulo text-base font-bold ${VARIANTES[variante]}`}
    >
      {children}
    </Link>
  );
}

const CAMPO =
  "w-full rounded-xl border border-verde/15 bg-white px-4 text-verde outline-none transition focus:border-verde placeholder:text-verde/35";

export function Campo({
  rotulo,
  dica,
  sufixo,
  destaque = false,
  ...resto
}: {
  rotulo?: string;
  dica?: string;
  sufixo?: string;
  /** Campo grande, para o valor principal da tela (o peso). */
  destaque?: boolean;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      {rotulo && <span className="font-titulo text-sm font-bold text-verde">{rotulo}</span>}
      <div className="relative">
        <input
          className={`${CAMPO} ${ALTURA} ${destaque ? "py-4 font-titulo text-3xl font-extrabold" : "text-base"}`}
          {...resto}
        />
        {sufixo && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-verde/45">
            {sufixo}
          </span>
        )}
      </div>
      {dica && <span className="text-xs text-verde/50">{dica}</span>}
    </label>
  );
}

export function Selecao({
  rotulo,
  opcoes,
  ...resto
}: { rotulo: string; opcoes: string[] } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-titulo text-sm font-bold text-verde">{rotulo}</span>
      <select className={`${CAMPO} ${ALTURA} appearance-none bg-[length:0] text-base`} {...resto}>
        {opcoes.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AreaDeTexto({
  rotulo,
  children,
  ...resto
}: { rotulo?: string; children?: ReactNode } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      {rotulo && <span className="font-titulo text-sm font-bold text-verde">{rotulo}</span>}
      <div className="relative">
        <textarea rows={3} className={`${CAMPO} resize-none py-3.5 text-base`} {...resto} />
        {children}
      </div>
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
    sucesso: "bg-lima/25 text-verde",
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

/** Etiqueta pequena: raça, porte, lote, status. */
export function Chip({
  children,
  tom = "claro",
}: {
  children: ReactNode;
  tom?: "claro" | "escuro" | "lima" | "atencao";
}) {
  const estilos = {
    claro: "bg-verde/8 text-verde",
    escuro: "bg-fundo/15 text-fundo",
    lima: "bg-lima/30 text-verde",
    atencao: "bg-amber-100 text-amber-900",
  }[tom];
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${estilos}`}>{children}</span>
  );
}

export function Cartao({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-verde/8 bg-white p-5 ${className}`}>
      {children}
    </section>
  );
}

export function Kpi({
  rotulo,
  valor,
  unidade,
  tom = "normal",
}: {
  rotulo: string;
  valor: string | number | null;
  unidade?: string;
  tom?: "normal" | "alerta";
}) {
  return (
    <div className="rounded-2xl border border-verde/8 bg-white px-5 py-4">
      <p className="text-xs font-bold text-verde/55">{rotulo}</p>
      <p className="mt-1.5 font-titulo text-3xl font-extrabold text-verde">
        <span className={tom === "alerta" ? "text-red-600" : undefined}>{valor ?? "—"}</span>
        {valor !== null && unidade && (
          <span className="ml-1.5 text-sm font-bold text-verde/50">{unidade}</span>
        )}
      </p>
    </div>
  );
}
