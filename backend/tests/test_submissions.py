"""Public response submission: answer validation and the polling endpoint."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Response, ResponseStatus
from app.services.email import MemoryEmailSender
from tests.fakes import FakeAnalyzer, make_recommendation
from tests.helpers import (
    publish_questionnaire,
    sample_answers,
    sample_questionnaire_payload,
    sign_in_headers,
    submit_answers,
)

OWNER = "owner@example.com"


async def test_valid_submission_is_accepted(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    info = await publish_questionnaire(client, email_sender)

    response = await client.post(
        f"/public/questionnaires/{info['slug']}/responses",
        json={"answers": sample_answers()},
    )

    assert response.status_code == 202, response.text
    body = response.json()
    uuid.UUID(body["response_id"])
    assert body["status"] in {"pending", "processing", "complete"}


async def test_submission_requires_no_authentication(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    info = await publish_questionnaire(client, email_sender)

    response = await client.post(
        f"/public/questionnaires/{info['slug']}/responses",
        json={"answers": sample_answers()},
        headers={"Authorization": "Bearer garbage"},
    )

    assert response.status_code == 202


async def test_answers_are_normalised_before_storage(
    client: AsyncClient, email_sender: MemoryEmailSender, db_session: AsyncSession
) -> None:
    info = await publish_questionnaire(client, email_sender)

    await submit_answers(
        client,
        info["slug"],
        sample_answers(q1=["Online", "Retail"], q3="   padded answer   "),
    )

    result = await db_session.execute(select(Response))
    stored = result.scalar_one()
    # Multi-select is stored in questionnaire order, not submission order.
    assert stored.answers["q1"] == ["Retail", "Online"]
    assert stored.answers["q3"] == "padded answer"


# --- Rejections ---------------------------------------------------------------

INVALID_ANSWERS: list[tuple[str, dict[str, Any]]] = [
    ("wrong-option", sample_answers(q1=["Carrier pigeon"])),
    ("option-not-a-list", sample_answers(q1="Retail")),
    ("empty-option-list", sample_answers(q1=[])),
    ("duplicate-options", sample_answers(q1=["Retail", "Retail"])),
    ("option-not-a-string", sample_answers(q1=[1])),
    ("scale-above-max", sample_answers(q2=9)),
    ("scale-below-min", sample_answers(q2=0)),
    ("scale-not-an-integer", sample_answers(q2="4")),
    ("scale-boolean", sample_answers(q2=True)),
    ("short-text-empty", sample_answers(q3="   ")),
    ("short-text-too-long", sample_answers(q3="x" * 501)),
    ("short-text-not-a-string", sample_answers(q3=42)),
]


@pytest.mark.parametrize(
    "answers", [pytest.param(value, id=name) for name, value in INVALID_ANSWERS]
)
async def test_invalid_answers_are_rejected(
    client: AsyncClient, email_sender: MemoryEmailSender, answers: dict[str, Any]
) -> None:
    info = await publish_questionnaire(client, email_sender)

    response = await client.post(
        f"/public/questionnaires/{info['slug']}/responses", json={"answers": answers}
    )

    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "invalid_answers"


async def test_missing_answer_is_rejected(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    info = await publish_questionnaire(client, email_sender)
    answers = sample_answers()
    del answers["q2"]

    response = await client.post(
        f"/public/questionnaires/{info['slug']}/responses", json={"answers": answers}
    )

    assert response.status_code == 422
    details = response.json()["error"]["details"]
    assert any(item["question_id"] == "q2" for item in details)


async def test_unknown_question_id_is_rejected(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    info = await publish_questionnaire(client, email_sender)

    response = await client.post(
        f"/public/questionnaires/{info['slug']}/responses",
        json={"answers": sample_answers(q_bogus="hello")},
    )

    assert response.status_code == 422
    details = response.json()["error"]["details"]
    assert any(
        item["question_id"] == "q_bogus" and "unknown" in item["message"] for item in details
    )


async def test_every_problem_is_reported_at_once(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    info = await publish_questionnaire(client, email_sender)
    answers = sample_answers(q1=["Nope"], q2=99)
    del answers["q3"]

    response = await client.post(
        f"/public/questionnaires/{info['slug']}/responses", json={"answers": answers}
    )

    assert response.status_code == 422
    reported = {item["question_id"] for item in response.json()["error"]["details"]}
    assert reported == {"q1", "q2", "q3"}


async def test_rejected_submission_creates_no_row(
    client: AsyncClient, email_sender: MemoryEmailSender, db_session: AsyncSession
) -> None:
    info = await publish_questionnaire(client, email_sender)

    await client.post(
        f"/public/questionnaires/{info['slug']}/responses",
        json={"answers": sample_answers(q2=99)},
    )

    result = await db_session.execute(select(Response))
    assert result.scalars().all() == []


async def test_unpublished_questionnaire_rejects_submissions(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    headers = await sign_in_headers(client, email_sender, OWNER)
    created = await client.post(
        "/questionnaires", json=sample_questionnaire_payload(), headers=headers
    )
    published = await client.post(
        f"/questionnaires/{created.json()['id']}/publish", headers=headers
    )
    slug = published.json()["public_slug"]

    unpublished = await client.patch(
        f"/questionnaires/{created.json()['id']}",
        json={"is_published": False},
        headers=headers,
    )
    assert unpublished.status_code == 200

    response = await client.post(
        f"/public/questionnaires/{slug}/responses", json={"answers": sample_answers()}
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "questionnaire_not_found"


async def test_unknown_slug_rejects_submissions(client: AsyncClient) -> None:
    response = await client.post(
        "/public/questionnaires/does-not-exist/responses",
        json={"answers": sample_answers()},
    )
    assert response.status_code == 404


async def test_unknown_top_level_keys_are_rejected(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    info = await publish_questionnaire(client, email_sender)

    response = await client.post(
        f"/public/questionnaires/{info['slug']}/responses",
        json={"answers": sample_answers(), "status": "complete"},
    )

    assert response.status_code == 422


# --- Polling ------------------------------------------------------------------


async def test_polling_returns_status_and_result_only(
    client: AsyncClient, email_sender: MemoryEmailSender, analyzer: FakeAnalyzer
) -> None:
    """Background analysis has already run by the time the POST returns.

    Starlette awaits a response's background tasks before the ASGI call
    completes, and httpx's ASGITransport awaits that call — so these tests see
    the finished state without polling or sleeping.
    """
    expected = make_recommendation()
    analyzer.result = expected
    info = await publish_questionnaire(client, email_sender)
    response_id = await submit_answers(client, info["slug"])

    poll = await client.get(f"/public/responses/{response_id}")

    assert poll.status_code == 200
    body = poll.json()
    assert set(body) == {"status", "result"}
    assert body["status"] == "complete"
    assert body["result"]["recommendation"] == expected.recommendation
    assert body["result"]["confidence"] == expected.confidence


async def test_polling_never_exposes_answers_or_guide(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    guide = "Owner-only rubric that must never reach a respondent."
    info = await publish_questionnaire(client, email_sender, analysis_guide=guide)
    response_id = await submit_answers(
        client, info["slug"], sample_answers(q3="a distinctive respondent phrase")
    )

    poll = await client.get(f"/public/responses/{response_id}")

    assert "answers" not in poll.json()
    assert guide not in poll.text
    assert "a distinctive respondent phrase" not in poll.text


async def test_polling_an_unknown_id_is_404(client: AsyncClient) -> None:
    response = await client.get(f"/public/responses/{uuid.uuid4()}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "response_not_found"


async def test_failed_analysis_is_visible_without_a_result(
    client: AsyncClient, email_sender: MemoryEmailSender, analyzer: FakeAnalyzer
) -> None:
    analyzer.error = RuntimeError("model unavailable")
    info = await publish_questionnaire(client, email_sender)
    response_id = await submit_answers(client, info["slug"])

    poll = await client.get(f"/public/responses/{response_id}")

    assert poll.json() == {"status": ResponseStatus.FAILED.value, "result": None}
