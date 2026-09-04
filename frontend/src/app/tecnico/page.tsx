"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Aviso, Botao, Cabecalho, Campo, LinkBotao } from "@/components/ui";
import { db } from "@/lib/db";
import { limparSessao } from "@/lib/sessao";
import { sincronizarTudo } from "@/lib/sync";

/** Tela 1 — Início. */
export default function Inicio() {
  const router = useRouter();
  const [brinco, setBrinco] = useState("");
  const [sincronizando, setSincronizando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  const fila = useLiveQuery(() => db.fila.orderBy("coletado_em").reverse().toArray(), [], []);
  const rebanho = useLiveQuery(() => db.animais.count(), [], 0);
  const comErro = fila.filter((p) => p.ultimo_erro);

  async function sincronizarAgora() {
    setSincronizando(true);
    setResultado(null);
    const resumo = await sincronizarTudo();
    setResultado(
      resumo.motivo
        ? `Não deu para sincronizar: ${resumo.motivo}.`
        : `${resumo.enviadas} enviada(s). ${resumo.restantes} na fila.`,
    );
    setSincronizando(false);
  }

  function abrirColeta(evento: React.FormEvent) {
    evento.preventDefault();
    const limpo = brinco.trim();
    if (limpo) router.push(`/tecnico/coleta?brinco=${encodeURIComponent(limpo)}`);
  }

  return (
    <main className="flex flex-col gap-6">
      <Cabecalho titulo="Coleta de peso" subtitulo={`${rebanho} animais no aparelho`} />

      <div className="flex flex-col gap-3">
        <LinkBotao href="/tecnico/ler" variante="destaque">
          Ler brinco por aproximação
        </LinkBotao>

        <form onSubmit={abrirColeta} className="flex flex-col gap-3">
          <Campo
            rotulo="Ou digite o número do brinco"
            inputMode="numeric"
            value={brinco}
            onChange={(e) => setBrinco(e.target.value)}
            placeholder="1234"
          />
          <Botao type="submit" variante="neutra" disabled={!brinco.trim()}>
            Abrir coleta
          </Botao>
        </form>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-titulo text-sm font-bold uppercase tracking-wide text-verde/60">
          Fila de envio
        </h2>

        {fila.length === 0 ? (
          <Aviso>Nada pendente. Tudo que você coletou já está no servidor.</Aviso>
        ) : (
          <ul className="flex flex-col gap-2">
            {fila.slice(0, 8).map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-xl bg-white px-4 py-3"
              >
                <span className="font-titulo font-bold text-verde">Brinco {p.brinco}</span>
                <span className="text-sm text-verde/60">{p.peso_kg} kg</span>
              </li>
            ))}
            {fila.length > 8 && (
              <li className="px-1 text-xs text-verde/50">e mais {fila.length - 8}…</li>
            )}
          </ul>
        )}

        {comErro.length > 0 && (
          <Aviso tom="erro">
            {comErro.length} pesagem(ns) o servidor recusou: {comErro[0].ultimo_erro}
          </Aviso>
        )}

        <Botao onClick={sincronizarAgora} disabled={sincronizando}>
          {sincronizando ? "Sincronizando…" : "Sincronizar agora"}
        </Botao>
        {resultado && <Aviso>{resultado}</Aviso>}
      </section>

      <div className="flex items-center justify-between">
        <a href="/tecnico/gravar" className="py-2 text-sm text-verde/50 underline">
          Gravar tag de um brinco
        </a>
      </div>

      <button
        onClick={() => {
          limparSessao();
          router.replace("/tecnico/login");
        }}
        className="py-2 text-sm text-verde/50 underline"
      >
        Sair
      </button>
    </main>
  );
}
