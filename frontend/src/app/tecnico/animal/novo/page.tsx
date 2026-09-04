"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Aviso, Botao, Cabecalho, Campo, LinkBotao } from "@/components/ui";
import { apiAuth, ErroApi, SemConexao } from "@/lib/api";
import { db } from "@/lib/db";

/**
 * Tela 5 — Cadastro de animal.
 *
 * Diferente da pesagem, o cadastro **precisa de internet**: o animal nasce com
 * id do servidor, e criar ids locais para animais abriria a porta para dois
 * cadastros do mesmo bicho vindos de dois aparelhos. A pesagem é o que não pode
 * esperar; o cadastro pode.
 */
type AnimalCriado = { id: string; brinco: string; nome: string | null; raca: string | null; lote_id: string | null; status: string };

function Conteudo() {
  const router = useRouter();
  const parametros = useSearchParams();
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const brincoInicial = parametros.get("brinco") ?? "";

  async function salvar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);
    setSalvando(true);

    const campos = new FormData(evento.currentTarget);
    const brinco = String(campos.get("brinco")).trim();

    try {
      const criado = await apiAuth<AnimalCriado>("/animais", {
        method: "POST",
        body: JSON.stringify({
          brinco,
          nome: String(campos.get("nome") || "") || null,
          raca: String(campos.get("raca") || "") || null,
          peso_nascimento: String(campos.get("peso_nascimento") || "") || null,
        }),
      });

      // Entra na cópia local na hora: a coleta seguinte já encontra o animal.
      await db.animais.put({
        id: criado.id,
        brinco: criado.brinco,
        nome: criado.nome,
        raca: criado.raca,
        lote_id: criado.lote_id,
        status: criado.status,
      });

      router.replace(`/tecnico/coleta?brinco=${encodeURIComponent(criado.brinco)}`);
    } catch (e) {
      setErro(
        e instanceof SemConexao
          ? "Sem sinal. O cadastro de animal precisa de internet — mas você já pode registrar o peso pelo número do brinco."
          : e instanceof ErroApi
            ? e.message
            : "Não foi possível cadastrar",
      );
      setSalvando(false);
    }
  }

  return (
    <main className="flex flex-col gap-6">
      <Cabecalho titulo="Cadastrar animal" subtitulo="Bicho novo no rebanho." />

      <form onSubmit={salvar} className="flex flex-col gap-4">
        <Campo
          rotulo="Brinco"
          name="brinco"
          inputMode="numeric"
          defaultValue={brincoInicial}
          required
        />
        <Campo rotulo="Nome (opcional)" name="nome" />
        <Campo rotulo="Raça (opcional)" name="raca" placeholder="Nelore, Angus…" />
        <Campo
          rotulo="Peso ao nascer (opcional)"
          name="peso_nascimento"
          sufixo="kg"
          inputMode="decimal"
        />
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        <Botao type="submit" variante="destaque" disabled={salvando}>
          {salvando ? "Cadastrando…" : "Cadastrar e pesar"}
        </Botao>
      </form>

      <LinkBotao href="/tecnico" variante="neutra">
        Cancelar
      </LinkBotao>
    </main>
  );
}

export default function NovoAnimal() {
  return (
    <Suspense fallback={null}>
      <Conteudo />
    </Suspense>
  );
}
