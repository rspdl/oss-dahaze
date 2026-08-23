"""환경 설정. 시크릿은 환경변수로만 들어온다 (ADR-0004)."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SESSION_SECRET = "dev-only-change-me"
# HMAC-SHA256 의 권장 최소 키 길이 (RFC 7518 §3.2).
MIN_SECRET_BYTES = 32


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
    session_secret: str = DEFAULT_SESSION_SECRET
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

    @property
    def is_development(self) -> bool:
        return self.environment == "development"

    def assert_production_ready(self) -> None:
        """운영으로 뜨기 전에 치명적인 설정 누락을 잡는다.

        세션과 MCP 토큰이 모두 `session_secret` 하나로 서명된다. 배포에서 환경변수를
        빠뜨리면 기본값(18바이트)으로 조용히 돌아가고, 그건 HMAC-SHA256 권장치 32바이트에
        못 미친다. 조용히 약한 키를 쓰느니 뜨지 않는 편이 낫다.
        """
        if self.is_development:
            return

        problems: list[str] = []
        if self.session_secret == DEFAULT_SESSION_SECRET:
            problems.append("SESSION_SECRET 이 기본값 그대로다")
        if len(self.session_secret.encode()) < MIN_SECRET_BYTES:
            problems.append(
                f"SESSION_SECRET 이 {MIN_SECRET_BYTES}바이트 미만이다 "
                "(openssl rand -hex 32)"
            )
        if not self.cookie_secure:
            problems.append("COOKIE_SECURE 가 꺼져 있다")

        if problems:
            raise RuntimeError(
                f"environment={self.environment} 로는 뜰 수 없다: " + "; ".join(problems)
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()
