"""Application configuration, sourced entirely from environment variables."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Every knob the application exposes. See backend/.env.example."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Application ---
    environment: Literal["development", "test", "production"] = "development"
    debug: bool = False
    project_name: str = "Formigence API"
    api_v1_prefix: str = ""
    # Comma-separated; parsed by `cors_origin_list`. Kept as a plain string so
    # pydantic-settings does not try to JSON-decode the env value.
    cors_origins: str = "http://localhost:5173"

    # --- Database ---
    database_url: str = "postgresql+asyncpg://formigence:formigence@localhost:5432/formigence"
    test_database_url: str = (
        "postgresql+asyncpg://formigence:formigence@localhost:5432/formigence_test"
    )
    db_echo: bool = False

    # --- Security ---
    secret_key: str = "dev-only-insecure-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = Field(default=15, gt=0)
    refresh_token_expire_days: int = Field(default=30, gt=0)

    # --- OTP ---
    otp_length: int = Field(default=6, ge=4, le=10)
    otp_expire_minutes: int = Field(default=10, gt=0)
    otp_max_attempts: int = Field(default=5, gt=0)

    # --- Email ---
    email_backend: Literal["console"] = "console"
    email_from: str = "no-reply@formigence.local"

    # --- Rate limiting ---
    rate_limit_enabled: bool = True
    otp_request_rate_limit_per_ip: str = "10/hour"
    otp_request_rate_limit_per_email: str = "5/hour"
    otp_verify_rate_limit_per_ip: str = "20/hour"
    otp_verify_rate_limit_per_email: str = "10/hour"
    # Deliberately stricter than the auth endpoints: submitting a response costs
    # us an Anthropic API call, so it is the most abusable endpoint we expose.
    response_submit_rate_limit_per_ip: str = "5/hour"

    # --- CAPTCHA ---
    # Off in dev. When enabled, submissions must carry a provider token.
    captcha_enabled: bool = False
    captcha_provider: Literal["turnstile"] = "turnstile"
    turnstile_secret_key: str = ""
    turnstile_verify_url: str = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    captcha_timeout_seconds: float = Field(default=10.0, gt=0)

    # --- Anthropic / analysis ---
    anthropic_api_key: str = ""
    # Pinned rather than tracking "latest" so a model change is a deploy, not a
    # surprise. See README for the current-generation alternative.
    anthropic_model: str = "claude-sonnet-4-6"
    anthropic_max_tokens: int = Field(default=1000, gt=0)
    anthropic_timeout_seconds: float = Field(default=60.0, gt=0)
    # Total attempts = 1 + analysis_max_retries.
    analysis_max_retries: int = Field(default=2, ge=0)
    analysis_retry_base_delay_seconds: float = Field(default=1.0, gt=0)
    analysis_retry_max_delay_seconds: float = Field(default=30.0, gt=0)

    # --- Pagination ---
    page_size_default: int = Field(default=20, gt=0)
    page_size_max: int = Field(default=100, gt=0)

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """Cached accessor so the environment is read once per process."""
    return Settings()


settings = get_settings()
