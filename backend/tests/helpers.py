"""Shared helpers for the API tests."""

from __future__ import annotations

import re
from typing import Any

from httpx import AsyncClient

from app.services.email import MemoryEmailSender

_CODE_RE = re.compile(r"Your sign-in code is: (\d+)")


def latest_otp_code(sender: MemoryEmailSender) -> str:
    """Pull the code out of the most recent captured email."""
    assert sender.sent, "no email was sent"
    match = _CODE_RE.search(sender.sent[-1]["body"])
    assert match, f"no code found in email body: {sender.sent[-1]['body']!r}"
    return match.group(1)


async def request_code(client: AsyncClient, sender: MemoryEmailSender, email: str) -> str:
    response = await client.post("/auth/request-otp", json={"email": email})
    assert response.status_code == 200, response.text
    return latest_otp_code(sender)


async def sign_in(client: AsyncClient, sender: MemoryEmailSender, email: str) -> dict[str, Any]:
    """Run the full request -> verify flow and return the token pair."""
    code = await request_code(client, sender, email)
    response = await client.post("/auth/verify-otp", json={"email": email, "code": code})
    assert response.status_code == 200, response.text
    tokens: dict[str, Any] = response.json()
    return tokens


async def sign_in_headers(
    client: AsyncClient, sender: MemoryEmailSender, email: str
) -> dict[str, str]:
    tokens = await sign_in(client, sender, email)
    return auth_headers(tokens["access_token"])


def auth_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def sample_questions() -> list[dict[str, Any]]:
    return [
        {
            "id": "q1",
            "type": "multiple_choice",
            "prompt": "Which channels do you sell through?",
            "options": ["Retail", "Online", "Wholesale"],
            "allow_multiple": True,
        },
        {
            "id": "q2",
            "type": "scale",
            "prompt": "How confident are you in your current pricing?",
            "min": 1,
            "max": 5,
            "min_label": "Not at all",
            "max_label": "Very",
        },
        {
            "id": "q3",
            "type": "short_text",
            "prompt": "What is your biggest bottleneck?",
            "max_length": 500,
        },
    ]


def sample_questionnaire_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "title": "Growth readiness check",
        "description": "A short assessment for small business owners.",
        "schema": sample_questions(),
        "analysis_guide": "Weigh pricing confidence heaviest; recommend one next step.",
    }
    payload.update(overrides)
    return payload


def sample_answers(**overrides: Any) -> dict[str, Any]:
    """A valid answer set for `sample_questions()`."""
    answers: dict[str, Any] = {
        "q1": ["Retail", "Online"],
        "q2": 4,
        "q3": "Finding time to work on the business rather than in it.",
    }
    answers.update(overrides)
    return answers


async def publish_questionnaire(
    client: AsyncClient,
    sender: MemoryEmailSender,
    owner: str = "owner@example.com",
    **payload_overrides: Any,
) -> dict[str, str]:
    """Sign in, create a questionnaire, publish it, and return its id and slug."""
    headers = await sign_in_headers(client, sender, owner)
    created = await client.post(
        "/questionnaires",
        json=sample_questionnaire_payload(**payload_overrides),
        headers=headers,
    )
    assert created.status_code == 201, created.text
    published = await client.post(
        f"/questionnaires/{created.json()['id']}/publish", headers=headers
    )
    assert published.status_code == 200, published.text
    body = published.json()
    return {"id": body["id"], "slug": body["public_slug"]}


async def submit_answers(
    client: AsyncClient, slug: str, answers: dict[str, Any] | None = None
) -> str:
    """Submit a response and return its id."""
    response = await client.post(
        f"/public/questionnaires/{slug}/responses",
        json={"answers": answers if answers is not None else sample_answers()},
    )
    assert response.status_code == 202, response.text
    return str(response.json()["response_id"])
