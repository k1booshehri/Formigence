"""Test doubles for the analysis pipeline.

The Anthropic API is never called from the test suite. Two levels of double:

* `FakeAnalyzer` stands in for the whole analyzer, for tests about the pipeline
  and the endpoints.
* `FakeAnthropicClient` stands in for the SDK client, for tests about the real
  `AnthropicResponseAnalyzer` — prompt assembly, retries, usage reporting.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx

from app.schemas.response import Recommendation
from app.services.analysis import AnalysisRequest, TokenUsage, UsageSink


def make_recommendation(
    recommendation: str = "Raise prices by 10% and re-test in a quarter.",
    reasoning: str = "Pricing confidence is low while demand indicators are strong.",
    confidence: str = "medium",
) -> Recommendation:
    return Recommendation(recommendation=recommendation, reasoning=reasoning, confidence=confidence)


@dataclass
class FakeAnalyzer:
    """Records the requests it receives and replays a scripted outcome."""

    result: Recommendation | None = None
    error: Exception | None = None
    usages: list[TokenUsage] = field(default_factory=list)
    requests: list[AnalysisRequest] = field(default_factory=list)

    async def analyze(self, request: AnalysisRequest, usage_sink: UsageSink) -> Recommendation:
        self.requests.append(request)
        for usage in self.usages:
            await usage_sink(usage)
        if self.error is not None:
            raise self.error
        return self.result or make_recommendation()


# --- SDK-level doubles --------------------------------------------------------


@dataclass
class FakeToolUseBlock:
    input: Any
    name: str = "submit_recommendation"
    type: str = "tool_use"


@dataclass
class FakeTextBlock:
    text: str = "Some prose instead of a tool call."
    type: str = "text"


@dataclass
class FakeUsage:
    input_tokens: int = 1200
    output_tokens: int = 300


@dataclass
class FakeMessage:
    content: list[Any] = field(default_factory=list)
    usage: FakeUsage = field(default_factory=FakeUsage)
    stop_reason: str = "tool_use"
    model: str = "claude-sonnet-4-6"


def tool_use_message(payload: dict[str, Any] | None = None, **kwargs: Any) -> FakeMessage:
    body = payload if payload is not None else make_recommendation().model_dump()
    return FakeMessage(content=[FakeToolUseBlock(input=body)], **kwargs)


class FakeMessagesResource:
    def __init__(self, script: list[Any]) -> None:
        self.script = list(script)
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if not self.script:
            raise AssertionError("FakeAnthropicClient ran out of scripted responses")
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class FakeAnthropicClient:
    """Minimal stand-in for `anthropic.AsyncAnthropic`."""

    def __init__(self, script: list[Any]) -> None:
        self.messages = FakeMessagesResource(script)


def http_response(status_code: int, headers: dict[str, str] | None = None) -> httpx.Response:
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return httpx.Response(status_code, request=request, headers=headers or {})
