import { describe, expect, it } from "vitest";

import { brincoDoTexto } from "@/lib/nfc";

/**
 * M6 — leitura da tag.
 *
 * A NTAG213 é gravada com a URL de coleta inteira, e não só com o número, para
 * que encostar o celular funcione mesmo com o app fechado (o Android abre a
 * URL). Ler a tag é, portanto, extrair o brinco de uma URL.
 */
describe("brinco gravado na tag", () => {
  it("extrai da URL de coleta", () => {
    expect(
      brincoDoTexto("https://app.dominio.com/tecnico/coleta?brinco=1234"),
    ).toBe("1234");
  });

  it("aceita a URL com outros parâmetros e porta", () => {
    expect(
      brincoDoTexto("https://app.192.168.0.130.nip.io:8443/tecnico/coleta?brinco=0042&x=1"),
    ).toBe("0042");
  });

  it("aceita tag gravada só com o número", () => {
    expect(brincoDoTexto("1234")).toBe("1234");
    expect(brincoDoTexto("  1234  ")).toBe("1234");
  });

  it("recusa URL sem o parâmetro brinco", () => {
    expect(brincoDoTexto("https://app.dominio.com/tecnico")).toBeNull();
  });

  it("recusa texto que não é brinco", () => {
    expect(brincoDoTexto("")).toBeNull();
    expect(brincoDoTexto("olá, mundo")).toBeNull();
    expect(brincoDoTexto("x".repeat(50))).toBeNull();
  });
});
