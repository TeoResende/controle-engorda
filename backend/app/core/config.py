from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuração da aplicação, lida de variáveis de ambiente."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Postgres
    postgres_user: str = "engorda"
    postgres_password: str = "engorda"
    postgres_db: str = "engorda"
    postgres_host: str = "postgres"
    postgres_port: int = 5432

    # Papel restrito com que a aplicação fala com o banco.
    #
    # Isto é o que faz a Row-Level Security valer: **superusuário do Postgres
    # ignora RLS**, inclusive com FORCE. Enquanto a aplicação usava o usuário
    # dono do banco, as políticas estavam lá e não protegiam nada. As migrations
    # continuam rodando com o usuário administrador, que precisa de DDL.
    postgres_app_user: str = "engorda_app"
    postgres_app_password: str = "engorda_app_dev"

    # Redis
    redis_host: str = "redis"
    redis_port: int = 6379

    # MinIO / S3
    minio_endpoint: str = "http://minio:9000"
    minio_root_user: str = "minioadmin"
    minio_root_password: str = "minioadmin"
    minio_bucket: str = "observacoes"

    # Auth — token longo porque o técnico passa horas offline em campo
    secret_key: str = "troque-esta-chave-em-producao"
    access_token_expire_minutes: int = 720
    refresh_token_expire_days: int = 30

    log_level: str = "info"

    # --- Atrás de proxy ---
    # Quando o TLS termina fora da aplicação — Traefik, Nginx Proxy Manager,
    # Cloudflare —, o backend só sabe que a requisição chegou por HTTPS pelo
    # cabeçalho X-Forwarded-Proto. Sem confiar nele, todo redirecionamento e
    # toda URL gerada saem em http, e o navegador barra por conteúdo misto.
    #
    # Confiar em "*" só é seguro porque o backend não é alcançável de fora da
    # rede do Docker. Se um dia for exposto direto, esta lista precisa virar os
    # IPs reais dos proxies — senão qualquer cliente forja o cabeçalho.
    proxies_confiaveis: str = "*"

    # Origens aceitas pelo navegador. Em desenvolvimento o app roda em outro
    # host; em produção ele é servido do mesmo domínio da API (rota /api), e
    # apertar isso fecha uma porta que não precisa ficar aberta.
    cors_origens: str = "*"

    @property
    def origens_permitidas(self) -> list[str]:
        return [o.strip() for o in self.cors_origens.split(",") if o.strip()]

    # --- Transcrição de áudio (M7) ---
    # API externa primeiro; sem chave ou em caso de falha, cai para o Whisper
    # local. A URL segue o formato da API de transcrição da OpenAI, que virou
    # padrão de fato — outros provedores a implementam.
    transcricao_api_url: str = "https://api.openai.com/v1/audio/transcriptions"
    transcricao_api_chave: str = ""
    transcricao_api_modelo: str = "whisper-1"
    transcricao_timeout_s: int = 60
    # Modelo local do faster-whisper. "small" equilibra qualidade e CPU de VPS;
    # "tiny" cabe em máquina apertada, "medium" pede bem mais memória.
    whisper_modelo_local: str = "small"
    # Teto de duração/tamanho do áudio de observação.
    audio_max_segundos: int = 60
    audio_max_bytes: int = 2 * 1024 * 1024

    # --- Identidade visual ---
    # Logo é exibida em cabeçalho pequeno; acima disso é peso sem ganho visual.
    logo_max_bytes: int = 512 * 1024

    def _url(self, usuario: str, senha: str, banco: str | None = None) -> str:
        return (
            f"postgresql+asyncpg://{usuario}:{senha}"
            f"@{self.postgres_host}:{self.postgres_port}/{banco or self.postgres_db}"
        )

    @property
    def database_url(self) -> str:
        """Conexão da aplicação — papel restrito, sujeito à RLS."""
        return self._url(self.postgres_app_user, self.postgres_app_password)

    @property
    def database_url_admin(self) -> str:
        """Conexão administrativa — migrations e seed, com DDL e sem RLS."""
        return self._url(self.postgres_user, self.postgres_password)

    @property
    def redis_url(self) -> str:
        return f"redis://{self.redis_host}:{self.redis_port}"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
