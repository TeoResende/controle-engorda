# Gráficos do sistema — como funcionam e como manter

Este documento descreve **tudo** que existe para desenhar os gráficos do
dashboard: os componentes de tela, as rotas e serviços que os alimentam, e as
decisões de domínio que fazem cada curva contar a verdade. É o mapa para mexer
neles sem reintroduzir bugs que já pagamos.

Regra que atravessa tudo: **gráfico é SVG escrito à mão, não biblioteca.** Uma
lib de gráficos custaria ~100 KB de bundle para desenhar duas linhas, e o
dashboard precisa abrir rápido em conexão de fazenda (seção 8.5 do CLAUDE.md).

---

## Onde cada peça mora

| Camada | Arquivo | O que faz |
|---|---|---|
| Componente base | `frontend/src/components/grafico.tsx` | `GraficoDeLinha` — **uma** linha, eixo x por rótulo ou por data |
| Componente multilinha | `frontend/src/components/grafico-curvas.tsx` | `GraficoCurvas` — **várias** linhas, eixo x **numérico** (dias) |
| Card em abas | `frontend/src/components/curva-dashboard.tsx` | `CurvaDashboard` — orquestra as abas "Por data" e "Por idade" |
| Tela visão geral | `frontend/src/app/dashboard/page.tsx` | usa `CurvaDashboard` e o aviso de pendências |
| Tela do animal | `frontend/src/app/dashboard/animal/[id]/page.tsx` | usa `GraficoDeLinha` com o ponto de nascimento |
| Rotas | `backend/app/api/metricas.py` | `/visao-geral`, `/curva-periodo`, `/curva-alinhada`, `/animal/{id}` |
| Cálculo | `backend/app/servicos/metricas.py` | `_serie`, `curva_alinhada`, `detalhe_animal` |
| Schemas | `backend/app/schemas/metricas.py` | `PontoDaSerie`, `CurvaAlinhada`, `PontoAlinhado`, `LinhaAlinhada`, `PesagemDaSerie` |
| Testes | `backend/tests/test_metricas.py`, `test_curvas.py` | período, dof, idade, agregação, dedup |

---

## Os três gráficos, e o que cada um responde

### 1. Curva da visão geral — aba "Por data"

**Pergunta:** como o peso médio do rebanho evoluiu no calendário?

- **Rota:** a série inicial vem em `GET /metricas/visao-geral` (`serie`); o
  recorte por período vem de `GET /metricas/curva-periodo?desde=&ate=`.
- **Cálculo (`_serie`):** peso médio do rebanho **por mês**, usando **um peso por
  animal por mês — o último**. Não é a média de todas as pesagens do mês.
- **Por que o último, e não a média crua:** um animal pesado duas vezes no mês
  (repesagem, correção, duas passagens pelo curral) entrava duas vezes e
  distorcia a curva — uma correção para baixo fazia o rebanho inteiro
  "emagrecer" num mês em que só ganhou peso. O sintoma era uma queda irreal, e o
  ponto do mês corrente divergindo do KPI "peso médio atual". Desempate igual ao
  resto: `data`, `coletado_em`, `id`.
- **O filtro de período recorta só o gráfico.** Os KPIs (peso médio, GMD) são
  fotografia do agora — recortá-los por um período do passado mudaria o
  significado. Por isso o filtro chama `curva-periodo`, não `visao-geral`.

### 2. Curva alinhada — aba "Por idade / acompanhamento"

**Pergunta:** comparar a evolução de animais que nasceram/entraram em datas
diferentes, no **mesmo ponto da vida**.

- **Rota:** `GET /metricas/curva-alinhada?eixo=&lote_id=&animais=&agregar=`.
- **Dois eixos (`eixo`):**
  - **`dof` (dias de acompanhamento) — padrão.** Dia 0 = a **primeira pesagem**
    de cada animal. Todos partem do zero, então a janela de engorda (~120 dias)
    fica perfeitamente comparável mesmo entre bichos que entraram em datas
    diferentes. **Não depende de data de nascimento.** É o padrão porque responde
    melhor à pergunta "quem ganhou mais no mesmo período".
  - **`idade` (dias de vida).** Dia = `data da pesagem − data de nascimento`.
    Compara por idade biológica. Quem **não tem data de nascimento** fica de fora
    e é contado em `sem_nascimento` — a tela avisa, não esconde.
- **Escopo:**
  - **`agregar=true`** → uma linha só: a **média por faixa** (bucket de 15 dias no
    dof, 30 no idade). É o que a opção "Todos (média)" usa — plotar centenas de
    animais individualmente viraria espaguete.
  - **`lote_id`** → uma linha **por animal** do lote (teto de 12 na resposta; a
    tela deixa a legenda destacar cada um ao passar o mouse).
  - **`animais=csv`** → seleção específica de ids. Na tela é o escopo **"Escolher
    animais…"**, com duas portas para a **mesma** seleção: a busca por brinco (bom
    quando se sabe o número) e o botão **"Ver lista"**, que abre uma modal com o
    rebanho inteiro para ir clicando (`components/modal-selecao-animais.tsx`).
    Teto de 8 para continuar legível; sem nada escolhido, o gráfico pede a seleção
    em vez de desenhar vazio.
- **Dedup:** um peso por animal por dia, o último (`data`, `coletado_em`, `id`) —
  a mesma regra do resto, para uma repesagem não virar dois pontos.
- **Marcação do eixo x:** a cada 15 dias no dof, 30 no idade (`passoX` no
  `GraficoCurvas`). Meses seriam grossos demais para um ciclo de ~120 dias.

### 3. Curva do animal — `/dashboard/animal/[id]`

**Pergunta:** a evolução de peso de **um** animal, desde o nascimento.

- **Rota/serviço:** `GET /metricas/animal/{id}` → `detalhe_animal`.
- **O peso ao nascer é o primeiro ponto** da série (`origem: "nascimento"`),
  quando o animal tem data **e** peso de nascimento. Sem isso, a curva começava
  na primeira ida ao curral, escondendo meses de crescimento.
  - Vai marcado: `pesagem_id` nulo, sem autor, sem áudio, sem "Corrigir" (mexer
    nele é editar o cadastro).
  - O GMD **não** muda: continua medido entre pesagens, não desde o nascimento.
- **Eixo proporcional ao tempo:** quando todos os pontos têm data, o
  `GraficoDeLinha` espaça por data, não por posição — senão os oito meses entre
  nascer e a primeira pesagem apareceriam do mesmo tamanho de duas pesagens com
  um mês de diferença.

---

## Pendências de nascimento

Alinhar por idade exige data de nascimento; a projeção de abate (roadmap) exige
idade. Para o buraco não ficar invisível:

- **Filtro:** `GET /animais?sem_nascimento=true` traz quem está sem data **ou**
  peso de nascimento.
- **Aviso no dashboard:** conta as pendências e linka para a lista filtrada
  (`/dashboard/animais?sem_nascimento=1`).
- **Aviso na aba "Por idade":** mostra quantos ficaram de fora por falta de
  nascimento.
- **Decisão consciente:** os campos são **opcionais no formulário**. Bezerro
  comprado às vezes não tem data exata, e travar bloquearia editar o animal por
  outro motivo. Se um dia o cliente quiser obrigatório de verdade, é uma linha
  no schema `AnimalCriar`/no form — mas aí é preciso lidar com o passado (os já
  cadastrados sem data).

---

## Os componentes de gráfico

### `GraficoDeLinha` (`grafico.tsx`)

Uma linha. `Ponto = { rotulo, valor, data? }`. Se **todos** os pontos têm
`data`, o eixo x fica proporcional ao tempo; senão, espaça por posição.
Coordenadas amplas (900×340) escaladas por `viewBox`, para o texto manter
proporção em qualquer largura. Cores vêm das variáveis da marca
(`rgb(var(--cor-verde))`), então acompanham o tema da fazenda.

### `GraficoCurvas` (`grafico-curvas.tsx`)

Várias linhas, **eixo x numérico** (dias). `Serie = { rotulo, cor, grossa?,
pontos: {x,y}[] }`. Paleta de séries **fixa** (`CORES_SERIE`, 8 cores) — a marca
pinta o resto da tela, mas linhas que precisam se distinguir entre si não podem
depender de uma cor só. A legenda destaca a série no hover/foco. Os eixos usam
`rgb(var(--cor-borda))` e `rgb(var(--cor-verde))` para acompanhar o tema.

### `CurvaDashboard` (`curva-dashboard.tsx`)

O card em abas. Recebe `serieInicial` (a série do calendário que já vem na visão
geral, para o card não piscar vazio). Busca sob demanda: o recorte por período e
o modo alinhado só disparam quando a aba/controle muda. Guarda o estado das duas
abas separado.

---

## Como adicionar um gráfico ou uma aba nova

1. **Decida a pergunta de negócio** que ele responde — se não há uma clara, não
   é gráfico, é enfeite.
2. **Backend primeiro:** uma rota em `metricas.py` + um serviço que **agrega no
   SQL** o quanto der (lição das 269 s → 0,25 s da seção 8.5). Deduplique
   repesagem com o desempate padrão (`data`, `coletado_em`, `id`). Exclua
   `status != ativo` e `desativado_em` — animal fora do rebanho não conta.
3. **Meça com volume.** Com 24 animais tudo parece rápido; teste com milhares
   antes de confiar.
4. **Teste a série contra o SQL cru.** Vários bugs daqui (a média crua, o
   desempate não-determinístico de 294,02 vs 297,94) só apareceram comparando o
   que a rota devolve com um `SELECT` na mão.
5. **Frontend:** reaproveite `GraficoDeLinha` (uma linha) ou `GraficoCurvas`
   (várias). Cores de série saem de `CORES_SERIE`.
6. **Cada série é um peso por animal por período — o último.** Nunca a média de
   todas as pesagens: é o erro que faz a curva mentir.

---

## Armadilhas já pagas (não reintroduzir)

- **Média crua sobre todas as pesagens do mês** → curva com queda irreal quando
  há repesagem. Use um peso por animal por período.
- **`DISTINCT ON` / desempate sem ordem definida** → o mesmo dashboard mostra
  números diferentes a cada carga. Sempre `data, coletado_em, id`.
- **KPI recortado por período** → "peso médio atual" deixa de ser "atual". O
  filtro é só do gráfico.
- **Eixo por posição com intervalos desiguais no tempo** → curva que mente sobre
  o ritmo. Use `data`/dias reais no eixo.
- **Alinhar por idade sem tratar quem não tem nascimento** → animais somem em
  silêncio. Conte e avise (`sem_nascimento`).
- **Plotar "todos" individualmente** → espaguete ilegível. "Todos" é média;
  linhas individuais só para um lote ou seleção pequena.
