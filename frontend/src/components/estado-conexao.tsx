"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";

import { db } from "@/lib/db";
import { sincronizar } from "@/lib/sync";

/**
 * Faixa fixa no topo do app do técnico.
 *
 * Estar offline é o estado NORMAL aqui, não uma falha — por isso a faixa informa
 * sem alarmar, e o que realmente importa mostrar é quantas pesagens ainda não
 * subiram: é isso que o técnico não pode perder.
 */
export function EstadoConexao() {
  const [online, setOnline] = useState(true);
  const pendentes = useLiveQuery(() => db.fila.count(), [], 0);

  useEffect(() => {
    const atualizar = () => setOnline(navigator.onLine);
    atualizar();
    window.addEventListener("online", atualizar);
    window.addEventListener("offline", atualizar);
    return () => {
      window.removeEventListener("online", atualizar);
      window.removeEventListener("offline", atualizar);
    };
  }, []);

  // Voltou o sinal: sobe a fila sozinho, sem o técnico precisar pedir.
  useEffect(() => {
    const aoVoltar = () => {
      void sincronizar();
    };
    window.addEventListener("online", aoVoltar);
    return () => window.removeEventListener("online", aoVoltar);
  }, []);

  return (
    <div
      className={`flex items-center justify-between px-4 py-2 text-xs font-bold ${
        online ? "bg-verde text-fundo" : "bg-verde/10 text-verde"
      }`}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={`inline-block h-2 w-2 rounded-full ${online ? "bg-lima" : "bg-verde/40"}`}
        />
        {online ? "Conectado" : "Sem sinal — pode continuar coletando"}
      </span>
      {pendentes > 0 && (
        <span>
          {pendentes} {pendentes === 1 ? "pesagem na fila" : "pesagens na fila"}
        </span>
      )}
    </div>
  );
}
