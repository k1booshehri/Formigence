"""Token issuing/verification, secret hashing, and slug generation."""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import unicodedata
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Final

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error, VerifyMismatchError

from app.core.config import settings

ACCESS_TOKEN_TYPE: Final = "access"

_password_hasher = PasswordHasher()

_SLUG_STRIP_RE = re.compile(r"[^a-z0-9]+")
_SLUG_TRIM_RE = re.compile(r"^-+|-+$")
_MAX_SLUG_BASE_LENGTH: Final = 60


# --- OTP codes -------------------------------------------------------------
# OTPs are low-entropy (6 digits), so they get a slow, salted hash. Attempts are
# also capped in the auth service; the two defences are complementary.


def generate_otp_code(length: int | None = None) -> str:
    """Return a cryptographically random numeric code of the configured length."""
    digits = length if length is not None else settings.otp_length
    return "".join(secrets.choice("0123456789") for _ in range(digits))


def hash_otp_code(code: str) -> str:
    return _password_hasher.hash(code)


def verify_otp_code(code_hash: str, code: str) -> bool:
    try:
        return _password_hasher.verify(code_hash, code)
    except (VerifyMismatchError, Argon2Error, ValueError):
        return False


# --- Refresh tokens --------------------------------------------------------
# Refresh tokens are opaque 256-bit random strings rather than JWTs: they are
# looked up in the database on every use, so they gain nothing from being
# self-describing and lose the ability to be revoked. Being high-entropy, a
# plain SHA-256 digest is sufficient (and keeps the column directly indexable).


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(32)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def refresh_tokens_equal(left: str, right: str) -> bool:
    return hmac.compare_digest(left, right)


# --- Access tokens ---------------------------------------------------------


def create_access_token(
    user_id: uuid.UUID,
    *,
    expires_delta: timedelta | None = None,
) -> str:
    now = datetime.now(UTC)
    expires = now + (
        expires_delta
        if expires_delta is not None
        else timedelta(minutes=settings.access_token_expire_minutes)
    )
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "typ": ACCESS_TOKEN_TYPE,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


class TokenError(Exception):
    """Raised when an access token is missing, malformed, or expired."""


def decode_access_token(token: str) -> uuid.UUID:
    """Return the subject of a valid access token, or raise TokenError."""
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "sub", "typ"]},
        )
    except jwt.PyJWTError as exc:  # expired, bad signature, malformed, ...
        raise TokenError(str(exc)) from exc

    if payload.get("typ") != ACCESS_TOKEN_TYPE:
        raise TokenError("Token is not an access token")

    subject = payload.get("sub")
    if not isinstance(subject, str):
        raise TokenError("Token subject is missing")
    try:
        return uuid.UUID(subject)
    except ValueError as exc:
        raise TokenError("Token subject is not a valid user id") from exc


# --- Slugs -----------------------------------------------------------------


def slugify(value: str) -> str:
    """Reduce arbitrary text to a lowercase, hyphenated, URL-safe stem."""
    normalized = unicodedata.normalize("NFKD", value)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii").lower()
    hyphenated = _SLUG_STRIP_RE.sub("-", ascii_only)
    return _SLUG_TRIM_RE.sub("", hyphenated)[:_MAX_SLUG_BASE_LENGTH].strip("-")


def generate_public_slug(title: str) -> str:
    """Build a public slug from a title, with a random suffix for uniqueness.

    The suffix means a caller cannot enumerate slugs by guessing titles, and it
    keeps collisions vanishingly unlikely without a retry loop in the common case.
    """
    stem = slugify(title) or "questionnaire"
    return f"{stem}-{secrets.token_hex(4)}"
