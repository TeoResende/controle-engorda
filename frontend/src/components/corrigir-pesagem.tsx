"use client";

import { useState } from "react";

import { Aviso, Botao, Campo } from "@/components/ui";
import { apiAuth, ErroApi } from "@/lib/api";
import { hojeLocal } from "@/lib/formato";

/**
 * Correção e retirada de uma pesagem.
 *
 * Retirar **desativa**, não apaga: peso é o produto do sistema, e uma leitura
 * errada precisa continuar auditável depois de tirada da série. Corrigir edita
 * a mesma pesagem — mandar outra com id novo viraria um segundo ponto na curva
 * do animal, e ninguém saberia qual vale.
 */
export function CorrigirPesagem({
  pesagemId,
  peso,
  data,
  aoMudar,
}: {
  pesagemId: string;
  peso: string;
  data: string;
  aoMudar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function executar(acao: () => Promise<unknown>) {
    setErro(null);
    setOcupado(true);
    try {
      await acao();
      setAberto(false);
      aoMudar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível concluir");
    } finally {
      setOcupado(false);
    }
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="text-sm font-bold text-verde/70 transition hover:text-verde"
      >
        Corrigir
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-verde/4 p-3 text-left">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const campos = new FormData(e.currentTarget);
          void executar(() =>
            apiAuth(`/pesagens/${pesagemId}`, {
              method: "PATCH",
              body: JSON.stringify({
                peso_kg: String(campos.get("peso_kg")).replace(",", "."),
                data: String(campos.get("data")),
                observacao_texto: String(campos.get("observacao") || "") || null,
              }),
            }),
          );
        }}
        className="flex flex-col gap-2"
      >
        <Campo rotulo="Peso (kg)" name="peso_kg" inputMode="decimal" defaultValue={peso} required />
        <Campo rotulo="Data" name="data" type="date" defaultValue={data} max={hojeLocal()} />
        <Campo rotulo="Observação" name="observacao" />
        <div className="flex flex-wrap gap-2">
          <Botao type="submit" variante="destaque" carregando={ocupado}>
            Salvar correção
          </Botao>
          <Botao type="button" variante="neutra" onClick={() => setAberto(false)}>
            Cancelar
          </Botao>
        </div>
      </form>

      <button
        onClick={() => {
          if (!window.confirm("Tirar esta pesagem da série do animal?\n\nEla não é apagada — sai das médias e do gráfico, e continua consultável.")) return;
          void executar(() => apiAuth(`/pesagens/${pesagemId}`, { method: "DELETE" }));
        }}
        disabled={ocupado}
        className="self-start text-sm font-bold text-red-600 disabled:opacity-40"
      >
        Tirar da série
      </button>

      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </div>
  );
}
