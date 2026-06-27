from __future__ import annotations

import logging
from threading import Lock

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class BaseLLMClient:
    def generate(self, *, system_prompt: str, user_prompt: str) -> str:
        raise NotImplementedError


class MockLLMClient(BaseLLMClient):
    def generate(self, *, system_prompt: str, user_prompt: str) -> str:
        # Local deterministic response used when GROQ_API_KEY is missing.
        marker = "Retrieved company documentation:"
        context = user_prompt.split(marker, 1)[-1].strip() if marker in user_prompt else user_prompt
        if "No relevant context" in context or len(context) < 30:
            return "I cannot confirm this from the available company documentation. Please contact human support."
        first_lines = [line.strip() for line in context.splitlines() if line.strip() and not line.startswith("Question:")]
        evidence = " ".join(first_lines[:4])[:700]
        return (
            "Based on the available company documentation, here is the most relevant information I found: "
            f"{evidence}"
        )


class GroqLLMClient(BaseLLMClient):
    def __init__(self) -> None:
        from groq import Groq

        if not settings.groq_api_key:
            raise RuntimeError("GROQ_API_KEY is required for the Groq provider")
        self.client = Groq(api_key=settings.groq_api_key)

    def generate(self, *, system_prompt: str, user_prompt: str) -> str:
        response = self.client.chat.completions.create(
            model=settings.groq_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=700,
        )
        return (response.choices[0].message.content or "").strip()


_llm_client: BaseLLMClient | None = None
_lock = Lock()


def get_llm_client() -> BaseLLMClient:
    global _llm_client
    if _llm_client is not None:
        return _llm_client
    with _lock:
        if _llm_client is not None:
            return _llm_client
        provider = settings.llm_provider.lower()
        if provider == "mock" or not settings.groq_api_key:
            logger.info("Using mock LLM provider. Set GROQ_API_KEY and LLM_PROVIDER=groq for production.")
            _llm_client = MockLLMClient()
        else:
            _llm_client = GroqLLMClient()
        return _llm_client
