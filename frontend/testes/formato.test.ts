import { describe, expect, it } from "vitest";

import { data, hojeLocal, numero, variacao } from "@/lib/formato";

/**
 * A data da coleta vinha de `toISOString()`, que devolve a data em **UTC**. No
 * Brasil (UTC-3) isso gravava a data de amanhã em toda pesagem feita depois das
 * 21h — bem no horário em que ainda se trabalha no curral, e o peso ia parar no
 * dia seguinte.
 */
describe("data local", () => {
  it("usa o fuso do aparelho, não UTC", () => {
    // 4 de setembro, 23h30 no horário de Brasília = 5 de setembro em UTC.
    const noite = new Date(2026, 8, 4, 23, 30, 0);
    expect(hojeLocal(noite)).toBe("2026-09-04");
    // Prova que o caminho antigo erraria em qualquer fuso a oeste de Greenwich.
    if (noite.getTimezoneOffset() > 0) {
      expect(noite.toISOString().slice(0, 10)).toBe("2026-09-05");
    }
  });

  it("preenche mês e dia com zero à esquerda", () => {
    expect(hojeLocal(new Date(2026, 0, 7, 10, 0, 0))).toBe("2026-01-07");
  });
});

describe("formatação pt-BR", () => {
  it("mostra data sem escorregar de fuso", () => {
    // Montada da string, não de new Date() — que mostraria o dia anterior.
    expect(data("2026-09-05")).toBe("05/09/2026");
    expect(data("2026-01-01T03:00:00Z")).toBe("01/01/2026");
    expect(data(null)).toBe("—");
  });

  it("usa vírgula decimal", () => {
    expect(numero("1.18", 2)).toBe("1,18");
    expect(numero(312, 0)).toBe("312");
    expect(numero(null)).toBe("—");
  });

  it("marca o sinal da variação", () => {
    expect(variacao("14")).toBe("+14 kg");
    expect(variacao("-8")).toBe("-8 kg");
    expect(variacao(null)).toBe("—");
  });
});
