"""The public endpoint: no auth, and never the owner's analysis guide."""

from __future__ import annotations

from httpx import AsyncClient

from app.services.email import MemoryEmailSender
from tests.helpers import sample_questionnaire_payload, sign_in_headers

OWNER = "owner@example.com"
GUIDE = "Secret scoring rubric that belongs to the owner."


async def _publish(client: AsyncClient, email_sender: MemoryEmailSender) -> dict[str, str]:
    headers = await sign_in_headers(client, email_sender, OWNER)
    created = await client.post(
        "/questionnaires",
        json=sample_questionnaire_payload(analysis_guide=GUIDE),
        headers=headers,
    )
    assert created.status_code == 201, created.text
    published = await client.post(
        f"/questionnaires/{created.json()['id']}/publish", headers=headers
    )
    assert published.status_code == 200, published.text
    return {"slug": published.json()["public_slug"], "id": published.json()["id"]}


async def test_published_questionnaire_is_readable_without_auth(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    info = await _publish(client, email_sender)

    response = await client.get(f"/public/questionnaires/{info['slug']}")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == info["id"]
    assert body["title"] == "Growth readiness check"
    assert body["description"] == "A short assessment for small business owners."
    assert len(body["schema"]) == 3


async def test_public_payload_never_contains_the_analysis_guide(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    info = await _publish(client, email_sender)

    response = await client.get(f"/public/questionnaires/{info['slug']}")

    body = response.json()
    assert "analysis_guide" not in body
    assert "owner_id" not in body
    # Belt and braces: the guide text must not appear anywhere in the response.
    assert GUIDE not in response.text
    assert set(body) == {"id", "title", "description", "schema", "public_slug"}


async def test_unpublished_questionnaire_is_404(
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

    # Unpublish again; the slug is retained but must stop resolving.
    unpublished = await client.patch(
        f"/questionnaires/{created.json()['id']}",
        json={"is_published": False},
        headers=headers,
    )
    assert unpublished.status_code == 200
    assert unpublished.json()["public_slug"] == slug

    response = await client.get(f"/public/questionnaires/{slug}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "questionnaire_not_found"


async def test_never_published_questionnaire_has_no_public_route(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    headers = await sign_in_headers(client, email_sender, OWNER)
    created = await client.post(
        "/questionnaires", json=sample_questionnaire_payload(), headers=headers
    )

    assert created.json()["public_slug"] is None
    assert created.json()["is_published"] is False


async def test_unknown_slug_is_404(client: AsyncClient) -> None:
    response = await client.get("/public/questionnaires/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "questionnaire_not_found"


async def test_public_endpoint_ignores_any_supplied_credentials(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    info = await _publish(client, email_sender)

    response = await client.get(
        f"/public/questionnaires/{info['slug']}",
        headers={"Authorization": "Bearer garbage"},
    )

    assert response.status_code == 200
    assert "analysis_guide" not in response.json()
