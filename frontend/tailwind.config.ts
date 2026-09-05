import type { Config } from "tailwindcss";

// Paleta de referência (Coopervass) — ver CLAUDE.md seção 7.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // As variáveis vêm do next/font (app/layout.tsx). A pilha de reserva
        // existe para o primeiro paint e para quando a fonte não carrega.
        titulo: ["var(--fonte-titulo)", "system-ui", "sans-serif"],
        corpo: ["var(--fonte-corpo)", "system-ui", "sans-serif"],
      },
      colors: {
        // `<alpha-value>` é o que permite `text-verde/70` continuar funcionando
        // com a cor vinda de variável CSS — por isso os canais separados em
        // globals.css, e não hex.
        verde: "rgb(var(--cor-verde) / <alpha-value>)",
        "verde-claro": "rgb(var(--cor-verde-claro) / <alpha-value>)",
        lima: "rgb(var(--cor-lima) / <alpha-value>)",
        fundo: "rgb(var(--cor-fundo) / <alpha-value>)",
        borda: "rgb(var(--cor-borda) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};

export default config;
