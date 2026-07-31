"""Questionnaire persistence and ownership rules.

Ownership is enforced by scoping every owner-facing query with `owner_id`, so a
questionnaire belonging to someone else is indistinguishable from one that does
not exist — the caller gets a 404, never a 403 that would confirm it is real.
"""

from __future__ import annotations

import uuid
from typing import Any

from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError
from app.core.security import generate_public_slug
from app.models import Questionnaire, User
from app.schemas.questionnaire import QuestionnaireCreate, QuestionnaireUpdate
from app.schemas.questions import Question, QuestionList

_SLUG_ATTEMPTS = 5

# Used to turn validated question models back into JSON-safe dicts for JSONB.
_question_list_adapter: TypeAdapter[list[Question]] = TypeAdapter(QuestionList)


def serialize_questions(questions: list[Question]) -> list[dict[str, Any]]:
    dumped = _question_list_adapter.dump_python(questions, mode="json", exclude_none=True)
    return [dict(item) for item in dumped]


class QuestionnaireNotFoundError(NotFoundError):
    def __init__(self) -> None:
        super().__init__("Questionnaire not found", code="questionnaire_not_found")


class QuestionnaireService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # --- Owner-scoped operations ------------------------------------------

    async def create(self, owner: User, data: QuestionnaireCreate) -> Questionnaire:
        questionnaire = Questionnaire(
            owner_id=owner.id,
            title=data.title,
            description=data.description,
            schema=serialize_questions(data.questions),
            analysis_guide=data.analysis_guide,
            is_published=False,
        )
        self.session.add(questionnaire)
        await self.session.commit()
        await self.session.refresh(questionnaire)
        return questionnaire

    async def list_for_owner(self, owner_id: uuid.UUID) -> list[Questionnaire]:
        result = await self.session.execute(
            select(Questionnaire)
            .where(Questionnaire.owner_id == owner_id)
            .order_by(Questionnaire.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_owned(self, questionnaire_id: uuid.UUID, owner_id: uuid.UUID) -> Questionnaire:
        result = await self.session.execute(
            select(Questionnaire).where(
                Questionnaire.id == questionnaire_id,
                Questionnaire.owner_id == owner_id,
            )
        )
        questionnaire = result.scalar_one_or_none()
        if questionnaire is None:
            raise QuestionnaireNotFoundError()
        return questionnaire

    async def update(
        self,
        questionnaire_id: uuid.UUID,
        owner_id: uuid.UUID,
        data: QuestionnaireUpdate,
    ) -> Questionnaire:
        questionnaire = await self.get_owned(questionnaire_id, owner_id)
        changes = data.model_dump(exclude_unset=True)

        # `_reject_explicit_nulls` on the schema guarantees these are non-null
        # whenever the key is present, so the None checks below only narrow types.
        if "title" in changes and data.title is not None:
            questionnaire.title = data.title
        if "description" in changes:
            questionnaire.description = data.description
        if "analysis_guide" in changes and data.analysis_guide is not None:
            questionnaire.analysis_guide = data.analysis_guide
        if "questions" in changes and data.questions is not None:
            questionnaire.schema = serialize_questions(data.questions)
        if "is_published" in changes and data.is_published is not None:
            questionnaire.is_published = data.is_published
            if data.is_published and questionnaire.public_slug is None:
                await self._assign_slug(questionnaire)

        await self.session.commit()
        await self.session.refresh(questionnaire)
        return questionnaire

    async def delete(self, questionnaire_id: uuid.UUID, owner_id: uuid.UUID) -> None:
        questionnaire = await self.get_owned(questionnaire_id, owner_id)
        await self.session.delete(questionnaire)
        await self.session.commit()

    async def publish(self, questionnaire_id: uuid.UUID, owner_id: uuid.UUID) -> Questionnaire:
        questionnaire = await self.get_owned(questionnaire_id, owner_id)
        if questionnaire.public_slug is None:
            await self._assign_slug(questionnaire)
        questionnaire.is_published = True
        await self.session.commit()
        await self.session.refresh(questionnaire)
        return questionnaire

    async def _assign_slug(self, questionnaire: Questionnaire) -> None:
        """Pick a free slug.

        The 32-bit random suffix makes collisions vanishingly unlikely; the loop
        exists so that the rare case degrades into a retry rather than a 500.
        The unique constraint on the column remains the real guarantee.
        """
        for _ in range(_SLUG_ATTEMPTS):
            candidate = generate_public_slug(questionnaire.title)
            existing = await self.session.execute(
                select(Questionnaire.id).where(Questionnaire.public_slug == candidate)
            )
            if existing.scalar_one_or_none() is None:
                questionnaire.public_slug = candidate
                return
        raise ConflictError("Could not allocate a unique public slug", code="slug_conflict")

    # --- Public (unauthenticated) operations -------------------------------

    async def get_published_by_slug(self, slug: str) -> Questionnaire:
        result = await self.session.execute(
            select(Questionnaire).where(
                Questionnaire.public_slug == slug,
                Questionnaire.is_published.is_(True),
            )
        )
        questionnaire = result.scalar_one_or_none()
        if questionnaire is None:
            raise QuestionnaireNotFoundError()
        return questionnaire
