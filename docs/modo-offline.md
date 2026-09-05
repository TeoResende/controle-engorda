# Como o aplicativo funciona sem internet

> Para técnicos de campo, gestores e quem for testar o sistema.
> Não é preciso entender de tecnologia para ler este documento.

---

## O problema que isto resolve

No curral não há sinal de celular. E é exatamente no curral que o peso do
animal precisa ser anotado — não depois, de memória, no escritório.

Um aplicativo comum simplesmente para de funcionar sem internet: mostra a tela
de erro do navegador e pronto. Este não. Ele foi feito para que **o técnico
trabalhe o dia inteiro sem sinal e não perca nada**.

---

## A ideia em uma frase

O celular guarda uma **cópia do aplicativo** e uma **lista dos animais**. Quando
falta sinal, o técnico continua trabalhando nessa cópia. O que ele registra fica
numa **fila de espera** dentro do aparelho e sobe sozinho quando o sinal volta.

Pense num caderno de bolso: você anota no curral e depois passa a limpo no
computador. A diferença é que aqui o "passar a limpo" acontece sozinho, e o
caderno nunca é jogado fora antes de a anotação estar salva no servidor.

---

## O que acontece, passo a passo

### Antes de sair para o campo (com internet)

1. O técnico abre o aplicativo e faz login.
2. O celular **guarda uma cópia do aplicativo** — as telas, os botões, as
   letras. É o que permite abrir sem sinal depois.
3. O celular **baixa a lista dos animais** da fazenda: brinco, nome, raça,
   porte e o último peso de cada um.

Isso acontece automaticamente. Leva poucos segundos.

### No curral (sem sinal)

1. O técnico abre o aplicativo pelo ícone. **Ele abre normalmente.**
2. No alto da tela aparece uma etiqueta cor de âmbar: **"Offline"**. Isso não é
   erro — é o estado normal do trabalho no campo.
3. Ele encosta o celular no brinco do animal (ou digita o número).
4. A tela de coleta abre mostrando de qual animal é aquele brinco, a raça, o
   porte e **quanto ele pesava da última vez** — tudo vindo da cópia guardada no
   aparelho.
5. Ele digita o peso. Se quiser, **segura o botão do microfone e fala** uma
   observação, em vez de digitar com a mão suja.
6. Toca em *Salvar pesagem*.
7. A tela de confirmação diz: **"Guardado no aparelho. Sobe sozinho assim que o
   sinal voltar."**
8. Repete quantas vezes precisar. Cinquenta animais, duzentos, o dia inteiro.

Enquanto isso, um contador vermelho mostra quantas pesagens estão esperando para
subir. É o número que diz "ainda tem coisa aqui dentro".

### Quando o sinal volta

Sozinho, sem ninguém apertar nada:

1. O aplicativo percebe que voltou a internet.
2. Envia as pesagens da fila, em blocos, na ordem em que foram coletadas.
3. O servidor confirma o recebimento de cada uma.
4. **Só depois da confirmação** a cópia do celular é apagada.
5. Se houver áudio, ele sobe depois do peso — o peso é o que não pode se perder.
6. Por fim, a lista de animais no aparelho é atualizada.

O contador vermelho zera. Fim.

---

## Por que nada se perde

Três decisões cuidam disso:

**1. A cópia local só é apagada depois da confirmação.**
Se a internet cair no meio do envio, a pesagem continua no celular e vai na
próxima tentativa. Nunca existe um momento em que o dado saiu do aparelho e
ainda não chegou ao servidor.

**2. Cada pesagem nasce com um número de série próprio.**
O celular cria esse número no momento da coleta, antes de existir internet. Se a
mesma pesagem for enviada duas vezes — porque a resposta se perdeu, porque a
fila foi processada de novo — o servidor reconhece o número e **não cria um
registro duplicado**. Isso é o que torna seguro tentar de novo quantas vezes for
preciso.

**3. Pesagem recusada não é descartada.**
Se o servidor recusar (por exemplo, um brinco que não existe), a pesagem
**continua na fila**, com o motivo escrito ao lado. Erro de digitação não se
resolve sozinho, e o técnico precisa saber para corrigir — não descobrir a perda
semanas depois.

---

## O que funciona e o que não funciona sem sinal

| | Sem internet |
|---|---|
| Abrir o aplicativo | **Sim** |
| Ler o brinco por aproximação (NFC) | **Sim** |
| Digitar o número do brinco | **Sim** |
| Ver de qual animal é o brinco, raça e porte | **Sim** |
| Ver o último peso do animal | **Sim** |
| Ver as pesagens que ele mesmo fez hoje | **Sim** |
| Registrar peso | **Sim** |
| Gravar observação falada | **Sim** |
| Ver o histórico completo do animal | Não — mostra aviso |
| **Cadastrar um animal novo** | **Não** |
| Fazer login pela primeira vez | Não |
| Painel do cliente (dashboard) | Não |

### Por que cadastrar animal exige internet

Parece uma limitação incômoda, mas é proposital.

Quando um animal é cadastrado, o **servidor** cria a identidade dele. Se cada
celular pudesse criar identidades sozinho, dois técnicos cadastrando o mesmo
bezerro em aparelhos diferentes criariam **dois animais**, cada um com metade do
histórico de peso. Um bicho, duas fichas, e ninguém percebe até alguém procurar
a evolução do peso e ela não fazer sentido.

Pesagem é diferente: ela sempre se refere a um animal que já existe, então pode
esperar. Cadastro, não.

Na prática: se aparecer um animal sem cadastro no curral, o técnico **pode
registrar o peso mesmo assim**, digitando o número do brinco. O servidor liga o
peso ao animal certo na hora de sincronizar.

---

## Duas condições obrigatórias

O modo offline **não é automático em qualquer situação**. Duas coisas precisam
estar certas, e sem elas nada disso funciona.

### 1. O endereço precisa começar com `https://`

Os navegadores só permitem que um site funcione sem internet — e só permitem ler
NFC e usar o microfone — quando a conexão é segura. Isso é uma regra do
navegador, não uma escolha do sistema.

Em endereço `http://` (sem o "s"), o aplicativo **abre e registra peso**, mas:

- não abre sem sinal;
- não lê brinco por aproximação;
- não grava observação falada.

O próprio aplicativo avisa quando isso acontece, com uma tarja no alto da tela.

> **Em teste na rede local:** não basta clicar em "continuar assim mesmo" no
> aviso de certificado. O navegador tira o aviso da tela mas continua tratando o
> endereço como inseguro por baixo — e o modo offline nunca liga. É preciso
> **instalar o certificado no aparelho**, uma vez só. Veja
> [Preparando o celular para o teste](#preparando-o-celular-para-o-teste) logo
> abaixo.
>
> **Em produção**, com domínio de verdade, nada disso é necessário.

### 2. O celular precisa ter aberto o aplicativo uma vez, com internet

A cópia do aplicativo e a lista de animais precisam ser baixadas antes. Não dá
para "ficar offline" num aparelho que nunca esteve online.

---

## Preparando o celular para o teste

> Só para **teste na rede local**. Em produção, com domínio próprio, pule esta
> seção inteira.

Endereços da internet têm um certificado emitido por uma autoridade que todos os
aparelhos já conhecem. Um servidor de teste na rede de casa não tem — então
criamos uma autoridade nossa, e o celular precisa ser avisado de que ela é
confiável.

**É rápido, e é uma vez por aparelho.**

### 1. Baixe o certificado

No navegador do celular, abra:

```
http://192.168.0.130:8081/ca-engorda.crt
```

O arquivo será baixado.

### 2. Instale como certificado de autoridade

Nas **Configurações do Android**:

*Segurança* → *Mais configurações de segurança* → *Criptografia e credenciais* →
*Instalar um certificado* → **Certificado CA**

O aparelho vai avisar que "sua privacidade pode estar em risco". É esperado:
esse aviso aparece para qualquer certificado instalado à mão. Toque em
**Instalar mesmo assim**, escolha o arquivo `ca-engorda.crt` que você baixou e
dê um nome, como *Engorda*.

> O caminho exato muda um pouco entre fabricantes. Se não achar, procure por
> "certificado" na busca das Configurações.

### 3. Abra o aplicativo pelo endereço seguro

```
https://app.192.168.0.130.nip.io:8443/tecnico
```

Agora **não deve aparecer nenhum aviso** de conexão não particular. Se aparecer,
o certificado não foi instalado corretamente — refaça o passo 2.

### 4. Confirme

Entre no aplicativo e vá em **Mais → Uso sem internet**. As quatro linhas devem
estar verdes.

### Já tentou antes e não deu certo?

Limpe o que ficou guardado da tentativa anterior, senão ela atrapalha:

*Chrome* → ⋮ → *Configurações do site* → *Dados armazenados* → localize o
endereço → **Limpar**.

Depois refaça do passo 3.

---

## Como preparar o celular antes de ir para o campo

No aplicativo, toque em **Mais** (última aba, embaixo à direita) e procure o
quadro **"Uso sem internet"**.

Ele mostra quatro linhas, cada uma verde ou vermelha:

| Linha | O que significa |
|---|---|
| **Conexão segura (HTTPS)** | Se o endereço permite funcionar sem internet |
| **App preparado para offline** | Se a cópia do aplicativo já está no aparelho |
| **Telas guardadas** | Quantas telas e arquivos foram guardados |
| **Rebanho no aparelho** | Quantos animais estão na cópia local |

Se estiver tudo verde, aparece: **"Tudo pronto. O app abre e coleta peso sem
sinal."**

Se não estiver, toque em **"Preparar para o campo"** — ainda com internet.
Aguarde a confirmação. Depois pode desligar os dados.

**Faça isso antes de sair.** Leva segundos com sinal, e é impossível fazer sem.

---

## Testando

1. Com internet, abra o aplicativo pelo endereço `https://` e faça login.
2. Vá em **Mais → Uso sem internet** e toque em **Preparar para o campo**.
3. Espere a mensagem "Tudo pronto".
4. **Ligue o modo avião.**
5. Feche e abra o aplicativo. Ele deve abrir, com a etiqueta **"Offline"** no
   alto.
6. Registre um peso em qualquer animal.
7. Veja o contador vermelho aparecer na aba **Mais**.
8. **Desligue o modo avião** e espere alguns segundos.
9. O contador zera sozinho. A pesagem está no servidor.

### Se não funcionar

Abra **Mais → Uso sem internet** e veja **qual linha está vermelha**. Ela diz
exatamente o que falta:

- **Conexão segura: não** → você está em `http://`. Troque para `https://` na
  porta `8443`.
- **App preparado: não**, e ao tocar em preparar aparece uma mensagem sobre
  **certificado** → o certificado da autoridade não está instalado no aparelho.
  Volte para [Preparando o celular para o teste](#preparando-o-celular-para-o-teste).
- **App preparado: não** → toque em *Preparar para o campo*, com internet.
- **Telas guardadas: poucas** → o preparo foi interrompido. Toque em preparar de
  novo e espere terminar.
- **Rebanho: 0 animais** → a lista não baixou. Verifique a internet e entre no
  aplicativo de novo.

> **Se você já testou antes e mudou de endereço:** limpe os dados do site e
> comece de novo. O navegador guarda uma cópia por endereço, e a cópia antiga
> pode atrapalhar. No Chrome do Android: ⋮ → *Configurações do site* → *Dados
> armazenados* → *Limpar*.

---

## Perguntas comuns

**Se o celular desligar ou a bateria acabar, perco as pesagens?**
Não. Elas ficam gravadas no aparelho, não na memória temporária. Ao ligar de
novo, continuam lá esperando.

**E se eu fechar o aplicativo?**
Nada acontece. A fila continua guardada. Da próxima vez que abrir com internet,
ela sobe.

**Posso pesar o mesmo animal duas vezes no mesmo dia?**
Pode. As duas ficam registradas, e a mais recente é a que vale como peso atual.

**Se eu registrar sem querer um peso errado, dá para corrigir?**
Ainda não pela tela — a correção existe no sistema, mas a tela para fazê-la está
por construir. Por enquanto, avise quem administra. Quando existir, nada será
apagado de verdade: a pesagem retirada continua no sistema para consulta.

**O áudio da observação também funciona offline?**
Sim. Ele fica guardado junto com a pesagem e sobe depois dela. O peso tem
prioridade: se o áudio falhar, o peso já está salvo.

**Quanto tempo posso ficar sem sinal?**
Dias, se precisar. O limite prático é o espaço do celular, e uma pesagem ocupa
muito pouco. Áudios ocupam mais — por isso a gravação é limitada a um minuto.

**Por que clicar em "continuar assim mesmo" no aviso de certificado não resolve?**
Porque o aviso e a permissão são coisas diferentes. Ao continuar, o navegador
deixa você *ver* a página, mas mantém o endereço marcado como inseguro por
dentro — e recursos como funcionar sem internet, ler NFC e usar o microfone
seguem bloqueados. Só instalar o certificado como confiável remove a marca.

**O painel do cliente funciona sem internet?**
Não, e é de propósito. Lá se toma decisão olhando número. Mostrar dado velho
seria pior que mostrar erro de conexão.

---

## Em uma frase

**O aplicativo do técnico foi feito para o curral, não para o escritório: ele
abre sem sinal, guarda tudo no aparelho e só apaga a cópia local depois que o
servidor confirmou o recebimento.**
