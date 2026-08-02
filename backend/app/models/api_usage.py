"""Per-owner Anthropic API usage.

One row per API call, written even when the call ultimately failed — as long as
the response carried a usage block, the tokens were spent and the owner should
see them.

The questionnaire and response references are nullable with ON DELETE SET NULL
so that deleting content does not erase the billing record it produced. The
owner reference cascades: if the account is gone, so is its usage history.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class ApiUsage(Base):
    __tablename__ = "api_usage"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    questionnaire_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("questionnaires.id", ondelete="SET NULL"), nullable=True, index=True
    )
    response_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("responses.id", ondelete="SET NULL"), nullable=True, index=True
    )
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )

    owner: Mapped[User] = relationship(back_populates="api_usage")
