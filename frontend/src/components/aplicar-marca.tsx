"use client";

import { useEffect } from "react";

import { aplicarMarca, baixarMarca, marcaGuardada } from "@/lib/marca";

/**
 * Pinta a tela com a marca da fazenda. Não desenha nada.
 *
 * Aplica primeiro o que está guardado no aparelho e depois atualiza da API: sem
 * isso, o app do técnico abriria com as cores padrão e trocaria de tema no meio
 * do carregamento — e offline nunca chegaria à marca certa.
 */
export function AplicarMarca() {
  useEffect(() => {
    void marcaGuardada().then((m) => m && aplicarMarca(m));
    void baixarMarca().then((m) => m && aplicarMarca(m));
  }, []);
  return null;
}
