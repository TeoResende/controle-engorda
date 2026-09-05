"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { Aviso, Botao, Cabecalho, LinkBotao } from "@/components/ui";
import { escutarTags, suporteNfc, type SuporteNfc } from "@/lib/nfc";

/**
 * Tela 2 — Leitura do brinco por NFC.
 *
 * Web NFC só existe no Chrome/Android e só em contexto seguro. Quando não dá,
 * esta tela não pode virar beco sem saída: o técnico segue pelo número digitado.
 */
function Conteudo() {
  const router = useRouter();
  // Quando a leitura foi pedida pela tela de cadastro, o brinco volta para lá.
  const destino = useSearchParams().get("destino");
  const [suporte, setSuporte] = useState<SuporteNfc | null>(null);
  const [escutando, setEscutando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const controle = useRef<AbortController | null>(null);

  useEffect(() => {
    setSuporte(suporteNfc());
    return () => controle.current?.abort();
  }, []);

  async function comecar() {
    setErro(null);
    const abortador = new AbortController();
    controle.current = abortador;
    try {
      await escutarTags({
        sinal: abortador.signal,
        aoLer: (brinco) => {
          abortador.abort(); // uma tag por vez: já vai para a coleta
          // Vibração curta confirma a leitura sem o técnico precisar olhar a tela.
          navigator.vibrate?.(80);
          router.replace(
            destino === "cadastro"
              ? `/tecnico/animal/novo?brinco=${encodeURIComponent(brinco)}`
              : `/tecnico/coleta?brinco=${encodeURIComponent(brinco)}`,
          );
        },
        aoErrar: setErro,
      });
      setEscutando(true);
    } catch (e) {
      setEscutando(false);
      setErro(
        e instanceof Error && e.name === "NotAllowedError"
          ? "Permissão de NFC negada. Libere nas configurações do Chrome."
          : e instanceof Error
            ? e.message
            : "Não consegui ligar o leitor",
      );
    }
  }

  return (
    <main className="flex flex-col gap-6">
      <Cabecalho titulo="Ler brinco" subtitulo="Encoste o celular no brinco do animal." />

      {suporte === "disponivel" && (
        <>
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-white py-12">
            <div
              className={`flex h-28 w-28 items-center justify-center rounded-full ${
                escutando ? "animate-pulse bg-lima" : "bg-verde/10"
              }`}
            >
              <span className="font-titulo text-4xl font-extrabold text-verde">NFC</span>
            </div>
            <p className="px-6 text-center text-sm text-verde/70">
              {escutando
                ? "Procurando… encoste a parte de trás do celular no brinco."
                : "Toque em ligar o leitor para começar."}
            </p>
          </div>

          {!escutando && <Botao variante="destaque" onClick={comecar}>Ligar o leitor</Botao>}
        </>
      )}

      {suporte === "sem-https" && (
        <Aviso tom="erro">
          A leitura por aproximação exige conexão segura (HTTPS). Abra o app pelo
          endereço https:// para usar o NFC.
        </Aviso>
      )}

      {suporte === "sem-api" && (
        <Aviso tom="erro">
          Este aparelho ou navegador não lê NFC pela web. Funciona no Chrome para
          Android; no iPhone, use o número do brinco.
        </Aviso>
      )}

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <LinkBotao href="/tecnico/animais" variante="neutra">
        Buscar pelo número
      </LinkBotao>
    </main>
  );
}

export default function Ler() {
  return (
    <Suspense fallback={null}>
      <Conteudo />
    </Suspense>
  );
}
