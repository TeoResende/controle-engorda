"use client";

import { useCallback, useEffect, useState } from "react";

import { db } from "@/lib/db";
import { registrarWorker } from "@/lib/worker";
import { Aviso, Botao, Cartao } from "@/components/ui";

/**
 * Diagnóstico do modo offline.
 *
 * "Não funcionou" não é acionável. Este painel diz exatamente qual das quatro
 * condições falhou — contexto seguro, worker registrado, telas guardadas,
 * rebanho baixado — e deixa preparar o aparelho antes de sair para o campo.
 */

type Estado = {
  seguro: boolean;
  endereco: string;
  workerSuportado: boolean;
  workerRegistrado: boolean;
  workerEscopo: string | null;
  workerAtivo: boolean;
  telasGuardadas: number;
  scriptsGuardados: number;
  animais: number;
  naFila: number;
};

const TELAS_ESPERADAS = [
  "/tecnico",
  "/tecnico/ler",
  "/tecnico/coleta",
  "/tecnico/confirmacao",
  "/tecnico/animais",
  "/tecnico/fila",
  "/tecnico/mais",
];

async function medir(): Promise<Estado> {
  const registro =
    "serviceWorker" in navigator
      ? await navigator.serviceWorker.getRegistration("/")
      : undefined;

  let telas = 0;
  let scripts = 0;
  if ("caches" in window) {
    for (const nome of await caches.keys()) {
      const cache = await caches.open(nome);
      for (const chave of await cache.keys()) {
        const caminho = new URL(chave.url).pathname;
        if (caminho.startsWith("/_next/")) scripts += 1;
        else if (caminho === "/" || caminho.startsWith("/tecnico")) telas += 1;
      }
    }
  }

  return {
    seguro: window.isSecureContext,
    endereco: window.location.origin,
    workerSuportado: "serviceWorker" in navigator,
    workerRegistrado: Boolean(registro),
    workerEscopo: registro ? new URL(registro.scope).pathname : null,
    workerAtivo: Boolean(registro?.active),
    telasGuardadas: telas,
    scriptsGuardados: scripts,
    animais: await db.animais.count(),
    naFila: await db.fila.count(),
  };
}

export function DiagnosticoOffline() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  const atualizar = useCallback(() => {
    medir().then(setEstado);
  }, []);

  useEffect(atualizar, [atualizar]);

  async function prepararParaOCampo() {
    setPreparando(true);
    setResultado(null);
    setFalha(null);

    const resultado = await registrarWorker();
    if (!resultado.ok) {
      setFalha(resultado.motivo);
      setPreparando(false);
      atualizar();
      return;
    }

    // Dá tempo de o install baixar as telas antes de medir de novo.
    await new Promise((r) => setTimeout(r, 3000));
    atualizar();
    setResultado("Aparelho preparado. Pode desligar a internet e testar.");
    setPreparando(false);
  }

  if (!estado) return null;

  const pronto =
    estado.seguro &&
    estado.workerAtivo &&
    estado.telasGuardadas >= TELAS_ESPERADAS.length &&
    estado.scriptsGuardados > 0;

  return (
    <Cartao>
      <h2 className="font-titulo font-extrabold text-verde">Uso sem internet</h2>

      {pronto ? (
        <Aviso tom="sucesso">
          Tudo pronto. O app abre e coleta peso sem sinal.
        </Aviso>
      ) : !estado.seguro ? (
        <Aviso tom="erro">
          <strong>Conexão sem HTTPS.</strong> O navegador só deixa o app funcionar
          sem internet em endereço seguro. Você está em {estado.endereco} — abra
          pelo endereço https:// (porta 8443) e aceite o aviso de certificado.
        </Aviso>
      ) : !estado.workerRegistrado ? (
        <Aviso tom="atencao">
          O app ainda não foi preparado neste aparelho. Toque em preparar abaixo,
          com internet.
        </Aviso>
      ) : (
        <Aviso tom="atencao">
          Preparo incompleto: {estado.telasGuardadas} de {TELAS_ESPERADAS.length}{" "}
          telas guardadas. Toque em preparar, ainda com internet.
        </Aviso>
      )}

      <dl className="mt-3 flex flex-col gap-1.5 text-sm">
        <Linha rotulo="Endereço" valor={estado.endereco} ok={estado.seguro} />
        <Linha
          rotulo="Conexão segura (HTTPS)"
          valor={estado.seguro ? "sim" : "não"}
          ok={estado.seguro}
        />
        <Linha
          rotulo="App preparado para offline"
          valor={
            !estado.workerSuportado
              ? "navegador não suporta"
              : estado.workerAtivo
                ? `sim (${estado.workerEscopo})`
                : estado.workerRegistrado
                  ? "instalando…"
                  : "não"
          }
          ok={estado.workerAtivo}
        />
        <Linha
          rotulo="Telas guardadas"
          valor={`${estado.telasGuardadas} telas, ${estado.scriptsGuardados} arquivos`}
          ok={estado.telasGuardadas >= TELAS_ESPERADAS.length && estado.scriptsGuardados > 0}
        />
        <Linha
          rotulo="Rebanho no aparelho"
          valor={`${estado.animais} animais`}
          ok={estado.animais > 0}
        />
        <Linha rotulo="Pesagens na fila" valor={String(estado.naFila)} ok />
      </dl>

      <div className="mt-4 flex flex-col gap-2">
        <Botao
          variante={pronto ? "neutra" : "destaque"}
          onClick={prepararParaOCampo}
          carregando={preparando}
          disabled={!estado.seguro}
        >
          {preparando ? "Preparando…" : "Preparar para o campo"}
        </Botao>
        {resultado && <Aviso tom="sucesso">{resultado}</Aviso>}
        {falha && <Aviso tom="erro">{falha}</Aviso>}
      </div>
    </Cartao>
  );
}

function Linha({ rotulo, valor, ok }: { rotulo: string; valor: string; ok: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-borda/60 pb-1.5 last:border-0">
      <dt className="text-verde/60">{rotulo}</dt>
      <dd
        className={`text-right font-bold ${ok ? "text-verde" : "text-red-700"}`}
        style={{ overflowWrap: "anywhere" }}
      >
        {valor}
      </dd>
    </div>
  );
}
