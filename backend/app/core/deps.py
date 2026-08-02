"""Shared FastAPI dependencies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.db import SessionLocal, get_session
from app.core.errors import UnauthorizedError
from app.core.security import TokenError, decode_access_token
from app.models import User
from app.services.analysis import AnthropicResponseAnalyzer, ResponseAnalyzer
from app.services.auth import AuthService
from app.services.captcha import CaptchaVerifier, build_captcha_verifier
from app.services.email import EmailSender, build_email_sender
from app.services.questionnaire import QuestionnaireService
from app.services.response import ResponseService

# auto_error=False so a missing header produces our own error envelope rather
# than FastAPI's bare {"detail": ...}.
_bearer_scheme = HTTPBearer(auto_error=False)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_email_sender() -> EmailSender:
    return build_email_sender()


EmailSenderDep = Annotated[EmailSender, Depends(get_email_sender)]


def get_auth_service(session: SessionDep, email_sender: EmailSenderDep) -> AuthService:
    return AuthService(session, email_sender)


def get_questionnaire_service(session: SessionDep) -> QuestionnaireService:
    return QuestionnaireService(session)


def get_response_service(session: SessionDep) -> ResponseService:
    return ResponseService(session)


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """The factory background work uses to open its own sessions.

    Background tasks run after the response is sent, by which point the
    request-scoped session is closed — so they cannot borrow it. Exposing the
    factory as a dependency also lets tests point background work at the test
    database.
    """
    return SessionLocal


# Built once: the Anthropic client holds a connection pool, so rebuilding it per
# request would be wasteful. The analyzer itself is stateless.
_analyzer: ResponseAnalyzer | None = None


def get_analyzer() -> ResponseAnalyzer:
    global _analyzer
    if _analyzer is None:
        _analyzer = AnthropicResponseAnalyzer()
    return _analyzer


def get_captcha_verifier() -> CaptchaVerifier:
    return build_captcha_verifier()


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]
QuestionnaireServiceDep = Annotated[QuestionnaireService, Depends(get_questionnaire_service)]
ResponseServiceDep = Annotated[ResponseService, Depends(get_response_service)]
SessionFactoryDep = Annotated[async_sessionmaker[AsyncSession], Depends(get_session_factory)]
AnalyzerDep = Annotated[ResponseAnalyzer, Depends(get_analyzer)]
CaptchaVerifierDep = Annotated[CaptchaVerifier, Depends(get_captcha_verifier)]


async def get_current_user(
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
) -> User:
    if credentials is None or not credentials.credentials:
        raise UnauthorizedError("Missing bearer token", code="missing_token")

    try:
        user_id = decode_access_token(credentials.credentials)
    except TokenError as exc:
        raise UnauthorizedError("Invalid or expired token", code="invalid_token") from exc

    user = await session.get(User, user_id)
    if user is None:
        # Token is well-formed but the account is gone.
        raise UnauthorizedError("Account no longer exists", code="invalid_token")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
