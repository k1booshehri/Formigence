"""Owner endpoints for listing and reading responses, including isolation."""

from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.services.email import MemoryEmailSender
from tests.fakes import FakeAnalyzer, make_recommendation
from tests.helpers import (
    publish_questionnaire,
    sample_answers,
    sign_in_headers,
    submit_answers,
)

OWNER = "owner@example.com"
OTHER = "intruder@example.com"


async def test_list_returns_submitted_responses(
    client: AsyncClient, email_sender: MemoryEmailSender, analyzer: FakeAnalyzer
) -> None:
    analyzer.result = make_recommendation(confidence="high")
    info = await publish_questionnaire(client, email_sender)
    await submit_answers(client, info["slug"])
    headers = await sign_in_headers(client, email_sender, OWNER)

    response = await client.get(f"/questionnaires/{info['id']}/responses", headers=headers)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["offset"] == 0
    item = body["items"][0]
    assert item["status"] == "complete"
    assert item["confidence"] == "high"
    assert item["recommendation_summary"]
    uuid.UUID(item["id"])


async def test_list_summary_is_truncated_and_omits_answers(
    client: AsyncClient, email_sender: MemoryEmailSender, analyzer: FakeAnalyzer
) -> None:
    analyzer.result = make_recommendation(recommendation="x" * 400)
    info = await publish_questionnaire(client, email_sender)
    await submit_answers(client, info["slug"], sample_answers(q3="secret respondent text"))
    headers = await sign_in_headers(client, email_sender, OWNER)

    response = await client.get(f"/questionnaires/{info['id']}/responses", headers=headers)

    item = response.json()["items"][0]
    assert len(item["recommendation_summary"]) <= 200
    assert item["recommendation_summary"].endswith("…")
    assert "answers" not in item
    assert "secret respondent text" not in response.text


async def test_list_is_paginated(client: AsyncClient, email_sender: MemoryEmailSender) -> None:
    info = await publish_questionnaire(client, email_sender)
    for _ in range(3):
        await submit_answers(client, info["slug"])
    headers = await sign_in_headers(client, email_sender, OWNER)

    first = await client.get(
        f"/questionnaires/{info['id']}/responses?limit=2&offset=0", headers=headers
    )
    second = await client.get(
        f"/questionnaires/{info['id']}/responses?limit=2&offset=2", headers=headers
    )

    assert first.json()["total"] == 3
    assert len(first.json()["items"]) == 2
    assert len(second.json()["items"]) == 1
    first_ids = {item["id"] for item in first.json()["items"]}
    second_ids = {item["id"] for item in second.json()["items"]}
    assert not (first_ids & second_ids)


async def test_list_rejects_an_out_of_range_limit(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    info = await publish_questionnaire(client, email_sender)
    headers = await sign_in_headers(client, email_sender, OWNER)

    response = await client.get(
        f"/questionnaires/{info['id']}/responses?limit=10000", headers=headers
    )

    assert response.status_code == 422


async def test_detail_returns_answers_and_result(
    client: AsyncClient, email_sender: MemoryEmailSender, analyzer: FakeAnalyzer
) -> None:
    expected = make_recommendation()
    analyzer.result = expected
    info = await publish_questionnaire(client, email_sender)
    response_id = await submit_answers(client, info["slug"])
    headers = await sign_in_headers(client, email_sender, OWNER)

    response = await client.get(
        f"/questionnaires/{info['id']}/responses/{response_id}", headers=headers
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["answers"] == sample_answers()
    assert body["ai_result"]["recommendation"] == expected.recommendation
    assert body["ai_result"]["reasoning"] == expected.reasoning
    assert body["status"] == "complete"


async def test_detail_of_a_failed_response_has_no_result(
    client: AsyncClient, email_sender: MemoryEmailSender, analyzer: FakeAnalyzer
) -> None:
    analyzer.error = RuntimeError("no")
    info = await publish_questionnaire(client, email_sender)
    response_id = await submit_answers(client, info["slug"])
    headers = await sign_in_headers(client, email_sender, OWNER)

    response = await client.get(
        f"/questionnaires/{info['id']}/responses/{response_id}", headers=headers
    )

    assert response.json()["status"] == "failed"
    assert response.json()["ai_result"] is None


# --- Auth and ownership -------------------------------------------------------


async def test_owner_endpoints_require_authentication(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    info = await publish_questionnaire(client, email_sender)
    response_id = await submit_answers(client, info["slug"])

    listed = await client.get(f"/questionnaires/{info['id']}/responses")
    detail = await client.get(f"/questionnaires/{info['id']}/responses/{response_id}")

    assert listed.status_code == 401
    assert detail.status_code == 401


async def test_other_owners_get_404(client: AsyncClient, email_sender: MemoryEmailSender) -> None:
    info = await publish_questionnaire(client, email_sender, owner=OWNER)
    response_id = await submit_answers(client, info["slug"])
    other_headers = await sign_in_headers(client, email_sender, OTHER)

    listed = await client.get(f"/questionnaires/{info['id']}/responses", headers=other_headers)
    detail = await client.get(
        f"/questionnaires/{info['id']}/responses/{response_id}", headers=other_headers
    )

    for response in (listed, detail):
        assert response.status_code == 404, response.text
        assert response.json()["error"]["code"] == "questionnaire_not_found"


async def test_a_response_from_another_questionnaire_is_404(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    """Both questionnaires belong to the caller; the ids simply don't match."""
    first = await publish_questionnaire(client, email_sender, title="First")
    second = await publish_questionnaire(client, email_sender, title="Second")
    response_id = await submit_answers(client, first["slug"])
    headers = await sign_in_headers(client, email_sender, OWNER)

    response = await client.get(
        f"/questionnaires/{second['id']}/responses/{response_id}", headers=headers
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "response_not_found"


async def test_unknown_response_id_is_404(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    info = await publish_questionnaire(client, email_sender)
    headers = await sign_in_headers(client, email_sender, OWNER)

    response = await client.get(
        f"/questionnaires/{info['id']}/responses/{uuid.uuid4()}", headers=headers
    )

    assert response.status_code == 404
