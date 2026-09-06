"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AreaDeTexto, Aviso, Campo } from "@/components/ui";
import { apiAuth, ErroApi } from "@/lib/api";

/**
 * Exclusão definitiva — reciclagem de brinco e cadastro errado.
 *
 * **É a única operação sem volta do sistema.** Em todo o resto, "apagar"
 * desativa e o histórico continua consultável; aqui o animal e as pesagens dele
 * somem do banco.
 *
 * Ela existe porque o índice de brinco é único entre os animais **ativos**: uma
 * tag reaproveitada num animal cadastrado por engano deixa dois registros
 * disputando a mesma identidade, e o novo não consegue nascer enquanto o velho
 * estiver lá.
 *
 * Por isso a tela insiste no caminho normal antes de oferecer este: para
 * reaproveitar o brinco de um animal que **existiu de verdade**, o certo é
 * marcá-lo como vendido/morto — o brinco libera do mesmo jeito e o histórico
 * de peso, que é o valor do sistema, permanece. Apagar de vez só faz sentido
 * quando aquele registro nunca deveria ter existido.
 *
 * O brinco digitado é a confirmação: é a diferença entre um clique errado na
 * lista e uma decisão. O servidor exige o mesmo, e registra quem pediu,
 * quantas pesagens foram junto e por quê.
 */
export function ExcluirAnimal({
  animalId,
  brinco,
  pesagens,
}: {
  animalId: string;
  brinco: string;
  /** Quantas pesagens vão junto — o tamanho do estrago, dito antes. */
  pesagens: number;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [confirmacao, setConfirmacao] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [apagando, setApagando] = useState(false);

  async function excluir(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);
    setApagando(true);
    try {
      await apiAuth(`/animais/${animalId}/excluir`, {
        method: "POST",
        body: JSON.stringify({ brinco: confirmacao.trim(), motivo: motivo.trim() || null }),
      });
      // Volta para a lista: a ficha que estava aberta não existe mais.
      router.replace("/dashboard/animais");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível excluir");
      setApagando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="text-sm font-bold text-red-600 underline-offset-4 hover:underline"
      >
        Excluir definitivamente
      </button>
    );
  }

  return (
    <form onSubmit={excluir} className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50/50 p-4">
      <div>
        <h3 className="font-titulo font-extrabold text-red-700">
          Excluir o animal {brinco} para sempre
        </h3>
        <p className="mt-1 text-sm text-verde/70">
          Apaga o cadastro e {pesagens === 1 ? "a pesagem" : `as ${pesagens} pesagens`} dele.{" "}
          <strong>Não tem volta</strong> — nem backup da tela, nem lixeira.
        </p>
      </div>

      <Aviso tom="atencao">
        Se o animal existiu mesmo e você só quer reaproveitar o brinco, feche isto e use{" "}
        <strong>Editar cadastro → Situação: vendido / morto</strong>. O brinco libera igual e o
        histórico de peso fica. Excluir de vez é para o cadastro que nunca deveria ter existido.
      </Aviso>

      <Campo
        rotulo={`Digite ${brinco} para confirmar`}
        value={confirmacao}
        onChange={(e) => setConfirmacao(e.target.value)}
        inputMode="numeric"
        autoComplete="off"
      />

      <AreaDeTexto
        rotulo="Motivo (fica no registro do sistema)"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        rows={2}
        placeholder="Ex: cadastro duplicado, brinco reciclado por engano"
      />

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={apagando || confirmacao.trim() !== brinco}
          className="rounded-xl bg-red-600 px-4 py-2.5 font-titulo text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-40"
        >
          {apagando ? "Excluindo…" : "Excluir para sempre"}
        </button>
        <button
          type="button"
          onClick={() => {
            setAberto(false);
            setConfirmacao("");
            setErro(null);
          }}
          className="rounded-xl border border-borda bg-white px-4 py-2.5 font-titulo text-sm font-bold text-verde"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
