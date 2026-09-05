"use client";

import Link from "next/link";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/* Alvo de toque de 56px: o dedo é de quem está de luva, no curral. Abaixo de
   44px o WCAG já considera insuficiente. */
const ALTURA = "min-h-[56px]";

const VARIANTES = {
  primaria: "bg-verde text-fundo hover:bg-verde-claro",
  destaque: "bg-lima text-verde hover:brightness-95",
  neutra: "bg-white text-verde border border-borda hover:border-verde/40",
  perigo: "bg-white text-red-700 border border-red-200 hover:bg-red-50",
} as const;

type Variante = keyof typeof VARIANTES;

const BASE_BOTAO =
  "flex w-full items-center justify-center gap-2 rounded-xl px-5 font-titulo text-base font-bold transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50";

export function Botao({
  variante = "primaria",
  carregando = false,
  children,
  ...resto
}: {
  variante?: Variante;
  /** Mostra o giro e bloqueia o clique — sem trocar o texto de lugar. */
  carregando?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`${BASE_BOTAO} ${ALTURA} ${VARIANTES[variante]}`}
      disabled={carregando || resto.disabled}
      {...resto}
    >
      {carregando && <Girando />}
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
    <Link href={href} className={`${BASE_BOTAO} ${ALTURA} ${VARIANTES[variante]}`}>
      {children}
    </Link>
  );
}

function Girando() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity={0.25} strokeWidth={3} />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

const CAMPO =
  "w-full rounded-xl border border-borda bg-white px-4 text-verde transition outline-none focus:border-verde placeholder:text-verde/35 disabled:bg-verde/4 disabled:text-verde/50";

export function Campo({
  rotulo,
  dica,
  sufixo,
  erro,
  destaque = false,
  ...resto
}: {
  rotulo?: string;
  dica?: string;
  sufixo?: string;
  erro?: string;
  /** Campo grande, para o valor principal da tela (o peso). */
  destaque?: boolean;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      {rotulo && <span className="font-titulo text-sm font-bold text-verde">{rotulo}</span>}
      <div className="relative">
        <input
          aria-invalid={erro ? true : undefined}
          className={`${CAMPO} ${ALTURA} ${erro ? "border-red-400" : ""} ${
            destaque ? "tabular py-4 font-titulo text-3xl font-extrabold" : "text-base"
          } ${sufixo ? "pr-12" : ""}`}
          {...resto}
        />
        {sufixo && (
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-verde/45">
            {sufixo}
          </span>
        )}
      </div>
      {erro ? (
        <span className="text-xs font-bold text-red-700">{erro}</span>
      ) : (
        dica && <span className="text-xs text-verde/50">{dica}</span>
      )}
    </label>
  );
}

export function Selecao({
  rotulo,
  opcoes,
  ...resto
}: {
  rotulo: string;
  /** Aceita valores simples ou pares `[valor, rótulo]`. */
  opcoes: (string | [string, string])[];
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-titulo text-sm font-bold text-verde">{rotulo}</span>
      <div className="relative">
        <select
          // A seta é desenhada por nós: `appearance-none` sem seta deixava o
          // campo com cara de input de texto que não abre nada.
          className={`${CAMPO} ${ALTURA} appearance-none pr-11 text-base`}
          {...resto}
        >
          {opcoes.map((o) => {
            const [valor, texto] = Array.isArray(o) ? o : [o, o];
            return (
              <option key={valor} value={valor}>
                {texto}
              </option>
            );
          })}
        </select>
        <svg
          className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-verde/50"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
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
  tom?: "info" | "erro" | "sucesso" | "atencao";
  children: ReactNode;
}) {
  const estilos = {
    info: "bg-verde/5 text-verde",
    erro: "bg-red-50 text-red-800 ring-1 ring-red-100",
    sucesso: "bg-lima/25 text-verde",
    atencao: "bg-amber-50 text-amber-900 ring-1 ring-amber-100",
  }[tom];
  return (
    <p
      role={tom === "erro" ? "alert" : undefined}
      className={`rounded-xl px-4 py-3 text-sm ${estilos}`}
    >
      {children}
    </p>
  );
}

export function Cabecalho({
  titulo,
  subtitulo,
  acao,
}: {
  titulo: string;
  subtitulo?: string;
  acao?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-titulo text-2xl font-extrabold text-verde">{titulo}</h1>
        {subtitulo && <p className="mt-0.5 text-sm text-verde/60">{subtitulo}</p>}
      </div>
      {acao}
    </header>
  );
}

export function Chip({
  children,
  tom = "claro",
}: {
  children: ReactNode;
  tom?: "claro" | "escuro" | "lima" | "atencao" | "perigo";
}) {
  const estilos = {
    claro: "bg-verde/8 text-verde",
    escuro: "bg-fundo/15 text-fundo",
    lima: "bg-lima/30 text-verde",
    atencao: "bg-amber-100 text-amber-900",
    perigo: "bg-red-100 text-red-800",
  }[tom];
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${estilos}`}
    >
      {children}
    </span>
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
    <section className={`rounded-2xl border border-borda bg-white p-4 sm:p-5 ${className}`}>
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
    <div className="rounded-2xl border border-borda bg-white px-4 py-3.5 sm:px-5 sm:py-4">
      <p className="text-xs font-bold text-verde/55">{rotulo}</p>
      <p className="mt-1 font-titulo text-2xl font-extrabold text-verde sm:text-3xl">
        <span className={`tabular ${tom === "alerta" ? "text-red-600" : ""}`}>
          {valor ?? "—"}
        </span>
        {valor !== null && unidade && (
          <span className="ml-1.5 text-sm font-bold text-verde/50">{unidade}</span>
        )}
      </p>
    </div>
  );
}

/**
 * Esqueleto de carregamento.
 *
 * Melhor que a palavra "Carregando…": a página não muda de altura quando o dado
 * chega, então nada pula sob o dedo de quem já estava tocando.
 */
export function Esqueleto({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-verde/8 ${className}`} aria-hidden />;
}

export function EsqueletoKpis({ quantos = 4 }: { quantos?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: quantos }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-borda bg-white px-5 py-4">
          <Esqueleto className="h-3 w-24" />
          <Esqueleto className="mt-3 h-7 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Estado vazio: diz o que houve e o que fazer a seguir. */
export function Vazio({
  titulo,
  descricao,
  acao,
}: {
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl bg-verde/4 px-6 py-10 text-center">
      <p className="font-titulo font-bold text-verde">{titulo}</p>
      {descricao && <p className="max-w-sm text-sm text-verde/60">{descricao}</p>}
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  );
}
