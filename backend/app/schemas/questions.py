"""Strict question definitions for the questionnaire `schema` JSONB column.

The three question types form a discriminated union on `type`. Every model
forbids unknown keys, so a malformed definition is rejected at the API boundary
rather than being persisted and blowing up later in the analysis step.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

QuestionId = Annotated[
    str,
    StringConstraints(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"),
]
Prompt = Annotated[str, StringConstraints(min_length=1, max_length=1000, strip_whitespace=True)]
OptionText = Annotated[str, StringConstraints(min_length=1, max_length=300, strip_whitespace=True)]
Label = Annotated[str, StringConstraints(min_length=1, max_length=100, strip_whitespace=True)]

MAX_QUESTIONS = 100
MAX_SCALE_SPAN = 100


class _QuestionBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: QuestionId
    prompt: Prompt


class MultipleChoiceQuestion(_QuestionBase):
    type: Literal["multiple_choice"]
    options: Annotated[list[OptionText], Field(min_length=2, max_length=50)]
    allow_multiple: bool = False

    @model_validator(mode="after")
    def _options_must_be_unique(self) -> MultipleChoiceQuestion:
        if len(set(self.options)) != len(self.options):
            raise ValueError("options must be unique")
        return self


class ScaleQuestion(_QuestionBase):
    type: Literal["scale"]
    min: int
    max: int
    min_label: Label | None = None
    max_label: Label | None = None

    @model_validator(mode="after")
    def _range_must_be_sane(self) -> ScaleQuestion:
        if self.max <= self.min:
            raise ValueError("max must be greater than min")
        if self.max - self.min > MAX_SCALE_SPAN:
            raise ValueError(f"scale span must not exceed {MAX_SCALE_SPAN} points")
        return self


class ShortTextQuestion(_QuestionBase):
    type: Literal["short_text"]
    max_length: Annotated[int, Field(ge=1, le=5000)] | None = None


Question = Annotated[
    MultipleChoiceQuestion | ScaleQuestion | ShortTextQuestion,
    Field(discriminator="type"),
]


def _ids_must_be_unique(questions: list[Question]) -> list[Question]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for question in questions:
        if question.id in seen:
            duplicates.add(question.id)
        seen.add(question.id)
    if duplicates:
        raise ValueError(f"duplicate question ids: {', '.join(sorted(duplicates))}")
    return questions


QuestionList = Annotated[
    list[Question],
    Field(min_length=1, max_length=MAX_QUESTIONS),
    AfterValidator(_ids_must_be_unique),
]
