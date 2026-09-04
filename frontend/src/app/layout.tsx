import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Engorda — Acompanhamento de Peso",
  description: "Acompanhamento da evolução de peso de bezerros em engorda.",
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
