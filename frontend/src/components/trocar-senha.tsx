"use client";

import { useState } from "react";

import { Aviso, Botao, Campo, Cartao } from "@/components/ui";
import { apiAuth, ErroApi } from "@/lib/api";

/**
 * Troca da própria senha.
 *
 * Sem isto, quem entra com a senha que o administrador digitou nunca pode
 * trocá-la — e a senha de quem saiu da fazenda continua valendo.
 */
export function TrocarSenha() {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [salvando, setSalvando] = useState(false);

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);
    setOk(false);

    const campos = new FormData(evento.currentTarget);
    const nova = String(campos.get("senha_nova"));
    if (nova !== String(campos.get("confirmacao"))) {
      // Conferência no cliente: digitar errado duas vezes seguidas é raro, e o
      // custo de descobrir só no próximo login é ficar de fora.
      setErro("A confirmação não confere com a nova senha.");
      return;
    }

    const formulario = evento.currentTarget;
    setSalvando(true);
    try {
      await apiAuth("/auth/senha", {
        method: "POST",
        body: JSON.stringify({
          senha_atual: String(campos.get("senha_atual")),
          senha_nova: nova,
        }),
      });
      formulario.reset();
      setOk(true);
      setAberto(false);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível trocar a senha");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-titulo font-extrabold text-verde">Sua senha</h2>
          <p className="text-sm text-verde/60">
            Troque sempre que alguém mais souber a atual.
          </p>
        </div>
        <button
          onClick={() => {
            setAberto((v) => !v);
            setOk(false);
            setErro(null);
          }}
          className="rounded-xl border border-borda px-4 py-2.5 font-titulo text-sm font-bold text-verde"
        >
          {aberto ? "Cancelar" : "Trocar senha"}
        </button>
      </div>

      {ok && (
        <div className="mt-3">
          <Aviso tom="sucesso">
            Senha trocada. Use a nova no próximo acesso — você não precisa entrar
            de novo agora.
          </Aviso>
        </div>
      )}

      {aberto && (
        <form onSubmit={enviar} className="mt-4 grid gap-3 sm:grid-cols-3">
          <Campo
            rotulo="Senha atual"
            name="senha_atual"
            type="password"
            autoComplete="current-password"
            required
          />
          <Campo
            rotulo="Nova senha"
            name="senha_nova"
            type="password"
            autoComplete="new-password"
            minLength={8}
            dica="Mínimo de 8 caracteres"
            required
          />
          <Campo
            rotulo="Repita a nova senha"
            name="confirmacao"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          {erro && (
            <div className="sm:col-span-3">
              <Aviso tom="erro">{erro}</Aviso>
            </div>
          )}
          <div className="sm:col-span-3">
            <Botao type="submit" variante="destaque" carregando={salvando}>
              Salvar nova senha
            </Botao>
          </div>
        </form>
      )}
    </Cartao>
  );
}
