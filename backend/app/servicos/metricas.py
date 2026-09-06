"""Cálculo de peso, GMD e alertas.

**GMD** (ganho médio diário) é a métrica do negócio: quanto o animal ganha por
dia entre a primeira e a última pesagem. Aqui ele é calculado por SQL, sob
demanda, e não guardado em coluna — recalcular é barato nesta escala, e valor
derivado gravado no banco vira fonte de divergência assim que alguém corrige uma
pesagem.

Pesagem desativada fica de fora de tudo: peso retirado não conta para média nem
para alerta.
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import Date, Numeric, and_, case, cast, func, select
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Animal, Fazenda, Lote, Pesagem, StatusAnimal, Usuario
from app.schemas.metricas import (
    Alerta,
    ObservacaoRecente,
    ResumoDoDia,
    DetalheAnimal,
    PesagemDaSerie,
    PontoDaSerie,
    ResumoLote,
    VisaoGeral,
)

# Teto de alertas devolvidos. A tela mostra oito; o resto vira lista de animais
# a filtrar, não carga na resposta do dashboard.
LIMITE_DE_ALERTAS = 50

# Padrões, usados quando a fazenda não definiu os próprios. Confinamento e pasto
# não se comparam com o mesmo número — por isso os limites moram na fazenda.
GMD_MINIMO = Decimal("0.500")
DIAS_SEM_PESAGEM = 45


async def _limites(sessao: AsyncSession, fazenda_id: uuid.UUID) -> tuple[Decimal, int]:
    linha = (
        await sessao.execute(
            select(Fazenda.gmd_meta, Fazenda.dias_sem_pesagem).where(Fazenda.id == fazenda_id)
        )
    ).first()
    if linha is None:
        return GMD_MINIMO, DIAS_SEM_PESAGEM
    return Decimal(linha[0]), int(linha[1])


def _base_pesagens(fazenda_id: uuid.UUID):
    """Pesagens válidas de animais válidos da fazenda."""
    return (
        select(Pesagem)
        .join(Animal, Animal.id == Pesagem.animal_id)
        .where(
            Pesagem.fazenda_id == fazenda_id,
            Pesagem.desativado_em.is_(None),
            Animal.desativado_em.is_(None),
            Animal.status == StatusAnimal.ativo,
        )
    )


def _resumo_por_animal(fazenda_id: uuid.UUID):
    """Primeira e última pesagem de cada animal, com o GMD entre elas.

    **Uma passada só, agrupando.** A versão anterior numerava as pesagens com
    funções de janela e depois juntava a primeira com a última — e essa junção
    virava um laço aninhado que percorria o conjunto inteiro uma vez por animal.
    Com 5.000 animais e 120.000 pesagens dava 25 milhões de visitas e **33
    segundos**; assim, 156 ms. O cálculo das janelas nunca foi o problema: a
    junção era.

    `array_agg` com ordem explícita resolve o desempate — dois pesos no mesmo dia
    é situação normal (repesagem, correção, duas passagens pelo curral), e sem
    ordem definida o Postgres escolheria um ao acaso, fazendo o mesmo dashboard
    mostrar números diferentes a cada carga.
    """
    p = _base_pesagens(fazenda_id).subquery()

    ordem_asc = (p.c.data.asc(), p.c.coletado_em.asc(), p.c.id.asc())
    ordem_desc = (p.c.data.desc(), p.c.coletado_em.desc(), p.c.id.desc())

    primeiro = func.array_agg(aggregate_order_by(p.c.peso_kg, *ordem_asc))[1]
    ultimo = func.array_agg(aggregate_order_by(p.c.peso_kg, *ordem_desc))[1]
    qtd = func.count()
    primeira_data = func.min(p.c.data)
    ultima_data = func.max(p.c.data)

    dias = func.greatest(cast(ultima_data - primeira_data, Numeric), 1)

    return select(
        p.c.animal_id.label("animal_id"),
        qtd.label("qtd"),
        primeira_data.label("primeira_data"),
        ultima_data.label("ultima_data"),
        primeiro.label("peso_inicial"),
        ultimo.label("peso_atual"),
        (ultimo - primeiro).label("ganho"),
        case(
            # Com uma pesagem só não há ganho a medir — GMD fica nulo em vez de
            # zero, que seria lido como "não está ganhando peso".
            (qtd < 2, None),
            else_=(ultimo - primeiro) / dias,
        ).label("gmd"),
    ).group_by(p.c.animal_id)


async def _resumo_completo(sessao: AsyncSession, fazenda_id: uuid.UUID) -> list:
    """Traz o resumo de cada animal **uma vez só**, com brinco e lote junto.

    A versão anterior montava esta mesma agregação três vezes por requisição —
    uma para os totais, outra para os lotes, outra para os alertas — e cada uma
    varria as pesagens de novo. Com 5.000 animais isso custava ~3 s de
    dashboard. Agora é uma consulta, e o agrupamento por lote e a montagem dos
    alertas acontecem em Python, sobre um resultado que já está na memória.

    O limite prático é a quantidade de animais, não de pesagens: 50.000 linhas
    de resumo ainda são poucos megabytes. Se um dia passar disso, o caminho é
    agregar por lote no banco, não paginar isto.
    """
    resumo = _resumo_por_animal(fazenda_id).subquery()
    linhas = await sessao.execute(
        select(
            Animal.id,
            Animal.brinco,
            Animal.lote_id,
            Lote.nome,
            resumo.c.qtd,
            resumo.c.ultima_data,
            resumo.c.peso_atual,
            resumo.c.ganho,
            resumo.c.gmd,
        )
        .select_from(Animal)
        .join(resumo, resumo.c.animal_id == Animal.id, isouter=True)
        .join(Lote, Lote.id == Animal.lote_id, isouter=True)
        .where(
            Animal.fazenda_id == fazenda_id,
            Animal.desativado_em.is_(None),
            Animal.status == StatusAnimal.ativo,
        )
    )
    return list(linhas)


async def visao_geral(sessao: AsyncSession, fazenda_id: uuid.UUID, meses: int = 6) -> VisaoGeral:
    gmd_meta, dias_limite = await _limites(sessao, fazenda_id)
    linhas = await _resumo_completo(sessao, fazenda_id)

    pesados = [l for l in linhas if l.peso_atual is not None]
    com_gmd = [l.gmd for l in pesados if l.gmd is not None]

    return VisaoGeral(
        gmd_meta=gmd_meta,
        dias_sem_pesagem=dias_limite,
        animais_ativos=len(linhas),
        animais_pesados=len(pesados),
        peso_medio=_media([l.peso_atual for l in pesados]),
        gmd_medio=_media(com_gmd, casas=3),
        ganho_total_kg=_arredondar(sum((l.ganho for l in pesados if l.ganho), Decimal(0))),
        ultima_pesagem=max((l.ultima_data for l in pesados), default=None),
        serie=await _serie(sessao, fazenda_id, meses),
        lotes=_lotes(linhas),
        **_alertas(linhas, gmd_meta, dias_limite),
    )


def _media(valores: list, casas: int = 2) -> Decimal | None:
    if not valores:
        return None
    return _arredondar(sum(Decimal(v) for v in valores) / len(valores), casas)


def _arredondar(valor, casas: int = 2) -> Decimal | None:
    if valor is None:
        return None
    return Decimal(valor).quantize(Decimal(10) ** -casas)


async def _serie(sessao: AsyncSession, fazenda_id: uuid.UUID, meses: int) -> list[PontoDaSerie]:
    """Peso médio do rebanho por mês — a curva que o cliente vê primeiro."""
    corte = date.today() - timedelta(days=31 * meses)
    p = _base_pesagens(fazenda_id).subquery()
    mes = func.date_trunc("month", p.c.data)

    linhas = await sessao.execute(
        select(
            cast(mes, Date).label("mes"),
            func.avg(p.c.peso_kg),
            func.count(func.distinct(p.c.animal_id)),
        )
        .where(p.c.data >= corte)
        .group_by(mes)
        .order_by(mes)
    )
    return [
        PontoDaSerie(data=linha[0], peso_medio=_arredondar(linha[1]), animais=linha[2])
        for linha in linhas
    ]


def _lotes(linhas: list) -> list[ResumoLote]:
    """Agrupa por lote em memória — o dado já veio do banco."""
    por_lote: dict = {}
    for l in linhas:
        if l.lote_id is None:
            continue
        grupo = por_lote.setdefault(l.lote_id, {"nome": l.nome, "animais": 0, "pesos": [], "gmds": []})
        grupo["animais"] += 1
        if l.peso_atual is not None:
            grupo["pesos"].append(l.peso_atual)
        if l.gmd is not None:
            grupo["gmds"].append(l.gmd)

    return sorted(
        (
            ResumoLote(
                lote_id=lote_id,
                nome=g["nome"],
                animais=g["animais"],
                peso_medio=_media(g["pesos"]),
                gmd_medio=_media(g["gmds"], casas=3),
            )
            for lote_id, g in por_lote.items()
        ),
        key=lambda r: r.nome,
    )


def _alertas(linhas: list, gmd_meta: Decimal, dias_limite: int) -> dict:
    """Três coisas que o pecuarista precisa ver sem procurar.

    Devolve os mais graves e **quantos existem**: num rebanho grande e mal
    manejado seriam milhares, e a tela mostra oito. "5 de 1.240" é informação
    diferente de "5".
    """
    limite_sem_pesagem = date.today() - timedelta(days=dias_limite)
    alertas: list[Alerta] = []

    for l in linhas:
        if l.ganho is not None and l.ganho < 0:
            # Perder peso é mais grave que ganhar pouco: vem antes.
            alertas.append(
                Alerta(
                    tipo="perda_de_peso",
                    animal_id=l.id,
                    brinco=l.brinco,
                    mensagem=f"Perdeu {abs(l.ganho):.1f} kg desde a primeira pesagem",
                    valor=_arredondar(l.ganho),
                )
            )
        elif l.gmd is not None and Decimal(l.gmd) < gmd_meta:
            alertas.append(
                Alerta(
                    tipo="gmd_baixo",
                    animal_id=l.id,
                    brinco=l.brinco,
                    mensagem=f"Ganhando {Decimal(l.gmd):.2f} kg/dia (meta {gmd_meta:.2f})",
                    valor=_arredondar(l.gmd, 3),
                )
            )

        if l.ultima_data is not None and l.ultima_data < limite_sem_pesagem:
            alertas.append(
                Alerta(
                    tipo="sem_pesagem",
                    animal_id=l.id,
                    brinco=l.brinco,
                    mensagem=f"Sem pesagem desde {l.ultima_data.strftime('%d/%m/%Y')}",
                )
            )

    ordem = {"perda_de_peso": 0, "gmd_baixo": 1, "sem_pesagem": 2}
    alertas.sort(key=lambda a: (ordem[a.tipo], a.valor if a.valor is not None else 0))
    return {"alertas": alertas[:LIMITE_DE_ALERTAS], "alertas_total": len(alertas)}


async def observacoes_recentes(
    sessao: AsyncSession, fazenda_id: uuid.UUID, limite: int = 30
) -> list[ObservacaoRecente]:
    """Observações das pesagens, das mais recentes para as mais antigas.

    O técnico anota "mancando da pata esquerda" e isso ficava enterrado no
    histórico de um animal — quem cuida do rebanho nunca via. É informação de
    saúde chegando pelo caminho do peso, e precisa de um lugar onde apareça.
    """
    linhas = await sessao.execute(
        select(Pesagem, Animal.brinco, Animal.nome, Usuario.nome)
        .join(Animal, Animal.id == Pesagem.animal_id)
        .join(Usuario, Usuario.id == Pesagem.tecnico_id, isouter=True)
        .where(
            Pesagem.fazenda_id == fazenda_id,
            Pesagem.desativado_em.is_(None),
            Animal.desativado_em.is_(None),
            # Áudio pendente de transcrição também conta: o gestor precisa saber
            # que existe uma observação a caminho, não descobrir depois.
            (Pesagem.observacao_texto.isnot(None))
            | (Pesagem.observacao_audio_url.isnot(None)),
        )
        .order_by(Pesagem.data.desc(), Pesagem.coletado_em.desc())
        .limit(limite)
    )

    return [
        ObservacaoRecente(
            pesagem_id=p.id,
            animal_id=p.animal_id,
            brinco=brinco,
            nome_animal=nome_animal,
            data=p.data,
            peso_kg=p.peso_kg,
            texto=(p.observacao_texto or "").strip()
            or ("Áudio aguardando transcrição" if p.observacao_audio_url else ""),
            tem_audio=bool(p.observacao_audio_url),
            status_transcricao=p.status_transcricao.value if p.status_transcricao else None,
            tecnico_nome=tecnico,
        )
        for p, brinco, nome_animal, tecnico in linhas
    ]


async def resumo_do_dia(
    sessao: AsyncSession, fazenda_id: uuid.UUID, tecnico_id: uuid.UUID
) -> ResumoDoDia:
    """Contadores da tela inicial do técnico.

    "Pesadas hoje" conta só o que **este** técnico registrou: é o número que ele
    usa para saber onde parou, não uma estatística da fazenda.
    """
    hoje = date.today()

    pesadas = await sessao.scalar(
        select(func.count(Pesagem.id)).where(
            Pesagem.fazenda_id == fazenda_id,
            Pesagem.tecnico_id == tecnico_id,
            Pesagem.data == hoje,
            Pesagem.desativado_em.is_(None),
        )
    )

    # Lote onde mais se pesou hoje; sem pesagem hoje, o maior lote ativo — é o
    # que o técnico provavelmente vai atacar em seguida.
    lote = (
        await sessao.execute(
            select(Lote.id, Lote.nome, func.count(Pesagem.id).label("hoje"))
            .join(Animal, Animal.lote_id == Lote.id)
            .join(
                Pesagem,
                and_(
                    Pesagem.animal_id == Animal.id,
                    Pesagem.data == hoje,
                    Pesagem.desativado_em.is_(None),
                ),
                isouter=True,
            )
            .where(
                Lote.fazenda_id == fazenda_id,
                Lote.desativado_em.is_(None),
                Animal.desativado_em.is_(None),
                Animal.status == StatusAnimal.ativo,
            )
            .group_by(Lote.id, Lote.nome)
            .order_by(func.count(Pesagem.id).desc(), func.count(Animal.id).desc())
            .limit(1)
        )
    ).first()

    return ResumoDoDia(
        pesadas_hoje=pesadas or 0,
        lote_ativo=lote[1] if lote else None,
        lote_ativo_id=lote[0] if lote else None,
    )


async def detalhe_animal(
    sessao: AsyncSession, fazenda_id: uuid.UUID, animal_id: uuid.UUID
) -> DetalheAnimal | None:
    animal = await sessao.scalar(
        select(Animal).where(Animal.id == animal_id, Animal.fazenda_id == fazenda_id)
    )
    if animal is None:
        return None

    lote_nome = None
    if animal.lote_id:
        lote_nome = await sessao.scalar(select(Lote.nome).where(Lote.id == animal.lote_id))

    linhas = list(
        await sessao.execute(
            select(Pesagem, Usuario.nome)
            .join(Usuario, Usuario.id == Pesagem.tecnico_id, isouter=True)
            .where(
                Pesagem.animal_id == animal_id,
                Pesagem.fazenda_id == fazenda_id,
                Pesagem.desativado_em.is_(None),
            )
            .order_by(Pesagem.data, Pesagem.coletado_em, Pesagem.id)
        )
    )
    pesagens = [linha[0] for linha in linhas]

    peso_inicial = pesagens[0].peso_kg if pesagens else None
    peso_atual = pesagens[-1].peso_kg if pesagens else None
    ganho = (peso_atual - peso_inicial) if len(pesagens) >= 2 else None
    dias = (pesagens[-1].data - pesagens[0].data).days if len(pesagens) >= 2 else None
    gmd = (ganho / Decimal(max(dias or 1, 1))) if ganho is not None else None

    idade = None
    if animal.data_nascimento:
        d = date.today()
        idade = (d.year - animal.data_nascimento.year) * 12 + d.month - animal.data_nascimento.month
        if d.day < animal.data_nascimento.day:
            idade -= 1
        idade = max(idade, 0)

    # O peso ao nascer é um peso medido com data: fica na série, junto das
    # pesagens. Deixá-lo só no cartão de indicadores fazia a curva do animal
    # começar na primeira ida ao curral, escondendo meses de crescimento — e
    # quem abre a ficha do bezerro quer justamente ver de onde ele partiu.
    #
    # Entra **marcado** (`origem="nascimento"`): não é coleta de ninguém, não
    # tem áudio nem autor, e a tela precisa poder dizer isso em vez de exibir
    # uma pesagem que nunca aconteceu.
    serie = []
    if animal.data_nascimento and animal.peso_nascimento:
        serie.append(
            PesagemDaSerie(
                data=animal.data_nascimento,
                peso_kg=animal.peso_nascimento,
                variacao=None,
                tecnico_nome=None,
                observacao_texto=None,
                tem_audio=False,
                origem="nascimento",
            )
        )

    for pesagem, tecnico_nome in linhas:
        anterior = serie[-1].peso_kg if serie else None
        serie.append(
            PesagemDaSerie(
                pesagem_id=pesagem.id,
                data=pesagem.data,
                peso_kg=pesagem.peso_kg,
                # Com o nascimento na série, a primeira pesagem passa a ter um
                # anterior: a variação vira "quanto ganhou desde que nasceu",
                # que é a leitura que faltava.
                variacao=(pesagem.peso_kg - anterior) if anterior is not None else None,
                tecnico_nome=tecnico_nome,
                observacao_texto=pesagem.observacao_texto,
                tem_audio=bool(pesagem.observacao_audio_url),
            )
        )

    # Data de nascimento posterior a uma pesagem é dado errado, mas não pode
    # virar uma curva que anda para trás: ordena e recalcula as variações.
    if len(serie) > 1 and any(serie[i].data < serie[i - 1].data for i in range(1, len(serie))):
        serie.sort(key=lambda p: p.data)
        for i, ponto in enumerate(serie):
            ponto.variacao = (ponto.peso_kg - serie[i - 1].peso_kg) if i > 0 else None

    return DetalheAnimal(
        animal_id=animal.id,
        brinco=animal.brinco,
        nome=animal.nome,
        raca=animal.raca,
        porte=animal.porte,
        brinco_mae=animal.brinco_mae,
        data_nascimento=animal.data_nascimento,
        idade_meses=idade,
        peso_nascimento=animal.peso_nascimento,
        observacoes=animal.observacoes,
        lote_id=animal.lote_id,
        lote=lote_nome,
        status=animal.status.value,
        peso_atual=peso_atual,
        peso_inicial=peso_inicial,
        ganho_total=_arredondar(ganho),
        gmd=_arredondar(gmd, 3),
        dias_acompanhado=dias,
        pesagens=serie,
    )
