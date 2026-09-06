"use client";

import { useEffect, useState } from "react";

import { logoDaFazenda, logoGuardada } from "@/lib/marca";
import { fazendaAtiva } from "@/lib/sessao";

/**
 * A logo da fazenda, onde quer que ela apareça.
 *
 * As regras de busca e de cache moram em `lib/marca.ts` (`logoDaFazenda`), que
 * é onde os testes alcançam. Aqui só sobra o que é de tela: pintar o que já
 * está guardado antes da resposta da rede, revogar a URL local ao sair e cair
 * para a alternativa quando não há logo.
 */
export function LogoFazenda({
  className = "",
  alt = "",
  /** O que mostrar enquanto não há logo — nome da fazenda, ícone, nada. */
  alternativa = null,
  /** Muda para forçar nova busca depois de enviar ou remover a logo. */
  versao,
}: {
  className?: string;
  alt?: string;
  alternativa?: React.ReactNode;
  versao?: number;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    let atual: string | null = null;

    const mostrar = (blob: Blob | null) => {
      if (!vivo) return;
      if (atual) URL.revokeObjectURL(atual);
      atual = blob ? URL.createObjectURL(blob) : null;
      setUrl(atual);
    };

    async function carregar() {
      const fazenda = fazendaAtiva();
      if (!fazenda) return;
      mostrar(await logoGuardada(fazenda));
      mostrar(await logoDaFazenda(fazenda));
    }

    void carregar();
    return () => {
      vivo = false;
      if (atual) URL.revokeObjectURL(atual);
    };
  }, [versao]);

  if (!url) return <>{alternativa}</>;

  /* eslint-disable-next-line @next/next/no-img-element */
  return <img src={url} alt={alt} className={className} />;
}
