"use client";

import { useEffect, useState } from "react";

import { Celula, Linha, Tabela } from "@/components/tabela";
import { Aviso, Cartao, Chip } from "@/components/ui";
import { apiAuth, ErroApi } from "@/lib/api";
import { data as formatarData } from "@/lib/formato";
import { ROTULO_PAPEL } from "@/lib/sessao-usuario";

type Fazenda = {
  nome: string;
  proprietario: string | null;
  endereco: string | null;
  plano: string;
  criado_em: string;
};

type Membro = {
  id: string;
  nome: string;
  email: string;
  papel: string;
  ativo: boolean;
  admin_master: boolean;
};

export default function Configuracoes() {
  const [fazenda, setFazenda] = useState<Fazenda | null>(null);
  const [membros, setMembros] = useState<Membro[] | null>(null);
  // Gerir membros é área de admin; o cliente lê os dados da fazenda e para por aí.
  const [semPermissao, setSemPermissao] = useState(false);

  useEffect(() => {
    apiAuth<Fazenda>("/fazendas/atual").then(setFazenda).catch(() => setFazenda(null));
    apiAuth<Membro[]>("/membros")
      .then(setMembros)
      .catch((e) => {
        if (e instanceof ErroApi && e.status === 403) setSemPermissao(true);
        setMembros([]);
      });
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-titulo text-2xl font-extrabold text-verde">Configurações</h1>
        <p className="text-sm text-verde/60">Dados da fazenda e quem tem acesso</p>
      </header>

      <Cartao>
        <h2 className="font-titulo font-extrabold text-verde">Fazenda</h2>
        {!fazenda ? (
          <p className="mt-3 text-sm text-verde/55">Carregando…</p>
        ) : (
          <dl className="mt-3 grid gap-4 sm:grid-cols-2">
            {(
              [
                ["Nome", fazenda.nome],
                ["Proprietário", fazenda.proprietario ?? "—"],
                ["Endereço", fazenda.endereco ?? "—"],
                ["Cadastrada em", formatarData(fazenda.criado_em.slice(0, 10))],
              ] as [string, string][]
            ).map(([rotulo, valor]) => (
              <div key={rotulo}>
                <dt className="text-xs font-bold uppercase tracking-wider text-verde/45">
                  {rotulo}
                </dt>
                <dd className="text-sm text-verde">{valor}</dd>
              </div>
            ))}
          </dl>
        )}
      </Cartao>

      <Cartao>
        <h2 className="mb-2 font-titulo font-extrabold text-verde">Quem tem acesso</h2>
        {semPermissao ? (
          <Aviso>Só um administrador da fazenda vê e gerencia os membros.</Aviso>
        ) : !membros ? (
          <p className="text-sm text-verde/55">Carregando…</p>
        ) : (
          <Tabela colunas={["Nome", "E-mail", "Papel", "Situação"]}>
            {membros.map((m) => (
              <Linha key={m.id}>
                <Celula className="font-bold">
                  {m.nome}
                  {m.admin_master && (
                    <span className="ml-2">
                      <Chip tom="lima">master</Chip>
                    </span>
                  )}
                </Celula>
                <Celula className="text-verde/70">{m.email}</Celula>
                <Celula>{ROTULO_PAPEL[m.papel] ?? m.papel}</Celula>
                <Celula>
                  <Chip tom={m.ativo ? "lima" : "claro"}>{m.ativo ? "Ativo" : "Inativo"}</Chip>
                </Celula>
              </Linha>
            ))}
          </Tabela>
        )}
      </Cartao>
    </div>
  );
}
