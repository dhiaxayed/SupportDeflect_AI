"""Collect actual Compose acceptance evidence; never equate config validation with runtime proof."""

import argparse
import base64
import hashlib
import json
import os
import platform
import secrets
import ssl
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, HTTPSHandler, ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
SERVICES = {"traefik", "postgres", "migrate", "backend", "worker", "frontend", "mailer", "mailpit"}


class CheckError(RuntimeError):
    """A safe operator-facing acceptance failure whose message must exclude configuration values and credentials."""
    pass


class NoRedirect(HTTPRedirectHandler):
    """HTTP redirect policy that keeps acceptance credentials confined to the configured application origin."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # A broken proxy must not forward the acceptance credentials to another origin.
        """Refuse the proposed redirect; authenticated probes must fail rather than forward credentials to a different
        destination.
        """
        return None


def require(condition, message):
    """Raise CheckError with the supplied sanitized explanation when a runtime acceptance condition is false."""
    if not condition:
        raise CheckError(message)


def command(*args):
    """Run an operator command from the repository with a timeout; return stdout privately and expose only sanitized
    command-failure diagnostics. Known Docker operations/reasons are reported through
    fixed labels; arbitrary arguments, stdout and stderr never enter an exception.
    """
    try:
        result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=240)
    except (OSError, subprocess.TimeoutExpired):
        raise CheckError(f"Cannot execute {args[0]}; verify installation, daemon and permissions") from None
    # Compose config/inspect and arbitrary child output can contain secrets. Only
    # fixed command labels and recognized failure categories may enter a public report.
    label = args[0]
    if args[:2] == ("docker", "compose") and len(args) > 2 and args[2] in {
        "config", "version", "ps", "exec", "down", "up",
    }:
        label = f"docker compose {args[2]}"
    reason = "inspect the service locally"
    for marker, safe_reason in (
        ("is unhealthy", "a dependency is unhealthy"),
        ("didn't complete successfully", "a one-shot dependency failed"),
        ("has active endpoints", "a network still has active endpoints"),
        ("no space left on device", "Docker storage is exhausted"),
        ("cannot connect to the docker daemon", "Docker daemon is unavailable"),
        ("address already in use", "a required port is occupied"),
        ("toomanyrequests", "container registry rate limit"),
    ):
        if marker in (result.stderr or "").lower():
            reason = safe_reason
            break
    require(result.returncode == 0, f"{label} command failed; {reason}")
    return result.stdout


def compose(*args):
    """Execute docker compose through the bounded/sanitized command adapter so raw expanded configuration never
    reaches the report.
    """
    return command("docker", "compose", *args)


def wait_for(check, timeout):
    """Retry a readiness callable until success or a monotonic deadline; preserve only safe failure context on
    timeout.
    """
    deadline = time.monotonic() + timeout
    while True:
        try:
            return check()
        except (CheckError, URLError, TimeoutError, ConnectionError) as error:
            if time.monotonic() >= deadline:
                reason = str(error) if isinstance(error, CheckError) else type(error).__name__
                raise CheckError(f"Readiness timeout: {reason}") from None
            time.sleep(2)


def validate_containers(config, containers):
    """Check actual inspected services against resolved Compose health, sole-ingress, network and named-volume
    contracts; raise CheckError on drift.
    """
    found = {}
    for container in containers:
        service = container["Config"]["Labels"]["com.docker.compose.service"]
        require(service not in found, f"Unexpected duplicate service: {service}")
        found[service] = container
    require(set(found) == SERVICES, "Missing or unexpected Compose services")
    for name, container in found.items():
        state = container["State"]
        if name == "migrate":
            require(state["Status"] == "exited" and state["ExitCode"] == 0, "Migration did not finish successfully")
            continue
        require(state["Status"] == "running", f"Service is not running: {name}")
        definition = config["services"][name]
        if definition.get("healthcheck"):
            require(state.get("Health", {}).get("Status") == "healthy", f"Service is not healthy: {name}")
        ports = container["NetworkSettings"].get("Ports", {}) or {}
        published = any(ports.values())
        require(published == (name == "traefik"), f"Single-ingress violation: {name}")
        expected = {config["networks"][network]["name"] for network in definition["networks"]}
        require(set(container["NetworkSettings"]["Networks"]) == expected, f"Network mismatch: {name}")
        mounts = {mount["Destination"]: mount for mount in container["Mounts"]}
        for volume in definition.get("volumes", []):
            if volume["type"] == "volume":
                actual = mounts.get(volume["target"], {})
                expected_name = config["volumes"][volume["source"]]["name"]
                require(actual.get("Name") == expected_name, f"Persistent volume mismatch: {name}")


class Stack:
    """Runtime acceptance client for one configured Compose origin, with redirect refusal and separately authenticated
    local-mailbox access.
    """
    def __init__(self, config, ca_file=None):
        """Prepare the origin, trusted TLS context and private mailbox headers from resolved configuration; retain
        secrets only in memory.
        """
        self.config = config
        self.url = config["services"]["backend"]["environment"]["FRONTEND_URL"].rstrip("/")
        self.opener = build_opener(
            ProxyHandler({}), HTTPSHandler(context=ssl.create_default_context(cafile=ca_file)), NoRedirect()
        )
        mail_auth = config["services"]["mailpit"]["environment"]["MP_UI_AUTH"]
        self.mail_headers = {"Authorization": "Basic " + base64.b64encode(mail_auth.encode()).decode()}

    def request(self, path, method="GET", data=None, headers=None, status=200):
        """Send a same-origin probe with a request timeout and validate status/redirect refusal.

        Return JSON or bytes without logging private request contents. The response
        body is read fully rather than subject to a byte ceiling.
        """
        headers = dict(headers or {})
        if isinstance(data, dict):
            data = json.dumps(data).encode()
            headers["Content-Type"] = "application/json"
        request = Request(self.url + path, data=data, headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=20)
        except HTTPError as error:
            response = error
        with response:
            require(response.status == status, f"{method} {path} returned {response.status}; expected {status}")
            require(response.geturl() == self.url + path, f"Unexpected redirect: {path}")
            content = response.read()
            if "application/json" in response.headers.get("Content-Type", ""):
                return json.loads(content)
            return content

    def ready(self, timeout):
        """Poll actual container/schema and public/protected/mailbox entry points until the installation is ready or
        the deadline expires.
        """
        def inspect():
            """Inspect the current real containers and ingress routes for one readiness attempt; no fixture success
            substitutes for missing runtime services.
            """
            identifiers = compose("ps", "--all", "--quiet").split()
            require(bool(identifiers), "No containers found")
            validate_containers(self.config, json.loads(command("docker", "inspect", *identifiers)))
            health = compose(
                "exec",
                "-T",
                "backend",
                "python",
                "-c",
                "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/healthz/db').status)",
            )
            require(health.strip() == "200", "Database/schema readiness failed")
            require(b"SupportDeflect" in self.request("/"), "Public landing is missing")
            self.request("/login")
            require(b"Powered by" in self.request("/api/v1/widget/script.js"), "Widget renderer is missing")
            self.request("/api/v1/auth/me", status=401)
            self.request("/mail/api/v1/messages", status=401)
            self.request("/mail/api/v1/messages", headers=self.mail_headers)

        wait_for(inspect, timeout)

    def login(self, state):
        """Authenticate saved synthetic acceptance credentials and require the same public company identity before
        returning a Bearer header.
        """
        result = self.request("/api/v1/auth/login", "POST", {"email": state["email"], "password": state["password"]})
        require(result["user"]["organization"]["public_id"] == state["company"], "Organization identity changed")
        return {"Authorization": "Bearer " + result["access_token"]}

    def upload_logo(self, headers):
        """Upload the local fixture PNG as real multipart data and return its saved asset path for persistence/hash
        verification.
        """
        content = (ROOT / "widget/supportdeflect-logo.png").read_bytes()
        boundary = secrets.token_hex(24)
        body = (
            (
                f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="acceptance.png"\r\n'
                "Content-Type: image/png\r\n\r\n"
            ).encode()
            + content
            + f"\r\n--{boundary}--\r\n".encode()
        )
        return self.request(
            "/api/v1/settings/widget/logo",
            "POST",
            body,
            {**headers, "Content-Type": f"multipart/form-data; boundary={boundary}"},
            status=201,
        )["logo_path"]

    def exercise(self, state_path, timeout):
        """Create synthetic tenant/design/logo/mail state, save recovery credentials privately, and wait for actual
        local SMTP capture.
        """
        state = {
            "url": self.url,
            "email": f"acceptance-{secrets.token_hex(8)}@example.com",
            "password": secrets.token_urlsafe(24),
        }
        result = self.request(
            "/api/v1/auth/register",
            "POST",
            {
                "organization_name": "Infrastructure acceptance (synthetic)",
                "admin_email": state["email"],
                "password": state["password"],
            },
            status=201,
        )
        state["company"] = result["user"]["organization"]["public_id"]
        # Keep recovery credentials before any later check can fail; never attach this file to CI artifacts.
        save_private_state(state_path, state)
        headers = self.login(state)
        self.request("/api/v1/platform/overview", headers=headers, status=403)
        settings = self.request("/api/v1/settings/widget", headers=headers)
        settings.update(brand_name="Acceptance widget", primary_color="#146b57", allowed_domains=["client.example"])
        settings["design"].update(
            width=430, height=610, radius=16, identity="custom", logo_path=self.upload_logo(headers)
        )
        state["settings"] = self.request("/api/v1/settings/widget", "PUT", settings, headers)
        state["logo_sha256"] = hashlib.sha256(self.request(settings["design"]["logo_path"])).hexdigest()

        def delivered():
            """Find the synthetic welcome message in the authenticated mailbox and return its ID once actual capture
            is observed.
            """
            listing = self.request("/mail/api/v1/messages?limit=500", headers=self.mail_headers)
            message = next(
                (
                    item
                    for item in listing["messages"]
                    if any(recipient["Address"] == state["email"] for recipient in item["To"])
                ),
                None,
            )
            require(message is not None, "Welcome email did not reach local SMTP")
            return message["ID"]

        state["mail_id"] = wait_for(delivered, timeout)
        save_private_state(state_path, state, replace=True)
        self.verify_state(state)
        return state

    def verify_state(self, state):
        """Reauthenticate saved acceptance state and compare persisted organization/design/logo/mail identities after
        restart or restoration.
        """
        require(state["url"] == self.url, "State belongs to a different public origin")
        headers = self.login(state)
        require(self.request("/api/v1/settings/widget", headers=headers) == state["settings"], "Saved design changed")
        public_path = f"/api/v1/widget/settings/{state['company']}"
        public = self.request(public_path, headers={"Origin": "https://client.example"})
        require(public["design"] == state["settings"]["design"], "Embedded design differs from saved design")
        self.request(public_path, headers={"Origin": "https://not-allowed.example"}, status=403)
        logo = self.request(state["settings"]["design"]["logo_path"])
        require(hashlib.sha256(logo).hexdigest() == state["logo_sha256"], "Persistent logo content changed")
        message = self.request(f"/mail/api/v1/message/{state['mail_id']}", headers=self.mail_headers)
        require(any(recipient["Address"] == state["email"] for recipient in message["To"]), "Persisted email missing")


def save_private_state(path, state, replace=False):
    """Write synthetic recovery credentials with restrictive permissions, refusing accidental overwrite unless
    explicitly permitted.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | (os.O_TRUNC if replace else os.O_EXCL)
    with os.fdopen(os.open(path, flags, 0o600), "w", encoding="utf-8") as output:
        json.dump(state, output)


def main():
    """Validate acceptance CLI consent, run actual checks/optional synthetic writes/restart, save a sanitized report
    and return a truthful exit status.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--exercise", action="store_true", help="Create a synthetic tenant, logo/design and local welcome email"
    )
    parser.add_argument(
        "--state", type=Path, help="Private credentials/baseline: create with --exercise, otherwise verify"
    )
    parser.add_argument("--restart", action="store_true", help="Perform Compose down/up WITHOUT deleting volumes")
    parser.add_argument("--allow-interruption", action="store_true", help="Acknowledge downtime for all tenants")
    parser.add_argument("--ca-file", help="Trusted local CA/certificate PEM for an HTTPS installation")
    parser.add_argument("--timeout", type=int, default=240)
    parser.add_argument("--report", type=Path, default=ROOT / "logs/stack-acceptance.json")
    args = parser.parse_args()
    if args.exercise and (not args.state or args.state.exists()):
        parser.error("--exercise requires a new --state path; existing credentials are never overwritten")
    if args.restart and (not args.allow_interruption or not args.state):
        parser.error("--restart requires --allow-interruption and --state")
    if args.state and args.state.resolve() == args.report.resolve():
        parser.error("The public report and private state must use different files")
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    report = {
        "timestamp_utc": datetime.now(UTC).isoformat(),
        "host": platform.platform(),
        "checks": [],
        "status": "failed",
        "llm": "not tested by this infrastructure check",
    }
    try:
        config = json.loads(compose("config", "--format", "json"))
        report["project"] = config["name"]
        report["revision"] = command("git", "rev-parse", "HEAD").strip()
        report["dirty_checkout"] = bool(command("git", "status", "--porcelain").strip())
        report["compose_version"] = compose("version", "--short").strip()
        stack = Stack(config, args.ca_file)
        stack.ready(args.timeout)
        report["checks"].append(
            "services, migration, health, networks, volumes, sole proxy ingress, landing, API, widget, mailbox auth"
        )
        state = None
        if args.exercise:
            state = stack.exercise(args.state, args.timeout)
            report["checks"].append(
                "real registration/login, role/domain denial, uploaded logo, saved/public design, SMTP welcome email"
            )
        elif args.state:
            state = json.loads(args.state.read_text(encoding="utf-8"))
            stack.verify_state(state)
            report["checks"].append("existing database identity, exact design, logo hash and mailbox message retained")
        if args.restart:
            compose("down")
            compose("up", "-d")
            stack.ready(args.timeout)
            stack.verify_state(state)
            report["checks"].append("Compose down/up persistence verified against pre-restart application data")
        report["status"] = "passed"
    except (CheckError, OSError, ValueError, KeyError, URLError) as error:
        report["error"] = str(error) if isinstance(error, CheckError) else type(error).__name__
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
