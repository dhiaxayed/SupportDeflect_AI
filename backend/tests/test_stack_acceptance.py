"""Check the infrastructure probe's API contract; container/SMTP execution stays a separate CI gate."""

import importlib.util
import json
from pathlib import Path

import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.db import SessionLocal
from app.models import MailMessage


def test_acceptance_probe_uses_real_api_and_persisted_design(client, tmp_path, monkeypatch):
    """Run the operator probe's registration/logo/design workflow against actual fixture API/SQL state with only SMTP
    receipt simulated.
    """
    path = Path(__file__).resolve().parents[2] / "scripts/verify_stack.py"
    spec = importlib.util.spec_from_file_location("verify_stack", path)
    probe = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(probe)
    monkeypatch.setattr(get_settings(), "widget_assets_directory", str(tmp_path / "assets"))
    stack = probe.Stack(
        {
            "services": {
                "backend": {"environment": {"FRONTEND_URL": "http://testserver"}},
                "mailpit": {"environment": {"MP_UI_AUTH": "admin:fixture-only"}},
            }
        }
    )

    def request(path, method="GET", data=None, headers=None, status=200):
        # Only the SMTP transport is a double here. Registration must actually
        # enqueue mail, and all application requests exercise the real API/DB.
        """Adapt the probe's HTTP method/body/status contract to the real fixture client and return the expected
        parsed response.
        """
        if path.startswith("/mail/api/"):
            with SessionLocal() as db:
                message = db.scalar(select(MailMessage).where(MailMessage.template == "welcome"))
                assert message is not None
                item = {"ID": message.id, "To": [{"Address": message.recipient}]}
                return {"messages": [item]} if "/messages" in path else item
        response = client.request(
            method,
            path,
            headers=headers,
            **({"json": data} if isinstance(data, dict) else {"content": data}),
        )
        assert response.status_code == status, response.text
        return response.json() if "application/json" in response.headers.get("Content-Type", "") else response.content

    monkeypatch.setattr(stack, "request", request)
    state_path = tmp_path / "private-state.json"
    state = stack.exercise(state_path, timeout=2)
    assert json.loads(state_path.read_text()) == state
    stack.verify_state(state)
    state["logo_sha256"] = "incorrect"
    with pytest.raises(probe.CheckError, match="logo content"):
        stack.verify_state(state)
