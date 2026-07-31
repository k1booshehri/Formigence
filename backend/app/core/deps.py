"""Shared FastAPI dependencies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.errors import UnauthorizedError
from app.core.security import TokenError, decode_access_token
from app.models import User
from app.services.auth import AuthService
from app.services.email import EmailSender, build_email_sender
from app.services.questionnaire import QuestionnaireService

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


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]
QuestionnaireServiceDep = Annotated[QuestionnaireService, Depends(get_questionnaire_service)]


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
