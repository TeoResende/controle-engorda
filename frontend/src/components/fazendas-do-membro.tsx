"use client";

import { useCallback, useEffect, useState } from "react";

import { Aviso, Botao, Cartao, Chip, Esqueleto } from "@/components/ui";
import { apiAuth, ErroApi } from "@/lib/api";
import { ROTULO_PAPEL } from "@/lib/sessao-usuario";

type Vinculo = {
  fazenda_id: string;
  fazenda_nome: string;
  papel: string;
  ativo: boolean;
};

type Fazenda = { id: string; nome: string; desativado_em: string | null };

const PAPEIS = ["tecnico", "cliente", "admin"] as const;

/**
 * Em que fazendas esta pessoa trabalha.
 *
 * O modelo sempre permitiu que um técnico atendesse várias fazendas e que um
 * cliente fosse dono de mais de uma — o vínculo é por fazenda desde o M1. O que
 * faltava era o caminho: montar esse arranjo exigia entrar em cada fazenda e
 * recadastrar a pessoa, inventando uma senha que o servidor ia ignorar. Dá
 * trabalho o bastante para alguém desistir e criar duas contas para a mesma
 * pessoa — e aí a autoria das pesagens se parte em duas.
 *
 * Só o **admin master** vê este painel: dizer ao admin da fazenda A que fulano
 * também trabalha na fazenda B vazaria a existência de outro cliente.
 */
export function FazendasDoMembro({
  membroId,
  nome,
  aoFechar,
}: {
  membroId: string;
  nome: string;
  aoFechar: () => void;
}) {
  const [vinculos, setVinculos] = useState<Vinculo[] | null>(null);
  const [fazendas, setFazendas] = useState<Fazenda[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [v, f] = await Promise.all([
        apiAuth<Vinculo[]>(`/membros/${membroId}/fazendas`),
        apiAuth<Fazenda[]>("/fazendas"),
      ]);
      setVinculos(v);
      setFazendas(f);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não consegui carregar as fazendas");
      setVinculos([]);
    }
  }, [membroId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function executar(acao: () => Promise<unknown>) {
    setErro(null);
    setOcupado(true);
    try {
      await acao();
      await carregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar");
    } finally {
      setOcupado(false);
    }
  }

  const papelEm = (fazenda_id: string) =>
    vinculos?.find((v) => v.fazenda_id === fazenda_id && v.ativo)?.papel ?? null;

  return (
    <Cartao>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-titulo font-extrabold text-verde">Fazendas de {nome}</h3>
          <p className="mt-0.5 text-sm text-verde/60">
            A mesma conta pode atender várias fazendas, com papel diferente em cada uma.
          </p>
        </div>
        <button
          onClick={aoFechar}
          className="rounded-xl border border-borda px-4 py-2 font-titulo text-sm font-bold text-verde"
        >
          Fechar
        </button>
      </div>

      {erro && (
        <div className="mt-3">
          <Aviso tom="erro">{erro}</Aviso>
        </div>
      )}

      {vinculos === null ? (
        <div className="mt-4 flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Esqueleto key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {fazendas
            .filter((f) => !f.desativado_em)
            .map((f) => {
              const papel = papelEm(f.id);
              return (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-borda px-4 py-3"
                >
                  <span className="min-w-0">
                    <span className="block font-titulo font-bold text-verde">{f.nome}</span>
                    <span className="text-xs text-verde/55">
                      {papel ? `Trabalha aqui como ${ROTULO_PAPEL[papel].toLowerCase()}` : "Sem acesso"}
                    </span>
                  </span>

                  <span className="flex flex-wrap items-center gap-2">
                    <select
                      value={papel ?? "tecnico"}
                      disabled={ocupado}
                      onChange={(e) =>
                        executar(() =>
                          apiAuth(`/membros/${membroId}/fazendas/${f.id}`, {
                            method: "PUT",
                            body: JSON.stringify({ papel: e.target.value }),
                          }),
                        )
                      }
                      className="rounded-lg border border-borda bg-white px-2 py-1.5 text-sm text-verde disabled:opacity-40"
                    >
                      {PAPEIS.map((p) => (
                        <option key={p} value={p}>
                          {ROTULO_PAPEL[p]}
                        </option>
                      ))}
                    </select>

                    {papel ? (
                      <button
                        disabled={ocupado}
                        onClick={() =>
                          executar(() =>
                            apiAuth(`/membros/${membroId}/fazendas/${f.id}`, { method: "DELETE" }),
                          )
                        }
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 disabled:opacity-40"
                      >
                        Tirar acesso
                      </button>
                    ) : (
                      <Botao
                        disabled={ocupado}
                        onClick={() =>
                          executar(() =>
                            apiAuth(`/membros/${membroId}/fazendas/${f.id}`, {
                              method: "PUT",
                              body: JSON.stringify({ papel: "tecnico" }),
                            }),
                          )
                        }
                      >
                        Dar acesso
                      </Botao>
                    )}
                  </span>
                </li>
              );
            })}
        </ul>
      )}

      {vinculos?.some((v) => !v.ativo) && (
        <div className="mt-3">
          <p className="text-xs text-verde/50">
            Já trabalhou em:{" "}
            {vinculos
              .filter((v) => !v.ativo)
              .map((v) => v.fazenda_nome)
              .join(", ")}
            . O registro fica — as pesagens dela continuam apontando para ela.
          </p>
        </div>
      )}

      <div className="mt-3">
        <Chip tom="claro">Só o admin master vê e muda isto</Chip>
      </div>
    </Cartao>
  );
}
