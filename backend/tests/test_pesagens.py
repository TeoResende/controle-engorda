"""M4 — registro de pesagem e idempotência pelo UUID gerado no celular."""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal


def payload(**extra) -> dict:
    """Pesagem como o celular monta: id próprio, data e hora da coleta."""
    base = {
        "id": str(uuid.uuid4()),
        "data": date.today().isoformat(),
        "peso_kg": "312.50",
        "coletado_em": datetime.now(timezone.utc).isoformat(),
    }
    base.update(extra)
    return base


async def test_registrar_pesagem(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    corpo = payload(animal_id=str(dados["animal_a"].id))

    resposta = await client.post("/pesagens", json=corpo, headers=h)
    assert resposta.status_code == 201, resposta.text
    criada = resposta.json()
    assert criada["id"] == corpo["id"]
    assert criada["peso_kg"] == "312.50"
    assert criada["sincronizado_em"] is not None


async def test_mesma_pesagem_duas_vezes_nao_duplica(client, dados, logar):
    """O critério de aceite do marco."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    corpo = payload(animal_id=str(dados["animal_a"].id))

    primeira = await client.post("/pesagens", json=corpo, headers=h)
    segunda = await client.post("/pesagens", json=corpo, headers=h)

    assert primeira.status_code == 201  # criou agora
    assert segunda.status_code == 200  # já existia
    assert primeira.json()["id"] == segunda.json()["id"]

    lista = (await client.get(f"/pesagens?animal_id={dados['animal_a'].id}", headers=h)).json()
    assert lista["total"] == 1


async def test_reenvio_com_conteudo_diferente_nao_sobrescreve(client, dados, logar):
    """Vale o que chegou primeiro: sobrescrever em silêncio esconderia um bug do
    cliente. Correção é PATCH."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    corpo = payload(animal_id=str(dados["animal_a"].id))
    await client.post("/pesagens", json=corpo, headers=h)

    corpo["peso_kg"] = "999.00"
    reenvio = await client.post("/pesagens", json=corpo, headers=h)
    assert reenvio.status_code == 200
    assert reenvio.json()["peso_kg"] == "312.50"


async def test_dez_reenvios_geram_um_registro(client, dados, logar):
    """A fila do celular pode reprocessar o mesmo item várias vezes."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    animal_id = str(dados["animal_a"].id)
    corpo = payload(animal_id=animal_id)
    for _ in range(10):
        assert (await client.post("/pesagens", json=corpo, headers=h)).status_code in (200, 201)

    assert (await client.get(f"/pesagens?animal_id={animal_id}", headers=h)).json()["total"] == 1


async def test_identificar_o_animal_pelo_brinco(client, dados, logar):
    """O aparelho leu a tag mas pode não conhecer o UUID do animal."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    resposta = await client.post("/pesagens", json=payload(brinco="1001"), headers=h)
    assert resposta.status_code == 201
    assert resposta.json()["animal_id"] == str(dados["animal_a"].id)


async def test_brinco_de_outra_fazenda_nao_resolve(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    # 2001 existe, mas na fazenda B.
    resposta = await client.post("/pesagens", json=payload(brinco="2001"), headers=h)
    assert resposta.status_code == 422


async def test_animal_de_outra_fazenda_e_recusado(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    resposta = await client.post(
        "/pesagens", json=payload(animal_id=str(dados["animal_b"].id)), headers=h
    )
    assert resposta.status_code == 422


async def test_pesagem_sem_identificar_animal(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    assert (await client.post("/pesagens", json=payload(), headers=h)).status_code == 422


async def test_autoria_vem_do_token_e_nao_do_corpo(client, dados, logar):
    """O aparelho não escolhe em nome de quem a pesagem é assinada."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    corpo = payload(animal_id=str(dados["animal_a"].id), tecnico_id=str(dados["cliente_a"].id))
    resposta = await client.post("/pesagens", json=corpo, headers=h)
    assert resposta.status_code == 201
    assert resposta.json()["tecnico_id"] == str(dados["tecnico"].id)


async def test_peso_invalido(client, dados, logar):
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    for peso in ("0", "-10", "5000"):
        corpo = payload(animal_id=str(dados["animal_a"].id), peso_kg=peso)
        assert (await client.post("/pesagens", json=corpo, headers=h)).status_code == 422


async def test_data_no_futuro_e_recusada(client, dados, logar):
    """Só pode ser relógio errado no aparelho."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    corpo = payload(
        animal_id=str(dados["animal_a"].id),
        data=(date.today() + timedelta(days=5)).isoformat(),
    )
    assert (await client.post("/pesagens", json=corpo, headers=h)).status_code == 422


async def test_coletado_em_antigo_e_aceito(client, dados, logar):
    """Dias sem sinal: a coleta é antiga, a sincronização é de agora."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    ha_uma_semana = datetime.now(timezone.utc) - timedelta(days=7)
    corpo = payload(
        animal_id=str(dados["animal_a"].id),
        data=(date.today() - timedelta(days=7)).isoformat(),
        coletado_em=ha_uma_semana.isoformat(),
    )
    resposta = await client.post("/pesagens", json=corpo, headers=h)
    assert resposta.status_code == 201
    corpo_resp = resposta.json()
    assert corpo_resp["coletado_em"] < corpo_resp["sincronizado_em"]


async def test_cliente_nao_registra_pesagem(client, dados, logar):
    h = await logar(dados["cliente_a"])
    corpo = payload(animal_id=str(dados["animal_a"].id))
    assert (await client.post("/pesagens", json=corpo, headers=h)).status_code == 403
    # ...mas lê o histórico normalmente.
    assert (await client.get("/pesagens", headers=h)).status_code == 200


async def test_pesagens_nao_atravessam_fazenda(client, dados, logar):
    ha = await logar(dados["tecnico"], dados["fazenda_a"].id)
    hb = await logar(dados["tecnico"], dados["fazenda_b"].id)

    corpo = payload(animal_id=str(dados["animal_b"].id))
    criada = await client.post("/pesagens", json=corpo, headers=hb)
    assert criada.status_code == 201

    assert (await client.get(f"/pesagens/{corpo['id']}", headers=ha)).status_code == 404
    assert (await client.get("/pesagens", headers=ha)).json()["total"] == 0


async def test_corrida_de_dois_envios_do_mesmo_id(client, dados, logar, monkeypatch):
    """Dois envios simultâneos do mesmo id: a fila reenviou enquanto a primeira
    tentativa ainda estava em voo.

    A checagem prévia não basta — entre o SELECT e o INSERT cabe outro INSERT. A
    barreira real é a PK, e quem perde a corrida precisa ler o registro do
    vencedor em vez de estourar 500.
    """
    from app.core.deps import SessaoFazenda
    from app.models import Pesagem

    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    # O id é lido antes: o rollback dentro da requisição expira os objetos da
    # fixture, que compartilha a sessão com o app nos testes.
    animal_id = str(dados["animal_a"].id)
    corpo = payload(animal_id=animal_id)
    assert (await client.post("/pesagens", json=corpo, headers=h)).status_code == 201

    # Simula a janela: a busca prévia não enxerga o registro que já existe.
    original = SessaoFazenda.obter
    ja_fingiu = False

    async def obter_cego(self, model, id_, **kwargs):
        nonlocal ja_fingiu
        if model is Pesagem and not ja_fingiu:
            ja_fingiu = True
            return None
        return await original(self, model, id_, **kwargs)

    monkeypatch.setattr(SessaoFazenda, "obter", obter_cego)

    resposta = await client.post("/pesagens", json=corpo, headers=h)
    assert resposta.status_code == 200
    assert resposta.json()["id"] == corpo["id"]
    assert (await client.get(f"/pesagens?animal_id={animal_id}", headers=h)).json()["total"] == 1


async def test_coleta_no_futuro_e_recusada(client, dados, logar):
    """Relógio adiantado no aparelho não pode falsear o peso atual.

    `coletado_em` no futuro vence o desempate de "última pesagem" contra toda
    coleta legítima — o animal passa a exibir como peso atual um valor que
    ninguém mediu naquele momento.
    """
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    daqui_dois_dias = datetime.now(timezone.utc) + timedelta(days=2)
    corpo = payload(animal_id=str(dados["animal_a"].id), coletado_em=daqui_dois_dias.isoformat())

    resposta = await client.post("/pesagens", json=corpo, headers=h)
    assert resposta.status_code == 422
    assert "relógio" in resposta.json()["detail"].lower()


async def test_pequeno_adiantamento_de_relogio_e_tolerado(client, dados, logar):
    """Celular com meia hora de diferença é rotina; recusar seria perder dado."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    daqui_pouco = datetime.now(timezone.utc) + timedelta(hours=2)
    corpo = payload(animal_id=str(dados["animal_a"].id), coletado_em=daqui_pouco.isoformat())

    assert (await client.post("/pesagens", json=corpo, headers=h)).status_code == 201


async def test_a_coleta_mais_recente_do_dia_e_a_que_vale(client, dados, logar):
    """Duas pesagens no mesmo dia: vale a mais recente pelo relógio da coleta."""
    h = await logar(dados["tecnico"], dados["fazenda_a"].id)
    animal_id = str(dados["animal_a"].id)
    hoje = date.today().isoformat()
    agora = datetime.now(timezone.utc)

    await client.post(
        "/pesagens",
        json=payload(
            animal_id=animal_id,
            data=hoje,
            peso_kg="300.00",
            coletado_em=(agora - timedelta(hours=3)).isoformat(),
        ),
        headers=h,
    )
    await client.post(
        "/pesagens",
        json=payload(
            animal_id=animal_id,
            data=hoje,
            peso_kg="310.00",
            coletado_em=(agora - timedelta(minutes=5)).isoformat(),
        ),
        headers=h,
    )

    hc = await logar(dados["cliente_a"])
    detalhe = (await client.get(f"/metricas/animal/{animal_id}", headers=hc)).json()
    assert Decimal(detalhe["peso_atual"]) == Decimal("310.00")
