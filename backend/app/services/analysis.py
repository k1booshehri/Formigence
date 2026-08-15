"""The AI analysis pipeline.

Two pieces, deliberately separated:

* `AnthropicResponseAnalyzer` talks to the Anthropic API and knows nothing about
  the database. It retries transient failures and reports token usage through a
  callback.
* `run_analysis_for_response` owns the database transitions. It is a plain async
  function taking a session factory and an analyzer, so moving from
  FastAPI `BackgroundTasks` to a real worker means calling it from the worker
  instead of from the request — no changes here.

Structured output comes from a single forced tool call: `tool_choice` requires
`submit_recommendation`, and its input is then validated with Pydantic, so
`ai_result` is always a known shape.
"""

from __future__ import annotations

import asyncio
import logging
import random
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Protocol, cast

import anthropic
from anthropic.types import MessageParam, ToolChoiceToolParam, ToolParam
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings
from app.models import ApiUsage, Questionnaire, Response, ResponseStatus
from app.schemas.questions import Question
from app.schemas.response import Recommendation
from app.services.answers import parse_questions
from app.services.prompt import build_system_prompt, build_user_message

logger = logging.getLogger(__name__)

TOOL_NAME = "submit_recommendation"

# `input_schema` is a hand-written JSON Schema document and the SDK's TypedDict
# for it has varied across versions, so build the literal plainly and assert the
# tool shape once here rather than annotating each nested level.
RECOMMENDATION_TOOL: ToolParam = cast(
    ToolParam,
    {
        "name": TOOL_NAME,
        "description": (
            "Submit the structured recommendation for this respondent. "
            "Call this exactly once; it is the only way to return a result."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "recommendation": {
                    "type": "string",
                    "description": (
                        "The recommendation for the respondent, written for them to read. "
                        "Must not quote or paraphrase the analysis guide."
                    ),
                },
                "reasoning": {
                    "type": "string",
                    "description": (
                        "Why this recommendation follows from the answers and the guide."
                    ),
                },
                "confidence": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                    "description": "How confident you are given the answers provided.",
                },
            },
            "required": ["recommendation", "reasoning", "confidence"],
            "additionalProperties": False,
        },
    },
)


@dataclass(frozen=True)
class TokenUsage:
    model: str
    input_tokens: int
    output_tokens: int


@dataclass(frozen=True)
class AnalysisRequest:
    title: str
    description: str | None
    analysis_guide: str
    questions: list[Question]
    answers: dict[str, Any]


UsageSink = Callable[[TokenUsage], Awaitable[None]]


class AnalysisError(Exception):
    """Analysis could not produce a validated recommendation."""


class ResponseAnalyzer(Protocol):
    """The contract the pipeline depends on; tests substitute a fake."""

    async def analyze(self, request: AnalysisRequest, usage_sink: UsageSink) -> Recommendation: ...


class AnthropicResponseAnalyzer:
    """Calls the Anthropic API with a forced tool choice and validates the result."""

    def __init__(
        self,
        # Typed loosely so tests can pass a double without subclassing the SDK
        # client; production always passes an `anthropic.AsyncAnthropic`.
        client: Any = None,
        *,
        model: str | None = None,
        max_tokens: int | None = None,
        max_retries: int | None = None,
    ) -> None:
        # max_retries=0 on the SDK client: this class owns retrying, and letting
        # both layers retry would multiply the attempt count.
        self.client = client or anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key,
            timeout=settings.anthropic_timeout_seconds,
            max_retries=0,
        )
        self.model = model or settings.anthropic_model
        self.max_tokens = max_tokens or settings.anthropic_max_tokens
        self.max_retries = max_retries if max_retries is not None else settings.analysis_max_retries

    async def analyze(self, request: AnalysisRequest, usage_sink: UsageSink) -> Recommendation:
        system_prompt = build_system_prompt(request.analysis_guide, tool_name=TOOL_NAME)
        user_message = build_user_message(
            title=request.title,
            description=request.description,
            questions=request.questions,
            answers=request.answers,
        )

        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            if attempt:
                await asyncio.sleep(self._backoff_delay(attempt, last_error))
            try:
                return await self._attempt(system_prompt, user_message, usage_sink)
            except _RetryableError as exc:
                last_error = exc
                logger.warning(
                    "Analysis attempt %d/%d failed: %s",
                    attempt + 1,
                    self.max_retries + 1,
                    exc,
                )
            except AnalysisError:
                raise
            except anthropic.APIStatusError as exc:
                # 4xx other than 429: retrying will not help.
                raise AnalysisError(f"Anthropic rejected the request: {exc}") from exc

        raise AnalysisError(f"Analysis failed after {self.max_retries + 1} attempts: {last_error}")

    async def _attempt(
        self, system_prompt: str, user_message: str, usage_sink: UsageSink
    ) -> Recommendation:
        messages: list[MessageParam] = [{"role": "user", "content": user_message}]
        # Forced tool choice is what makes the output structured; see module docstring.
        tool_choice: ToolChoiceToolParam = {"type": "tool", "name": TOOL_NAME}
        try:
            message = await self.client.messages.create(
                model=self.model,
                max_tokens=self.max_tokens,
                system=system_prompt,
                messages=messages,
                tools=[RECOMMENDATION_TOOL],
                tool_choice=tool_choice,
            )
        except anthropic.RateLimitError as exc:
            raise _RetryableError(f"rate limited: {exc}", exc) from exc
        except anthropic.APIStatusError as exc:
            if exc.status_code >= 500:
                raise _RetryableError(f"server error {exc.status_code}", exc) from exc
            raise
        except anthropic.APIConnectionError as exc:  # includes APITimeoutError
            raise _RetryableError(f"connection error: {exc}", exc) from exc

        # The call returned, so the tokens were spent — record them before
        # deciding whether the content is usable.
        await self._report_usage(message, usage_sink)

        if getattr(message, "stop_reason", None) == "refusal":
            raise AnalysisError("The model declined to analyze this submission")

        recommendation = self._extract_recommendation(message)
        if recommendation is None:
            # A missing or malformed tool call is usually transient, so allow
            # the retry budget to absorb it.
            raise _RetryableError("no valid tool call in the response", None)
        return recommendation

    async def _report_usage(self, message: Any, usage_sink: UsageSink) -> None:
        usage = getattr(message, "usage", None)
        if usage is None:  # pragma: no cover - the API always returns usage
            return
        await usage_sink(
            TokenUsage(
                model=getattr(message, "model", self.model) or self.model,
                input_tokens=int(getattr(usage, "input_tokens", 0) or 0),
                output_tokens=int(getattr(usage, "output_tokens", 0) or 0),
            )
        )

    @staticmethod
    def _extract_recommendation(message: Any) -> Recommendation | None:
        for block in getattr(message, "content", []) or []:
            if getattr(block, "type", None) != "tool_use":
                continue
            if getattr(block, "name", None) != TOOL_NAME:
                continue
            try:
                return Recommendation.model_validate(getattr(block, "input", None))
            except ValidationError as exc:
                logger.warning("Tool call did not match the expected schema: %s", exc)
                return None
        return None

    def _backoff_delay(self, attempt: int, last_error: Exception | None) -> float:
        retry_after = _retry_after_seconds(last_error)
        if retry_after is not None:
            return min(retry_after, settings.analysis_retry_max_delay_seconds)
        base = settings.analysis_retry_base_delay_seconds * (2 ** (attempt - 1))
        capped = min(base, settings.analysis_retry_max_delay_seconds)
        # Jitter so concurrent retries do not resynchronize into a burst.
        return capped * random.uniform(0.5, 1.0)


class _RetryableError(Exception):
    def __init__(self, message: str, cause: Exception | None) -> None:
        super().__init__(message)
        self.cause = cause


def _retry_after_seconds(error: Exception | None) -> float | None:
    """Honour a Retry-After header when the API supplies one."""
    cause = getattr(error, "cause", None)
    response = getattr(cause, "response", None)
    headers = getattr(response, "headers", None)
    if headers is None:
        return None
    raw = headers.get("retry-after")
    # `headers` reaches us through getattr, so narrow before converting.
    if not isinstance(raw, str):
        return None
    try:
        return max(0.0, float(raw))
    except ValueError:
        return None


# --- Pipeline -----------------------------------------------------------------


async def run_analysis_for_response(
    response_id: uuid.UUID,
    *,
    session_factory: async_sessionmaker[AsyncSession],
    analyzer: ResponseAnalyzer,
) -> None:
    """Analyze one response and record the outcome.

    Safe to call from FastAPI `BackgroundTasks` today and from a queue worker
    later: it takes its own session factory rather than borrowing the request's
    session, which is already closed by the time background tasks run.

    A response is only picked up from `pending`, so a duplicate dispatch is a
    no-op rather than a second billed API call.
    """
    claimed = await _claim(response_id, session_factory)
    if claimed is None:
        return
    owner_id, questionnaire_id = claimed

    async def usage_sink(usage: TokenUsage) -> None:
        await _record_usage(
            session_factory,
            owner_id=owner_id,
            questionnaire_id=questionnaire_id,
            response_id=response_id,
            usage=usage,
        )

    completed = False
    try:
        async with session_factory() as session:
            request = await _build_request(session, response_id)
        if request is None:  # pragma: no cover - claimed rows always resolve
            return

        recommendation = await analyzer.analyze(request, usage_sink)

        async with session_factory() as session:
            response = await session.get(Response, response_id)
            if response is not None:
                response.ai_result = recommendation.model_dump(mode="json")
                response.status = ResponseStatus.COMPLETE
                await session.commit()
                completed = True
    except Exception:
        logger.exception("Analysis failed for response %s", response_id)
    finally:
        if not completed:
            # try/finally with its own session: a response must never be left
            # stranded in `processing`, even if the session above is poisoned.
            await _mark_failed(response_id, session_factory)


async def _claim(
    response_id: uuid.UUID, session_factory: async_sessionmaker[AsyncSession]
) -> tuple[uuid.UUID, uuid.UUID] | None:
    """Move a pending response to `processing`; return its owner and questionnaire."""
    async with session_factory() as session:
        response = await session.get(Response, response_id)
        if response is None:
            logger.warning("Response %s vanished before analysis", response_id)
            return None
        if response.status != ResponseStatus.PENDING:
            logger.info("Response %s already claimed (%s)", response_id, response.status)
            return None

        questionnaire = await session.get(Questionnaire, response.questionnaire_id)
        if questionnaire is None:  # pragma: no cover - FK guarantees this
            return None

        response.status = ResponseStatus.PROCESSING
        await session.commit()
        return questionnaire.owner_id, questionnaire.id


async def _build_request(session: AsyncSession, response_id: uuid.UUID) -> AnalysisRequest | None:
    response = await session.get(Response, response_id)
    if response is None:
        return None
    questionnaire = await session.get(Questionnaire, response.questionnaire_id)
    if questionnaire is None:
        return None
    return AnalysisRequest(
        title=questionnaire.title,
        description=questionnaire.description,
        analysis_guide=questionnaire.analysis_guide,
        questions=parse_questions(questionnaire.schema),
        answers=response.answers,
    )


async def _record_usage(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    owner_id: uuid.UUID,
    questionnaire_id: uuid.UUID,
    response_id: uuid.UUID,
    usage: TokenUsage,
) -> None:
    """Persist one usage row in its own transaction.

    Separate from the analysis transaction on purpose: the tokens were spent
    whether or not the analysis goes on to succeed.
    """
    try:
        async with session_factory() as session:
            session.add(
                ApiUsage(
                    owner_id=owner_id,
                    questionnaire_id=questionnaire_id,
                    response_id=response_id,
                    model=usage.model,
                    input_tokens=usage.input_tokens,
                    output_tokens=usage.output_tokens,
                )
            )
            await session.commit()
    except Exception:  # pragma: no cover - never let logging break analysis
        logger.exception("Could not record API usage for response %s", response_id)


async def _mark_failed(
    response_id: uuid.UUID, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    try:
        async with session_factory() as session:
            response = await session.get(Response, response_id)
            if response is None or response.status in (
                ResponseStatus.COMPLETE,
                ResponseStatus.FAILED,
            ):
                return
            response.status = ResponseStatus.FAILED
            await session.commit()
    except Exception:  # pragma: no cover
        logger.exception("Could not mark response %s as failed", response_id)
