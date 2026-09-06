"use client";

import { useEffect, useRef, useState } from "react";

import { LogoFazenda } from "@/components/logo-fazenda";
import { Aviso, Cartao } from "@/components/ui";
import { apiAuth, ErroApi } from "@/lib/api";
import { aplicarMarca, baixarMarca, canaisParaHex, type Marca } from "@/lib/marca";
import { lerSessao } from "@/lib/sessao";

/** Os mesmos valores de `globals.css`, para o botão "voltar ao padrão". */
const PADRAO = {
  cor_primaria: canaisParaHex("30 75 59"),
  cor_destaque: canaisParaHex("198 212 0"),
  cor_fundo: canaisParaHex("246 247 242"),
};

type Fazenda = Marca & { nome: string };

/**
 * Identidade visual da fazenda: logo e cores.
 *
 * A pré-visualização é o próprio app: mudar a cor aqui repinta a tela inteira na
 * hora. Miniatura de amostra mentiria — o que importa é como o verde escolhido
 * se comporta atrás do texto branco do cabeçalho, não como ele fica num
 * quadradinho.
 */
export function IdentidadeVisual() {
  const [fazenda, setFazenda] = useState<Fazenda | null>(null);
  const [cores, setCores] = useState(PADRAO);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [versaoLogo, setVersaoLogo] = useState(0);
  const arquivo = useRef<HTMLInputElement>(null);

  const sessao = lerSessao();
  const podeEditar = sessao?.papel === "admin" || sessao?.admin_master;

  useEffect(() => {
    apiAuth<Fazenda>("/fazendas/atual")
      .then((f) => {
        setFazenda(f);
        setCores({
          cor_primaria: f.cor_primaria ?? PADRAO.cor_primaria,
          cor_destaque: f.cor_destaque ?? PADRAO.cor_destaque,
          cor_fundo: f.cor_fundo ?? PADRAO.cor_fundo,
        });
      })
      .catch(() => setFazenda(null));
  }, []);

  // Pré-visualização ao vivo enquanto se mexe nos seletores.
  useEffect(() => {
    if (fazenda) aplicarMarca({ ...cores, tem_logo: fazenda.tem_logo, nome: fazenda.nome });
  }, [cores, fazenda]);

  async function executar(acao: () => Promise<unknown>, mensagem: string) {
    setErro(null);
    setOk(null);
    setOcupado(true);
    try {
      await acao();
      const atualizada = await baixarMarca();
      if (atualizada) aplicarMarca(atualizada);
      setFazenda(await apiAuth<Fazenda>("/fazendas/atual"));
      setOk(mensagem);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar");
    } finally {
      setOcupado(false);
    }
  }

  const salvarCores = () =>
    executar(
      () => apiAuth("/fazendas/atual", { method: "PATCH", body: JSON.stringify(cores) }),
      "Cores salvas. Quem entrar agora já vê a nova identidade.",
    );

  const voltarAoPadrao = () => {
    setCores(PADRAO);
    return executar(
      () =>
        apiAuth("/fazendas/atual", {
          method: "PATCH",
          // Vazio limpa a cor no servidor: guardar o padrão copiado faria a
          // fazenda ficar presa a ele se a referência do sistema mudasse.
          body: JSON.stringify({ cor_primaria: "", cor_destaque: "", cor_fundo: "" }),
        }),
      "Voltou às cores padrão do sistema.",
    );
  };

  async function enviarLogo(evento: React.ChangeEvent<HTMLInputElement>) {
    const escolhido = evento.target.files?.[0];
    if (!escolhido) return;

    const formulario = new FormData();
    formulario.append("arquivo", escolhido);
    await executar(
      () => apiAuth("/fazendas/atual/logo", { method: "POST", body: formulario, headers: {} }),
      "Logo atualizada.",
    );
    setVersaoLogo((v) => v + 1);
    if (arquivo.current) arquivo.current.value = "";
  }

  if (!fazenda) return null;

  return (
    <Cartao>
      <h2 className="font-titulo font-extrabold text-verde">Identidade visual</h2>
      <p className="mt-0.5 text-sm text-verde/60">
        {podeEditar
          ? "Logo e cores desta fazenda. A tela muda enquanto você escolhe."
          : "Definida por um administrador da fazenda."}
      </p>

      {/* --- Logo --- */}
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <div className="flex h-20 w-40 items-center justify-center rounded-xl border border-borda bg-white p-2">
          <LogoFazenda
            versao={versaoLogo}
            alt={`Logo da ${fazenda.nome}`}
            className="max-h-full max-w-full object-contain"
            alternativa={
              <span className="px-2 text-center text-xs text-verde/45">
                Sem logo — o nome da fazenda aparece no lugar
              </span>
            }
          />
        </div>

        {podeEditar && (
          <div className="flex flex-wrap gap-2">
            <input
              ref={arquivo}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={enviarLogo}
              className="hidden"
              id="arquivo-logo"
            />
            <label
              htmlFor="arquivo-logo"
              className="cursor-pointer rounded-xl border border-borda bg-white px-4 py-2.5 font-titulo text-sm font-bold text-verde"
            >
              {fazenda.tem_logo ? "Trocar logo" : "Enviar logo"}
            </label>
            {fazenda.tem_logo && (
              <button
                disabled={ocupado}
                onClick={() =>
                  executar(
                    () => apiAuth("/fazendas/atual/logo", { method: "DELETE" }),
                    "Logo removida.",
                  )
                }
                className="rounded-xl border border-red-200 px-4 py-2.5 font-titulo text-sm font-bold text-red-700 disabled:opacity-40"
              >
                Remover
              </button>
            )}
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-verde/50">
        PNG, JPG, WEBP ou SVG, até 512 KB. Fundo transparente fica melhor sobre a
        cor primária.
      </p>

      {/* --- Cores --- */}
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <SeletorDeCor
          rotulo="Cor primária"
          dica="Cabeçalhos, barra lateral e textos"
          valor={cores.cor_primaria}
          aoMudar={(v) => setCores({ ...cores, cor_primaria: v })}
          desabilitado={!podeEditar}
        />
        <SeletorDeCor
          rotulo="Cor de destaque"
          dica="Botões de ação"
          valor={cores.cor_destaque}
          aoMudar={(v) => setCores({ ...cores, cor_destaque: v })}
          desabilitado={!podeEditar}
        />
        <SeletorDeCor
          rotulo="Cor de fundo"
          dica="Fundo das telas"
          valor={cores.cor_fundo}
          aoMudar={(v) => setCores({ ...cores, cor_fundo: v })}
          desabilitado={!podeEditar}
        />
      </div>

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

      {podeEditar && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={salvarCores}
            disabled={ocupado}
            className="rounded-xl bg-lima px-4 py-2.5 font-titulo text-sm font-bold text-verde disabled:opacity-50"
          >
            {ocupado ? "Salvando…" : "Salvar cores"}
          </button>
          <button
            onClick={voltarAoPadrao}
            disabled={ocupado}
            className="rounded-xl border border-borda px-4 py-2.5 font-titulo text-sm font-bold text-verde disabled:opacity-50"
          >
            Voltar ao padrão
          </button>
        </div>
      )}
    </Cartao>
  );
}

function SeletorDeCor({
  rotulo,
  dica,
  valor,
  aoMudar,
  desabilitado,
}: {
  rotulo: string;
  dica: string;
  valor: string;
  aoMudar: (valor: string) => void;
  desabilitado: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-titulo text-sm font-bold text-verde">{rotulo}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={valor}
          disabled={desabilitado}
          onChange={(e) => aoMudar(e.target.value.toUpperCase())}
          aria-label={rotulo}
          className="h-12 w-14 shrink-0 cursor-pointer rounded-lg border border-borda bg-white p-1 disabled:cursor-not-allowed"
        />
        <input
          value={valor}
          disabled={desabilitado}
          onChange={(e) => {
            const texto = e.target.value.toUpperCase();
            // Só aplica hex completo: aplicar a cada tecla faria a tela piscar
            // enquanto a pessoa digita.
            if (/^#[0-9A-F]{6}$/.test(texto)) aoMudar(texto);
          }}
          maxLength={7}
          className="w-full rounded-lg border border-borda bg-white px-3 py-2 font-mono text-sm uppercase text-verde outline-none focus:border-verde disabled:opacity-50"
        />
      </div>
      <span className="text-xs text-verde/50">{dica}</span>
    </div>
  );
}
