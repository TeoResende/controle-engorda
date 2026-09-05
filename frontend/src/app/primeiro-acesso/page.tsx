"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api, SemConexao } from "@/lib/api";
import { salvarSessao, type Sessao } from "@/lib/sessao";

type SetupStatus = { precisa_configuracao: boolean };

export default function PrimeiroAcesso() {
  const router = useRouter();
  const [liberado, setLiberado] = useState<boolean | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Quem chega aqui num sistema já configurado é devolvido: esta tela existe
  // uma única vez na vida da instalação.
  useEffect(() => {
    api<SetupStatus>("/setup/status")
      .then(({ precisa_configuracao }) => {
        setLiberado(precisa_configuracao);
        if (!precisa_configuracao) router.replace("/");
      })
      .catch(() => setLiberado(false));
  }, [router]);

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);

    const campos = new FormData(evento.currentTarget);
    try {
      const sessao = await api<Sessao>("/setup/primeiro-acesso", {
        method: "POST",
        body: JSON.stringify({
          nome: campos.get("nome"),
          email: campos.get("email"),
          senha: campos.get("senha"),
          nome_fazenda: campos.get("nome_fazenda"),
        }),
      });
      // O endpoint já devolve a sessão pronta: não faz sentido pedir para a
      // pessoa logar com a senha que acabou de digitar.
      salvarSessao(sessao);
      // Raiz e não dashboard: o primeiro usuário é admin master e pode querer
      // tanto a área do cliente quanto a coleta.
      router.replace("/");
    } catch (e) {
      setErro(
        e instanceof SemConexao
          ? "Não consegui falar com o servidor. Verifique se a API está no ar."
          : e instanceof Error
            ? e.message
            : "Não foi possível concluir",
      );
      setEnviando(false);
    }
  }

  if (liberado === null) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-verde/60">Carregando…</p>
      </main>
    );
  }
  if (!liberado) return null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="font-titulo text-3xl font-extrabold text-verde">
          Primeiro acesso
        </h1>
        <p className="mt-2 text-sm text-verde/70">
          Ninguém está cadastrado ainda. Crie o administrador do sistema e a
          primeira fazenda.
        </p>
      </div>

      <form onSubmit={enviar} className="flex flex-col gap-4">
        <Campo nome="nome" rotulo="Seu nome" autoComplete="name" />
        <Campo nome="email" rotulo="E-mail" tipo="email" autoComplete="email" />
        <Campo
          nome="senha"
          rotulo="Senha"
          tipo="password"
          autoComplete="new-password"
          dica="Mínimo de 8 caracteres"
          minLength={8}
        />
        <Campo nome="nome_fazenda" rotulo="Nome da fazenda" />

        {erro && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {erro}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando}
          className="rounded-xl bg-lima px-5 py-4 font-titulo font-bold text-verde disabled:opacity-60"
        >
          {enviando ? "Criando…" : "Criar e entrar"}
        </button>
      </form>
    </main>
  );
}

function Campo({
  nome,
  rotulo,
  tipo = "text",
  dica,
  ...resto
}: {
  nome: string;
  rotulo: string;
  tipo?: string;
  dica?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-titulo text-sm font-bold text-verde">{rotulo}</span>
      <input
        name={nome}
        type={tipo}
        required
        className="rounded-lg border border-verde/20 bg-white px-4 py-3 text-verde outline-none focus:border-verde"
        {...resto}
      />
      {dica && <span className="text-xs text-verde/50">{dica}</span>}
    </label>
  );
}
