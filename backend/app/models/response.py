"""Respondent submissions.

The table exists so the migration history is complete from the start, but no
endpoints read or write it yet — submission and the AI analysis step are out of
scope for this milestone.
"""

from __future__ import annotations

import enum
import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import Enum, ForeignKey, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.questionnaire import Questionnaire


class ResponseStatus(enum.StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETE = "complete"
    FAILED = "failed"


class Response(TimestampMixin, Base):
    __tablename__ = "responses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    questionnaire_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("questionnaires.id", ondelete="CASCADE"), nullable=False, index=True
    )
    answers: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    ai_result: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[ResponseStatus] = mapped_column(
        Enum(
            ResponseStatus,
            name="response_status",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
        default=ResponseStatus.PENDING,
        server_default=ResponseStatus.PENDING.value,
    )

    questionnaire: Mapped[Questionnaire] = relationship(back_populates="responses")
