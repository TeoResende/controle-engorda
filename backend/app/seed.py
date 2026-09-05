"""Seed de dados de teste.

Duas fazendas de propósito: o isolamento multi-tenant (M2) só é testável de
verdade se existir dado de outro tenant para vazar.

Uso: docker compose exec backend python -m app.seed [--reset]
"""

import asyncio
import random
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import delete, select

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.core.config import settings
from app.core.security import hash_senha
from app.models import (
    Animal,
    AnimalBrincoHistorico,
    Fazenda,
    Lote,
    Papel,
    Pesagem,
    StatusAnimal,
    StatusTranscricao,
    Usuario,
    UsuarioFazenda,
)

SENHA_PADRAO = "engorda123"

# Observações de campo plausíveis. Sem elas o painel de observações e a
# exportação nasceriam vazios, e ninguém veria que existem.
OBSERVACOES = [
    "Animal manso, sem alteração",
    "Andando com leve claudicação na pata esquerda",
    "Carrapato na região do pescoço, aplicado carrapaticida",
    "Comendo bem, pelo brilhante",
    "Apartado do lote por briga, sem ferimento",
    "Casco dianteiro precisa de aparo",
    "Recusou o cocho hoje, acompanhar",
]


async def limpar(session) -> None:
    for model in (
        Pesagem,
        AnimalBrincoHistorico,
        Animal,
        Lote,
        UsuarioFazenda,
        Usuario,
        Fazenda,
    ):
        await session.execute(delete(model))
    await session.commit()


def _curva_de_peso(peso_inicial: float, gmd: float, dias: int) -> float:
    """Peso após `dias` com ganho médio diário `gmd`, mais ruído de balança."""
    return round(peso_inicial + gmd * dias + random.uniform(-3.5, 3.5), 1)


async def semear() -> None:
    random.seed(42)  # seed fixa: o mesmo comando gera sempre os mesmos números
    hoje = date.today()

    # Conexão administrativa: o seed cria dados de várias fazendas de uma vez, e
    # a RLS — que existe justamente para impedir isso — barraria a aplicação.
    engine = create_async_engine(settings.database_url_admin)
    fabrica = async_sessionmaker(engine, expire_on_commit=False)

    async with fabrica() as session:
        if "--reset" in sys.argv:
            await limpar(session)

        existente = await session.scalar(select(Fazenda).limit(1))
        if existente is not None:
            print("Já existem dados. Use --reset para recriar.")
            return

        fazenda_a = Fazenda(nome="Fazenda Boa Vista", proprietario="João Ribeiro", plano="basico")
        fazenda_b = Fazenda(nome="Fazenda Santa Clara", proprietario="Marina Alves", plano="basico")
        session.add_all([fazenda_a, fazenda_b])
        await session.flush()

        senha = hash_senha(SENHA_PADRAO)
        master = Usuario(
            nome="Root Master", email="master@teste.com", senha_hash=senha, admin_master=True
        )
        admin = Usuario(nome="Ana Admin", email="admin@teste.com", senha_hash=senha)
        tecnico = Usuario(nome="Carlos Técnico", email="tecnico@teste.com", senha_hash=senha)
        cliente_a = Usuario(nome="João Ribeiro", email="joao@teste.com", senha_hash=senha)
        cliente_b = Usuario(nome="Marina Alves", email="marina@teste.com", senha_hash=senha)
        session.add_all([master, admin, tecnico, cliente_a, cliente_b])
        await session.flush()

        session.add_all(
            [
                # Admin nas duas fazendas: é quem consegue mexer em /membros.
                UsuarioFazenda(usuario_id=admin.id, fazenda_id=fazenda_a.id, papel=Papel.admin),
                UsuarioFazenda(usuario_id=admin.id, fazenda_id=fazenda_b.id, papel=Papel.admin),
                # O técnico atende as duas fazendas — caso que o M2 precisa tratar.
                UsuarioFazenda(usuario_id=tecnico.id, fazenda_id=fazenda_a.id, papel=Papel.tecnico),
                UsuarioFazenda(usuario_id=tecnico.id, fazenda_id=fazenda_b.id, papel=Papel.tecnico),
                UsuarioFazenda(usuario_id=cliente_a.id, fazenda_id=fazenda_a.id, papel=Papel.cliente),
                UsuarioFazenda(usuario_id=cliente_b.id, fazenda_id=fazenda_b.id, papel=Papel.cliente),
            ]
        )

        total_animais = 0
        total_pesagens = 0

        for fazenda, prefixo, nomes_lote in (
            (fazenda_a, 1, ["Lote Confinamento 1", "Lote Pasto Norte"]),
            (fazenda_b, 5, ["Lote Recria"]),
        ):
            lotes = [
                Lote(fazenda_id=fazenda.id, nome=nome, data_formacao=hoje - timedelta(days=120))
                for nome in nomes_lote
            ]
            session.add_all(lotes)
            await session.flush()

            for i, lote in enumerate(lotes):
                for j in range(8):
                    brinco = f"{prefixo}{i}{j:02d}"
                    peso_inicial = random.uniform(160, 220)
                    # Um animal por lote com GMD baixo, para o dashboard ter alerta.
                    gmd = 0.25 if j == 0 else random.uniform(0.75, 1.35)

                    animal = Animal(
                        fazenda_id=fazenda.id,
                        brinco=brinco,
                        raca=random.choice(["Nelore", "Angus", "Brangus", "Girolando"]),
                        porte=random.choice(["pequeno", "medio", "grande"]),
                        data_nascimento=hoje - timedelta(days=random.randint(300, 500)),
                        peso_nascimento=Decimal("32.0"),
                        lote_id=lote.id,
                        status=StatusAnimal.ativo,
                    )
                    session.add(animal)
                    await session.flush()
                    total_animais += 1

                    session.add(
                        AnimalBrincoHistorico(animal_id=animal.id, brinco=brinco)
                    )

                    # 5 pesagens a cada ~28 dias, a mais antiga há ~112 dias.
                    for k in range(5):
                        dias_atras = 28 * (4 - k)
                        data_pesagem = hoje - timedelta(days=dias_atras)
                        # 8h da manhã é a hora plausível de curral, mas nunca
                        # no futuro: coleta futura vence o desempate de "última
                        # pesagem" contra dado real e falseia o peso atual.
                        coletado = min(
                            datetime.combine(
                                data_pesagem, datetime.min.time(), tzinfo=timezone.utc
                            )
                            + timedelta(hours=8),
                            datetime.now(timezone.utc) - timedelta(minutes=1),
                        )
                        # Uma em cada quatro pesagens traz observação — é mais
                        # ou menos a proporção que o técnico registra na prática.
                        observacao = (
                            random.choice(OBSERVACOES)
                            if random.random() < 0.25
                            else None
                        )
                        session.add(
                            Pesagem(
                                id=uuid.uuid4(),  # em produção vem do celular
                                fazenda_id=fazenda.id,
                                animal_id=animal.id,
                                data=data_pesagem,
                                peso_kg=Decimal(str(_curva_de_peso(peso_inicial, gmd, 28 * k))),
                                tecnico_id=tecnico.id,
                                coletado_em=coletado,
                                observacao_texto=observacao,
                                status_transcricao=(
                                    StatusTranscricao.concluida if observacao else None
                                ),
                            )
                        )
                        total_pesagens += 1

        await session.commit()

    await engine.dispose()

    print(
        f"Seed pronto: 2 fazendas, 5 usuários, {total_animais} animais, "
        f"{total_pesagens} pesagens. Senha de todos: {SENHA_PADRAO}"
    )


if __name__ == "__main__":
    asyncio.run(semear())
