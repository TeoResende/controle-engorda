"use client";

import { useEffect, useRef, useState } from "react";

import { Aviso, Botao, Cabecalho, Campo, LinkBotao } from "@/components/ui";
import { gravarTag, suporteNfc, type SuporteNfc } from "@/lib/nfc";

/**
 * Gravação da tag NTAG213 do brinco.
 *
 * Fora das 5 telas do layout aprovado, mas necessária: sem gravar a tag não há
 * como testar a leitura, e depender de um app de terceiros para preparar cada
 * brinco não se sustenta quando forem centenas.
 */
export default function Gravar() {
  const [suporte, setSuporte] = useState<SuporteNfc | null>(null);
  const [brinco, setBrinco] = useState("");
  const [estado, setEstado] = useState<"parado" | "aguardando" | "pronto">("parado");
  const [erro, setErro] = useState<string | null>(null);
  const controle = useRef<AbortController | null>(null);

  useEffect(() => {
    setSuporte(suporteNfc());
    return () => controle.current?.abort();
  }, []);

  async function gravar() {
    setErro(null);
    setEstado("aguardando");
    const abortador = new AbortController();
    controle.current = abortador;
    try {
      await gravarTag(brinco.trim(), abortador.signal);
      navigator.vibrate?.([60, 40, 60]);
      setEstado("pronto");
    } catch (e) {
      setEstado("parado");
      setErro(e instanceof Error ? e.message : "Não consegui gravar a tag");
    }
  }

  return (
    <main className="flex flex-col gap-6">
      <Cabecalho titulo="Gravar brinco" subtitulo="Prepara a tag NFC de um animal." />

      {suporte !== "disponivel" && (
        <Aviso tom="erro">
          {suporte === "sem-https"
            ? "Gravar tag exige conexão segura (HTTPS)."
            : "Este aparelho ou navegador não grava NFC. Use o Chrome no Android."}
        </Aviso>
      )}

      <Campo
        rotulo="Número do brinco"
        inputMode="numeric"
        value={brinco}
        onChange={(e) => setBrinco(e.target.value)}
        placeholder="1234"
        dica="A tag guarda o endereço da tela de coleta com este número."
      />

      {estado === "aguardando" && (
        <Aviso>Encoste o celular na tag agora e mantenha parado.</Aviso>
      )}
      {estado === "pronto" && (
        <Aviso tom="sucesso">
          Tag gravada com o brinco {brinco}. Teste encostando o celular nela.
        </Aviso>
      )}
      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <Botao
        variante="destaque"
        onClick={gravar}
        disabled={suporte !== "disponivel" || !brinco.trim() || estado === "aguardando"}
      >
        {estado === "aguardando" ? "Aguardando a tag…" : "Gravar tag"}
      </Botao>

      <LinkBotao href="/tecnico" variante="neutra">
        Voltar
      </LinkBotao>
    </main>
  );
}
