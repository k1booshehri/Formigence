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


# The shape FastAPI expects for a route's `responses=`. Routers annotate their
# shared error maps with this: `dict` is invariant, so an inferred
# `dict[int, dict[str, type[ErrorResponse]]]` is not assignable to it.
OpenApiResponses = dict[int | str, dict[str, Any]]
