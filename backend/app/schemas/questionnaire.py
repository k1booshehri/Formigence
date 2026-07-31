"""Request/response models for questionnaires.

Note on the field named `questions`: the database column and the public JSON key
are both `schema`, but a Pydantic field literally named `schema` would shadow
`BaseModel.schema` and fail at class-construction time. The field is therefore
called `questions` internally and aliased to `schema` on the wire, which keeps
the API and the column name identical without the collision.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.questions import QuestionList

Title = Annotated[str, StringConstraints(min_length=1, max_length=200, strip_whitespace=True)]
Description = Annotated[str, StringConstraints(max_length=5000)]
AnalysisGuide = Annotated[str, StringConstraints(max_length=20000)]

# Fields that may be omitted from a PATCH but must not be sent as null.
_NON_NULLABLE_ON_UPDATE = ("title", "questions", "analysis_guide", "is_published")


class QuestionnaireCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    title: Title
    description: Description | None = None
    questions: QuestionList = Field(alias="schema")
    analysis_guide: AnalysisGuide = ""


class QuestionnaireUpdate(BaseModel):
    """PATCH body. Only the keys actually present in the request are applied."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    title: Title | None = None
    description: Description | None = None
    questions: QuestionList | None = Field(default=None, alias="schema")
    analysis_guide: AnalysisGuide | None = None
    is_published: bool | None = None

    @model_validator(mode="after")
    def _reject_explicit_nulls(self) -> Self:
        for name in _NON_NULLABLE_ON_UPDATE:
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} may not be null")
        return self


class QuestionnaireOut(BaseModel):
    """Owner-facing representation. Includes the private analysis guide."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    owner_id: uuid.UUID
    title: str
    description: str | None
    questions: QuestionList = Field(alias="schema")
    analysis_guide: str
    public_slug: str | None
    is_published: bool
    created_at: datetime
    updated_at: datetime


class PublicQuestionnaireOut(BaseModel):
    """Respondent-facing representation.

    Deliberately omits `analysis_guide` and `owner_id`: the guide is the owner's
    intellectual property and must never reach a respondent. This is enforced by
    the model rather than by hand-filtering at the route.
    """

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    title: str
    description: str | None
    questions: QuestionList = Field(alias="schema")
    public_slug: str
