"""환경 설정. 시크릿은 환경변수로만 들어온다 (ADR-0004)."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"

    # --- HTTP ---
    port: int = 8400
    cors_allow_origins: str = "http://localhost:3400"

    # --- DB ---
    # 앱은 postgresql:// 를 postgresql+asyncpg:// 로 치환한다 (infrastructure/db/session.py).
    # 로컬 기본 포트가 5432 가 아닌 이유는 deploy/docker-compose.dev.yml 주석 참고.
    database_url: str = "postgresql://dahaze:dahaze@localhost:55432/dahaze"

    # --- 세션 쿠키 ---
    # app.dahaze.xyz 와 api.dahaze.xyz 가 상위 도메인 쿠키를 공유한다 (ADR-0004).
    session_secret: str = "dev-only-change-me"
    cookie_domain: str | None = None
    cookie_secure: bool = False
    cookie_samesite: str = "lax"

    # --- OAuth (벤더별 자격증명) ---
    github_client_id: str | None = None
    github_client_secret: str | None = None
    oauth_redirect_uri: str = "http://localhost:8400/api/auth/github/callback"
    web_post_login_url: str = "http://localhost:3400"

    # --- LLM ---
    openai_api_key: str | None = None
    openai_model: str = "gpt-4.1"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
