"""Synchronous generation and health adapters for Groq and explicit test doubles.

Only selected prompts cross the network. Provider failures become stable diagnostic
codes without forwarding upstream bodies; this module does not persist conversations.
"""

from __future__ import annotations

import json
import logging
import math
from abc import ABC, abstractmethod
from threading import Lock

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class LLMProviderError(RuntimeError):
    """Safe generation failure carrying a stable diagnostic code and optional retry delay."""

    def __init__(self, message: str, *, code: str = "unavailable", retry_after_seconds: int | None = None) -> None:
        """Store a caller-safe error message, provider category and optional delay in seconds.

        Messages must exclude upstream bodies/private prompts; response mapping reads
        code and retry_after_seconds without parsing arbitrary exception text.
        """
        super().__init__(message)
        self.code = code
        self.retry_after_seconds = retry_after_seconds


class BaseLLMClient(ABC):
    """Synchronous prompt-to-text interface shared by Groq and explicit test generation."""

    @abstractmethod
    def generate(self, *, system_prompt: str, user_prompt: str, json_mode: bool = False) -> str:
        """Generate text from system/user prompts, optionally requesting a JSON object.

        The base implementation raises NotImplementedError. Providers own network/error
        translation; callers own evidence validation and conversation persistence.
        """
        raise NotImplementedError


class MockLLMClient(BaseLLMClient):
    """Deterministic test-only generation that exercises contracts without a hosted model."""

    def generate(self, *, system_prompt: str, user_prompt: str, json_mode: bool = False) -> str:
        """Return predictable greetings, evidence JSON or legacy context text for tests.

        JSON mode expects the RAG prompt schema and selects lexical matches; malformed
        fixture JSON/schema errors propagate. This performs no network or persistence
        and cannot establish real-model reasoning or grounding quality.
        """
        if "The user sent only a greeting or thanks." in system_prompt:
            return "Hello! How can I help you?"
        if json_mode:
            from app.services.retrieval import lexical_tokens

            payload = json.loads(user_prompt)
            query_tokens = set(lexical_tokens(payload["question"]))
            matches = [
                doc
                for doc in payload["documents"]
                if query_tokens.intersection(lexical_tokens(" ".join(passage["text"] for passage in doc["passages"])))
            ]
            if not matches:
                return json.dumps({"answer": "Not documented", "supported": False, "evidence": []})
            document = matches[0]
            passage = document["passages"][0]
            quote = passage["text"][:240]
            return json.dumps(
                {
                    "answer": f"Based on the available documentation: {quote} [{document['reference']}]",
                    "supported": True,
                    "evidence": [{"source": document["reference"], "passage": passage["id"]}],
                }
            )
        marker = "Retrieved company documentation:"
        context = user_prompt.split(marker, 1)[-1].strip() if marker in user_prompt else user_prompt
        if "No relevant context" in context or len(context) < 30:
            return "I cannot confirm this from the available company documentation. Please contact human support."
        context = context.split("content:", 1)[-1].split("Output requirements:", 1)[0].strip()
        first_lines = [
            line.strip() for line in context.splitlines() if line.strip() and not line.startswith("Question:")
        ]
        evidence = " ".join(first_lines[:4])[:700]
        return (
            "Based on the available company documentation, here is the most relevant information I found: "
            f"{evidence}"
        )


class GroqLLMClient(BaseLLMClient):
    """Configured synchronous Groq adapter with bounded, explicit generation failures."""

    def __init__(self) -> None:
        """Require a key/model and construct the SDK client with configured timeout and no retries.

        Missing configuration raises LLMProviderError(configuration). Client construction
        does not send prompts; one-request failure handling remains visible to RAG.
        """
        if not settings.groq_api_key:
            raise LLMProviderError("GROQ_API_KEY is required for the Groq provider", code="configuration")
        from groq import Groq

        if not settings.groq_model.strip():
            raise LLMProviderError("GROQ_MODEL is required", code="configuration")
        self.client = Groq(api_key=settings.groq_api_key, timeout=settings.groq_timeout_seconds, max_retries=0)

    def generate(self, *, system_prompt: str, user_prompt: str, json_mode: bool = False) -> str:
        """Send the supplied prompts to Groq and return a nonempty completion.

        Apply configured model/token/reasoning controls and optional JSON mode. SDK
        errors become LLMProviderError categories, bounded rate-limit retry hints and
        safe messages; truncated/empty responses are rejected. No upstream response body
        is forwarded, no conversation is stored and the SDK does not retry this request.
        """
        try:
            response = self.client.chat.completions.create(
                model=settings.groq_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.1,
                max_tokens=settings.groq_max_tokens if json_mode else min(700, settings.groq_max_tokens),
                **({"response_format": {"type": "json_object"}} if json_mode else {}),
                **(
                    {"extra_body": {"reasoning_effort": settings.groq_reasoning_effort, "include_reasoning": False}}
                    if settings.groq_reasoning_effort
                    else {}
                ),
            )
        except Exception as exc:
            from groq import APITimeoutError

            status = getattr(exc, "status_code", None)
            code = {401: "authentication", 403: "permission", 404: "model_unavailable", 429: "rate_limit"}.get(
                status, "unavailable"
            )
            if isinstance(exc, APITimeoutError):
                code = "timeout"
            retry_after = None
            if status == 429:
                try:
                    delay = float(exc.response.headers.get("retry-after", "0"))
                    if math.isfinite(delay) and delay > 0:
                        retry_after = min(300, math.ceil(delay))
                except (ValueError, AttributeError):
                    pass
            # Never forward provider response bodies: they may contain private prompts or credentials.
            raise LLMProviderError("Groq generation failed", code=code, retry_after_seconds=retry_after) from exc
        answer = (response.choices[0].message.content or "").strip() if response.choices else ""
        if response.choices and getattr(response.choices[0], "finish_reason", None) == "length":
            raise LLMProviderError("Groq response exceeded the output budget", code="output_limit")
        if not answer:
            raise LLMProviderError("Groq returned an empty answer", code="empty_response")
        return answer


def check_llm_health() -> tuple[str, str]:
    """Return a sanitized health state/detail for the configured provider and model.

    Groq mode performs a five-second model-list request, not a paid generation
    or an end-to-end answer check. Mock/configuration/outage states remain explicit;
    HTTP and malformed-response failures return degraded without leaking response bodies.
    """
    if settings.llm_provider == "mock":
        return "degraded", "Test-only mock provider"
    if not settings.groq_api_key or not settings.groq_model:
        return "unhealthy", "Configure GROQ_API_KEY and GROQ_MODEL"
    try:
        response = httpx.get(
            "https://api.groq.com/openai/v1/models",
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            timeout=5,
        )
        response.raise_for_status()
        models = response.json().get("data", [])
        if not any(isinstance(model, dict) and model.get("id") == settings.groq_model for model in models):
            return "degraded", "Configured GROQ_MODEL is not available to this account"
        return "healthy", f"Groq model {settings.groq_model} is available"
    except (httpx.HTTPError, ValueError, AttributeError, TypeError):
        return "degraded", "Groq model availability check failed"


_llm_client: BaseLLMClient | None = None
_lock = Lock()


def get_llm_client() -> BaseLLMClient:
    """Lazily cache one process-wide generation adapter under a creation lock.

    Mock generation requires explicit test environment/provider settings. Normal
    runtime constructs Groq and propagates configuration errors instead of silently
    falling back; provider settings are fixed by process startup.
    """
    global _llm_client
    if _llm_client is not None:
        return _llm_client
    with _lock:
        if _llm_client is None:
            if settings.llm_provider == "mock" and settings.environment == "test":
                _llm_client = MockLLMClient()
            else:
                _llm_client = GroqLLMClient()
        return _llm_client
