"""Unauthenticated respondent-facing endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, Request, status

from app.core.config import settings
from app.core.deps import (
    AnalyzerDep,
    CaptchaVerifierDep,
    QuestionnaireServiceDep,
    ResponseServiceDep,
    SessionFactoryDep,
)
from app.core.rate_limit import limiter
from app.schemas.common import ErrorResponse, OpenApiResponses
from app.schemas.questionnaire import PublicQuestionnaireOut
from app.schemas.response import (
    ResponseStatusOut,
    ResponseSubmitIn,
    ResponseSubmitOut,
)
from app.services.analysis import run_analysis_for_response
from app.services.answers import validate_answers

router = APIRouter(prefix="/public", tags=["public"])

_NOT_FOUND: OpenApiResponses = {status.HTTP_404_NOT_FOUND: {"model": ErrorResponse}}


@router.get(
    "/questionnaires/{slug}",
    response_model=PublicQuestionnaireOut,
    summary="Read a published questionnaire by its public slug",
    responses=_NOT_FOUND,
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


@router.post(
    "/questionnaires/{slug}/responses",
    response_model=ResponseSubmitOut,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit answers to a published questionnaire",
    responses={
        **_NOT_FOUND,
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
        status.HTTP_422_UNPROCESSABLE_ENTITY: {"model": ErrorResponse},
        status.HTTP_429_TOO_MANY_REQUESTS: {"model": ErrorResponse},
    },
)
@limiter.limit(settings.response_submit_rate_limit_per_ip)
async def submit_response(
    request: Request,
    slug: str,
    payload: ResponseSubmitIn,
    questionnaires: QuestionnaireServiceDep,
    responses: ResponseServiceDep,
    background_tasks: BackgroundTasks,
    session_factory: SessionFactoryDep,
    analyzer: AnalyzerDep,
    captcha: CaptchaVerifierDep,
) -> ResponseSubmitOut:
    """Accept answers and queue analysis.

    Returns 202 as soon as the row is stored; the Anthropic call happens in the
    background. Poll `GET /public/responses/{response_id}` for the result.
    """
    await captcha.verify(
        payload.captcha_token,
        remote_ip=request.client.host if request.client else None,
    )

    # 404s for an unpublished or unknown slug, before any work is done.
    questionnaire = await questionnaires.get_published_by_slug(slug)

    answers = validate_answers(questionnaire.schema, payload.answers)
    response = await responses.create_pending(questionnaire, answers)

    background_tasks.add_task(
        run_analysis_for_response,
        response.id,
        session_factory=session_factory,
        analyzer=analyzer,
    )
    return ResponseSubmitOut(response_id=response.id, status=response.status)


@router.get(
    "/responses/{response_id}",
    response_model=ResponseStatusOut,
    summary="Poll the status and result of a submitted response",
    responses=_NOT_FOUND,
)
async def get_response_status(
    response_id: uuid.UUID,
    responses: ResponseServiceDep,
) -> ResponseStatusOut:
    """No authentication — the uuid4 response id is the token.

    Returns status and, once complete, the recommendation. The submitted
    answers and the owner's analysis guide are excluded by the response model,
    not by hand-filtering here.
    """
    response = await responses.get_by_token(response_id)
    return ResponseStatusOut.from_response(response)
