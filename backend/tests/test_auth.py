"""End-to-end coverage of the passwordless auth flow."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_access_token
from app.models import OtpCode, RefreshToken, User
from app.services.email import MemoryEmailSender
from tests.helpers import auth_headers, latest_otp_code, request_code, sign_in

EMAIL = "owner@example.com"


async def test_full_flow_request_verify_then_authenticated_request(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    code = await request_code(client, email_sender, EMAIL)
    assert len(code) == settings.otp_length

    verify = await client.post("/auth/verify-otp", json={"email": EMAIL, "code": code})
    assert verify.status_code == 200
    tokens = verify.json()
    assert tokens["token_type"] == "bearer"
    assert tokens["expires_in"] == settings.access_token_expire_minutes * 60
    assert tokens["access_token"] and tokens["refresh_token"]

    me = await client.get("/me", headers=auth_headers(tokens["access_token"]))
    assert me.status_code == 200
    assert me.json()["email"] == EMAIL


async def test_request_otp_returns_200_for_unknown_and_known_addresses(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    first = await client.post("/auth/request-otp", json={"email": "brand-new@example.com"})
    second = await client.post("/auth/request-otp", json={"email": "brand-new@example.com"})

    assert first.status_code == 200
    assert second.status_code == 200
    # Identical body: the response must not leak whether the account existed.
    assert first.json() == second.json()
    assert len(email_sender.sent) == 2


async def test_request_otp_creates_the_user(
    client: AsyncClient, email_sender: MemoryEmailSender, db_session: AsyncSession
) -> None:
    await request_code(client, email_sender, EMAIL)

    result = await db_session.execute(select(User).where(User.email == EMAIL))
    assert result.scalar_one().email == EMAIL


async def test_email_is_normalised_to_lowercase(
    client: AsyncClient, email_sender: MemoryEmailSender, db_session: AsyncSession
) -> None:
    await request_code(client, email_sender, "Mixed.Case@Example.COM")
    await request_code(client, email_sender, "mixed.case@example.com")

    result = await db_session.execute(select(User).where(User.email == "mixed.case@example.com"))
    assert len(list(result.scalars().all())) == 1


async def test_otp_is_single_use(client: AsyncClient, email_sender: MemoryEmailSender) -> None:
    code = await request_code(client, email_sender, EMAIL)

    first = await client.post("/auth/verify-otp", json={"email": EMAIL, "code": code})
    assert first.status_code == 200

    replay = await client.post("/auth/verify-otp", json={"email": EMAIL, "code": code})
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "invalid_otp"


async def test_requesting_a_new_code_invalidates_the_previous_one(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    first_code = await request_code(client, email_sender, EMAIL)
    second_code = await request_code(client, email_sender, EMAIL)
    if first_code == second_code:  # pragma: no cover - 1-in-10^6 collision
        pytest.skip("the two random codes collided")

    stale = await client.post("/auth/verify-otp", json={"email": EMAIL, "code": first_code})
    assert stale.status_code == 401

    fresh = await client.post("/auth/verify-otp", json={"email": EMAIL, "code": second_code})
    assert fresh.status_code == 200


async def test_expired_otp_is_rejected(
    client: AsyncClient, email_sender: MemoryEmailSender, db_session: AsyncSession
) -> None:
    code = await request_code(client, email_sender, EMAIL)

    result = await db_session.execute(select(OtpCode))
    otp = result.scalar_one()
    otp.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.commit()

    response = await client.post("/auth/verify-otp", json={"email": EMAIL, "code": code})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_otp"


async def test_otp_is_burned_after_max_attempts(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    code = await request_code(client, email_sender, EMAIL)
    all_zeroes = "0" * settings.otp_length
    wrong = "1" * settings.otp_length if code == all_zeroes else all_zeroes

    for _ in range(settings.otp_max_attempts):
        failed = await client.post("/auth/verify-otp", json={"email": EMAIL, "code": wrong})
        assert failed.status_code == 401

    # The correct code no longer works: the attempt budget burned it.
    exhausted = await client.post("/auth/verify-otp", json={"email": EMAIL, "code": code})
    assert exhausted.status_code == 401
    assert exhausted.json()["error"]["code"] == "invalid_otp"


async def test_verify_with_unknown_email_is_401(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/verify-otp", json={"email": "nobody@example.com", "code": "123456"}
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_otp"


async def test_otp_code_is_not_stored_in_plaintext(
    client: AsyncClient, email_sender: MemoryEmailSender, db_session: AsyncSession
) -> None:
    code = await request_code(client, email_sender, EMAIL)

    result = await db_session.execute(select(OtpCode))
    otp = result.scalar_one()
    assert code not in otp.code_hash
    assert otp.code_hash.startswith("$argon2")


# --- Refresh -----------------------------------------------------------------


async def test_refresh_rotates_the_token(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    tokens = await sign_in(client, email_sender, EMAIL)

    refreshed = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refreshed.status_code == 200
    new_tokens = refreshed.json()
    assert new_tokens["refresh_token"] != tokens["refresh_token"]

    me = await client.get("/me", headers=auth_headers(new_tokens["access_token"]))
    assert me.status_code == 200


async def test_replaying_a_rotated_refresh_token_is_rejected(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    tokens = await sign_in(client, email_sender, EMAIL)
    first = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert first.status_code == 200

    replay = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "invalid_refresh_token"


async def test_replay_revokes_the_whole_token_family(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    tokens = await sign_in(client, email_sender, EMAIL)
    rotated = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    successor = rotated.json()["refresh_token"]

    # Replaying the revoked original should also invalidate its successor.
    await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})

    response = await client.post("/auth/refresh", json={"refresh_token": successor})
    assert response.status_code == 401


async def test_unknown_refresh_token_is_rejected(client: AsyncClient) -> None:
    response = await client.post("/auth/refresh", json={"refresh_token": "not-a-real-token"})
    assert response.status_code == 401


async def test_expired_refresh_token_is_rejected(
    client: AsyncClient, email_sender: MemoryEmailSender, db_session: AsyncSession
) -> None:
    tokens = await sign_in(client, email_sender, EMAIL)

    result = await db_session.execute(select(RefreshToken))
    stored = result.scalar_one()
    stored.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.commit()

    response = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert response.status_code == 401


async def test_refresh_token_is_not_stored_in_plaintext(
    client: AsyncClient, email_sender: MemoryEmailSender, db_session: AsyncSession
) -> None:
    tokens = await sign_in(client, email_sender, EMAIL)

    result = await db_session.execute(select(RefreshToken))
    stored = result.scalar_one()
    assert stored.token_hash != tokens["refresh_token"]
    assert len(stored.token_hash) == 64


# --- Access token handling ----------------------------------------------------


@pytest.mark.parametrize(
    "headers",
    [
        pytest.param({}, id="no-header"),
        pytest.param({"Authorization": "Bearer not-a-jwt"}, id="malformed"),
        pytest.param({"Authorization": "Basic abc"}, id="wrong-scheme"),
    ],
)
async def test_me_requires_a_valid_access_token(
    client: AsyncClient, headers: dict[str, str]
) -> None:
    response = await client.get("/me", headers=headers)
    assert response.status_code == 401
    assert "error" in response.json()


async def test_expired_access_token_is_rejected(
    client: AsyncClient, email_sender: MemoryEmailSender, db_session: AsyncSession
) -> None:
    await request_code(client, email_sender, EMAIL)
    result = await db_session.execute(select(User))
    user = result.scalar_one()

    expired = create_access_token(user.id, expires_delta=timedelta(seconds=-10))
    response = await client.get("/me", headers=auth_headers(expired))
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_token"


async def test_token_for_deleted_account_is_rejected(
    client: AsyncClient, email_sender: MemoryEmailSender, db_session: AsyncSession
) -> None:
    tokens = await sign_in(client, email_sender, EMAIL)

    result = await db_session.execute(select(User))
    await db_session.delete(result.scalar_one())
    await db_session.commit()

    response = await client.get("/me", headers=auth_headers(tokens["access_token"]))
    assert response.status_code == 401


async def test_error_responses_use_the_shared_envelope(client: AsyncClient) -> None:
    response = await client.get("/me")
    body = response.json()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message", "details"}


async def test_validation_errors_use_the_shared_envelope(client: AsyncClient) -> None:
    response = await client.post("/auth/request-otp", json={"email": "not-an-email"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


async def test_otp_email_body_contains_the_code(
    client: AsyncClient, email_sender: MemoryEmailSender
) -> None:
    await client.post("/auth/request-otp", json={"email": EMAIL})
    message = email_sender.sent[-1]
    assert message["to"] == EMAIL
    assert latest_otp_code(email_sender) in message["body"]
