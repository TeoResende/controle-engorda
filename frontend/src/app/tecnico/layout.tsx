"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AvisoInseguro } from "@/components/aviso-inseguro";
import { BarraSuperior, NavegacaoInferior } from "@/components/barra-tecnico";
import { LinkBotao } from "@/components/ui";
import { lerSessao } from "@/lib/sessao";
import { registrarWorker } from "@/lib/worker";
import {
  baixarIdentidade,
  identidadeGuardada,
  type Identidade,
} from "@/lib/sessao-usuario";
import { sincronizarTudo } from "@/lib/sync";

const PUBLICAS = ["/tecnico/login", "/tecnico/offline"];
/** Telas de tarefa: cabeçalho próprio, sem barra nem abas atrapalhando. */
const SEM_MOLDURA = ["/tecnico/coleta", "/tecnico/animal/novo", "/tecnico/gravar"];

export default function LayoutTecnico({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const caminho = usePathname();
  const [pronto, setPronto] = useState(false);
  const [semPermissao, setSemPermissao] = useState(false);
  const [identidade, setIdentidade] = useState<Identidade | null>(null);

  // Service Worker: é o que faz o app ABRIR sem sinal. Escopo na raiz, mas só
  // serve /tecnico do cache — o dashboard do cliente passa direto para a rede.
  useEffect(() => {
    void registrarWorker();
  }, []);

  useEffect(() => {
    if (PUBLICAS.includes(caminho)) {
      setPronto(true);
      return;
    }
    const sessao = lerSessao();
    if (!sessao) {
      router.replace("/tecnico/login");
      return;
    }

    // Cliente é somente leitura: o servidor recusaria a pesagem com 403. Deixar
    // ele coletar guardaria no aparelho um peso que nunca poderia subir — falha
    // que parece ter dado certo e só quebra depois, dentro da fila.
    if (sessao.papel === "cliente" && !sessao.admin_master) {
      setSemPermissao(true);
      setPronto(true);
      return;
    }

    setPronto(true);
    // Mostra o que está guardado na hora e atualiza em segundo plano.
    void identidadeGuardada().then((i) => i && setIdentidade(i));
    void baixarIdentidade().then((i) => i && setIdentidade(i));
    void sincronizarTudo();
  }, [caminho, router]);

  if (!pronto) return null;

  if (semPermissao) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-5 p-5">
        <div>
          <h1 className="font-titulo text-2xl font-extrabold text-verde">
            Esta área é da equipe de campo
          </h1>
          <p className="mt-2 text-sm text-verde/70">
            Sua conta é de cliente e acompanha o rebanho, mas não registra
            pesagem. Peça a um administrador da fazenda para mudar seu papel se
            você também for a campo.
          </p>
        </div>
        <LinkBotao href="/dashboard" variante="destaque">
          Ir para o acompanhamento
        </LinkBotao>
        <LinkBotao href="/tecnico/login" variante="neutra">
          Entrar com outra conta
        </LinkBotao>
      </main>
    );
  }

  if (PUBLICAS.includes(caminho)) {
    return (
      <div className="mx-auto w-full max-w-md p-5">
        <AvisoInseguro />
        {children}
      </div>
    );
  }

  const semMoldura = SEM_MOLDURA.some((r) => caminho.startsWith(r));

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-fundo">
      <AvisoInseguro />
      {!semMoldura && <BarraSuperior fazenda={identidade?.fazenda ?? "…"} />}
      <div className="flex-1">{children}</div>
      {!semMoldura && <NavegacaoInferior />}
    </div>
  );
}
