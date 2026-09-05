/**
 * UUID v4 para o id da pesagem.
 *
 * `crypto.randomUUID()` só existe em **contexto seguro** — em http puro (o app
 * aberto pelo IP da rede local, por exemplo) ele é `undefined` e a coleta
 * quebrava no ponto mais crítico do fluxo. `crypto.getRandomValues()` não tem
 * essa restrição e está disponível em qualquer contexto, então é dele que
 * montamos o UUID quando o atalho não existe.
 *
 * Este id é a chave de idempotência do envio (M4): dois aparelhos gerando o
 * mesmo id fariam uma pesagem sumir dentro da outra. Por isso a última queda,
 * `Math.random()`, existe só para não deixar o técnico sem registrar peso em
 * um navegador antigo — e nunca deveria ser alcançada.
 */

const HEX: string[] = Array.from({ length: 256 }, (_, i) =>
  (i + 0x100).toString(16).slice(1),
);

function bytesAleatorios(): Uint8Array {
  const bytes = new Uint8Array(16);
  const cripto = globalThis.crypto;

  if (cripto && typeof cripto.getRandomValues === "function") {
    cripto.getRandomValues(bytes);
    return bytes;
  }

  for (let i = 0; i < 16; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

export function novoUuid(): string {
  const cripto = globalThis.crypto;
  if (cripto && typeof cripto.randomUUID === "function") {
    return cripto.randomUUID();
  }

  const b = bytesAleatorios();
  b[6] = (b[6] & 0x0f) | 0x40; // versão 4
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122

  return (
    HEX[b[0]] + HEX[b[1]] + HEX[b[2]] + HEX[b[3]] + "-" +
    HEX[b[4]] + HEX[b[5]] + "-" +
    HEX[b[6]] + HEX[b[7]] + "-" +
    HEX[b[8]] + HEX[b[9]] + "-" +
    HEX[b[10]] + HEX[b[11]] + HEX[b[12]] + HEX[b[13]] + HEX[b[14]] + HEX[b[15]]
  );
}
