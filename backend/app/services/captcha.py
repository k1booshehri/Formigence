"""CAPTCHA verification for public submissions.

A placeholder hook behind `CAPTCHA_ENABLED`, which is off in development. With
it off, `NullCaptchaVerifier` accepts everything and no token is required, so
local and test flows are unaffected. With it on, submissions must carry a
`captcha_token` that Cloudflare Turnstile accepts.

The Turnstile implementation is deliberately thin — swapping in hCaptcha or
reCAPTCHA means adding a class here and a value to `CAPTCHA_PROVIDER`.
"""

from __future__ import annotations

import logging
from typing import Protocol

import httpx

from app.core.config import settings
from app.core.errors import AppError

logger = logging.getLogger(__name__)


class CaptchaVerificationError(AppError):
    def __init__(self, message: str = "CAPTCHA verification failed") -> None:
        super().__init__(403, "captcha_failed", message)


class CaptchaVerifier(Protocol):
    """The contract a provider implementation must satisfy."""

    async def verify(self, token: str | None, *, remote_ip: str | None = None) -> None:
        """Return normally when the token is acceptable, else raise."""
        ...


class NullCaptchaVerifier:
    """Development/test backend: accepts everything."""

    async def verify(self, token: str | None, *, remote_ip: str | None = None) -> None:
        return None


class TurnstileVerifier:
    """Verifies a token against Cloudflare Turnstile's siteverify endpoint."""

    def __init__(self, secret_key: str | None = None, verify_url: str | None = None) -> None:
        self.secret_key = secret_key or settings.turnstile_secret_key
        self.verify_url = verify_url or settings.turnstile_verify_url

    async def verify(self, token: str | None, *, remote_ip: str | None = None) -> None:
        if not token:
            raise CaptchaVerificationError("A CAPTCHA token is required")
        if not self.secret_key:
            # Fail closed: enabling CAPTCHA without a key must not silently
            # degrade into accepting every submission.
            logger.error("CAPTCHA is enabled but TURNSTILE_SECRET_KEY is not set")
            raise CaptchaVerificationError("CAPTCHA is misconfigured")

        payload = {"secret": self.secret_key, "response": token}
        if remote_ip:
            payload["remoteip"] = remote_ip

        try:
            async with httpx.AsyncClient(timeout=settings.captcha_timeout_seconds) as client:
                result = await client.post(self.verify_url, data=payload)
                result.raise_for_status()
                body = result.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("CAPTCHA verification request failed: %s", exc)
            raise CaptchaVerificationError("Could not verify the CAPTCHA") from exc

        if not body.get("success", False):
            logger.info("CAPTCHA rejected: %s", body.get("error-codes"))
            raise CaptchaVerificationError()


def build_captcha_verifier() -> CaptchaVerifier:
    """Pick the verifier named by CAPTCHA_ENABLED / CAPTCHA_PROVIDER."""
    if not settings.captcha_enabled:
        return NullCaptchaVerifier()
    if settings.captcha_provider == "turnstile":
        return TurnstileVerifier()
    raise ValueError(  # pragma: no cover - Literal-constrained
        f"Unsupported CAPTCHA_PROVIDER: {settings.captcha_provider}"
    )
