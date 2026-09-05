"use client";

import { useEffect, useState } from "react";

import { Aviso, Botao, Campo, Cartao, Selecao } from "@/components/ui";
import { apiAuth, ErroApi } from "@/lib/api";

const RACAS = ["Nelore", "Angus", "Brangus", "Girolando", "Guzerá", "Tabapuã", "Senepol", "Cruzado", "Outra"];
const PORTES = ["Pequeno", "Médio", "Grande"];
const SITUACOES: [string, string][] = [
  ["ativo", "Ativo no rebanho"],
  ["vendido", "Vendido"],
  ["morto", "Morto"],
  ["transferido", "Transferido"],
];

type Animal = {
  brinco: string;
  nome: string | null;
  raca: string | null;
  porte: string | null;
  brinco_mae: string | null;
  data_nascimento: string | null;
  peso_nascimento: string | null;
  observacoes: string | null;
  lote_id: string | null;
  status: string;
};

/**
 * Edição do cadastro do animal.
 *
 * `status` fica aqui, e não num botão de "remover": tirar do rebanho é dizer o
 * **motivo** — vendido, morto, transferido —, e essa informação vale para o
 * negócio. As pesagens permanecem em qualquer caso.
 */
export function EditarAnimal({
  animalId,
  animal,
  aoSalvar,
}: {
  animalId: string;
  animal: Animal;
  aoSalvar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [lotes, setLotes] = useState<{ id: string; nome: string }[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    apiAuth<{ id: string; nome: string }[]>("/lotes").then(setLotes).catch(() => setLotes([]));
  }, [aberto]);

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);
    setSalvando(true);

    const campos = new FormData(evento.currentTarget);
    const texto = (chave: string) => String(campos.get(chave) || "").trim() || null;

    try {
      await apiAuth(`/animais/${animalId}`, {
        method: "PATCH",
        body: JSON.stringify({
          brinco: String(campos.get("brinco")).trim(),
          nome: texto("nome"),
          raca: texto("raca"),
          porte: texto("porte"),
          brinco_mae: texto("brinco_mae"),
          data_nascimento: texto("data_nascimento"),
          peso_nascimento: texto("peso_nascimento"),
          observacoes: texto("observacoes"),
          lote_id: texto("lote_id"),
          status: String(campos.get("status")),
        }),
      });
      setAberto(false);
      aoSalvar();
    } catch (e) {
      setErro(
        e instanceof ErroApi && e.status === 409
          ? "Já existe outro animal ativo com este brinco nesta fazenda."
          : e instanceof Error
            ? e.message
            : "Não foi possível salvar",
      );
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="rounded-xl border border-borda bg-white px-4 py-2.5 font-titulo text-sm font-bold text-verde transition hover:border-verde/40"
      >
        Editar cadastro
      </button>
    );
  }

  return (
    <Cartao className="w-full">
      <h2 className="font-titulo font-extrabold text-verde">Editar cadastro</h2>
      <form onSubmit={enviar} className="mt-4 grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Brinco" name="brinco" defaultValue={animal.brinco} required />
        <Campo rotulo="Nome" name="nome" defaultValue={animal.nome ?? ""} />
        <Selecao rotulo="Raça" name="raca" opcoes={["", ...RACAS]} defaultValue={animal.raca ?? ""} />
        <Selecao rotulo="Porte" name="porte" opcoes={["", ...PORTES]} defaultValue={animal.porte ?? ""} />
        <Campo rotulo="Brinco da mãe" name="brinco_mae" defaultValue={animal.brinco_mae ?? ""} />
        <Selecao
          rotulo="Lote"
          name="lote_id"
          opcoes={[["", "Sem lote"], ...lotes.map((l) => [l.id, l.nome] as [string, string])]}
          defaultValue={animal.lote_id ?? ""}
        />
        <Campo
          rotulo="Data de nascimento"
          name="data_nascimento"
          type="date"
          defaultValue={animal.data_nascimento ?? ""}
        />
        <Campo
          rotulo="Peso ao nascer (kg)"
          name="peso_nascimento"
          inputMode="decimal"
          defaultValue={animal.peso_nascimento ?? ""}
        />
        <Selecao
          rotulo="Situação no rebanho"
          name="status"
          opcoes={SITUACOES}
          defaultValue={animal.status}
        />
        <Campo rotulo="Observações" name="observacoes" defaultValue={animal.observacoes ?? ""} />

        {erro && (
          <div className="sm:col-span-2">
            <Aviso tom="erro">{erro}</Aviso>
          </div>
        )}

        <div className="flex gap-2 sm:col-span-2">
          <Botao type="submit" variante="destaque" carregando={salvando}>
            Salvar
          </Botao>
          <Botao type="button" variante="neutra" onClick={() => setAberto(false)}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Cartao>
  );
}
