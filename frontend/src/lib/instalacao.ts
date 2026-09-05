import { api } from "./api";

/**
 * A instalação ainda não tem nenhum usuário?
 *
 * Sem usuário não há como autenticar ninguém — e portanto não haveria como
 * criar o primeiro administrador. Toda tela de entrada precisa checar isto,
 * não só a raiz: quem abre `/tecnico` direto num sistema recém-subido cairia
 * numa tela de login sem caminho nenhum para sair dela.
 */
export async function precisaConfiguracao(): Promise<boolean> {
  try {
    const { precisa_configuracao } = await api<{ precisa_configuracao: boolean }>(
      "/setup/status",
    );
    return precisa_configuracao;
  } catch {
    // API fora do ar ou endereço errado: não é hora de mandar ninguém para o
    // cadastro inicial. Deixa a tela de login aparecer e falar por si.
    return false;
  }
}
