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

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def redis_url(self) -> str:
        return f"redis://{self.redis_host}:{self.redis_port}"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
