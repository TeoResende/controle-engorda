import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Engorda — Acompanhamento de Peso",
  description: "Acompanhamento da evolução de peso de bezerros em engorda.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Engorda", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#1E4B3B",
  // O app é operado com uma mão, no curral: zoom acidental atrapalha mais do
  // que ajuda, e os alvos de toque já são grandes.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
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
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="font-corpo antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
