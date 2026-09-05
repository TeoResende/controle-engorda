import type { Metadata, Viewport } from "next";
import { Manrope, Public_Sans } from "next/font/google";

import "./globals.css";

/**
 * As fontes do layout aprovado. Carregadas pelo `next/font`, que as hospeda no
 * próprio domínio: sem requisição a terceiro, sem salto de fonte na abertura, e
 * — o que importa aqui — funcionam offline no PWA do técnico, ao contrário de um
 * <link> para o Google Fonts.
 */
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--fonte-titulo",
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--fonte-corpo",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Engorda — Acompanhamento de Peso",
    template: "%s · Engorda",
  },
  description: "Acompanhamento da evolução de peso de bezerros em engorda.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Engorda", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#1E4B3B",
  width: "device-width",
  initialScale: 1,
  // Sem trava de zoom: o técnico pode estar de óculos sujo, e impedir ampliar é
  // uma barreira de acessibilidade que não se paga.
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning aqui é sobre extensões do navegador, não sobre
    // erro nosso: LanguageTool, Grammarly e afins injetam atributos em <html> e
    // <body> antes do React hidratar (`data-lt-installed`, `data-new-gr-...`),
    // e o React reclama de uma diferença que não veio do nosso código. O efeito
    // é limitado a estes dois elementos — mismatch de verdade, dentro da
    // árvore, continua sendo reportado.
    <html
      lang="pt-BR"
      className={`${manrope.variable} ${publicSans.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-fundo font-corpo text-verde antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
