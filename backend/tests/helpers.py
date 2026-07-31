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
