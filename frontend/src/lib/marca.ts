import { apiAuth } from "./api";
import { gravarMeta, lerMeta } from "./db";

/**
 * Identidade visual da fazenda.
 *
 * As cores viram variáveis CSS na raiz do documento, e o Tailwind lê dali —
 * por isso a paleta está em canais RGB, e não em hex: sem os canais separados,
 * `text-verde/70` (usado em dezenas de telas) pararia de funcionar.
 */
export type Marca = {
  cor_primaria: string | null;
  cor_destaque: string | null;
  cor_fundo: string | null;
  tem_logo: boolean;
  nome: string;
};

const PADRAO = {
  "--cor-verde": "30 75 59",
  "--cor-verde-claro": "44 107 84",
  "--cor-lima": "198 212 0",
  "--cor-fundo": "246 247 242",
  "--cor-borda": "228 232 223",
};

/** `#1E4B3B` → `30 75 59`. Devolve nulo para entrada inválida. */
export function hexParaCanais(hex: string | null | undefined): string | null {
  if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return null;
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

export function canaisParaHex(canais: string): string {
  const [r, g, b] = canais.split(" ").map(Number);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/**
 * Aproxima a cor do branco (`quanto` positivo) ou do preto (negativo).
 *
 * Serve para derivar tons que precisam acompanhar a marca — o hover do botão e
 * a cor da borda — sem obrigar quem configura a escolher cinco cores.
 */
function ajustar(canais: string, quanto: number): string {
  const alvo = quanto >= 0 ? 255 : 0;
  const forca = Math.abs(quanto);
  return canais
    .split(" ")
    .map((c) => Math.round(Number(c) + (alvo - Number(c)) * forca))
    .join(" ");
}

export function aplicarMarca(marca: Partial<Marca> | null): void {
  if (typeof document === "undefined") return;
  const raiz = document.documentElement;

  // Sempre parte do padrão: sem isso, tirar uma cor personalizada deixaria a
  // anterior grudada até recarregar a página.
  for (const [variavel, valor] of Object.entries(PADRAO)) {
    raiz.style.setProperty(variavel, valor);
  }
  if (!marca) return;

  const primaria = hexParaCanais(marca.cor_primaria);
  if (primaria) {
    raiz.style.setProperty("--cor-verde", primaria);
    raiz.style.setProperty("--cor-verde-claro", ajustar(primaria, 0.18));
  }

  const destaque = hexParaCanais(marca.cor_destaque);
  if (destaque) raiz.style.setProperty("--cor-lima", destaque);

  const fundo = hexParaCanais(marca.cor_fundo);
  if (fundo) {
    raiz.style.setProperty("--cor-fundo", fundo);
    // A borda acompanha o fundo: uma borda clara sobre fundo escuro some, e
    // deixar a padrão faria a tela parecer montada com peças de temas
    // diferentes.
    raiz.style.setProperty("--cor-borda", ajustar(fundo, -0.08));
  }
}

const CHAVE = "marca";

/** Marca guardada no aparelho — o app do técnico precisa dela offline. */
export async function marcaGuardada(): Promise<Marca | undefined> {
  return lerMeta<Marca>(CHAVE);
}

export async function baixarMarca(): Promise<Marca | undefined> {
  try {
    const fazenda = await apiAuth<Marca>("/fazendas/atual");
    const marca: Marca = {
      nome: fazenda.nome,
      cor_primaria: fazenda.cor_primaria,
      cor_destaque: fazenda.cor_destaque,
      cor_fundo: fazenda.cor_fundo,
      tem_logo: fazenda.tem_logo,
    };
    await gravarMeta(CHAVE, marca);
    return marca;
  } catch {
    return lerMeta<Marca>(CHAVE);
  }
}
