"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Aviso, Botao, Cabecalho, Campo } from "@/components/ui";
import { API_URL } from "@/lib/api";
import { salvarSessao, type Sessao } from "@/lib/sessao";
import { baixarRebanho } from "@/lib/sync";

type Fazenda = { fazenda_id: string; nome: string; papel: string };

export default function Login() {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  const [credenciais, setCredenciais] = useState({ email: "", senha: "" });
  // Técnico que atende mais de uma fazenda escolhe em qual vai operar: o login
  // devolve 409 com a lista em vez de adivinhar.
  const [fazendas, setFazendas] = useState<Fazenda[] | null>(null);

  async function autenticar(email: string, senha: string, fazenda_id?: string) {
    setErro(null);
    setEntrando(true);
    try {
      const resposta = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha, fazenda_id: fazenda_id ?? null }),
      });
      const dados = await resposta.json();

      if (resposta.status === 409) {
        setCredenciais({ email, senha });
        setFazendas(dados.detail.fazendas as Fazenda[]);
        setEntrando(false);
        return;
      }
      if (!resposta.ok) {
        setErro(typeof dados.detail === "string" ? dados.detail : "Não foi possível entrar");
        setEntrando(false);
        return;
      }

      salvarSessao(dados as Sessao);
      // Baixa o rebanho antes de soltar o técnico no curral: sem essa cópia, a
      // coleta offline não sabe de que animal é o brinco.
      try {
        await baixarRebanho();
      } catch {
        // Rebanho é conveniência; a coleta por brinco funciona mesmo sem ele.
      }
      router.replace("/tecnico");
    } catch {
      setErro("Sem conexão. O primeiro acesso precisa de internet.");
      setEntrando(false);
    }
  }

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const campos = new FormData(evento.currentTarget);
    void autenticar(String(campos.get("email")), String(campos.get("senha")));
  }

  if (fazendas) {
    return (
      <main className="flex min-h-screen flex-col justify-center gap-6 p-5">
        <Cabecalho titulo="Qual fazenda?" subtitulo="Você atende mais de uma." />
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
    <main className="flex min-h-screen flex-col justify-center gap-6 p-5">
      <Cabecalho titulo="Engorda" subtitulo="Entre para começar a coletar" />
      <form onSubmit={enviar} className="flex flex-col gap-4">
        <Campo rotulo="E-mail" name="email" type="email" autoComplete="username" required />
        <Campo
          rotulo="Senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
        />
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        <Botao type="submit" variante="destaque" disabled={entrando}>
          {entrando ? "Entrando…" : "Entrar"}
        </Botao>
      </form>
    </main>
  );
}
