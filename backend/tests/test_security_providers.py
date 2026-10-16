"""Test outbound-source safety and honest LLM/vector-provider failure handling.

DNS and HTTP transports are controlled doubles, allowing private-address, redirect,
size, model-selection and error-redaction checks without contacting those destinations."""

import socket
from types import SimpleNamespace

import httpx
import pytest

from app.services.ingestion import IngestionError, extract_text_from_url, validate_public_http_url
from app.services.llm import GroqLLMClient, LLMProviderError


@pytest.mark.parametrize("status_code", [404, 503])
async def test_source_http_errors_have_safe_actionable_messages(monkeypatch, status_code):
    """Translate failed public-source HTTP responses into useful bounded errors without disclosing token-bearing URL
    details.
    """
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a: [(0, 0, 0, "", ("8.8.8.8", 0))])
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(status_code))) as client:
        with pytest.raises(IngestionError, match=f"^Source website returned HTTP {status_code}$"):
            await extract_text_from_url("https://public.example/docs?token=private-value", client=client)


@pytest.mark.parametrize("address", ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "224.0.0.1"])
def test_private_dns_rejected(monkeypatch, address):
    """Reject every tested nonpublic DNS destination before any outbound source connection is made."""
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a: [(0, 0, 0, "", (address, 0))])
    with pytest.raises(IngestionError):
        validate_public_http_url("https://public.example/docs")


async def test_redirects_revalidated(monkeypatch):
    """Revalidate each redirect target so a permitted public URL cannot redirect into a private network."""
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda host, *a: [(0, 0, 0, "", ("127.0.0.1" if host == "private.example" else "8.8.8.8", 0))],
    )
    calls = []

    def handler(request):
        """Return a controlled redirect response to exercise destination revalidation without external traffic."""
        calls.append(str(request.url))
        return httpx.Response(302, headers={"location": "http://private.example/secrets"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(IngestionError):
            await extract_text_from_url("https://public.example/docs", client=client)
    assert calls == ["https://8.8.8.8/docs"]


async def test_relative_redirect_and_loop(monkeypatch):
    """Support a valid relative redirect while terminating redirect loops within the configured limit."""
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a: [(0, 0, 0, "", ("8.8.8.8", 0))])

    def handler(request):
        """Serve fixture redirect/content responses according to the requested path, including the deliberate loop."""
        if request.url.path == "/start":
            return httpx.Response(302, headers={"location": "/docs"})
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text="<title>Guide</title><main>Useful support documentation</main>",
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        text, title = await extract_text_from_url("https://public.example/start", client=client)
        assert title == "Guide" and "Useful support" in text
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(302, headers={"location": "/start"}))
    ) as client:
        with pytest.raises(IngestionError, match="loop"):
            await extract_text_from_url("https://public.example/start", client=client)


def test_groq_uses_configured_model_and_rejects_empty_answers(monkeypatch):
    """Send the configured model identifier and reject an empty successful-looking provider response."""
    from app.services import llm

    monkeypatch.setattr(llm.settings, "groq_api_key", "fixture-not-a-key")
    monkeypatch.setattr(llm.settings, "groq_model", "model-from-environment")
    client = GroqLLMClient()
    calls = []

    def complete(**kwargs):
        """Capture completion arguments and return the chosen fixture response from the provider double."""
        calls.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Documented answer"))])

    monkeypatch.setattr(client.client.chat.completions, "create", complete)
    assert client.generate(system_prompt="System", user_prompt="Question") == "Documented answer"
    assert calls[0]["model"] == "model-from-environment"
    monkeypatch.setattr(client.client.chat.completions, "create", lambda **kw: SimpleNamespace(choices=[]))
    with pytest.raises(LLMProviderError, match="empty"):
        client.generate(system_prompt="", user_prompt="")

    def fail(**kwargs):
        """Raise the controlled provider exception used to verify generation failure classification."""
        raise RuntimeError("upstream unavailable")

    monkeypatch.setattr(client.client.chat.completions, "create", fail)
    with pytest.raises(LLMProviderError, match="generation failed"):
        client.generate(system_prompt="", user_prompt="")


def test_no_implicit_mock_fallback(monkeypatch):
    """Fail honestly when real Groq configuration is absent rather than substituting normal-runtime mock answers."""
    from app.services import llm

    monkeypatch.setattr(llm, "_llm_client", None)
    monkeypatch.setattr(llm.settings, "llm_provider", "groq")
    monkeypatch.setattr(llm.settings, "groq_api_key", None)
    with pytest.raises(LLMProviderError, match="GROQ_API_KEY"):
        llm.get_llm_client()


@pytest.mark.parametrize(
    "status,code",
    [
        (401, "authentication"),
        (403, "permission"),
        (404, "model_unavailable"),
        (429, "rate_limit"),
        (503, "unavailable"),
    ],
)
def test_groq_failure_codes_do_not_expose_provider_body(monkeypatch, status, code):
    """Map upstream status failures to stable error codes while excluding the private provider body from public
    exceptions.
    """
    from groq import APIStatusError

    from app.services import llm

    monkeypatch.setattr(llm.settings, "groq_api_key", "fixture-not-a-key")
    monkeypatch.setattr(llm.settings, "groq_model", "fixture-model")
    client = GroqLLMClient()

    def fail(**kwargs):
        """Raise an HTTP-status provider error carrying synthetic private content to test sanitization."""
        response = httpx.Response(
            status, headers={"retry-after": "2.5"}, request=httpx.Request("POST", "https://api.groq.com")
        )
        raise APIStatusError("private provider response", response=response, body={"secret": "private"})

    monkeypatch.setattr(client.client.chat.completions, "create", fail)
    with pytest.raises(LLMProviderError) as error:
        client.generate(system_prompt="system", user_prompt="user")
    assert error.value.code == code
    assert error.value.retry_after_seconds == (3 if status == 429 else None)
    assert str(error.value) == "Groq generation failed"


@pytest.mark.parametrize("effort", ["", "low"])
def test_groq_reasoning_controls_are_explicit_and_optional(monkeypatch, effort):
    """Include reasoning configuration only when explicitly set, retaining compatibility with models that do not
    support it.
    """
    import json

    from groq import Groq

    from app.services import llm

    monkeypatch.setattr(llm.settings, "groq_api_key", "fixture-not-a-key")
    monkeypatch.setattr(llm.settings, "groq_model", "fixture-model")
    monkeypatch.setattr(llm.settings, "groq_reasoning_effort", effort)
    client = GroqLLMClient()
    calls = []

    def complete(request):
        """Observe the actual outgoing completion request and return a controlled valid response."""
        calls.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "fixture",
                "object": "chat.completion",
                "created": 0,
                "model": "fixture-model",
                "choices": [{"index": 0, "message": {"role": "assistant", "content": "{}"}, "finish_reason": "stop"}],
            },
        )

    client.client = Groq(api_key="fixture-not-a-key", http_client=httpx.Client(transport=httpx.MockTransport(complete)))
    assert client.generate(system_prompt="system", user_prompt="user", json_mode=True) == "{}"
    assert calls[0]["max_tokens"] == llm.settings.groq_max_tokens
    assert calls[0]["response_format"] == {"type": "json_object"}
    if effort:
        assert calls[0]["reasoning_effort"] == effort and calls[0]["include_reasoning"] is False
    else:
        assert "reasoning_effort" not in calls[0] and "include_reasoning" not in calls[0]


def test_pgvector_error_does_not_disable_vector_writes(monkeypatch):
    """Propagate persistent vector-write failure instead of silently disabling pgvector or switching to a different
    store.
    """
    from sqlalchemy.exc import SQLAlchemyError

    from app.services.vector_store import DatabaseVectorStore

    store = DatabaseVectorStore()
    store.pgvector_available = True

    def fail(**kwargs):
        """Raise a controlled SQLAlchemy failure at the vector schema/write boundary."""
        raise SQLAlchemyError("database unavailable")

    monkeypatch.setattr(store, "_search_pgvector", fail)
    with pytest.raises(SQLAlchemyError):
        store.search(org_id="tenant", query_embedding=[1.0], top_k=1)
    assert store.pgvector_available


def test_groq_health_checks_actual_configured_model(monkeypatch):
    """Require account model availability to include the configured model rather than equating any models HTTP 200
    with readiness.
    """
    from app.services import llm

    monkeypatch.setattr(llm.settings, "llm_provider", "groq")
    monkeypatch.setattr(llm.settings, "groq_api_key", "fixture-not-a-key")
    monkeypatch.setattr(llm.settings, "groq_model", "configured-model")
    for body in ([], {}, {"data": None}, {"data": ["bad"]}, {"data": [{"id": "other"}]}):
        monkeypatch.setattr(
            httpx,
            "get",
            lambda *a, body=body, **k: httpx.Response(
                200, json=body, request=httpx.Request("GET", "https://api.groq.com/openai/v1/models")
            ),
        )
        assert llm.check_llm_health()[0] == "degraded"
    monkeypatch.setattr(
        httpx,
        "get",
        lambda *a, **k: httpx.Response(
            200,
            json={"data": [{"id": "configured-model"}]},
            request=httpx.Request("GET", "https://api.groq.com/openai/v1/models"),
        ),
    )
    assert llm.check_llm_health()[0] == "healthy"


async def test_url_size_limit_and_pinned_dns(monkeypatch):
    """Bound streamed source bytes and verify the connection uses validated DNS addresses while preserving Host/SNI
    identity.
    """
    from app.services import ingestion

    monkeypatch.setattr(socket, "getaddrinfo", lambda *a: [(0, 0, 0, "", ("8.8.8.8", 0))])
    monkeypatch.setattr(ingestion.settings, "url_max_bytes", 50)

    def handler(request):
        """Inspect the pinned synthetic request and return controlled bytes for the source size-limit path."""
        assert request.url.host == "8.8.8.8"
        assert request.headers["host"] == "public.example"
        assert request.extensions["sni_hostname"] == "public.example"
        return httpx.Response(200, text="a" * 51)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(IngestionError, match="size limit"):
            await extract_text_from_url("https://public.example/docs", client=client)
