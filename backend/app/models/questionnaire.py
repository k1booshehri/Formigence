from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, ForeignKey, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.response import Response
    from app.models.user import User


class Questionnaire(TimestampMixin, Base):
    __tablename__ = "questionnaires"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The list of question definitions. Validated against a strict Pydantic
    # discriminated union on every write; see app/schemas/questions.py.
    schema: Mapped[list[dict[str, Any]]] = mapped_column("schema", JSONB, nullable=False)
    # The owner's private prompt for the AI analysis step. Never leaves the
    # owner-authenticated endpoints.
    analysis_guide: Mapped[str] = mapped_column(Text, nullable=False, default="")
    public_slug: Mapped[str | None] = mapped_column(
        String(120), nullable=True, unique=True, index=True
    )
    is_published: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    owner: Mapped[User] = relationship(back_populates="questionnaires")
    responses: Mapped[list[Response]] = relationship(
        back_populates="questionnaire", cascade="all, delete-orphan"
    )
