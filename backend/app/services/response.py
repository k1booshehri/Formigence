"""Response persistence and the owner-scoped queries over it.

Ownership works exactly as in phase 1: owner-facing reads resolve the parent
questionnaire through `QuestionnaireService.get_owned` first, so a response
belonging to someone else's questionnaire is a 404, not a 403.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.models import Questionnaire, Response, ResponseStatus
from app.services.questionnaire import QuestionnaireService


class ResponseNotFoundError(NotFoundError):
    def __init__(self) -> None:
        super().__init__("Response not found", code="response_not_found")


class ResponseService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.questionnaires = QuestionnaireService(session)

    # --- Public (unauthenticated) operations -------------------------------

    async def create_pending(
        self, questionnaire: Questionnaire, answers: dict[str, Any]
    ) -> Response:
        response = Response(
            questionnaire_id=questionnaire.id,
            answers=answers,
            status=ResponseStatus.PENDING,
        )
        self.session.add(response)
        await self.session.commit()
        await self.session.refresh(response)
        return response

    async def get_by_token(self, response_id: uuid.UUID) -> Response:
        """Look up a response by its id.

        The id is a uuid4 and is the only credential for polling, so treat it as
        an unguessable bearer token: no other authorization is applied, and the
        caller only ever sees status and result.
        """
        response = await self.session.get(Response, response_id)
        if response is None:
            raise ResponseNotFoundError()
        return response

    # --- Owner-scoped operations -------------------------------------------

    async def list_for_questionnaire(
        self,
        questionnaire_id: uuid.UUID,
        owner_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
    ) -> tuple[list[Response], int]:
        # 404s when the questionnaire is not the caller's.
        await self.questionnaires.get_owned(questionnaire_id, owner_id)

        total = await self.session.scalar(
            select(func.count())
            .select_from(Response)
            .where(Response.questionnaire_id == questionnaire_id)
        )
        result = await self.session.execute(
            select(Response)
            .where(Response.questionnaire_id == questionnaire_id)
            .order_by(Response.created_at.desc(), Response.id.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().all()), int(total or 0)

    async def get_owned(
        self,
        questionnaire_id: uuid.UUID,
        response_id: uuid.UUID,
        owner_id: uuid.UUID,
    ) -> Response:
        await self.questionnaires.get_owned(questionnaire_id, owner_id)

        result = await self.session.execute(
            select(Response).where(
                Response.id == response_id,
                Response.questionnaire_id == questionnaire_id,
            )
        )
        response = result.scalar_one_or_none()
        if response is None:
            raise ResponseNotFoundError()
        return response
