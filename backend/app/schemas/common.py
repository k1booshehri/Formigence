"""Shared response envelopes (also used to document errors in OpenAPI)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ErrorDetail(BaseModel):
    code: str = Field(description="Stable, machine-readable error code")
    message: str = Field(description="Human-readable explanation")
    details: Any = Field(default=None, description="Optional structured context")


class ErrorResponse(BaseModel):
    error: ErrorDetail


class MessageResponse(BaseModel):
    message: str
