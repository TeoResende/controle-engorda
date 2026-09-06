"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { FazendaDaTarefa } from "@/components/fazenda-da-tarefa";
import { Brinco, Voltar } from "@/components/icones";
import { AreaDeTexto, Aviso, Botao, Campo, Selecao } from "@/components/ui";
import { apiAuth, ErroApi, SemConexao } from "@/lib/api";
import { db } from "@/lib/db";

/**
 * Tela 5 — Cadastro de animal.
 *
 * Diferente da pesagem, o cadastro **precisa de internet**: o animal nasce com
 * id do servidor, e ids locais abririam a porta para dois cadastros do mesmo
 * bicho vindos de dois aparelhos, partindo o histórico de peso em dois. A
 * pesagem é o que não pode esperar; o cadastro pode.
 */
const RACAS = ["Nelore", "Angus", "Brangus", "Girolando", "Guzerá", "Tabapuã", "Senepol", "Cruzado", "Outra"];
const PORTES = ["Pequeno", "Médio", "Grande"];

type AnimalCriado = {
  id: string;
  /** Carimbada pelo servidor a partir do token. É a fonte da verdade sobre a
   *  que fazenda o animal pertence — o app não deve deduzir. */
  fazenda_id: string;
  brinco: string;
  nome: string | null;
  raca: string | null;
  porte: string | null;
  lote_id: string | null;
  status: string;
};

type LoteOpcao = { id: string; nome: string };

function Conteudo() {
  const router = useRouter();
  const parametros = useSearchParams();
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [brinco, setBrinco] = useState(parametros.get("brinco") ?? "");
  // Cadastro já exige internet, então buscar os lotes aqui não tira nada.
  // Animal que nasce sem lote fica fora de toda comparação por grupo até
  // alguém lembrar de encaixá-lo — e ninguém lembra.
  const [lotes, setLotes] = useState<LoteOpcao[]>([]);

  useEffect(() => {
    apiAuth<LoteOpcao[]>("/lotes")
      .then(setLotes)
      .catch(() => setLotes([]));
  }, []);

  async function salvar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);
    setSalvando(true);

    const campos = new FormData(evento.currentTarget);
    const texto = (chave: string) => String(campos.get(chave) || "").trim() || null;

    try {
      const criado = await apiAuth<AnimalCriado>("/animais", {
        method: "POST",
        body: JSON.stringify({
          brinco: brinco.trim(),
          nome: texto("nome"),
          raca: texto("raca"),
          porte: texto("porte"),
          brinco_mae: texto("brinco_mae"),
          lote_id: texto("lote_id"),
          data_nascimento: texto("data_nascimento"),
          peso_nascimento: texto("peso_nascimento"),
          observacoes: texto("observacoes"),
        }),
      });

      // Entra na cópia local na hora: a coleta seguinte já encontra o animal.
      await db.animais.put({
        id: criado.id,
        // Do servidor, não de `fazendaAtiva()`: a cópia local é indexada por
        // (fazenda, brinco), e um palpite errado esconderia o animal recém
        // cadastrado no próprio aparelho, sem erro nenhum.
        fazenda_id: criado.fazenda_id,
        brinco: criado.brinco,
        nome: criado.nome,
        raca: criado.raca,
        porte: criado.porte,
        lote_id: criado.lote_id,
        status: criado.status,
        ultimo_peso: null,
        ultima_pesagem: null,
      });

      router.replace(`/tecnico/coleta?brinco=${encodeURIComponent(criado.brinco)}`);
    } catch (e) {
      setErro(
        e instanceof SemConexao
          ? "Sem sinal. O cadastro precisa de internet — mas você já pode registrar o peso pelo número do brinco."
          : e instanceof ErroApi
            ? e.message
            : "Não foi possível cadastrar",
      );
      setSalvando(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-borda bg-white px-4 py-3">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-verde">
          <Voltar />
          <span className="font-titulo font-extrabold">Cadastrar animal</span>
        </button>
      </header>

      <form onSubmit={salvar} className="flex flex-1 flex-col gap-4 p-5">
        {/* De qual fazenda vai ser este animal — decidido antes de salvar, e
            à vista: sem isto, quem atende duas cadastrava na errada em
            silêncio. */}
        <FazendaDaTarefa
          acao="Cadastrando em"
          temRascunho={brinco.trim() !== ""}
          aviso="Trocar de fazenda limpa o cadastro que você começou. Continuar?"
        />

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Campo
              rotulo="Número do brinco"
              inputMode="numeric"
              value={brinco}
              onChange={(e) => setBrinco(e.target.value)}
              required
            />
          </div>
          <button
            type="button"
            onClick={() => router.push("/tecnico/ler?destino=cadastro")}
            aria-label="Ler brinco por NFC"
            className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-xl bg-verde text-lima"
          >
            <Brinco className="h-6 w-6" />
          </button>
        </div>

        <Campo rotulo="Nome (opcional)" name="nome" placeholder="Ex: Mimosa" />

        <div className="grid grid-cols-2 gap-3">
          <Selecao rotulo="Raça" name="raca" opcoes={RACAS} defaultValue="Nelore" />
          <Selecao rotulo="Porte" name="porte" opcoes={PORTES} defaultValue="Médio" />
        </div>

        {lotes.length > 0 && (
          <Selecao
            rotulo="Lote"
            name="lote_id"
            opcoes={[["", "Sem lote"], ...lotes.map((l) => [l.id, l.nome] as [string, string])]}
          />
        )}

        <Campo rotulo="Brinco da mãe" name="brinco_mae" placeholder="Ex: 0872" inputMode="numeric" />

        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Data de nascimento" name="data_nascimento" type="date" />
          <Campo rotulo="Peso ao nascer (kg)" name="peso_nascimento" inputMode="decimal" />
        </div>

        <AreaDeTexto
          rotulo="Observações"
          name="observacoes"
          placeholder="Observações gerais sobre o animal…"
        />

        {erro && <Aviso tom="erro">{erro}</Aviso>}

        <div className="mt-auto pt-4">
          <Botao
            type="submit"
            variante="destaque"
            carregando={salvando}
            disabled={!brinco.trim()}
          >
            {salvando ? "Cadastrando…" : "Salvar animal"}
          </Botao>
        </div>
      </form>
    </div>
  );
}

export default function NovoAnimal() {
  return (
    <Suspense fallback={null}>
      <Conteudo />
    </Suspense>
  );
}
