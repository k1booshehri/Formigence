"""Validation of respondent answers against a questionnaire's stored schema.

The questionnaire `schema` JSONB was itself validated on write (see
app/schemas/questions.py), so it is re-parsed here into the same models and then
used as the authority for what an acceptable answer looks like.

Every question is required: the question types have no `optional` flag, so an
answer must be present for each one.
"""

from __future__ import annotations

from typing import Any

from pydantic import TypeAdapter, ValidationError

from app.core.errors import AppError
from app.schemas.questions import (
    MultipleChoiceQuestion,
    Question,
    QuestionList,
    ScaleQuestion,
    ShortTextQuestion,
)

_question_list_adapter: TypeAdapter[list[Question]] = TypeAdapter(QuestionList)

# Fallback cap for short_text answers whose question sets no max_length. Without
# it a respondent could post an unbounded blob straight into a model prompt.
DEFAULT_SHORT_TEXT_MAX_LENGTH = 5000


class AnswerValidationError(AppError):
    """422 carrying one entry per rejected question."""

    def __init__(self, errors: list[dict[str, str]]) -> None:
        super().__init__(
            422,
            "invalid_answers",
            "Answers do not match the questionnaire",
            details=errors,
        )


def parse_questions(schema: list[dict[str, Any]]) -> list[Question]:
    """Re-parse a stored schema into question models."""
    return _question_list_adapter.validate_python(schema)


def validate_answers(schema: list[dict[str, Any]], answers: dict[str, Any]) -> dict[str, Any]:
    """Check `answers` against `schema`, returning the normalized answer map.

    Raises AnswerValidationError listing every problem found, rather than
    stopping at the first — a respondent should be able to fix their whole
    submission in one pass.
    """
    try:
        questions = parse_questions(schema)
    except ValidationError as exc:  # pragma: no cover - schema validated on write
        raise AppError(
            500, "invalid_questionnaire_schema", "The questionnaire schema is corrupt"
        ) from exc

    errors: list[dict[str, str]] = []
    known_ids = {question.id for question in questions}

    for unknown_id in sorted(set(answers) - known_ids):
        errors.append({"question_id": unknown_id, "message": "unknown question id"})

    normalized: dict[str, Any] = {}
    for question in questions:
        if question.id not in answers:
            errors.append({"question_id": question.id, "message": "an answer is required"})
            continue
        try:
            normalized[question.id] = _validate_one(question, answers[question.id])
        except ValueError as exc:
            errors.append({"question_id": question.id, "message": str(exc)})

    if errors:
        raise AnswerValidationError(errors)
    return normalized


def _validate_one(question: Question, value: Any) -> Any:
    if isinstance(question, MultipleChoiceQuestion):
        return _validate_multiple_choice(question, value)
    if isinstance(question, ScaleQuestion):
        return _validate_scale(question, value)
    if isinstance(question, ShortTextQuestion):
        return _validate_short_text(question, value)
    raise AssertionError(f"unhandled question type: {question!r}")  # pragma: no cover


def _validate_multiple_choice(question: MultipleChoiceQuestion, value: Any) -> Any:
    options = set(question.options)

    if question.allow_multiple:
        if not isinstance(value, list):
            raise ValueError("expected a list of option values")
        if not value:
            raise ValueError("select at least one option")
        for item in value:
            if not isinstance(item, str):
                raise ValueError("options must be strings")
        if len(set(value)) != len(value):
            raise ValueError("options must not be repeated")
        invalid = [item for item in value if item not in options]
        if invalid:
            raise ValueError(f"not an available option: {', '.join(sorted(invalid))}")
        # Preserve the questionnaire's option order rather than the submitter's.
        return [option for option in question.options if option in set(value)]

    if not isinstance(value, str):
        raise ValueError("expected a single option value")
    if value not in options:
        raise ValueError("not an available option")
    return value


def _validate_scale(question: ScaleQuestion, value: Any) -> int:
    # bool is a subclass of int in Python; True would otherwise pass as 1.
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("expected an integer")
    if value < question.min or value > question.max:
        raise ValueError(f"must be between {question.min} and {question.max}")
    return value


def _validate_short_text(question: ShortTextQuestion, value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("expected text")
    text = value.strip()
    if not text:
        raise ValueError("an answer is required")
    limit = question.max_length or DEFAULT_SHORT_TEXT_MAX_LENGTH
    if len(text) > limit:
        raise ValueError(f"must be at most {limit} characters")
    return text
