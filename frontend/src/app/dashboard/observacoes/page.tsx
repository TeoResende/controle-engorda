"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AudioObservacao } from "@/components/audio-observacao";
import { BotaoExportar, BotaoImprimir } from "@/components/exportar";
import { Lupa } from "@/components/icones";
import { CabecalhoImpressao } from "@/components/impressao";
import { Cartao, Chip, Esqueleto, Vazio } from "@/components/ui";
import { apiAuth } from "@/lib/api";
import { data as formatarData, peso as formatarPeso } from "@/lib/formato";

type Observacao = {
  pesagem_id: string;
  animal_id: string;
  brinco: string;
  nome_animal: string | null;
  data: string;
  peso_kg: string;
  texto: string;
  tem_audio: boolean;
  status_transcricao: string | null;
  tecnico_nome: string | null;
};

/**
 * Registro de campo do rebanho.
 *
 * O técnico anota "mancando da pata esquerda" e isso ficava enterrado no
 * histórico de um animal. É informação de saúde chegando pelo caminho do peso —
 * e quem cuida do rebanho precisa de um lugar onde ela apareça sozinha.
 */
export default function Observacoes() {
  const [itens, setItens] = useState<Observacao[] | null>(null);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    apiAuth<Observacao[]>("/metricas/observacoes?limite=200")
      .then(setItens)
      .catch(() => setItens([]));
  }, []);

  const termo = busca.trim().toLowerCase();
  const filtradas = (itens ?? []).filter(
    (o) =>
      !termo ||
      o.brinco.toLowerCase().includes(termo) ||
      o.texto.toLowerCase().includes(termo) ||
      (o.nome_animal ?? "").toLowerCase().includes(termo),
  );

  return (
    <div className="flex flex-col gap-5">
      <CabecalhoImpressao
        titulo="Observações de campo"
        recorte={
          [busca ? `busca “${busca}”` : null, itens ? `${filtradas.length} registros` : null]
            .filter(Boolean)
            .join(" · ") || undefined
        }
      />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-titulo text-2xl font-extrabold text-verde">Observações</h1>
          <p className="text-sm text-verde/60">
            O que os técnicos anotaram ou falaram durante as pesagens
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <BotaoExportar caminho="/exportar/observacoes.csv" />
          <BotaoImprimir />
        </div>
      </header>

      <div className="relative print:hidden">
        <Lupa className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-verde/40" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por brinco ou pelo texto da observação…"
          className="w-full max-w-md rounded-xl border border-borda bg-white py-2.5 pl-9 pr-3 text-sm text-verde outline-none focus:border-verde placeholder:text-verde/35"
        />
      </div>

      {!itens ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Esqueleto key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : filtradas.length === 0 ? (
        <Vazio
          titulo={termo ? "Nada encontrado" : "Nenhuma observação ainda"}
          descricao={
            termo
              ? `Nenhuma observação com “${busca}”.`
              : "Os técnicos podem digitar ou gravar uma observação a cada pesagem. Elas aparecem aqui."
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {filtradas.map((o) => (
            <li key={o.pesagem_id}>
              <Cartao className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/dashboard/animal/${o.animal_id}`}
                      className="font-titulo font-bold text-verde hover:underline"
                    >
                      {o.brinco}
                      {o.nome_animal && (
                        <span className="ml-1.5 font-normal text-verde/70">{o.nome_animal}</span>
                      )}
                    </Link>
                    <p className="text-xs text-verde/55">
                      {formatarData(o.data)} · {formatarPeso(o.peso_kg)} kg
                      {o.tecnico_nome && ` · ${o.tecnico_nome}`}
                    </p>
                  </div>
                  {o.status_transcricao === "pendente" && <Chip tom="atencao">transcrevendo</Chip>}
                  {o.status_transcricao === "falhou" && <Chip tom="perigo">transcrição falhou</Chip>}
                </div>

                <p className="mt-2.5 text-sm text-verde">{o.texto}</p>

                {o.tem_audio && (
                  <div className="mt-3 print:hidden">
                    <AudioObservacao pesagemId={o.pesagem_id} />
                  </div>
                )}
              </Cartao>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
