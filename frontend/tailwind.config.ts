import type { Config } from "tailwindcss";

// Paleta de referência (Coopervass) — ver CLAUDE.md seção 7.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        verde: "#1E4B3B",
        lima: "#C6D400",
        fundo: "#F6F7F2",
      },
      fontFamily: {
        titulo: ["Manrope", "system-ui", "sans-serif"],
        corpo: ["'Public Sans'", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
