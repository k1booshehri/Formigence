"""Owner-authenticated access to the responses a questionnaire has collected.

Shares the `/questionnaires` prefix with app/api/questionnaires.py; ownership is
enforced the same way, so another owner's questionnaire 404s before any response
row is touched.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status

from app.core.config import settings
from app.core.deps import CurrentUser, ResponseServiceDep
from app.schemas.common import ErrorResponse
from app.schemas.response import ResponseDetailOut, ResponsePage, ResponseSummaryOut

router = APIRouter(prefix="/questionnaires", tags=["responses"])

_COMMON_ERRORS = {
    status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
    status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
}


@router.get(
    "/{questionnaire_id}/responses",
    response_model=ResponsePage,
    summary="List the responses to one of the caller's questionnaires",
    responses=_COMMON_ERRORS,
)
async def list_responses(
    questionnaire_id: uuid.UUID,
    current_user: CurrentUser,
    service: ResponseServiceDep,
    limit: Annotated[int, Query(ge=1, le=settings.page_size_max)] = (settings.page_size_default),
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ResponsePage:
    """Newest first. Each row carries a truncated recommendation, not the full text."""
    responses, total = await service.list_for_questionnaire(
        questionnaire_id, current_user.id, limit=limit, offset=offset
    )
    return ResponsePage(
        items=[ResponseSummaryOut.from_response(item) for item in responses],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{questionnaire_id}/responses/{response_id}",
    response_model=ResponseDetailOut,
    summary="Read one response in full, including answers and the AI result",
    responses=_COMMON_ERRORS,
)
async def get_response(
    questionnaire_id: uuid.UUID,
    response_id: uuid.UUID,
    current_user: CurrentUser,
    service: ResponseServiceDep,
) -> ResponseDetailOut:
    response = await service.get_owned(questionnaire_id, response_id, current_user.id)
    return ResponseDetailOut.from_response(response)
