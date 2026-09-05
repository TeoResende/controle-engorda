"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Lupa, Seta } from "@/components/icones";
import { Celula, Linha, Tabela } from "@/components/tabela";
import { Cartao, Chip, Esqueleto, Vazio } from "@/components/ui";
import { apiAuth } from "@/lib/api";
import { data as formatarData, peso as formatarPeso } from "@/lib/formato";

type Animal = {
  id: string;
  brinco: string;
  nome: string | null;
  raca: string | null;
  status: string;
  lote_id: string | null;
  ultimo_peso: string | null;
  ultima_pesagem: string | null;
};

type Pagina = { itens: Animal[]; total: number };

const POR_PAGINA = 50;

function Conteudo() {
  const router = useRouter();
  const parametros = useSearchParams();
  const [busca, setBusca] = useState(parametros.get("brinco") ?? "");
  const [pagina, setPagina] = useState(0);
  const [dados, setDados] = useState<Pagina | null>(null);

  const lote = parametros.get("lote");

  useEffect(() => {
    const consulta = new URLSearchParams({
      limite: String(POR_PAGINA),
      deslocamento: String(pagina * POR_PAGINA),
    });
    if (busca.trim()) consulta.set("brinco", busca.trim());
    if (lote) consulta.set("lote_id", lote);

    apiAuth<Pagina>(`/animais?${consulta}`)
      .then(setDados)
      .catch(() => setDados({ itens: [], total: 0 }));
  }, [busca, pagina, lote]);

  const paginas = dados ? Math.ceil(dados.total / POR_PAGINA) : 0;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-titulo text-2xl font-extrabold text-verde">Animais</h1>
          <p className="text-sm text-verde/60">
            {dados ? `${dados.total} animais ativos` : "Carregando…"}
            {lote && " neste lote"}
          </p>
        </div>
        <div className="relative w-full max-w-xs">
          <Lupa className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-verde/40" />
          <input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPagina(0); // busca nova começa da primeira página
            }}
            placeholder="Buscar por brinco…"
            className="w-full rounded-xl border border-borda bg-white py-2.5 pl-9 pr-3 text-sm text-verde outline-none focus:border-verde placeholder:text-verde/35"
          />
        </div>
      </header>

      <Cartao>
        {!dados ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Esqueleto key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : dados.itens.length === 0 ? (
          <Vazio
            titulo="Nenhum animal encontrado"
            descricao={
              busca
                ? `Nada com “${busca}”. Confira o número do brinco.`
                : "Os animais aparecem aqui assim que forem cadastrados."
            }
          />
        ) : (
          <>
            <Tabela colunas={["Brinco", "Nome", "Raça", "Último peso", "Status", ""]}>
              {dados.itens.map((a) => (
                <Linha key={a.id}>
                  <Celula principal>{a.brinco}</Celula>
                  <Celula rotulo="Nome">{a.nome ?? "—"}</Celula>
                  <Celula rotulo="Raça">{a.raca ?? "—"}</Celula>
                  <Celula rotulo="Último peso" className="tabular">
                    {a.ultimo_peso
                      ? `${formatarPeso(a.ultimo_peso)} kg · ${formatarData(a.ultima_pesagem)}`
                      : "—"}
                  </Celula>
                  <Celula rotulo="Status">
                    <Chip tom={a.status === "ativo" ? "lima" : "claro"}>
                      {a.status[0].toUpperCase() + a.status.slice(1)}
                    </Chip>
                  </Celula>
                  <Celula className="md:text-right">
                    <Link href={`/dashboard/animal/${a.id}`} aria-label={`Abrir ${a.brinco}`}>
                      <Seta className="ml-auto h-4 w-4 text-verde/30" />
                    </Link>
                  </Celula>
                </Linha>
              ))}
            </Tabela>

            {paginas > 1 && (
              <div className="mt-4 flex items-center justify-between text-sm">
                <button
                  onClick={() => setPagina((p) => Math.max(p - 1, 0))}
                  disabled={pagina === 0}
                  className="font-bold text-verde disabled:opacity-30"
                >
                  ← Anterior
                </button>
                <span className="text-verde/55">
                  Página {pagina + 1} de {paginas}
                </span>
                <button
                  onClick={() => setPagina((p) => Math.min(p + 1, paginas - 1))}
                  disabled={pagina >= paginas - 1}
                  className="font-bold text-verde disabled:opacity-30"
                >
                  Próxima →
                </button>
              </div>
            )}
          </>
        )}
      </Cartao>
    </div>
  );
}

export default function Animais() {
  return (
    <Suspense fallback={null}>
      <Conteudo />
    </Suspense>
  );
}
