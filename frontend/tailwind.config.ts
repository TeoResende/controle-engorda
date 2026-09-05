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
        verde: "#1E4B3B",
        lima: "#C6D400",
        fundo: "#F6F7F2",
        // Tons derivados, para não espalhar opacidade mágica pelo código.
        "verde-claro": "#2C6B54",
        borda: "#E4E8DF",
      },
    },
  },
  plugins: [],
};

export default config;
