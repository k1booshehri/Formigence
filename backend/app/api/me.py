from __future__ import annotations

from fastapi import APIRouter, status

from app.core.deps import CurrentUser
from app.schemas.common import ErrorResponse
from app.schemas.user import UserOut

router = APIRouter(tags=["me"])


@router.get(
    "/me",
    response_model=UserOut,
    summary="The authenticated user",
    responses={status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse}},
)
async def read_me(current_user: CurrentUser) -> UserOut:
    return UserOut.model_validate(current_user)
