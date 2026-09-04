"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Aviso, Botao, Cabecalho, Campo, LinkBotao } from "@/components/ui";
import { animalPorBrinco, type AnimalLocal } from "@/lib/db";
import { enfileirar, sincronizar } from "@/lib/sync";

/**
 * Tela 3 — Coleta de peso.
 *
 * É onde a tag NFC aterrissa (`/tecnico/coleta?brinco=1234`), e é a tela que
 * mais precisa funcionar sem sinal: ela resolve o animal na cópia local, salva
 * no IndexedDB e só depois tenta enviar. Se o envio falhar, o técnico nem fica
 * sabendo — o registro está seguro e a fila cuida do resto.
 */
function Conteudo() {
  const router = useRouter();
  const parametros = useSearchParams();
  const brinco = (parametros.get("brinco") ?? "").trim();

  const [animal, setAnimal] = useState<AnimalLocal | null | undefined>(undefined);
  const [peso, setPeso] = useState("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!brinco) {
      setAnimal(null);
      return;
    }
    animalPorBrinco(brinco).then((encontrado) => setAnimal(encontrado ?? null));
  }, [brinco]);

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    const valor = peso.replace(",", ".").trim();
    const numero = Number(valor);
    if (!Number.isFinite(numero) || numero <= 0 || numero > 2000) {
      setErro("Peso inválido. Confira o número.");
      return;
    }

    setSalvando(true);
    setErro(null);

    const agora = new Date();
    await enfileirar({
      // UUID criado aqui, offline: é ele que impede o reenvio de duplicar.
      id: crypto.randomUUID(),
      animal_id: animal?.id ?? null,
      brinco,
      data: agora.toISOString().slice(0, 10),
      peso_kg: numero.toFixed(2),
      observacao_texto: observacao.trim() || null,
      latitude: null,
      longitude: null,
      coletado_em: agora.toISOString(),
      tentativas: 0,
      ultimo_erro: null,
    });

    // Tenta subir na hora, mas não espera dar certo: o registro já está salvo.
    const resumo = await sincronizar();
    const sincronizou = resumo.enviadas > 0 ? "1" : "0";

    router.replace(
      `/tecnico/confirmacao?brinco=${encodeURIComponent(brinco)}&peso=${numero.toFixed(1)}&sync=${sincronizou}`,
    );
  }

  if (!brinco) {
    return (
      <main className="flex flex-col gap-6">
        <Cabecalho titulo="Sem brinco" subtitulo="Nenhum número de brinco foi informado." />
        <LinkBotao href="/tecnico">Voltar</LinkBotao>
      </main>
    );
  }

  if (animal === undefined) {
    return <p className="py-10 text-center text-sm text-verde/60">Procurando animal…</p>;
  }

  return (
    <main className="flex flex-col gap-6">
      <div className="rounded-2xl bg-verde px-5 py-6 text-fundo">
        <p className="text-xs font-bold uppercase tracking-wide text-lima">Brinco</p>
        <p className="font-titulo text-4xl font-extrabold">{brinco}</p>
        {animal ? (
          <p className="mt-1 text-sm text-fundo/80">
            {[animal.nome, animal.raca].filter(Boolean).join(" · ") || "Animal cadastrado"}
          </p>
        ) : (
          <p className="mt-1 text-sm text-fundo/80">Ainda não está no aparelho</p>
        )}
      </div>

      {!animal && (
        <Aviso>
          Não achei esse brinco na cópia local. Você pode registrar o peso mesmo
          assim — o servidor resolve o animal na hora de sincronizar. Se for
          bicho novo, cadastre primeiro.
        </Aviso>
      )}

      <form onSubmit={salvar} className="flex flex-col gap-4">
        <Campo
          rotulo="Peso"
          sufixo="kg"
          // decimal + autoFocus: menos toques no curral, teclado numérico direto.
          inputMode="decimal"
          autoFocus
          value={peso}
          onChange={(e) => setPeso(e.target.value)}
          placeholder="0,0"
        />
        <Campo
          rotulo="Observação (opcional)"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="Algo fora do normal?"
        />
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        <Botao type="submit" variante="destaque" disabled={salvando || !peso.trim()}>
          {salvando ? "Salvando…" : "Salvar peso"}
        </Botao>
      </form>

      {!animal && (
        <LinkBotao href={`/tecnico/animal/novo?brinco=${encodeURIComponent(brinco)}`} variante="neutra">
          Cadastrar este animal
        </LinkBotao>
      )}
    </main>
  );
}

export default function Coleta() {
  return (
    <Suspense fallback={null}>
      <Conteudo />
    </Suspense>
  );
}
