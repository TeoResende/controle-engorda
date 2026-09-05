"use client";

import { useEffect, useState } from "react";

/**
 * Aviso de contexto inseguro (http).
 *
 * Sem HTTPS o navegador desliga, em silêncio, quatro coisas de que este app
 * depende: Service Worker (abrir offline), Web NFC, gravação de áudio e
 * `crypto.randomUUID`. Nada disso dá erro visível — as funções simplesmente não
 * existem. Sem este aviso, a pessoa testa e conclui que o app está quebrado.
 */
export function AvisoInseguro() {
  const [inseguro, setInseguro] = useState(false);
  const [endereco, setEndereco] = useState("");

  useEffect(() => {
    if (window.isSecureContext) return;
    setInseguro(true);
    // Porta 8443 é a do Traefik em desenvolvimento; em produção o HTTPS é o
    // padrão e este aviso nunca aparece.
    const url = new URL(window.location.href);
    url.protocol = "https:";
    url.port = "8443";
    setEndereco(url.toString());
  }, []);

  if (!inseguro) return null;

  return (
    <div className="bg-amber-100 px-4 py-3 text-xs text-amber-900">
      <p className="font-bold">Conexão sem HTTPS — recursos limitados</p>
      <p className="mt-1">
        Registrar peso funciona. Não funcionam: abrir sem sinal, ler brinco por
        NFC e gravar observação em áudio.
      </p>
      <a href={endereco} className="mt-1 inline-block font-bold underline">
        Abrir por HTTPS
      </a>
    </div>
  );
}
