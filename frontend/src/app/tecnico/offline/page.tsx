import { Aviso, Cabecalho, LinkBotao } from "@/components/ui";

/** Última linha de defesa: navegação que o cache não alcançou. */
export default function Offline() {
  return (
    <main className="flex min-h-screen flex-col justify-center gap-6 p-5">
      <Cabecalho titulo="Sem sinal" subtitulo="Esta tela ainda não estava guardada no aparelho." />
      <Aviso>
        O que você já coletou continua salvo e vai subir sozinho quando o sinal
        voltar. Nada foi perdido.
      </Aviso>
      <LinkBotao href="/tecnico">Voltar para a coleta</LinkBotao>
    </main>
  );
}
