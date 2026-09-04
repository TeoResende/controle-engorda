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
    <html lang="pt-BR">
      <body className="font-corpo antialiased">{children}</body>
    </html>
  );
}
