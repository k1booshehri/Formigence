"""Questionnaire CRUD, including ownership isolation."""

from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.services.email import MemoryEmailSender
from tests.helpers import (
    sample_questionnaire_payload,
    sample_questions,
    sign_in_headers,
)

OWNER = "owner@example.com"
OTHER = "intruder@example.com"


async def test_create_returns_the_stored_questionnaire(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    headers = await sign_in_headers(client, email_sender, OWNER)
    payload = sample_questionnaire_payload()

    response = await client.post("/questionnaires", json=payload, headers=headers)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["title"] == payload["title"]
    assert body["analysis_guide"] == payload["analysis_guide"]
    assert body["schema"] == payload["schema"]
    assert body["is_published"] is False
    assert body["public_slug"] is None
    uuid.UUID(body["id"])


async def test_create_requires_authentication(client: AsyncClient) -> None:
    response = await client.post("/questionnaires", json=sample_questionnaire_payload())
    assert response.status_code == 401


async def test_list_returns_only_the_callers_questionnaires(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    owner_headers = await sign_in_headers(client, email_sender, OWNER)
    other_headers = await sign_in_headers(client, email_sender, OTHER)

    await client.post(
        "/questionnaires",
        json=sample_questionnaire_payload(title="Mine"),
        headers=owner_headers,
    )
    await client.post(
        "/questionnaires",
        json=sample_questionnaire_payload(title="Theirs"),
        headers=other_headers,
    )

    owner_list = await client.get("/questionnaires", headers=owner_headers)
    assert owner_list.status_code == 200
    titles = [item["title"] for item in owner_list.json()]
    assert titles == ["Mine"]


async def test_get_own_questionnaire(client: AsyncClient, email_sender: MemoryEmailSender) -> None:
    headers = await sign_in_headers(client, email_sender, OWNER)
    created = await client.post(
        "/questionnaires", json=sample_questionnaire_payload(), headers=headers
    )
    questionnaire_id = created.json()["id"]

    response = await client.get(f"/questionnaires/{questionnaire_id}", headers=headers)

    assert response.status_code == 200
    assert response.json()["id"] == questionnaire_id


async def test_patch_applies_only_the_supplied_fields(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    headers = await sign_in_headers(client, email_sender, OWNER)
    created = await client.post(
        "/questionnaires", json=sample_questionnaire_payload(), headers=headers
    )
    original = created.json()

    response = await client.patch(
        f"/questionnaires/{original['id']}",
        json={"title": "Renamed"},
        headers=headers,
    )

    assert response.status_code == 200
    updated = response.json()
    assert updated["title"] == "Renamed"
    assert updated["description"] == original["description"]
    assert updated["schema"] == original["schema"]
    assert updated["analysis_guide"] == original["analysis_guide"]


async def test_patch_can_replace_the_schema(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    headers = await sign_in_headers(client, email_sender, OWNER)
    created = await client.post(
        "/questionnaires", json=sample_questionnaire_payload(), headers=headers
    )
    new_schema = [sample_questions()[0]]

    response = await client.patch(
        f"/questionnaires/{created.json()['id']}",
        json={"schema": new_schema},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["schema"] == new_schema


async def test_patch_rejects_an_invalid_schema(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    headers = await sign_in_headers(client, email_sender, OWNER)
    created = await client.post(
        "/questionnaires", json=sample_questionnaire_payload(), headers=headers
    )

    response = await client.patch(
        f"/questionnaires/{created.json()['id']}",
        json={"schema": [{"id": "q1", "type": "nope", "prompt": "?"}]},
        headers=headers,
    )

    assert response.status_code == 422


async def test_patch_rejects_explicit_nulls_for_required_fields(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    headers = await sign_in_headers(client, email_sender, OWNER)
    created = await client.post(
        "/questionnaires", json=sample_questionnaire_payload(), headers=headers
    )

    response = await client.patch(
        f"/questionnaires/{created.json()['id']}", json={"title": None}, headers=headers
    )

    assert response.status_code == 422


async def test_delete_removes_the_questionnaire(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    headers = await sign_in_headers(client, email_sender, OWNER)
    created = await client.post(
        "/questionnaires", json=sample_questionnaire_payload(), headers=headers
    )
    questionnaire_id = created.json()["id"]

    deleted = await client.delete(f"/questionnaires/{questionnaire_id}", headers=headers)
    assert deleted.status_code == 204

    missing = await client.get(f"/questionnaires/{questionnaire_id}", headers=headers)
    assert missing.status_code == 404


async def test_publish_sets_the_flag_and_allocates_a_slug(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    headers = await sign_in_headers(client, email_sender, OWNER)
    created = await client.post(
        "/questionnaires",
        json=sample_questionnaire_payload(title="Growth Readiness Check!"),
        headers=headers,
    )

    response = await client.post(f"/questionnaires/{created.json()['id']}/publish", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["is_published"] is True
    assert body["public_slug"] is not None
    assert body["public_slug"].startswith("growth-readiness-check-")


async def test_publish_is_idempotent_and_keeps_the_slug(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    headers = await sign_in_headers(client, email_sender, OWNER)
    created = await client.post(
        "/questionnaires", json=sample_questionnaire_payload(), headers=headers
    )
    questionnaire_id = created.json()["id"]

    first = await client.post(f"/questionnaires/{questionnaire_id}/publish", headers=headers)
    second = await client.post(f"/questionnaires/{questionnaire_id}/publish", headers=headers)

    assert first.json()["public_slug"] == second.json()["public_slug"]


async def test_slugs_are_unique_across_identical_titles(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    headers = await sign_in_headers(client, email_sender, OWNER)
    slugs = set()
    for _ in range(3):
        created = await client.post(
            "/questionnaires",
            json=sample_questionnaire_payload(title="Same Title"),
            headers=headers,
        )
        published = await client.post(
            f"/questionnaires/{created.json()['id']}/publish", headers=headers
        )
        slugs.add(published.json()["public_slug"])

    assert len(slugs) == 3


# --- Ownership isolation ------------------------------------------------------


async def test_other_owners_get_404_not_403(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    owner_headers = await sign_in_headers(client, email_sender, OWNER)
    created = await client.post(
        "/questionnaires", json=sample_questionnaire_payload(), headers=owner_headers
    )
    questionnaire_id = created.json()["id"]

    other_headers = await sign_in_headers(client, email_sender, OTHER)

    read = await client.get(f"/questionnaires/{questionnaire_id}", headers=other_headers)
    patched = await client.patch(
        f"/questionnaires/{questionnaire_id}", json={"title": "Hijacked"}, headers=other_headers
    )
    published = await client.post(
        f"/questionnaires/{questionnaire_id}/publish", headers=other_headers
    )
    deleted = await client.delete(f"/questionnaires/{questionnaire_id}", headers=other_headers)

    for response in (read, patched, published, deleted):
        assert response.status_code == 404, response.text
        assert response.json()["error"]["code"] == "questionnaire_not_found"

    # And the original is untouched.
    still_there = await client.get(f"/questionnaires/{questionnaire_id}", headers=owner_headers)
    assert still_there.status_code == 200
    assert still_there.json()["title"] != "Hijacked"


async def test_unknown_id_is_404(client: AsyncClient, email_sender: MemoryEmailSender) -> None:
    headers = await sign_in_headers(client, email_sender, OWNER)
    response = await client.get(f"/questionnaires/{uuid.uuid4()}", headers=headers)
    assert response.status_code == 404


async def test_non_uuid_id_is_422(client: AsyncClient, email_sender: MemoryEmailSender) -> None:
    headers = await sign_in_headers(client, email_sender, OWNER)
    response = await client.get("/questionnaires/not-a-uuid", headers=headers)
    assert response.status_code == 422
