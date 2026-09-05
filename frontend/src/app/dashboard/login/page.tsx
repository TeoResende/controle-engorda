"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Aviso, Botao, Cabecalho, Campo } from "@/components/ui";
import { api, ErroApi, SemConexao } from "@/lib/api";
import { salvarSessao, type Sessao } from "@/lib/sessao";

type Fazenda = { fazenda_id: string; nome: string; papel: string };

export default function LoginCliente() {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  const [credenciais, setCredenciais] = useState({ email: "", senha: "" });
  const [fazendas, setFazendas] = useState<Fazenda[] | null>(null);

  async function autenticar(email: string, senha: string, fazenda_id?: string) {
    setErro(null);
    setEntrando(true);
    try {
      const sessao = await api<Sessao>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, senha, fazenda_id: fazenda_id ?? null }),
      });
      salvarSessao(sessao);
      router.replace("/dashboard");
    } catch (e) {
      if (e instanceof SemConexao) {
        setErro("Não consegui falar com o servidor. Verifique a conexão.");
      } else if (e instanceof ErroApi && e.status === 409) {
        const detalhe = (e.corpo as { detail?: { fazendas?: Fazenda[] } })?.detail;
        setCredenciais({ email, senha });
        setFazendas(detalhe?.fazendas ?? []);
      } else {
        setErro(e instanceof Error ? e.message : "Não foi possível entrar");
      }
      setEntrando(false);
    }
  }

  if (fazendas) {
    return (
      <main className="flex min-h-screen flex-col justify-center gap-6">
        <Cabecalho titulo="Qual fazenda?" />
        <div className="flex flex-col gap-3">
          {fazendas.map((f) => (
            <Botao
              key={f.fazenda_id}
              variante="destaque"
              disabled={entrando}
              onClick={() => autenticar(credenciais.email, credenciais.senha, f.fazenda_id)}
            >
              {f.nome}
            </Botao>
          ))}
        </div>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6">
      <Cabecalho titulo="Engorda" subtitulo="Acompanhe a evolução do seu rebanho" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const campos = new FormData(e.currentTarget);
          void autenticar(String(campos.get("email")), String(campos.get("senha")));
        }}
        className="flex flex-col gap-4"
      >
        <Campo rotulo="E-mail" name="email" type="email" autoComplete="username" required />
        <Campo rotulo="Senha" name="senha" type="password" autoComplete="current-password" required />
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        <Botao type="submit" variante="destaque" disabled={entrando}>
          {entrando ? "Entrando…" : "Entrar"}
        </Botao>
      </form>
    </main>
  );
}
