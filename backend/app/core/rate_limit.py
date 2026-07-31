"""Rate limiting for the OTP endpoints, keyed by client IP and by email.

slowapi covers the per-IP dimension through route decorators. The per-email
dimension cannot use a slowapi key function because the key lives in the request
body, so it is enforced explicitly from the route using the same underlying
`limits` primitives.

Both dimensions use in-process memory storage, which is correct for a single
worker. A multi-worker or multi-instance deployment should swap in the Redis
storage backend; that is a configuration change, not a code change.
"""

from __future__ import annotations

from limits import RateLimitItem, parse
from limits.storage import MemoryStorage
from limits.strategies import MovingWindowRateLimiter
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import settings
from app.core.errors import AppError

limiter = Limiter(key_func=get_remote_address, enabled=settings.rate_limit_enabled)

_email_storage = MemoryStorage()
_email_strategy = MovingWindowRateLimiter(_email_storage)


class RateLimitedError(AppError):
    def __init__(self, message: str = "Too many requests. Please try again later.") -> None:
        super().__init__(429, "rate_limited", message)


def enforce_email_rate_limit(email: str, limit: str, *, scope: str) -> None:
    """Consume one unit of the per-email budget, or raise a 429.

    `scope` separates the budgets of different endpoints so that requesting a
    code and verifying one do not share a counter.
    """
    if not settings.rate_limit_enabled:
        return
    item: RateLimitItem = parse(limit)
    key = f"{scope}:{email.strip().lower()}"
    if not _email_strategy.hit(item, key):
        raise RateLimitedError()


def reset_email_rate_limits() -> None:
    """Clear all per-email counters. Intended for tests."""
    _email_storage.reset()
