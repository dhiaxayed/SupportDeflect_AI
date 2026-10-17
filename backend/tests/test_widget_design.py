"""Validate the persisted widget contract, safe local logos and public follow-up access.

Temporary asset directories isolate file writes. API assertions distinguish tenant
configuration from public rendering/case replies and test analytics over the full dataset."""

from copy import deepcopy
from datetime import UTC, datetime
from io import BytesIO

import pytest
from PIL import Image

from app.db import SessionLocal
from app.models import ConversationLog
from tests.conftest import register_org


def logo_bytes(size=(320, 100)):
    """Encode a synthetic PNG at the requested dimensions for byte/pixel/tenant ownership upload checks."""
    output = BytesIO()
    Image.new("RGB", size, "#0f62fe").save(output, format="PNG")
    return output.getvalue()


def test_visitor_reply_capability_is_scoped_and_does_not_reveal_internal_notes(client, auth_headers):
    """Require case/tenant-bound visitor capabilities and serialize only status/human reply, excluding private staff
    notes.
    """
    import jwt

    from app.core.config import get_settings
    from app.security import decode_access_token

    settings = client.get("/api/v1/settings/widget", headers=auth_headers).json()
    settings["allowed_domains"] = ["client.example"]
    assert client.put("/api/v1/settings/widget", headers=auth_headers, json=settings).status_code == 200
    company = client.get("/api/v1/auth/me", headers=auth_headers).json()["organization"]["public_id"]
    origin = {"Origin": "https://client.example"}
    answer = client.post(
        f"/api/v1/widget/{company}/chat",
        headers=origin,
        json={"question": "Undocumented question", "visitor_id": "visitor_capability_test"},
    ).json()
    case_id, token = answer["support_case_id"], answer["case_access_token"]
    path = f"/api/v1/widget/{company}/cases/{case_id}"
    assert client.post(path, headers=origin, json={"token": "invalid"}).status_code == 403
    with pytest.raises(ValueError):
        decode_access_token(token)
    claims = jwt.decode(token, get_settings().secret_key, algorithms=["HS256"], audience="widget-case")
    claims["exp"] = 1
    expired = jwt.encode(claims, get_settings().secret_key, algorithm="HS256")
    assert client.post(path, headers=origin, json={"token": expired}).status_code == 403
    assert client.post(path, headers={"Origin": "https://evil.example"}, json={"token": token}).status_code == 403
    assert client.post(path + "-different", headers=origin, json={"token": token}).status_code == 403
    client.patch(f"/api/v1/support-cases/{case_id}/note", headers=auth_headers, json={"internal_note": "Staff secret"})
    client.patch(
        f"/api/v1/support-cases/{case_id}/resolve",
        headers=auth_headers,
        json={"human_answer": "Human reply for this visitor"},
    )
    response = client.post(path, headers=origin, json={"token": token})
    assert response.json() == {"status": "resolved", "answer": "Human reply for this visitor"}
    assert response.headers["cache-control"] == "no-store"


def test_full_design_persistence_public_contract_and_local_logo(client, auth_headers, monkeypatch, tmp_path):
    """Save a complete tenant design and local logo, then compare protected/public API contracts and persisted
    values.
    """
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "widget_assets_directory", str(tmp_path))
    upload = client.post(
        "/api/v1/settings/widget/logo", headers=auth_headers, files={"file": ("logo.png", logo_bytes(), "image/png")}
    )
    assert upload.status_code == 201
    logo = upload.json()["logo_path"]
    settings = client.get("/api/v1/settings/widget", headers=auth_headers).json()
    settings.update(
        brand_name="Real tenant",
        primary_color="#123456",
        greeting_message="Welcome here",
        allowed_domains=["client.example"],
    )
    design = settings["design"]
    design.update(
        width=510,
        height=690,
        launcher_size=72,
        position="bottom-left",
        offset_x=31,
        offset_y=35,
        radius=8,
        theme="dark",
        background_color="#efefef",
        text_color="#222222",
        placeholder="Your question here",
        subtitle="Customer success",
        identity="custom",
        logo_path=logo,
        logo_size=42,
        open_behavior="delayed",
        open_delay_seconds=3,
    )
    saved = client.put("/api/v1/settings/widget", headers=auth_headers, json=settings)
    assert saved.status_code == 200, saved.text
    assert saved.json() == settings
    assert client.get("/api/v1/settings/widget", headers=auth_headers).json() == settings
    public_id = client.get("/api/v1/auth/me", headers=auth_headers).json()["organization"]["public_id"]
    public = client.get(f"/api/v1/widget/settings/{public_id}", headers={"Origin": "https://client.example"})
    assert public.status_code == 200 and public.json()["design"] == design
    assert (
        client.get(f"/api/v1/widget/settings/{public_id}", headers={"Origin": "https://other.example"}).status_code
        == 403
    )
    image = client.get(logo)
    assert image.status_code == 200 and image.headers["content-type"] == "image/png"
    assert image.headers["x-content-type-options"] == "nosniff"
    assert Image.open(BytesIO(image.content)).size == (320, 100)
    # Older settings screens must not accidentally reset a saved studio design.
    settings.pop("design")
    assert client.put("/api/v1/settings/widget", headers=auth_headers, json=settings).json()["design"] == design
    assert client.get("/api/v1/widget/preview").status_code == 200
    assert client.get("/api/v1/widget/brand.png").status_code == 200
    assert "Powered by" in client.get("/api/v1/widget/script.js").text


def test_design_validation_logo_ownership_and_format(client, auth_headers, monkeypatch, tmp_path):
    """Reject invalid design bounds, foreign-tenant logos and unsupported image formats before storing widget
    configuration.
    """
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "widget_assets_directory", str(tmp_path))
    settings = client.get("/api/v1/settings/widget", headers=auth_headers).json()
    for invalid in (
        {"width": 900},
        {"height": 200},
        {"primary_color": "red"},
        {"radius": -1},
        {"identity": "custom", "logo_path": None},
        {"logo_path": "https://tracking.example/logo.png"},
        {"made_up": True},
    ):
        payload = deepcopy(settings)
        payload["design"].update(invalid)
        assert client.put("/api/v1/settings/widget", headers=auth_headers, json=payload).status_code == 422
    assert (
        client.post("/api/v1/settings/widget/logo", files={"file": ("logo.png", logo_bytes(), "image/png")}).status_code
        == 401
    )
    for content in (b"<svg><script>alert(1)</script></svg>", b"not-an-image", logo_bytes((4097, 1))):
        result = client.post(
            "/api/v1/settings/widget/logo", headers=auth_headers, files={"file": ("logo.png", content, "image/png")}
        )
        assert result.status_code == 422
    oversized = client.post(
        "/api/v1/settings/widget/logo",
        headers=auth_headers,
        files={"file": ("logo.png", b"x" * (2 * 1024 * 1024 + 1), "image/png")},
    )
    assert oversized.status_code == 413
    uploaded = client.post(
        "/api/v1/settings/widget/logo", headers=auth_headers, files={"file": ("logo.png", logo_bytes(), "image/png")}
    ).json()["logo_path"]
    other, _ = register_org(client, "Other", "other@example.com")
    payload = client.get("/api/v1/settings/widget", headers=other).json()
    payload["design"].update(identity="custom", logo_path=uploaded)
    assert client.put("/api/v1/settings/widget", headers=other, json=payload).status_code == 422


def test_analytics_counts_every_row_not_just_latest_ten(client, auth_headers):
    """Populate enough fixture conversations to prove aggregates use the full dataset rather than the recent-activity
    display limit.
    """
    org_id = client.get("/api/v1/auth/me", headers=auth_headers).json()["organization"]["id"]
    with SessionLocal() as db:
        for index in range(35):
            db.add(
                ConversationLog(
                    org_id=org_id,
                    question="Repeated question",
                    answer="Answer",
                    resolved=index < 20,
                    outcome="answered" if index < 20 else "escalated",
                    needs_human=index >= 20,
                    channel="widget",
                    created_at=datetime.now(UTC),
                )
            )
        db.commit()
    summary = client.get("/api/v1/analytics/summary", headers=auth_headers).json()
    assert summary["total_questions"] == 35 and len(summary["latest_questions"]) == 10
    assert sum(day["conversations"] for day in summary["daily"]) == 35
    assert sum(day["resolved"] for day in summary["daily"]) == 20
    assert summary["frequent_unresolved"] == [{"question": "Repeated question", "count": 15}]


@pytest.mark.parametrize("provider", ["mock", "fake"])
def test_simulated_providers_not_allowed_in_normal_application(provider):
    """Reject explicit mock/fake providers outside ENVIRONMENT=test so tests cannot silently become production
    behavior.
    """
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError, match="only permitted"):
        Settings(
            _env_file=None,
            environment="local",
            llm_provider="mock" if provider == "mock" else "groq",
            embedding_provider="fake" if provider == "fake" else "sentence-transformers",
        )
