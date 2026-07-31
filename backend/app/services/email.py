"""Email delivery, abstracted so a real provider can drop in later.

Only the console backend exists today: it writes the message to the application
log, which is how a developer reads OTP codes locally.
"""

from __future__ import annotations

import logging
from typing import Protocol

from app.core.config import settings

logger = logging.getLogger("app.email")


class EmailSender(Protocol):
    """The contract a provider implementation must satisfy."""

    async def send(self, *, to: str, subject: str, body: str) -> None: ...


class ConsoleEmailSender:
    """Development backend: logs the message instead of sending it."""

    def __init__(self, sender: str | None = None) -> None:
        self.sender = sender or settings.email_from

    async def send(self, *, to: str, subject: str, body: str) -> None:
        logger.info(
            "\n--- EMAIL (console backend) ---\nFrom: %s\nTo: %s\nSubject: %s\n\n%s\n"
            "--- END EMAIL ---",
            self.sender,
            to,
            subject,
            body,
        )


class MemoryEmailSender:
    """Test backend: keeps every message in a list for assertions."""

    def __init__(self) -> None:
        self.sent: list[dict[str, str]] = []

    async def send(self, *, to: str, subject: str, body: str) -> None:
        self.sent.append({"to": to, "subject": subject, "body": body})


def build_email_sender() -> EmailSender:
    """Pick the backend named by EMAIL_BACKEND."""
    if settings.email_backend == "console":
        return ConsoleEmailSender()
    raise ValueError(f"Unsupported EMAIL_BACKEND: {settings.email_backend}")


def render_otp_email(code: str, expires_in_minutes: int) -> tuple[str, str]:
    """Return the (subject, body) of the one-time-code email."""
    subject = "Your Formigence sign-in code"
    body = (
        f"Your sign-in code is: {code}\n\n"
        f"It expires in {expires_in_minutes} minutes and can only be used once.\n"
        "If you did not request this code, you can ignore this email."
    )
    return subject, body
