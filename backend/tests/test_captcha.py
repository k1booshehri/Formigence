"""The CAPTCHA hook: off by default, fail-closed when enabled."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.core.deps import get_captcha_verifier
from app.core.errors import AppError
from app.main import app
from app.services.captcha import (
    NullCaptchaVerifier,
    TurnstileVerifier,
    build_captcha_verifier,
)
from app.services.email import MemoryEmailSender
from tests.helpers import publish_questionnaire, sample_answers


@pytest.fixture
def captcha_enabled() -> Iterator[None]:
    original = settings.captcha_enabled
    settings.captcha_enabled = True
    yield
    settings.captcha_enabled = original


def test_disabled_captcha_selects_the_null_verifier() -> None:
    assert isinstance(build_captcha_verifier(), NullCaptchaVerifier)


def test_enabled_captcha_selects_turnstile(captcha_enabled: None) -> None:
    assert isinstance(build_captcha_verifier(), TurnstileVerifier)


async def test_null_verifier_accepts_anything() -> None:
    await NullCaptchaVerifier().verify(None)
    await NullCaptchaVerifier().verify("whatever")


async def test_turnstile_rejects_a_missing_token() -> None:
    verifier = TurnstileVerifier(secret_key="a-secret")

    with pytest.raises(AppError) as excinfo:
        await verifier.verify(None)

    assert excinfo.value.status_code == 403
    assert excinfo.value.code == "captcha_failed"


async def test_turnstile_fails_closed_without_a_secret_key() -> None:
    """Enabling CAPTCHA without configuring it must not accept everything."""
    verifier = TurnstileVerifier(secret_key="")

    with pytest.raises(AppError) as excinfo:
        await verifier.verify("a-token")

    assert excinfo.value.status_code == 403


async def test_submission_is_rejected_when_the_verifier_refuses(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    info = await publish_questionnaire(client, email_sender)

    class RefusingVerifier:
        async def verify(self, token: str | None, *, remote_ip: str | None = None) -> None:
            raise AppError(403, "captcha_failed", "CAPTCHA verification failed")

    app.dependency_overrides[get_captcha_verifier] = RefusingVerifier

    try:
        response = await client.post(
            f"/public/questionnaires/{info['slug']}/responses",
            json={"answers": sample_answers(), "captcha_token": "bad"},
        )
    finally:
        app.dependency_overrides.pop(get_captcha_verifier, None)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "captcha_failed"


async def test_submission_accepts_a_token_when_captcha_is_off(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    """A client that always sends a token still works in dev."""
    info = await publish_questionnaire(client, email_sender)

    response = await client.post(
        f"/public/questionnaires/{info['slug']}/responses",
        json={"answers": sample_answers(), "captcha_token": "ignored-in-dev"},
    )

    assert response.status_code == 202
