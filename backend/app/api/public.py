"""Unauthenticated respondent-facing endpoints."""

from __future__ import annotations

from fastapi import APIRouter, status

from app.core.deps import QuestionnaireServiceDep
from app.schemas.common import ErrorResponse
from app.schemas.questionnaire import PublicQuestionnaireOut

router = APIRouter(prefix="/public", tags=["public"])


@router.get(
    "/questionnaires/{slug}",
    response_model=PublicQuestionnaireOut,
    summary="Read a published questionnaire by its public slug",
    responses={status.HTTP_404_NOT_FOUND: {"model": ErrorResponse}},
)
async def get_public_questionnaire(
    slug: str,
    service: QuestionnaireServiceDep,
) -> PublicQuestionnaireOut:
    """No authentication.

    The response model excludes `analysis_guide` — the owner's private prompt
    must never reach a respondent. Unpublished questionnaires 404.
    """
    questionnaire = await service.get_published_by_slug(slug)
    return PublicQuestionnaireOut.model_validate(questionnaire)
