/**
 * Leitura NFC (Web NFC — Chrome/Android).
 *
 * A tag NTAG213 do brinco é gravada com a URL de coleta
 * (`.../tecnico/coleta?brinco=1234`), então ler a tag é extrair o `brinco` da
 * URL. Gravar a URL inteira, e não só o número, é o que faz o brinco funcionar
 * também para quem só encosta o celular sem o app aberto: o Android abre a URL.
 */

export type SuporteNfc = "disponivel" | "sem-api" | "sem-https";

export function suporteNfc(): SuporteNfc {
  if (typeof window === "undefined") return "sem-api";
  // Web NFC exige contexto seguro; sem isso a API nem aparece.
  if (!window.isSecureContext) return "sem-https";
  return "NDEFReader" in window ? "disponivel" : "sem-api";
}

/** Extrai o brinco de um registro de tag: aceita a URL completa ou só o número. */
export function brincoDoTexto(texto: string): string | null {
  const limpo = texto.trim();
  if (!limpo) return null;

  try {
    const url = new URL(limpo);
    const daQuery = url.searchParams.get("brinco");
    if (daQuery) return daQuery.trim();
  } catch {
    // Não era URL — segue como texto puro.
  }

  // Tag gravada só com o número (ou brinco escrito à mão).
  return /^[A-Za-z0-9-]{1,20}$/.test(limpo) ? limpo : null;
}

type Assinatura = {
  aoLer: (brinco: string) => void;
  aoErrar: (mensagem: string) => void;
  sinal: AbortSignal;
};

/**
 * Começa a escutar tags. Resolve quando a escuta está ativa; a leitura em si
 * chega por callback, quantas vezes o técnico encostar o celular.
 */
export async function escutarTags({ aoLer, aoErrar, sinal }: Assinatura): Promise<void> {
  const Leitor = (window as unknown as { NDEFReader?: new () => NDEFReaderLike })
    .NDEFReader;
  if (!Leitor) throw new Error("Este aparelho ou navegador não lê NFC");

  const leitor = new Leitor();

  leitor.onreadingerror = () => {
    aoErrar("Não consegui ler a tag. Encoste de novo, mais firme.");
  };

  leitor.onreading = (evento) => {
    const decodificador = new TextDecoder();
    for (const registro of evento.message.records) {
      // A tag pode ter mais de um registro; o primeiro que der um brinco vale.
      const texto =
        registro.recordType === "url"
          ? decodificador.decode(registro.data)
          : registro.recordType === "text"
            ? decodificador.decode(registro.data)
            : null;
      if (!texto) continue;

      const brinco = brincoDoTexto(texto);
      if (brinco) {
        aoLer(brinco);
        return;
      }
    }
    // Também vale o id serial da tag, se nada legível vier no conteúdo.
    aoErrar("Tag sem número de brinco gravado.");
  };

  // `scan` é o que dispara o pedido de permissão de NFC no Android.
  await leitor.scan({ signal: sinal });
}

type NDEFReaderLike = {
  scan(opcoes?: { signal?: AbortSignal }): Promise<void>;
  onreading: ((evento: { message: { records: NDEFRecordLike[] } }) => void) | null;
  onreadingerror: (() => void) | null;
};

type NDEFRecordLike = {
  recordType: string;
  data?: BufferSource;
};


/**
 * Grava a URL de coleta na tag do brinco.
 *
 * Gravamos a URL completa, e não só o número: assim encostar o celular no brinco
 * funciona mesmo com o app fechado — o Android abre a URL direto na tela de
 * coleta. Um brinco gravado só com o número exigiria abrir o app antes.
 */
export async function gravarTag(brinco: string, sinal: AbortSignal): Promise<void> {
  const Escritor = (window as unknown as { NDEFReader?: new () => NDEFWriterLike })
    .NDEFReader;
  if (!Escritor) throw new Error("Este aparelho ou navegador não grava NFC");

  const url = `${window.location.origin}/tecnico/coleta?brinco=${encodeURIComponent(brinco)}`;
  await new Escritor().write({ records: [{ recordType: "url", data: url }] }, { signal: sinal });
}

type NDEFWriterLike = {
  write(
    mensagem: { records: { recordType: string; data: string }[] },
    opcoes?: { signal?: AbortSignal },
  ): Promise<void>;
};
