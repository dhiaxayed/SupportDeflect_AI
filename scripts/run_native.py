"""Run the native development stack; Compose remains the Linux deployment path."""

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import webbrowser
from pathlib import Path
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener

from dotenv import dotenv_values

APPLICATION_URL = "http://127.0.0.1:5173/"


def find_node(root: Path, explicit: str | None) -> str:
    """Resolve an explicit, configured or cached Node 24+ executable; raise SystemExit with an actionable prerequisite
    message if none passes version probing.
    """
    candidates = [explicit or os.environ.get("SUPPORTDEFLECT_NODE")]
    if not candidates[0]:
        candidates = [shutil.which("node"), str(root / "frontend/node_modules/node/bin/node.exe")]
        for variable in ("LOCALAPPDATA", "APPDATA"):
            if os.environ.get(variable):
                cache = Path(os.environ[variable]) / "npm-cache/_npx"
                candidates.extend(str(path) for path in sorted(cache.glob("*/node_modules/node/bin/node.exe")))
    for candidate in candidates:
        if not candidate:
            continue
        try:
            version = subprocess.check_output(
                [candidate, "--version"],
                text=True,
                stderr=subprocess.DEVNULL,
                timeout=10,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            ).strip()
            if int(version.lstrip("v").split(".")[0]) >= 24:
                return candidate
        except (OSError, ValueError, subprocess.SubprocessError):
            continue
    raise SystemExit("Node 24+ introuvable. Installez-le ou indiquez son chemin avec --node / SUPPORTDEFLECT_NODE.")


def find_mailpit(root: Path, explicit: str | None) -> str:
    """Resolve the explicit/configured/local Mailpit executable without downloading software; fail with a path-
    selection instruction when absent.
    """
    selected = explicit or os.environ.get("SUPPORTDEFLECT_MAILPIT")
    candidates = (
        [selected]
        if selected
        else [
            shutil.which("mailpit"),
            str(root / "tools/mailpit/mailpit.exe"),
            str(Path(tempfile.gettempdir()) / "supportdeflect-tools/mailpit/mailpit.exe"),
        ]
    )
    for candidate in candidates:
        if candidate and (Path(candidate).is_file() or shutil.which(candidate)):
            return candidate
    raise SystemExit("Mailpit introuvable. Indiquez son chemin avec --mailpit / SUPPORTDEFLECT_MAILPIT.")


def local_stack_ready() -> bool:
    """Probe the configured local API, frontend and Mailpit with per-request timeouts.

    Initial URLs target loopback and bypass environment proxies. The standard opener
    still permits redirects, so this is a readiness check rather than an outbound-network
    restriction. Frontend/mailbox bodies are size-limited, but health JSON decoding
    has no byte ceiling. Return False for unavailable or unexpected services.
    """
    opener = build_opener(ProxyHandler({}))
    try:
        with opener.open("http://127.0.0.1:8000/healthz/db", timeout=2) as response:
            if json.load(response) != {"status": "healthy"}:
                return False
        with opener.open(APPLICATION_URL, timeout=2) as response:
            if b"SupportDeflect" not in response.read(512 * 1024):
                return False
        with opener.open("http://127.0.0.1:8025/", timeout=2) as response:
            return b"Mailpit" in response.read(64 * 1024)
    except (OSError, URLError, ValueError):
        return False


def main():
    """Validate native prerequisites/configuration, migrate/reindex, supervise all five local processes and clean them
    up on exit; --check performs no startup.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", help="Node 24+ executable; otherwise detected automatically")
    parser.add_argument("--mailpit", help="Local Mailpit executable; otherwise detected automatically")
    parser.add_argument("--open-browser", action="store_true", help="Open the application after its services are ready")
    parser.add_argument("--check", action="store_true", help="Validate local prerequisites without starting services")
    parser.add_argument(
        "--offline-embeddings",
        action="store_true",
        help="Use a previously downloaded MiniLM cache",
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if args.open_browser and not args.check and local_stack_ready():
        print(f"SupportDeflect AI est deja demarre : {APPLICATION_URL}", flush=True)
        webbrowser.open(APPLICATION_URL)
        return
    args.node = find_node(root, args.node)
    args.mailpit = find_mailpit(root, args.mailpit)
    for path in (
        "backend/.env",
        "frontend/node_modules/vite/bin/vite.js",
        "mailer/node_modules/nodemailer/package.json",
    ):
        if not (root / path).is_file():
            raise SystemExit(f"Prerequis manquant : {path}. Suivez l'installation native du README.")
    env = {
        **os.environ,
        **{k: v for k, v in dotenv_values(root / "backend/.env").items() if v is not None},
    }
    for name in ("GROQ_API_KEY", "GROQ_MODEL"):
        if os.environ.get(name):
            env[name] = os.environ[name]
    # Keep the Groq key/model pair together when inherited from the root Compose configuration.
    # Never import root DB/runtime settings into the native stack.
    if not env.get("GROQ_API_KEY"):
        root_values = dotenv_values(root / ".env")
        for name in ("GROQ_API_KEY", "GROQ_MODEL"):
            if root_values.get(name) and not os.environ.get(name):
                env[name] = root_values[name]
    env.update(
        ENVIRONMENT="local",
        LLM_PROVIDER="groq",
        EMBEDDING_PROVIDER="sentence-transformers",
        ALLOW_FAKE_EMBEDDINGS_FALLBACK="false",
        VECTOR_PROVIDER="database",
        FRONTEND_URL="http://localhost:5173",
        BACKEND_PUBLIC_URL="http://localhost:8000",
        INGESTION_MODE="queued",
        PYTHONUNBUFFERED="1",
        HF_HUB_DISABLE_TELEMETRY="1",
    )
    if not env.get("MAILER_SERVICE_TOKEN") or len(env["MAILER_SERVICE_TOKEN"]) < 32:
        raise SystemExit("Set a random MAILER_SERVICE_TOKEN in backend/.env (at least 32 characters).")
    if args.offline_embeddings:
        env["HF_HUB_OFFLINE"] = "1"
    if args.check:
        print(json.dumps({"status": "ready", "node": args.node, "mailpit": args.mailpit}), flush=True)
        return
    for port in (8000, 5173, 1025, 8025):
        with socket.socket() as check:
            try:
                check.bind(("127.0.0.1", port))
            except OSError:
                raise SystemExit(f"Port {port} is already occupied; stop the identified service first.") from None
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=root / "backend",
        env=env,
        check=True,
    )
    logs = root / "logs"
    # Persisted text survives model changes. Rebuild stale vectors before serving indexed knowledge.
    subprocess.run(
        [sys.executable, "scripts/reindex_vectors.py", "--all"],
        cwd=root / "backend",
        env=env,
        check=True,
    )
    logs.mkdir(exist_ok=True)
    mail_data = root / "data/mailpit"
    mail_data.mkdir(parents=True, exist_ok=True)
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    processes = []
    streams = []
    stopping = False

    def stop(_signum=None, _frame=None):
        """Record a termination request in the supervisor; signal handling defers process cleanup to the main finally
        block.
        """
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    def start(name, command, cwd, overrides=None):
        """Launch one supervised child with isolated environment overrides and an append-only local log; retain
        process/stream handles for guaranteed cleanup.
        """
        log = (logs / f"native-{name}.log").open("a", encoding="utf-8")
        streams.append(log)
        process = subprocess.Popen(
            command,
            cwd=cwd,
            env={**env, **(overrides or {})},
            stdout=log,
            stderr=subprocess.STDOUT,
            creationflags=flags,
        )
        processes.append((name, process))

    try:
        start(
            "mailpit",
            [args.mailpit],
            root,
            {
                "MP_SMTP_BIND_ADDR": "127.0.0.1:1025",
                "MP_UI_BIND_ADDR": "127.0.0.1:8025",
                "MP_DATABASE": str(mail_data / "mail.db"),
                "MP_DISABLE_VERSION_CHECK": "true",
                "MP_SMTP_DISABLE_RDNS": "true",
                "MP_BLOCK_REMOTE_CSS_AND_FONTS": "true",
            },
        )
        start(
            "api",
            [
                sys.executable,
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                "8000",
            ],
            root / "backend",
        )
        start(
            "worker",
            [sys.executable, "scripts/run_ingestion_worker.py"],
            root / "backend",
        )
        start(
            "frontend",
            [
                args.node,
                "node_modules/vite/bin/vite.js",
                "--host",
                "127.0.0.1",
                "--port",
                "5173",
                "--strictPort",
            ],
            root / "frontend",
            {"DEV_API_URL": "http://127.0.0.1:8000"},
        )
        start(
            "mailer",
            [args.node, "worker.mjs"],
            root / "mailer",
            {
                "MAILER_API_URL": "http://127.0.0.1:8000/api/v1",
                "SMTP_HOST": "127.0.0.1",
                "SMTP_PORT": "1025",
                "SMTP_ALLOW_INSECURE_LOCAL": "true",
                "SMTP_FROM": env.get("MAIL_FROM", "dhiaayed03@gmail.com"),
            },
        )
        print(
            json.dumps(
                {
                    "url": "http://localhost:5173",
                    "mailbox": "http://127.0.0.1:8025",
                    "processes": {name: process.pid for name, process in processes},
                }
            ),
            flush=True,
        )
        browser_pending = args.open_browser
        browser_deadline = time.monotonic() + 300
        while not stopping:
            for name, process in processes:
                if process.poll() is not None:
                    raise SystemExit(f"{name} exited; inspect logs/native-{name}.log")
            if browser_pending:
                if local_stack_ready():
                    print(f"Projet pret : {APPLICATION_URL} - Ctrl+C pour arreter les services.", flush=True)
                    webbrowser.open(APPLICATION_URL)
                    browser_pending = False
                elif time.monotonic() >= browser_deadline:
                    print(f"Demarrage encore en cours. Consultez logs puis ouvrez {APPLICATION_URL}", flush=True)
                    browser_pending = False
            time.sleep(1)
    finally:
        for _, process in reversed(processes):
            if process.poll() is None:
                if os.name == "nt":
                    subprocess.run(
                        ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                        capture_output=True,
                    )
                else:
                    process.terminate()
        for _, process in processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        for stream in streams:
            stream.close()


if __name__ == "__main__":
    main()
