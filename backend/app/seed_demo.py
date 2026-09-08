"""Dados de demonstração para VER os gráficos com volume realista.

Cria 100 animais em 4 lotes, cada um com peso de nascimento (35–55 kg) e **4
pesagens mensais** de engorda:

- mês 1: +10 a 20 kg
- mês 2: +20 a 30 kg
- mês 3: +20 a 30 kg
- mês 4: +30 a 50 kg

As datas de nascimento são escalonadas (para o eixo de calendário ter espalhamento
e o de "dias de vida" fazer sentido); as pesagens caem em +30/+60/+90/+120 dias
do nascimento, então a curva de acompanhamento alinha todo mundo no dia 0.

**Destrutivo:** zera a base de negócio antes de carregar. Exige `--confirmar`.

    docker compose exec backend python -m app.seed_demo --confirmar

Login criado: demo@teste.com / engorda123 (admin master). Troque a senha antes
de usar isto em qualquer lugar público.
"""

import asyncio
import random
import uuid
import sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.security import hash_senha
from app.models import Animal, Lote, Papel, Pesagem, StatusAnimal, Usuario, UsuarioFazenda
from app.seed import limpar

SENHA = "engorda123"
RACAS = ["Nelore", "Angus", "Brangus", "Girolando", "Holandês", "Jersey"]
PORTES = ["pequeno", "medio", "grande"]
GANHOS = [(10, 20), (20, 30), (20, 30), (30, 50)]  # por mês


async def semear_demo() -> None:
    if "--confirmar" not in sys.argv:
        print("seed_demo ZERA a base e carrega 100 animais de demonstração.")
        print("Para confirmar:  python -m app.seed_demo --confirmar")
        return

    random.seed(7)
    hoje = date.today()
    engine = create_async_engine(settings.database_url_admin)
    fabrica = async_sessionmaker(engine, expire_on_commit=False)

    async with fabrica() as s:
        await limpar(s)

        fazenda = __import__("app.models", fromlist=["Fazenda"]).Fazenda(
            nome="Fazenda Demo", proprietario="Demonstração", plano="basico"
        )
        s.add(fazenda)
        await s.flush()

        senha = hash_senha(SENHA)
        master = Usuario(nome="Demo Master", email="demo@teste.com", senha_hash=senha, admin_master=True)
        tecnico = Usuario(nome="Téc. Demo", email="tec-demo@teste.com", senha_hash=senha)
        s.add_all([master, tecnico])
        await s.flush()
        s.add(UsuarioFazenda(usuario_id=tecnico.id, fazenda_id=fazenda.id, papel=Papel.tecnico))

        lotes = [
            Lote(fazenda_id=fazenda.id, nome=nome, data_formacao=hoje - timedelta(days=200))
            for nome in ("Lote Aleitamento A", "Lote Aleitamento B", "Lote Creche 1", "Lote Creche 2")
        ]
        s.add_all(lotes)
        await s.flush()

        n_pesagens = 0
        for i in range(100):
            lote = lotes[i // 25]  # 25 por lote
            brinco = f"{2000 + i}"
            # A campanha TERMINA perto de hoje: a 4ª pesagem (nasc+120) cai nos
            # últimos ~25 dias, então nenhum animal dispara alerta de "sem pesagem
            # há +45 dias". Ainda dá ~4 meses de histórico no eixo de calendário.
            nasc = hoje - timedelta(days=120 + random.randint(0, 25))
            peso_nasc = Decimal(str(round(random.uniform(35, 55), 1)))

            animal = Animal(
                fazenda_id=fazenda.id,
                brinco=brinco,
                nome=None,
                raca=random.choice(RACAS),
                porte=random.choice(PORTES),
                data_nascimento=nasc,
                peso_nascimento=peso_nasc,
                lote_id=lote.id,
                status=StatusAnimal.ativo,
            )
            s.add(animal)
            await s.flush()

            peso = float(peso_nasc)
            for mes, (lo, hi) in enumerate(GANHOS, start=1):
                peso += random.uniform(lo, hi)
                data = nasc + timedelta(days=30 * mes)
                s.add(
                    Pesagem(
                        id=uuid.uuid4(),
                        fazenda_id=fazenda.id,
                        animal_id=animal.id,
                        tecnico_id=tecnico.id,
                        data=data,
                        peso_kg=Decimal(str(round(peso, 1))),
                        coletado_em=datetime.combine(data, datetime.min.time(), tzinfo=timezone.utc)
                        + timedelta(hours=8),
                    )
                )
                n_pesagens += 1

        await s.commit()
        print(f"OK: 1 fazenda, 4 lotes, 100 animais, {n_pesagens} pesagens.")
        print("Login: demo@teste.com / engorda123 (admin master)")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(semear_demo())
