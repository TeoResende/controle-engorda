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

from sqlalchemy import Date, Numeric, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Animal, Lote, Pesagem, StatusAnimal
from app.schemas.metricas import (
    Alerta,
    DetalheAnimal,
    PesagemDaSerie,
    PontoDaSerie,
    ResumoLote,
    VisaoGeral,
)

# Abaixo disso o animal está ganhando pouco para engorda e alguém precisa olhar.
GMD_MINIMO = Decimal("0.500")
# Sem pesagem há mais de 45 dias o acompanhamento perdeu o fio.
DIAS_SEM_PESAGEM = 45


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

    Feito em SQL e não em Python porque o rebanho pode ter milhares de animais
    com dezenas de pesagens cada — trazer tudo para a aplicação só para tirar
    média não se sustentaria.

    O desempate é explícito (`data`, depois `coletado_em`, depois `id`): dois
    pesos no mesmo dia é situação normal — repesagem, correção, duas passagens
    pelo curral — e sem ordem definida o Postgres escolheria um deles ao acaso,
    fazendo o mesmo dashboard mostrar números diferentes a cada carga.
    """
    p = _base_pesagens(fazenda_id).subquery()

    ordem_asc = (p.c.data.asc(), p.c.coletado_em.asc(), p.c.id.asc())
    ordem_desc = (p.c.data.desc(), p.c.coletado_em.desc(), p.c.id.desc())

    numerado = select(
        p.c.animal_id,
        p.c.peso_kg,
        p.c.data,
        func.row_number().over(partition_by=p.c.animal_id, order_by=ordem_asc).label("pos_ini"),
        func.row_number().over(partition_by=p.c.animal_id, order_by=ordem_desc).label("pos_fim"),
        func.count().over(partition_by=p.c.animal_id).label("qtd"),
    ).subquery()

    primeira = select(
        numerado.c.animal_id,
        numerado.c.peso_kg.label("peso_inicial"),
        numerado.c.data.label("primeira_data"),
        numerado.c.qtd,
    ).where(numerado.c.pos_ini == 1).subquery()

    ultima = select(
        numerado.c.animal_id,
        numerado.c.peso_kg.label("peso_atual"),
        numerado.c.data.label("ultima_data"),
    ).where(numerado.c.pos_fim == 1).subquery()

    dias = func.greatest(cast(ultima.c.ultima_data - primeira.c.primeira_data, Numeric), 1)

    return select(
        primeira.c.animal_id,
        primeira.c.qtd,
        primeira.c.primeira_data,
        ultima.c.ultima_data,
        primeira.c.peso_inicial,
        ultima.c.peso_atual,
        (ultima.c.peso_atual - primeira.c.peso_inicial).label("ganho"),
        case(
            # Com uma pesagem só não há ganho a medir — GMD fica nulo em vez de
            # zero, que seria lido como "não está ganhando peso".
            (primeira.c.qtd < 2, None),
            else_=(ultima.c.peso_atual - primeira.c.peso_inicial) / dias,
        ).label("gmd"),
    ).join_from(primeira, ultima, ultima.c.animal_id == primeira.c.animal_id)


async def visao_geral(sessao: AsyncSession, fazenda_id: uuid.UUID, meses: int = 6) -> VisaoGeral:
    resumo = _resumo_por_animal(fazenda_id).subquery()

    totais = (
        await sessao.execute(
            select(
                func.count(resumo.c.animal_id),
                func.avg(resumo.c.peso_atual),
                func.avg(resumo.c.gmd),
                func.sum(resumo.c.ganho),
                func.max(resumo.c.ultima_data),
            )
        )
    ).one()

    animais_ativos = await sessao.scalar(
        select(func.count(Animal.id)).where(
            Animal.fazenda_id == fazenda_id,
            Animal.desativado_em.is_(None),
            Animal.status == StatusAnimal.ativo,
        )
    )

    return VisaoGeral(
        animais_ativos=animais_ativos or 0,
        animais_pesados=totais[0] or 0,
        peso_medio=_arredondar(totais[1]),
        gmd_medio=_arredondar(totais[2], 3),
        ganho_total_kg=_arredondar(totais[3]),
        ultima_pesagem=totais[4],
        serie=await _serie(sessao, fazenda_id, meses),
        lotes=await _lotes(sessao, fazenda_id),
        alertas=await _alertas(sessao, fazenda_id),
    )


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


async def _lotes(sessao: AsyncSession, fazenda_id: uuid.UUID) -> list[ResumoLote]:
    resumo = _resumo_por_animal(fazenda_id).subquery()

    linhas = await sessao.execute(
        select(
            Lote.id,
            Lote.nome,
            func.count(Animal.id),
            func.avg(resumo.c.peso_atual),
            func.avg(resumo.c.gmd),
        )
        .select_from(Animal)
        .join(Lote, Lote.id == Animal.lote_id)
        .join(resumo, resumo.c.animal_id == Animal.id, isouter=True)
        .where(
            Animal.fazenda_id == fazenda_id,
            Animal.desativado_em.is_(None),
            Animal.status == StatusAnimal.ativo,
            Lote.desativado_em.is_(None),
        )
        .group_by(Lote.id, Lote.nome)
        .order_by(Lote.nome)
    )
    return [
        ResumoLote(
            lote_id=linha[0],
            nome=linha[1],
            animais=linha[2],
            peso_medio=_arredondar(linha[3]),
            gmd_medio=_arredondar(linha[4], 3),
        )
        for linha in linhas
    ]


async def _alertas(sessao: AsyncSession, fazenda_id: uuid.UUID) -> list[Alerta]:
    """Três coisas que o pecuarista precisa ver sem procurar."""
    resumo = _resumo_por_animal(fazenda_id).subquery()
    limite_sem_pesagem = date.today() - timedelta(days=DIAS_SEM_PESAGEM)

    linhas = await sessao.execute(
        select(
            Animal.id,
            Animal.brinco,
            resumo.c.gmd,
            resumo.c.ganho,
            resumo.c.ultima_data,
        )
        .join(resumo, resumo.c.animal_id == Animal.id)
        .where(Animal.fazenda_id == fazenda_id)
        .order_by(resumo.c.gmd.asc().nulls_last())
    )

    alertas: list[Alerta] = []
    for animal_id, brinco, gmd, ganho, ultima in linhas:
        if ganho is not None and ganho < 0:
            # Perder peso é mais grave que ganhar pouco: vem antes.
            alertas.append(
                Alerta(
                    tipo="perda_de_peso",
                    animal_id=animal_id,
                    brinco=brinco,
                    mensagem=f"Perdeu {abs(ganho):.1f} kg desde a primeira pesagem",
                    valor=_arredondar(ganho),
                )
            )
        elif gmd is not None and Decimal(gmd) < GMD_MINIMO:
            alertas.append(
                Alerta(
                    tipo="gmd_baixo",
                    animal_id=animal_id,
                    brinco=brinco,
                    mensagem=f"Ganhando {Decimal(gmd):.2f} kg/dia (mínimo {GMD_MINIMO})",
                    valor=_arredondar(gmd, 3),
                )
            )
        if ultima is not None and ultima < limite_sem_pesagem:
            alertas.append(
                Alerta(
                    tipo="sem_pesagem",
                    animal_id=animal_id,
                    brinco=brinco,
                    mensagem=f"Sem pesagem desde {ultima.strftime('%d/%m/%Y')}",
                )
            )

    ordem = {"perda_de_peso": 0, "gmd_baixo": 1, "sem_pesagem": 2}
    alertas.sort(key=lambda a: ordem[a.tipo])
    return alertas


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

    pesagens = list(
        await sessao.scalars(
            select(Pesagem)
            .where(
                Pesagem.animal_id == animal_id,
                Pesagem.fazenda_id == fazenda_id,
                Pesagem.desativado_em.is_(None),
            )
            .order_by(Pesagem.data)
        )
    )

    peso_inicial = pesagens[0].peso_kg if pesagens else None
    peso_atual = pesagens[-1].peso_kg if pesagens else None
    ganho = (peso_atual - peso_inicial) if len(pesagens) >= 2 else None
    dias = (pesagens[-1].data - pesagens[0].data).days if len(pesagens) >= 2 else None
    gmd = (ganho / Decimal(max(dias or 1, 1))) if ganho is not None else None

    return DetalheAnimal(
        animal_id=animal.id,
        brinco=animal.brinco,
        nome=animal.nome,
        raca=animal.raca,
        lote=lote_nome,
        status=animal.status.value,
        peso_atual=peso_atual,
        peso_inicial=peso_inicial,
        ganho_total=_arredondar(ganho),
        gmd=_arredondar(gmd, 3),
        dias_acompanhado=dias,
        pesagens=[
            PesagemDaSerie(
                data=p.data,
                peso_kg=p.peso_kg,
                observacao_texto=p.observacao_texto,
                tem_audio=bool(p.observacao_audio_url),
            )
            for p in pesagens
        ],
    )
