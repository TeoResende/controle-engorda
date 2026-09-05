"use client";

import { useEffect, useState } from "react";

import { API_URL } from "@/lib/api";
import { marcaGuardada, type Marca } from "@/lib/marca";

/**
 * Cabeçalho e rodapé do documento impresso.
 *
 * Uma folha que sai da impressora e vai para a mesa de alguém precisa se
 * identificar sozinha: de qual fazenda, qual relatório, com que recorte e de
 * quando. Sem isso, duas semanas depois ninguém sabe se aquele papel ainda vale.
 *
 * Bloco normal, no começo do documento — não `position: fixed`. Fixado, o
 * Chrome não repete em todas as páginas como se espera: renderiza uma vez e,
 * pior, no meio do conteúdo da segunda página. Verificado gerando o PDF.
 *
 * Não há rodapé próprio: como bloco normal ele saía logo abaixo do cabeçalho,
 * repetindo a mesma informação duas vezes na primeira folha. Data, página e
 * endereço quem imprime é a caixa de impressão do navegador.
 */
export function CabecalhoImpressao({
  titulo,
  recorte,
}: {
  titulo: string;
  /** O filtro aplicado — "Lote 03", "brinco 1234". Sem ele, a folha mente por
   *  omissão: parece o rebanho inteiro quando é um pedaço. */
  recorte?: string;
}) {
  const [marca, setMarca] = useState<Marca | null>(null);
  const [gerado, setGerado] = useState("");

  useEffect(() => {
    void marcaGuardada().then((m) => m && setMarca(m));
    // Só no cliente: a data no servidor seria de outro fuso e de outro momento.
    setGerado(
      new Date().toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
  }, []);

  return (
    <>
      <div className="cabecalho-impressao hidden print:block">
        <div className="flex items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            {marca?.tem_logo && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={`${API_URL}/fazendas/atual/logo`}
                alt=""
                className="max-h-9 max-w-32 object-contain"
              />
            )}
            <div>
              <p className="font-titulo text-sm font-extrabold">{marca?.nome ?? ""}</p>
              <p className="text-[11px]">
                {titulo}
                {recorte && <span className="opacity-70"> · {recorte}</span>}
              </p>
            </div>
          </div>
          <p className="text-[10px] opacity-70">Gerado em {gerado}</p>
        </div>
      </div>

    </>
  );
}
