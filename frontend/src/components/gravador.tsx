"use client";

import { useEffect, useRef, useState } from "react";

import { GravadorDeVoz, LIMITE_SEGUNDOS, suporteGravacao } from "@/lib/audio";
import { Aviso } from "./ui";

/**
 * Botão de observação em áudio.
 *
 * Serve para a mão suja e o dedo de luva: em vez de digitar no curral, o técnico
 * segura e fala. A transcrição vira texto depois, no servidor.
 */
export function Gravador({
  aoGravar,
}: {
  aoGravar: (audio: Blob | null, segundos: number) => void;
}) {
  const [suportado, setSuportado] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [gravado, setGravado] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const gravador = useRef<GravadorDeVoz | null>(null);

  useEffect(() => {
    setSuportado(suporteGravacao());
    return () => gravador.current?.descartar();
  }, []);

  useEffect(() => {
    if (!gravando) return;
    const relogio = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(relogio);
  }, [gravando]);

  // Corta sozinho no limite: áudio longo pesa na fila do celular em dias sem sinal.
  useEffect(() => {
    if (gravando && segundos >= LIMITE_SEGUNDOS) void parar();
  }, [gravando, segundos]);

  async function comecar() {
    setErro(null);
    try {
      gravador.current = new GravadorDeVoz();
      await gravador.current.comecar();
      setSegundos(0);
      setGravando(true);
    } catch {
      setErro("Não consegui acessar o microfone. Verifique a permissão.");
    }
  }

  async function parar() {
    if (!gravador.current) return;
    const { blob, segundos: duracao } = await gravador.current.parar();
    setGravando(false);
    setGravado(duracao);
    aoGravar(blob, duracao);
  }

  function apagar() {
    setGravado(null);
    setSegundos(0);
    aoGravar(null, 0);
  }

  if (!suportado) return null;

  return (
    <div className="flex flex-col gap-2">
      <span className="font-titulo text-sm font-bold text-verde">
        Observação falada (opcional)
      </span>

      {gravado !== null ? (
        <div className="flex items-center justify-between rounded-xl bg-lima/20 px-4 py-3">
          <span className="text-sm text-verde">Áudio de {gravado}s gravado</span>
          <button type="button" onClick={apagar} className="text-sm text-verde/60 underline">
            apagar
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={gravando ? parar : comecar}
          className={`min-h-[56px] rounded-xl px-5 font-titulo font-bold ${
            gravando ? "animate-pulse bg-red-600 text-white" : "bg-white text-verde border border-verde/20"
          }`}
        >
          {gravando ? `Gravando ${segundos}s — toque para parar` : "Gravar observação"}
        </button>
      )}

      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </div>
  );
}
