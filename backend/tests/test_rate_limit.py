"""The per-email OTP budget.

The app-level fixtures run with rate limiting disabled so the auth tests can
make many requests; this module exercises the limiter directly instead.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from app.core.config import settings
from app.core.errors import AppError
from app.core.rate_limit import enforce_email_rate_limit, reset_email_rate_limits


@pytest.fixture(autouse=True)
def enabled_limiter() -> Iterator[None]:
    original = settings.rate_limit_enabled
    settings.rate_limit_enabled = True
    reset_email_rate_limits()
    yield
    settings.rate_limit_enabled = original
    reset_email_rate_limits()


def test_requests_within_the_budget_are_allowed() -> None:
    for _ in range(3):
        enforce_email_rate_limit("a@example.com", "3/minute", scope="request-otp")


def test_exceeding_the_budget_raises_429() -> None:
    for _ in range(3):
        enforce_email_rate_limit("a@example.com", "3/minute", scope="request-otp")

    with pytest.raises(AppError) as excinfo:
        enforce_email_rate_limit("a@example.com", "3/minute", scope="request-otp")

    assert excinfo.value.status_code == 429
    assert excinfo.value.code == "rate_limited"


def test_budgets_are_per_email() -> None:
    for _ in range(3):
        enforce_email_rate_limit("a@example.com", "3/minute", scope="request-otp")

    # A different address is unaffected.
    enforce_email_rate_limit("b@example.com", "3/minute", scope="request-otp")


def test_budgets_are_case_insensitive() -> None:
    for _ in range(3):
        enforce_email_rate_limit("A@Example.com", "3/minute", scope="request-otp")

    with pytest.raises(AppError):
        enforce_email_rate_limit("a@example.com", "3/minute", scope="request-otp")


def test_scopes_have_independent_budgets() -> None:
    for _ in range(3):
        enforce_email_rate_limit("a@example.com", "3/minute", scope="request-otp")

    # Verifying a code draws on a separate budget.
    enforce_email_rate_limit("a@example.com", "3/minute", scope="verify-otp")


def test_disabling_the_limiter_short_circuits() -> None:
    settings.rate_limit_enabled = False
    for _ in range(50):
        enforce_email_rate_limit("a@example.com", "1/minute", scope="request-otp")
