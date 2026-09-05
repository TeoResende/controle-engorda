"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Seta } from "@/components/icones";
import { Celula, Linha, Tabela } from "@/components/tabela";
import { Cartao, Chip, Esqueleto, Vazio } from "@/components/ui";
import { apiAuth } from "@/lib/api";
import { data as formatarData, gmd as formatarGmd, peso as formatarPeso } from "@/lib/formato";

type LoteMetrica = {
  lote_id: string | null;
  nome: string;
  animais: number;
  peso_medio: string | null;
  gmd_medio: string | null;
};

type LoteCadastro = {
  id: string;
  nome: string;
  data_formacao: string | null;
  animais_ativos: number;
};

const GMD_META = 0.5;

export default function Lotes() {
  const [metricas, setMetricas] = useState<LoteMetrica[] | null>(null);
  const [cadastro, setCadastro] = useState<LoteCadastro[]>([]);

  useEffect(() => {
    apiAuth<{ lotes: LoteMetrica[] }>("/metricas/visao-geral?meses=1")
      .then((d) => setMetricas(d.lotes))
      .catch(() => setMetricas([]));
    apiAuth<LoteCadastro[]>("/lotes").then(setCadastro).catch(() => setCadastro([]));
  }, []);

  const porNome = new Map(cadastro.map((l) => [l.nome, l]));

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-titulo text-2xl font-extrabold text-verde">Lotes</h1>
        <p className="text-sm text-verde/60">Desempenho por lote do rebanho</p>
      </header>

      <Cartao>
        {!metricas ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Esqueleto key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : metricas.length === 0 ? (
          <Vazio
            titulo="Nenhum lote com animais ativos"
            descricao="Lotes agrupam os animais para acompanhar o desempenho por curral ou pasto."
          />
        ) : (
          <Tabela colunas={["Lote", "Formado em", "Animais", "Peso médio", "GMD", "Status", ""]}>
            {metricas.map((l) => {
              const atencao = l.gmd_medio !== null && Number(l.gmd_medio) < GMD_META;
              return (
                <Linha key={l.lote_id ?? l.nome}>
                  <Celula principal>{l.nome}</Celula>
                  <Celula rotulo="Formado em">{formatarData(porNome.get(l.nome)?.data_formacao)}</Celula>
                  <Celula rotulo="Animais">{l.animais}</Celula>
                  <Celula rotulo="Peso médio" className="tabular">
                    {l.peso_medio === null ? "—" : `${formatarPeso(l.peso_medio)} kg`}
                  </Celula>
                  <Celula rotulo="GMD" className="tabular">
                    {l.gmd_medio === null ? "—" : `${formatarGmd(l.gmd_medio)} kg/dia`}
                  </Celula>
                  <Celula rotulo="Status">
                    <Chip tom={atencao ? "atencao" : "lima"}>
                      {atencao ? "Atenção" : "No prazo"}
                    </Chip>
                  </Celula>
                  <Celula className="md:text-right">
                    <Link
                      href={`/dashboard/animais?lote=${l.lote_id ?? ""}`}
                      aria-label={`Ver animais do ${l.nome}`}
                    >
                      <Seta className="ml-auto h-4 w-4 text-verde/30" />
                    </Link>
                  </Celula>
                </Linha>
              );
            })}
          </Tabela>
        )}
      </Cartao>
    </div>
  );
}
