import { apiAuth } from "./api";
import { gravarMeta, lerMeta } from "./db";

/**
 * Nome do usuário e da fazenda, para o cabeçalho.
 *
 * Guardado no IndexedDB porque o cabeçalho aparece em toda tela do técnico,
 * inclusive offline — buscar na API a cada abertura deixaria o topo vazio
 * justamente no curral.
 */
export type Identidade = { nome: string; papel: string; fazenda: string };

const CHAVE = "identidade";

export async function identidadeGuardada(): Promise<Identidade | undefined> {
  return lerMeta<Identidade>(CHAVE);
}

export async function baixarIdentidade(): Promise<Identidade | undefined> {
  type Eu = {
    usuario: { nome: string };
    papel: string;
    fazenda_id: string;
    fazendas: { fazenda_id: string; nome: string }[];
  };
  try {
    const eu = await apiAuth<Eu>("/auth/eu");
    const fazenda = eu.fazendas.find((f) => f.fazenda_id === eu.fazenda_id);
    const identidade: Identidade = {
      nome: eu.usuario.nome,
      papel: eu.papel,
      fazenda: fazenda?.nome ?? "",
    };
    await gravarMeta(CHAVE, identidade);
    return identidade;
  } catch {
    return lerMeta<Identidade>(CHAVE);
  }
}

export const ROTULO_PAPEL: Record<string, string> = {
  tecnico: "Técnico de campo",
  cliente: "Cliente",
  admin: "Administrador",
};
