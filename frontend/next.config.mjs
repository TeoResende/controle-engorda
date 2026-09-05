/** @type {import('next').NextConfig} */
const nextConfig = {
  /*
   * `output: "standalone"` foi removido: ele gera um segundo pacote de build,
   * que o `next start` ignora — o Next avisa isso na subida. Vale retomar
   * junto com uma imagem de produção enxuta, servindo por
   * `node .next/standalone/server.js` em vez do `next start`; hoje a imagem do
   * frontend tem 1,66 GB porque carrega o node_modules inteiro.
   */

  /*
   * Desliga o distintivo de desenvolvimento do Next.
   *
   * Ele mostra se a rota é estática ou dinâmica e nunca aparece em produção —
   * mas fica sobre a tela enquanto se desenvolve, e num app operado com uma mão
   * só, num celular, ele cobre justamente o canto onde ficam as abas. Quem
   * testa também confunde o distintivo com um componente do produto.
   */
  devIndicators: {
    // O distintivo "Static Route" / "Dynamic Route".
    appIsrStatus: false,
    // O indicador de compilação em andamento.
    buildActivity: false,
  },
};

export default nextConfig;
