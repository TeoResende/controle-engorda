"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { EtiquetaConexao } from "@/components/barra-tecnico";
import { UltimasPesagens } from "@/components/ultimas-pesagens";
import { Microfone, Voltar } from "@/components/icones";
import { GravadorDeVoz, LIMITE_SEGUNDOS, suporteGravacao } from "@/lib/audio";
import { AreaDeTexto, Aviso, Botao, Campo, Chip } from "@/components/ui";
import { animalPorBrinco, type AnimalLocal } from "@/lib/db";
import { data as formatarData, hojeLocal, peso as formatarPeso } from "@/lib/formato";
import { enfileirar, sincronizar } from "@/lib/sync";
import { novoUuid } from "@/lib/uuid";

/**
 * Tela 3 — Nova pesagem.
 *
 * É onde a tag NFC aterrissa (`/tecnico/coleta?brinco=1234`) e a tela que mais
 * precisa funcionar sem sinal: resolve o animal na cópia local, salva no
 * IndexedDB e só depois tenta enviar. Se o envio falhar, o técnico nem fica
 * sabendo — o registro está seguro e a fila cuida do resto.
 */
function Conteudo() {
  const router = useRouter();
  const parametros = useSearchParams();
  const brinco = (parametros.get("brinco") ?? "").trim();

  const [animal, setAnimal] = useState<AnimalLocal | null | undefined>(undefined);
  const [online, setOnline] = useState(true);
  const [dataPesagem, setDataPesagem] = useState(hojeLocal);
  const [peso, setPeso] = useState("");
  const [observacao, setObservacao] = useState("");
  const [audio, setAudio] = useState<Blob | null>(null);
  const [gravando, setGravando] = useState(false);
  const [gravador] = useState(() => (typeof window === "undefined" ? null : new GravadorDeVoz()));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

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

  useEffect(() => {
    if (!brinco) {
      setAnimal(null);
      return;
    }
    animalPorBrinco(brinco).then((encontrado) => setAnimal(encontrado ?? null));
  }, [brinco]);

  async function alternarGravacao() {
    if (!gravador) return;
    if (gravando) {
      const { blob } = await gravador.parar();
      setAudio(blob);
      setGravando(false);
      return;
    }
    try {
      await gravador.comecar();
      setGravando(true);
      // Corta sozinho: áudio longo pesa na fila em dias sem sinal.
      setTimeout(async () => {
        if (gravador) {
          const { blob } = await gravador.parar().catch(() => ({ blob: null }) as never);
          if (blob) setAudio(blob);
          setGravando(false);
        }
      }, LIMITE_SEGUNDOS * 1000);
    } catch {
      setErro("Não consegui acessar o microfone. Verifique a permissão.");
    }
  }

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    const valor = Number(peso.replace(",", "."));
    if (!Number.isFinite(valor) || valor <= 0 || valor > 2000) {
      setErro("Peso inválido. Confira o número.");
      return;
    }

    setSalvando(true);
    setErro(null);

    await enfileirar({
      // UUID criado aqui, offline: é ele que impede o reenvio de duplicar.
      // Não usa crypto.randomUUID direto — ele não existe fora de contexto
      // seguro, e o app roda em http na rede local.
      id: novoUuid(),
      animal_id: animal?.id ?? null,
      brinco,
      data: dataPesagem,
      peso_kg: valor.toFixed(2),
      observacao_texto: observacao.trim() || null,
      latitude: null,
      longitude: null,
      coletado_em: new Date().toISOString(),
      tentativas: 0,
      ultimo_erro: null,
      audio: audio ?? undefined,
      audio_enviado: false,
    });

    // Tenta subir na hora, mas não espera dar certo: o registro já está salvo.
    const resumo = await sincronizar();
    router.replace(
      `/tecnico/confirmacao?brinco=${encodeURIComponent(brinco)}&peso=${valor.toFixed(1)}&sync=${resumo.enviadas > 0 ? "1" : "0"}`,
    );
  }

  if (!brinco) {
    return (
      <main className="flex flex-col gap-5 p-5">
        <Aviso tom="erro">Nenhum número de brinco foi informado.</Aviso>
        <Botao onClick={() => router.replace("/tecnico")}>Voltar</Botao>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-borda bg-white px-4 py-3">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-verde">
          <Voltar />
          <span className="font-titulo font-extrabold">Nova pesagem</span>
        </button>
        <EtiquetaConexao online={online} />
      </header>

      <form onSubmit={salvar} className="flex flex-1 flex-col gap-5 p-5">
        <section className="rounded-2xl bg-verde px-5 py-5">
          <p className="font-titulo text-3xl font-extrabold text-fundo">
            {brinco}
            {animal?.nome && (
              <span className="ml-2 text-base font-bold text-fundo/80">{animal.nome}</span>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {animal?.raca && <Chip tom="escuro">{animal.raca}</Chip>}
            {animal?.porte && <Chip tom="escuro">Porte {animal.porte}</Chip>}
            {animal === null && <Chip tom="escuro">Não está no aparelho</Chip>}
          </div>
          <p className="mt-3 text-xs text-fundo/60">
            {animal?.ultimo_peso
              ? `Último peso: ${formatarPeso(animal.ultimo_peso)} kg em ${formatarData(animal.ultima_pesagem)}`
              : "Sem pesagem anterior registrada"}
          </p>
        </section>

        {animal === null && (
          <Aviso>
            Não achei esse brinco na cópia local. Pode registrar o peso mesmo
            assim — o servidor resolve o animal ao sincronizar.
          </Aviso>
        )}

        <Campo
          rotulo="Data da pesagem"
          type="date"
          value={dataPesagem}
          onChange={(e) => setDataPesagem(e.target.value)}
          max={hojeLocal()}
        />

        <Campo
          rotulo="Peso (kg)"
          destaque
          inputMode="decimal"
          autoFocus
          value={peso}
          onChange={(e) => setPeso(e.target.value)}
          placeholder="0"
        />

        <AreaDeTexto
          rotulo="Observações"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="Digite ou grave uma observação…"
        >
          {suporteGravacao() && (
            <button
              type="button"
              onClick={alternarGravacao}
              aria-label={gravando ? "Parar gravação" : "Gravar observação"}
              className={`absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full ${
                gravando ? "animate-pulse bg-red-600 text-white" : "bg-verde text-lima"
              }`}
            >
              <Microfone />
            </button>
          )}
        </AreaDeTexto>

        {audio && !gravando && (
          <Aviso tom="sucesso">
            Observação em áudio gravada. Ela sobe junto com a pesagem.
          </Aviso>
        )}
        {erro && <Aviso tom="erro">{erro}</Aviso>}

        <UltimasPesagens animalId={animal?.id ?? null} brinco={brinco} />

        <div className="mt-auto flex flex-col gap-2 pt-4">
          <Botao
            type="submit"
            variante="destaque"
            carregando={salvando}
            disabled={!peso.trim()}
          >
            {salvando ? "Salvando…" : "Salvar pesagem"}
          </Botao>
          <button
            type="button"
            onClick={() => router.replace("/tecnico")}
            className="py-2 text-sm font-bold text-verde/60"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}

export default function Coleta() {
  return (
    <Suspense fallback={null}>
      <Conteudo />
    </Suspense>
  );
}
