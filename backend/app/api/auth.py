"""Passwordless auth endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Request, status

from app.core.config import settings
from app.core.deps import AuthServiceDep
from app.core.rate_limit import enforce_email_rate_limit, limiter
from app.schemas.auth import OtpRequestIn, OtpVerifyIn, RefreshIn, TokenPair
from app.schemas.common import ErrorResponse, MessageResponse

router = APIRouter(prefix="/auth", tags=["auth"])

_UNAUTHORIZED_RESPONSE = {status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse}}
_RATE_LIMITED_RESPONSE = {status.HTTP_429_TOO_MANY_REQUESTS: {"model": ErrorResponse}}


@router.post(
    "/request-otp",
    response_model=MessageResponse,
    status_code=status.HTTP_200_OK,
    summary="Request a one-time sign-in code",
    responses=_RATE_LIMITED_RESPONSE,
)
@limiter.limit(settings.otp_request_rate_limit_per_ip)
async def request_otp(
    request: Request,  # unused here, but slowapi's decorator requires it
    payload: OtpRequestIn,
    auth_service: AuthServiceDep,
) -> MessageResponse:
    """Always returns 200.

    Whether the address is already registered is not observable from the
    response, so this endpoint cannot be used to enumerate accounts.
    """
    enforce_email_rate_limit(
        payload.email, settings.otp_request_rate_limit_per_email, scope="request-otp"
    )
    await auth_service.request_otp(payload.email)
    return MessageResponse(message="If that address is valid, a sign-in code has been sent.")


@router.post(
    "/verify-otp",
    response_model=TokenPair,
    summary="Exchange a one-time code for tokens",
    responses={**_UNAUTHORIZED_RESPONSE, **_RATE_LIMITED_RESPONSE},
)
@limiter.limit(settings.otp_verify_rate_limit_per_ip)
async def verify_otp(
    request: Request,  # unused here, but slowapi's decorator requires it
    payload: OtpVerifyIn,
    auth_service: AuthServiceDep,
) -> TokenPair:
    enforce_email_rate_limit(
        payload.email, settings.otp_verify_rate_limit_per_email, scope="verify-otp"
    )
    return await auth_service.verify_otp(payload.email, payload.code)


@router.post(
    "/refresh",
    response_model=TokenPair,
    summary="Rotate a refresh token",
    responses=_UNAUTHORIZED_RESPONSE,
)
async def refresh_tokens(payload: RefreshIn, auth_service: AuthServiceDep) -> TokenPair:
    """Consumes the presented refresh token and returns a brand new pair."""
    return await auth_service.refresh(payload.refresh_token)
