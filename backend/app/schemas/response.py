"""Request/response models for respondent submissions and their AI results."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError

from app.models.response import ResponseStatus

Confidence = Literal["low", "medium", "high"]

# Bounded so a malformed model reply can't write an unbounded blob into JSONB.
RecommendationText = Annotated[str, StringConstraints(min_length=1, max_length=5000)]


class Recommendation(BaseModel):
    """The validated payload of a `submit_recommendation` tool call."""

    model_config = ConfigDict(extra="forbid")

    recommendation: RecommendationText
    reasoning: RecommendationText
    confidence: Confidence


class ResponseSubmitIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Answers are keyed by question id; values are shape-checked against the
    # questionnaire schema in app/services/answers.py, not here.
    answers: dict[str, Any]
    captcha_token: str | None = Field(
        default=None,
        max_length=4096,
        description="Provider token, required when CAPTCHA verification is enabled",
    )


class ResponseSubmitOut(BaseModel):
    response_id: uuid.UUID = Field(
        description="Unguessable identifier; also the polling token for this response"
    )
    status: ResponseStatus


class ResponseStatusOut(BaseModel):
    """Respondent-facing polling payload.

    Carries the status and, once analysis completes, the recommendation — and
    nothing else. The submitted answers and the owner's analysis guide are
    both absent by construction.
    """

    status: ResponseStatus
    result: Recommendation | None = None

    @classmethod
    def from_response(cls, response: Any) -> ResponseStatusOut:
        return cls(status=response.status, result=_parse_result(response.ai_result))


SUMMARY_MAX_LENGTH = 200


class ResponseSummaryOut(BaseModel):
    """One row of the owner's response list."""

    id: uuid.UUID
    submitted_at: datetime
    status: ResponseStatus
    recommendation_summary: str | None = None
    confidence: Confidence | None = None

    @classmethod
    def from_response(cls, response: Any) -> ResponseSummaryOut:
        result = _parse_result(response.ai_result)
        return cls(
            id=response.id,
            submitted_at=response.created_at,
            status=response.status,
            recommendation_summary=(
                _truncate(result.recommendation) if result is not None else None
            ),
            confidence=result.confidence if result is not None else None,
        )


class ResponseDetailOut(BaseModel):
    """Owner-facing detail: the raw answers plus the full AI result."""

    id: uuid.UUID
    questionnaire_id: uuid.UUID
    submitted_at: datetime
    updated_at: datetime
    status: ResponseStatus
    answers: dict[str, Any]
    ai_result: Recommendation | None = None

    @classmethod
    def from_response(cls, response: Any) -> ResponseDetailOut:
        return cls(
            id=response.id,
            questionnaire_id=response.questionnaire_id,
            submitted_at=response.created_at,
            updated_at=response.updated_at,
            status=response.status,
            answers=response.answers,
            ai_result=_parse_result(response.ai_result),
        )


def _truncate(text: str) -> str:
    if len(text) <= SUMMARY_MAX_LENGTH:
        return text
    return text[: SUMMARY_MAX_LENGTH - 1].rstrip() + "…"


def _parse_result(raw: dict[str, Any] | None) -> Recommendation | None:
    """Parse a stored ai_result, tolerating a row written by an older shape."""
    if not raw:
        return None
    try:
        return Recommendation.model_validate(raw)
    except ValidationError:
        return None


class ResponsePage(BaseModel):
    items: list[ResponseSummaryOut]
    total: int
    limit: int
    offset: int
