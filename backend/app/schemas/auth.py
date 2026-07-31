from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints


class OtpRequestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr


class OtpVerifyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    code: Annotated[str, StringConstraints(min_length=4, max_length=10, strip_whitespace=True)]


class RefreshIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refresh_token: Annotated[str, StringConstraints(min_length=1, max_length=512)]


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int = Field(description="Access token lifetime in seconds")
