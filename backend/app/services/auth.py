"""Passwordless authentication: email OTP in, JWT + refresh token out."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import UnauthorizedError
from app.core.security import (
    create_access_token,
    generate_otp_code,
    generate_refresh_token,
    hash_otp_code,
    hash_refresh_token,
    verify_otp_code,
)
from app.models import OtpCode, RefreshToken, User
from app.schemas.auth import TokenPair
from app.services.email import EmailSender, render_otp_email

logger = logging.getLogger(__name__)


def normalize_email(email: str) -> str:
    return email.strip().lower()


class InvalidCredentialsError(UnauthorizedError):
    """Deliberately vague: never reveals whether the email or the code was wrong."""

    def __init__(self) -> None:
        super().__init__("Invalid or expired code", code="invalid_otp")


class InvalidRefreshTokenError(UnauthorizedError):
    def __init__(self) -> None:
        super().__init__("Invalid or expired refresh token", code="invalid_refresh_token")


class AuthService:
    def __init__(self, session: AsyncSession, email_sender: EmailSender) -> None:
        self.session = session
        self.email_sender = email_sender

    # --- OTP issuing -------------------------------------------------------

    async def request_otp(self, email: str) -> None:
        """Create the user if needed, issue a fresh code, and email it.

        Callers must not vary their response based on anything that happens
        here: the endpoint always returns 200 so that it cannot be used to probe
        which addresses are registered.
        """
        normalized = normalize_email(email)
        user = await self._get_or_create_user(normalized)

        # Only the newest code should ever be usable.
        await self.session.execute(
            update(OtpCode)
            .where(OtpCode.user_id == user.id, OtpCode.consumed_at.is_(None))
            .values(consumed_at=datetime.now(UTC))
        )

        code = generate_otp_code()
        self.session.add(
            OtpCode(
                user_id=user.id,
                code_hash=hash_otp_code(code),
                expires_at=datetime.now(UTC) + timedelta(minutes=settings.otp_expire_minutes),
            )
        )
        await self.session.commit()

        subject, body = render_otp_email(code, settings.otp_expire_minutes)
        await self.email_sender.send(to=normalized, subject=subject, body=body)

    async def _get_or_create_user(self, email: str) -> User:
        existing = await self._get_user_by_email(email)
        if existing is not None:
            return existing

        self.session.add(User(email=email))
        try:
            await self.session.commit()
        except IntegrityError:
            # Concurrent request created the same user first.
            await self.session.rollback()
        created = await self._get_user_by_email(email)
        if created is None:  # pragma: no cover - only reachable if the row vanished
            raise RuntimeError(f"User {email} could not be created")
        return created

    async def _get_user_by_email(self, email: str) -> User | None:
        result = await self.session.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    # --- OTP verification --------------------------------------------------

    async def verify_otp(self, email: str, code: str) -> TokenPair:
        normalized = normalize_email(email)
        user = await self._get_user_by_email(normalized)
        if user is None:
            raise InvalidCredentialsError()

        otp = await self._latest_active_otp(user.id)
        if otp is None:
            raise InvalidCredentialsError()

        now = datetime.now(UTC)
        if otp.expires_at <= now:
            otp.consumed_at = now
            await self.session.commit()
            raise InvalidCredentialsError()

        if otp.attempts >= settings.otp_max_attempts:
            otp.consumed_at = now
            await self.session.commit()
            raise InvalidCredentialsError()

        if not verify_otp_code(otp.code_hash, code):
            otp.attempts += 1
            if otp.attempts >= settings.otp_max_attempts:
                # Burn the code rather than leaving a nearly-exhausted one alive.
                otp.consumed_at = now
            await self.session.commit()
            raise InvalidCredentialsError()

        otp.consumed_at = now
        tokens = await self._issue_tokens(user)
        await self.session.commit()
        return tokens

    async def _latest_active_otp(self, user_id: uuid.UUID) -> OtpCode | None:
        result = await self.session.execute(
            select(OtpCode)
            .where(OtpCode.user_id == user_id, OtpCode.consumed_at.is_(None))
            .order_by(OtpCode.created_at.desc(), OtpCode.id.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    # --- Token issuing and rotation ---------------------------------------

    async def _issue_tokens(self, user: User) -> TokenPair:
        raw_refresh = generate_refresh_token()
        self.session.add(
            RefreshToken(
                user_id=user.id,
                token_hash=hash_refresh_token(raw_refresh),
                expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_expire_days),
            )
        )
        await self.session.flush()
        return TokenPair(
            access_token=create_access_token(user.id),
            refresh_token=raw_refresh,
            expires_in=settings.access_token_expire_minutes * 60,
        )

    async def refresh(self, raw_token: str) -> TokenPair:
        """Exchange a refresh token for a new pair, revoking the old one."""
        token_hash = hash_refresh_token(raw_token)
        result = await self.session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        stored = result.scalar_one_or_none()
        if stored is None:
            raise InvalidRefreshTokenError()

        now = datetime.now(UTC)
        if stored.revoked_at is not None:
            # A revoked token being replayed means it leaked (or the client is
            # broken). Cut the whole family loose and make the user sign in again.
            logger.warning("Refresh token replay detected for user %s", stored.user_id)
            await self._revoke_all_for_user(stored.user_id)
            await self.session.commit()
            raise InvalidRefreshTokenError()

        if stored.expires_at <= now:
            raise InvalidRefreshTokenError()

        user = await self.session.get(User, stored.user_id)
        if user is None:  # pragma: no cover - FK guarantees this
            raise InvalidRefreshTokenError()

        stored.revoked_at = now
        tokens = await self._issue_tokens(user)
        await self.session.commit()
        return tokens

    async def _revoke_all_for_user(self, user_id: uuid.UUID) -> None:
        await self.session.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )
