"use client";

import { useEffect, useRef, useState } from "react";

import { Aviso, Cartao } from "@/components/ui";
import { API_URL, apiAuth, ErroApi } from "@/lib/api";
import { lerSessao } from "@/lib/sessao";

type Sistema = { tem_icone: boolean; versao_do_icone: number };

/**
 * Ícone do aplicativo — do produto, não da fazenda.
 *
 * É a diferença que confunde: a **logo** (`IdentidadeVisual`) identifica o
 * cliente dentro do sistema e cada fazenda tem a sua; o **ícone** é o que o
 * navegador põe na aba e o Android grava na tela inicial. O manifesto do PWA é
 * do domínio, então ele é um só para a instalação inteira — por isso quem mexe
 * aqui é o admin master, e a seção nem aparece para os demais.
 *
 * A imagem vem por endereço direto, e não como blob: a rota `/sistema/icone` é
 * pública justamente porque favicon e ícone de manifesto são buscados pelo
 * navegador sem cabeçalho de autenticação nenhum.
 */
export function IconeDoSistema() {
  const [sistema, setSistema] = useState<Sistema | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);

  const sessao = lerSessao();

  useEffect(() => {
    if (!sessao?.admin_master) return;
    apiAuth<Sistema>("/sistema")
      .then(setSistema)
      .catch(() => setSistema(null));
    // A sessão vem do localStorage e não muda entre renderizações.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!sessao?.admin_master || !sistema) return null;

  async function executar(acao: () => Promise<Sistema>, mensagem: string) {
    setErro(null);
    setOk(null);
    setOcupado(true);
    try {
      setSistema(await acao());
      setOk(mensagem);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar");
    } finally {
      setOcupado(false);
    }
  }

  async function enviar(evento: React.ChangeEvent<HTMLInputElement>) {
    const escolhido = evento.target.files?.[0];
    if (!escolhido) return;
    const formulario = new FormData();
    formulario.append("arquivo", escolhido);
    await executar(
      () => apiAuth<Sistema>("/sistema/icone", { method: "POST", body: formulario, headers: {} }),
      "Ícone atualizado. A aba e o app instalado trocam em alguns minutos.",
    );
    if (arquivo.current) arquivo.current.value = "";
  }

  // A versão no endereço é o que faz o navegador buscar de novo em vez de
  // mostrar o antigo do cache.
  const endereco = `${API_URL}/sistema/icone?v=${sistema.versao_do_icone}`;

  return (
    <Cartao>
      <h2 className="font-titulo font-extrabold text-verde">Ícone do aplicativo</h2>
      <p className="mt-0.5 text-sm text-verde/60">
        Vale para o sistema inteiro, todas as fazendas: é o ícone da aba do navegador e o
        que fica na tela inicial de quem instala o app.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-borda bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={endereco} alt="Ícone do aplicativo" className="max-h-full max-w-full object-contain" />
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            ref={arquivo}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={enviar}
            className="hidden"
            id="arquivo-icone"
            disabled={ocupado}
          />
          <label
            htmlFor="arquivo-icone"
            className="cursor-pointer rounded-xl border border-borda bg-white px-4 py-2.5 text-sm font-bold text-verde transition hover:bg-verde/5"
          >
            {sistema.tem_icone ? "Trocar ícone" : "Enviar ícone"}
          </label>
          {sistema.tem_icone && (
            <button
              onClick={() =>
                executar(
                  () => apiAuth<Sistema>("/sistema/icone", { method: "DELETE" }),
                  "Voltou ao ícone que vem com o sistema.",
                )
              }
              disabled={ocupado}
              className="rounded-xl border border-red-200 px-4 py-2.5 text-sm font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
            >
              Remover
            </button>
          )}
        </div>
      </div>

      <p className="mt-2 text-xs text-verde/45">
        PNG, JPG, WEBP ou SVG até 512 KB. Quadrado e com 512×512 pixels fica melhor: é
        desse tamanho que o Android tira todas as versões do ícone.
      </p>

      {erro && (
        <div className="mt-3">
          <Aviso tom="erro">{erro}</Aviso>
        </div>
      )}
      {ok && (
        <div className="mt-3">
          <Aviso tom="sucesso">{ok}</Aviso>
        </div>
      )}
    </Cartao>
  );
}
