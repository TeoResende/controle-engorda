import type { MetadataRoute } from "next";

/**
 * Manifesto do PWA, gerado em vez de servido como arquivo estático.
 *
 * O motivo é o ícone: ele deixou de ser um PNG fixo em `public/` e passou a
 * vir da API (`/sistema/icone`), onde o admin master pode trocá-lo. Um arquivo
 * estático não conseguiria montar esse endereço, que muda com a configuração
 * de `NEXT_PUBLIC_API_URL`.
 *
 * A rota do ícone é pública de propósito: o navegador busca ícone de manifesto
 * sem cabeçalho de autenticação nenhum. E ela nunca responde 404 — sem ícone
 * configurado devolve o que vem com o produto —, então este endereço sempre
 * funciona.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";
const ICONE = `${API}/sistema/icone`;

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Engorda — Coleta de Peso",
    short_name: "Engorda",
    description: "Registro de peso de bezerros no curral, com ou sem internet.",
    start_url: "/tecnico",
    scope: "/tecnico",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F6F7F2",
    theme_color: "#1E4B3B",
    icons: [
      { src: ICONE, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: ICONE, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: ICONE, sizes: "512x512", type: "image/png", purpose: "maskable" },
      // Os PNGs que vêm no build ficam como última linha de defesa: se a API
      // estiver fora do ar na hora de instalar, o app ainda ganha um ícone.
      { src: "/icones/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icones/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
