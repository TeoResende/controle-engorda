"use client";

import { useEffect } from "react";

import { registrarWorker } from "@/lib/worker";

/** Prepara o aparelho para uso sem internet. Não desenha nada. */
export function RegistrarWorker() {
  useEffect(() => {
    void registrarWorker();
  }, []);
  return null;
}
