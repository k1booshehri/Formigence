"""The questionnaire `schema` must reject malformed question definitions."""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Questionnaire
from app.services.email import MemoryEmailSender
from tests.helpers import sample_questionnaire_payload, sign_in_headers

OWNER = "owner@example.com"


def _mc(**overrides: Any) -> dict[str, Any]:
    question: dict[str, Any] = {
        "id": "q1",
        "type": "multiple_choice",
        "prompt": "Pick one",
        "options": ["a", "b"],
        "allow_multiple": False,
    }
    question.update(overrides)
    return question


def _scale(**overrides: Any) -> dict[str, Any]:
    question: dict[str, Any] = {"id": "q1", "type": "scale", "prompt": "Rate", "min": 1, "max": 5}
    question.update(overrides)
    return question


def _text(**overrides: Any) -> dict[str, Any]:
    question: dict[str, Any] = {"id": "q1", "type": "short_text", "prompt": "Describe"}
    question.update(overrides)
    return question


INVALID_SCHEMAS: list[tuple[str, Any]] = [
    ("empty-list", []),
    ("not-a-list", {"id": "q1", "type": "short_text", "prompt": "x"}),
    ("unknown-type", [{"id": "q1", "type": "ranking", "prompt": "Order these"}]),
    ("missing-type", [{"id": "q1", "prompt": "No type given"}]),
    ("missing-id", [{"type": "short_text", "prompt": "No id"}]),
    ("missing-prompt", [{"id": "q1", "type": "short_text"}]),
    ("empty-prompt", [_text(prompt="")]),
    ("id-with-spaces", [_text(id="not a slug")]),
    ("unknown-key", [_text(extra="surprise")]),
    ("duplicate-ids", [_text(id="dup"), _mc(id="dup")]),
    ("choice-with-one-option", [_mc(options=["only"])]),
    ("choice-with-no-options", [_mc(options=[])]),
    ("choice-with-duplicate-options", [_mc(options=["a", "a"])]),
    ("choice-options-not-strings", [_mc(options=[1, 2])]),
    ("choice-allow-multiple-not-bool", [_mc(allow_multiple="yes please")]),
    ("scale-max-below-min", [_scale(min=5, max=1)]),
    ("scale-max-equals-min", [_scale(min=3, max=3)]),
    ("scale-span-too-wide", [_scale(min=0, max=1000)]),
    ("scale-missing-bounds", [{"id": "q1", "type": "scale", "prompt": "Rate"}]),
    ("scale-non-integer-bounds", [_scale(min="low", max="high")]),
    ("text-max-length-zero", [_text(max_length=0)]),
    ("text-max-length-negative", [_text(max_length=-5)]),
    ("text-max-length-not-a-number", [_text(max_length="long")]),
]


@pytest.mark.parametrize(
    "schema", [pytest.param(value, id=name) for name, value in INVALID_SCHEMAS]
)
async def test_invalid_schemas_are_rejected_on_create(
    client: AsyncClient, email_sender: MemoryEmailSender, schema: Any
) -> None:
    headers = await sign_in_headers(client, email_sender, OWNER)

    response = await client.post(
        "/questionnaires",
        json=sample_questionnaire_payload(schema=schema),
        headers=headers,
    )

    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation_error"


async def test_validation_details_are_json_safe(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    """A custom validator's ValueError must not reach the JSON encoder."""
    headers = await sign_in_headers(client, email_sender, OWNER)

    response = await client.post(
        "/questionnaires",
        json=sample_questionnaire_payload(schema=[_scale(min=5, max=1)]),
        headers=headers,
    )

    assert response.status_code == 422, response.text
    details = response.json()["error"]["details"]
    assert details, "the failing field should be reported"
    for item in details:
        assert set(item) == {"type", "loc", "msg"}
        assert isinstance(item["loc"], list)
    assert any("max must be greater than min" in item["msg"] for item in details)


VALID_SCHEMAS: list[tuple[str, Any]] = [
    ("all-three-types", [_mc(id="a"), _scale(id="b"), _text(id="c")]),
    ("scale-with-labels", [_scale(min_label="Low", max_label="High")]),
    ("scale-with-negative-min", [_scale(min=-5, max=5)]),
    ("text-without-max-length", [_text()]),
    ("choice-allowing-multiple", [_mc(allow_multiple=True)]),
]


@pytest.mark.parametrize("schema", [pytest.param(value, id=name) for name, value in VALID_SCHEMAS])
async def test_valid_schemas_are_accepted(
    client: AsyncClient, email_sender: MemoryEmailSender, schema: Any
) -> None:
    headers = await sign_in_headers(client, email_sender, OWNER)

    response = await client.post(
        "/questionnaires",
        json=sample_questionnaire_payload(schema=schema),
        headers=headers,
    )

    assert response.status_code == 201, response.text


async def test_optional_fields_are_omitted_from_the_stored_jsonb(
    client: AsyncClient, email_sender: MemoryEmailSender, db_session: AsyncSession
) -> None:
    """Unset optionals should not clutter the stored JSONB with nulls."""
    headers = await sign_in_headers(client, email_sender, OWNER)

    response = await client.post(
        "/questionnaires",
        json=sample_questionnaire_payload(schema=[_text()]),
        headers=headers,
    )
    assert response.status_code == 201, response.text

    result = await db_session.execute(select(Questionnaire))
    stored_question = result.scalar_one().schema[0]
    assert stored_question == {"id": "q1", "type": "short_text", "prompt": "Describe"}


async def test_unknown_top_level_keys_are_rejected(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    headers = await sign_in_headers(client, email_sender, OWNER)

    response = await client.post(
        "/questionnaires",
        json=sample_questionnaire_payload(is_published=True),
        headers=headers,
    )

    assert response.status_code == 422


async def test_title_is_required(client: AsyncClient, email_sender: MemoryEmailSender) -> None:
    headers = await sign_in_headers(client, email_sender, OWNER)
    payload = sample_questionnaire_payload()
    del payload["title"]

    response = await client.post("/questionnaires", json=payload, headers=headers)

    assert response.status_code == 422
