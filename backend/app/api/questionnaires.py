"""Owner-authenticated questionnaire CRUD.

Every route resolves the questionnaire through the owner-scoped service, so
another owner's resource returns 404 rather than 403.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Response, status

from app.core.deps import CurrentUser, QuestionnaireServiceDep
from app.schemas.common import ErrorResponse
from app.schemas.questionnaire import (
    QuestionnaireCreate,
    QuestionnaireOut,
    QuestionnaireUpdate,
)

router = APIRouter(prefix="/questionnaires", tags=["questionnaires"])

_COMMON_ERRORS = {
    status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
    status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
}


@router.post(
    "",
    response_model=QuestionnaireOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a questionnaire",
    responses={status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse}},
)
async def create_questionnaire(
    payload: QuestionnaireCreate,
    current_user: CurrentUser,
    service: QuestionnaireServiceDep,
) -> QuestionnaireOut:
    questionnaire = await service.create(current_user, payload)
    return QuestionnaireOut.model_validate(questionnaire)


@router.get(
    "",
    response_model=list[QuestionnaireOut],
    summary="List the caller's questionnaires",
    responses={status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse}},
)
async def list_questionnaires(
    current_user: CurrentUser,
    service: QuestionnaireServiceDep,
) -> list[QuestionnaireOut]:
    questionnaires = await service.list_for_owner(current_user.id)
    return [QuestionnaireOut.model_validate(item) for item in questionnaires]


@router.get(
    "/{questionnaire_id}",
    response_model=QuestionnaireOut,
    summary="Read one of the caller's questionnaires",
    responses=_COMMON_ERRORS,
)
async def get_questionnaire(
    questionnaire_id: uuid.UUID,
    current_user: CurrentUser,
    service: QuestionnaireServiceDep,
) -> QuestionnaireOut:
    questionnaire = await service.get_owned(questionnaire_id, current_user.id)
    return QuestionnaireOut.model_validate(questionnaire)


@router.patch(
    "/{questionnaire_id}",
    response_model=QuestionnaireOut,
    summary="Partially update a questionnaire",
    responses=_COMMON_ERRORS,
)
async def update_questionnaire(
    questionnaire_id: uuid.UUID,
    payload: QuestionnaireUpdate,
    current_user: CurrentUser,
    service: QuestionnaireServiceDep,
) -> QuestionnaireOut:
    questionnaire = await service.update(questionnaire_id, current_user.id, payload)
    return QuestionnaireOut.model_validate(questionnaire)


@router.delete(
    "/{questionnaire_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a questionnaire",
    responses=_COMMON_ERRORS,
)
async def delete_questionnaire(
    questionnaire_id: uuid.UUID,
    current_user: CurrentUser,
    service: QuestionnaireServiceDep,
) -> Response:
    await service.delete(questionnaire_id, current_user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{questionnaire_id}/publish",
    response_model=QuestionnaireOut,
    summary="Publish a questionnaire, allocating a public slug if needed",
    responses=_COMMON_ERRORS,
)
async def publish_questionnaire(
    questionnaire_id: uuid.UUID,
    current_user: CurrentUser,
    service: QuestionnaireServiceDep,
) -> QuestionnaireOut:
    questionnaire = await service.publish(questionnaire_id, current_user.id)
    return QuestionnaireOut.model_validate(questionnaire)
