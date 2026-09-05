"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Aviso, Botao, Cabecalho, Campo } from "@/components/ui";
import { api, ErroApi, SemConexao } from "@/lib/api";
import { precisaConfiguracao } from "@/lib/instalacao";
import { salvarSessao, type Sessao } from "@/lib/sessao";
import { baixarRebanho, baixarSessoes } from "@/lib/sync";

type Fazenda = { fazenda_id: string; nome: string; papel: string };

export default function Login() {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  const [credenciais, setCredenciais] = useState({ email: "", senha: "" });
  // Técnico que atende mais de uma fazenda escolhe em qual vai operar: o login
  // devolve 409 com a lista em vez de adivinhar.
  const [fazendas, setFazendas] = useState<Fazenda[] | null>(null);

  // Instalação sem nenhum usuário: manda criar o primeiro administrador. Sem
  // isto, esta tela seria um beco sem saída num sistema recém-subido.
  useEffect(() => {
    precisaConfiguracao().then((precisa) => {
      if (precisa) router.replace("/primeiro-acesso");
    });
  }, [router]);

  async function autenticar(email: string, senha: string, fazenda_id?: string) {
    setErro(null);
    setEntrando(true);
    try {
      const sessao = await api<Sessao>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, senha, fazenda_id: fazenda_id ?? null }),
      });
      salvarSessao(sessao);
      // Baixa as sessões de todas as fazendas e o rebanho de cada uma, antes de
      // soltar o técnico no curral: é o que permite trocar de fazenda e resolver
      // o brinco sem sinal.
      try {
        await baixarSessoes();
        await baixarRebanho();
      } catch {
        // Cópia local é conveniência; a coleta por brinco funciona mesmo sem ela.
      }
      router.replace("/tecnico");
    } catch (e) {
      if (e instanceof SemConexao) {
        setErro("Sem conexão. O primeiro acesso precisa de internet.");
      } else if (e instanceof ErroApi && e.status === 409) {
        // O 409 traz a lista de fazendas de quem atende mais de uma.
        const detalhe = (e.corpo as { detail?: { fazendas?: Fazenda[] } })?.detail;
        setCredenciais({ email, senha });
        setFazendas(detalhe?.fazendas ?? []);
      } else {
        setErro(e instanceof Error ? e.message : "Não foi possível entrar");
      }
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
