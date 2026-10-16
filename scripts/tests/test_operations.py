"""Operator safety tests, executable with only Python's standard library."""

import copy
import importlib.util
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]


def load(name):
    """Import one root operator script by path so these safety tests need only the standard library rather than an
    installed application package.
    """
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


configure = load("configure")
archive_tools = load("restore_archive")
verify = load("verify_stack")


class ConfigurationTests(unittest.TestCase):
    """Configuration-generation safety checks isolated in temporary directories, including independent secrets and
    overwrite refusal.
    """
    def test_origins(self):
        """Accept valid HTTP(S) origins and reject path/credential/port/line-injection forms before environment
        generation.
        """
        for origin in ("http://localhost", "https://192.168.1.50/", "http://localhost:8080", "http://[::1]"):
            self.assertIsNotNone(configure.validate_origin(origin).hostname)
        for origin in (
            "http://host/path",
            "https://host?x=1",
            "https://host#section",
            "http://user:pass@host",
            "http://host:0",
            "http://host:65536",
            "http://host:bad",
            "http://host\nSECRET_KEY=value",
            "file:///etc/passwd",
            "http://",
            "http://space host",
            "http://@host",
            "http://host?",
            "http://host#",
            "http://host\\path",
            "http://$PRIVATE_KEY",
        ):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                configure.validate_origin(origin)

    def test_configuration_generation_preserves_existing_secrets(self):
        """Generate fixture configuration once, require independent strong values, then prove a second run leaves the
        original file untouched.
        """
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "scripts").mkdir()
            (root / ".env.example").write_text((SCRIPTS.parent / ".env.example").read_text())
            with patch.object(configure, "__file__", str(root / "scripts/configure.py")):
                with patch.object(sys, "argv", ["configure", "--url", "http://192.168.1.50"]):
                    configure.main()
                    original = (root / ".env").read_text()
                    with self.assertRaises(SystemExit):
                        configure.main()
            self.assertEqual(original, (root / ".env").read_text())
            values = dict(line.split("=", 1) for line in original.splitlines() if line and not line.startswith("#"))
            keys = [
                values[key] for key in ("SECRET_KEY", "POSTGRES_PASSWORD", "MAILER_SERVICE_TOKEN", "MAILPIT_PASSWORD")
            ]
            self.assertEqual(len(set(keys)), 4)
            self.assertTrue(all(len(key) >= 48 for key in keys))
            self.assertEqual(values["PUBLIC_URL"], "http://192.168.1.50")


class ArchiveTests(unittest.TestCase):
    """Synthetic TAR/gzip safety cases that protect an existing destination sentinel before any replacement occurs."""
    def member(self, name, directory=False):
        """Build a synthetic regular-file/directory TAR header with known service ownership and safe default modes."""
        member = tarfile.TarInfo(name)
        member.type = tarfile.DIRTYPE if directory else tarfile.REGTYPE
        member.mode = 0o750 if directory else 0o640
        member.uid, member.gid = 1000, 1000
        return member

    def archive(self, path, members):
        """Write the supplied synthetic headers into a gzip TAR fixture at the requested temporary path."""
        with tarfile.open(path, "w:gz") as output:
            for member in members:
                output.addfile(member, io.BytesIO(b""))

    def test_unsafe_archives_do_not_delete_existing_data(self):
        """Reject unsafe member structures before touching destination contents, retaining the existing sentinel for
        every adversarial case.
        """
        root = self.member("mail", directory=True)
        link = self.member("mail/link")
        link.type, link.linkname = tarfile.SYMTYPE, "/etc/passwd"
        cases = [
            [],
            [root, self.member("../escape")],
            [root, self.member("/absolute")],
            [root, self.member("wrong-root/file")],
            [root, self.member("mail/..\\escape")],
            [root, self.member("mail/C:/escape")],
            [root, link],
            [root, self.member("mail/file"), self.member("mail/file")],
            [root, self.member("mail/file"), self.member("mail/file/nested")],
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            destination = path / "destination"
            destination.mkdir()
            sentinel = destination / "keep"
            sentinel.write_text("original")
            for members in cases:
                with self.subTest(names=[item.name for item in members]):
                    self.archive(path / "bad.tar.gz", members)
                    with self.assertRaises(SystemExit):
                        archive_tools.restore(path / "bad.tar.gz", "mail", destination, replace=True)
                    self.assertEqual(sentinel.read_text(), "original")

    def test_restore_preserves_service_ownership_and_safe_modes(self):
        """Replace a temporary volume with valid content while restoring service ownership and stripping privileged
        permission bits.
        """
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            destination = path / "destination"
            destination.mkdir()
            (destination / "old").write_text("old")
            root, file = self.member("mail", True), self.member("mail/mailpit.db")
            file.mode = 0o4640
            self.archive(path / "valid.tar.gz", [root, file])
            with patch.object(archive_tools.os, "chown", create=True) as chown:
                archive_tools.restore(path / "valid.tar.gz", "mail", destination, replace=True)
            self.assertFalse((destination / "old").exists())
            self.assertTrue((destination / "mailpit.db").is_file())
            chown.assert_any_call(destination / "mailpit.db", 1000, 1000)
            chown.assert_any_call(destination, 1000, 1000)
            if os.name != "nt":
                self.assertEqual((destination / "mailpit.db").stat().st_mode & 0o7777, 0o640)

    def test_corrupt_or_incomplete_compression_preserves_existing_data(self):
        """Corrupt CRC/truncate the gzip trailer and require validation-only and replacement modes to preserve all
        original destination data.
        """
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            destination = path / "destination"
            destination.mkdir()
            sentinel = destination / "keep"
            sentinel.write_text("original")
            archive = path / "mail.tar.gz"
            self.archive(archive, [self.member("mail", True), self.member("mail/mailpit.db")])
            original = archive.read_bytes()
            bad_crc = bytearray(original)
            bad_crc[-8] ^= 0xFF
            for payload in (bytes(bad_crc), original[:-8]):
                for replace in (False, True):
                    with self.subTest(replace=replace, truncated=len(payload) < len(original)):
                        archive.write_bytes(payload)
                        with self.assertRaises(SystemExit):
                            archive_tools.restore(archive, "mail", destination, replace=replace)
                        self.assertEqual(sentinel.read_text(), "original")

    def test_restore_reads_the_same_open_archive_that_passed_integrity_validation(self):
        """Require gzip validation and TAR parsing to share the same open source descriptor rather than reopening a
        replaceable path.
        """
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            archive = path / "mail.tar.gz"
            self.archive(archive, [self.member("mail", True)])
            with (
                patch.object(archive_tools.gzip, "GzipFile", wraps=archive_tools.gzip.GzipFile) as gzip_open,
                patch.object(archive_tools.tarfile, "open", wraps=archive_tools.tarfile.open) as tar_open,
            ):
                archive_tools.restore(archive, "mail", path, replace=False)
            validated_source = gzip_open.call_args_list[0].kwargs["fileobj"]
            self.assertIs(tar_open.call_args.kwargs["fileobj"], validated_source)
            self.assertIsNone(tar_open.call_args.kwargs.get("name"))


class StackTests(unittest.TestCase):
    """Operator-probe contract, privacy and interruption checks using explicit container/HTTP/command doubles rather
    than a real Docker installation.
    """
    def fixture(self):
        """Return a complete synthetic resolved Compose/inspection pair satisfying the expected eight-service runtime
        contract.
        """
        config = {
            "services": {},
            "networks": {"edge": {"name": "test_edge"}},
            "volumes": {"data": {"name": "test_data"}},
        }
        containers = []
        for name in sorted(verify.SERVICES):
            config["services"][name] = {"networks": {"edge": {}}, "healthcheck": {"test": ["CMD", "true"]}}
            containers.append(
                {
                    "Config": {"Labels": {"com.docker.compose.service": name}},
                    "State": {
                        "Status": "exited" if name == "migrate" else "running",
                        "ExitCode": 0,
                        "Health": {"Status": "healthy"},
                    },
                    "NetworkSettings": {
                        "Networks": {"test_edge": {}},
                        "Ports": {"80/tcp": [{}]} if name == "traefik" else {},
                    },
                    "Mounts": [],
                }
            )
        config["services"]["postgres"]["volumes"] = [{"type": "volume", "source": "data", "target": "/data"}]
        next(item for item in containers if item["Config"]["Labels"]["com.docker.compose.service"] == "postgres")[
            "Mounts"
        ] = [
            {"Name": "test_data", "Destination": "/data"},
        ]
        return config, containers

    def test_actual_container_contract(self):
        """Corrupt each health/ingress/network/storage/migration invariant and require the runtime validator to reject
        it.
        """
        config, containers = self.fixture()
        verify.validate_containers(config, containers)
        failures = [
            ("backend", lambda item: item["State"].update(Status="restarting")),
            ("backend", lambda item: item["State"]["Health"].update(Status="unhealthy")),
            ("backend", lambda item: item["NetworkSettings"]["Ports"].update({"8000/tcp": [{}]})),
            ("migrate", lambda item: item["State"].update(ExitCode=1)),
            ("frontend", lambda item: item["NetworkSettings"].update(Networks={})),
            ("postgres", lambda item: item["Mounts"][0].update(Name="wrong_volume")),
        ]
        for service, corrupt in failures:
            with self.subTest(service=service):
                modified = copy.deepcopy(containers)
                corrupt(
                    next(item for item in modified if item["Config"]["Labels"]["com.docker.compose.service"] == service)
                )
                with self.assertRaises(verify.CheckError):
                    verify.validate_containers(config, modified)
        with self.assertRaises(verify.CheckError):
            verify.validate_containers(config, containers[:-1])

    def test_state_is_private_and_not_overwritten_accidentally(self):
        """Persist private fixture recovery state with restrictive permissions and reject overwrite without explicit
        consent.
        """
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            verify.save_private_state(path, {"password": "test-only"})
            with self.assertRaises(FileExistsError):
                verify.save_private_state(path, {})
            self.assertEqual(json.loads(path.read_text()), {"password": "test-only"})
            if os.name != "nt":
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_restart_requires_explicit_downtime_acknowledgement(self):
        """Reject restart CLI usage before any Compose call unless the operator explicitly acknowledges interruption
        and supplies state.
        """
        with patch.object(sys, "argv", ["verify_stack", "--restart"]), patch.object(verify, "compose") as compose:
            with self.assertRaises(SystemExit) as error:
                verify.main()
            self.assertEqual(error.exception.code, 2)
            compose.assert_not_called()

    def test_command_failure_does_not_disclose_environment(self):
        """Inject secret-bearing command output and require the reported failure to omit those private values."""
        result = subprocess.CompletedProcess(["docker"], 1, "SECRET_KEY=private", "password=private")
        with patch.object(verify.subprocess, "run", return_value=result):
            with self.assertRaises(verify.CheckError) as error:
                verify.compose("config")
            self.assertNotIn("private", str(error.exception))

    def test_timeout_retains_safe_actionable_failure(self):
        """Keep the sanitized unhealthy-service reason when readiness polling reaches its deadline."""
        def unhealthy():
            """Fail every readiness attempt with a safe backend-health reason to exercise timeout reporting."""
            raise verify.CheckError("Service is not healthy: backend")

        with self.assertRaisesRegex(verify.CheckError, "not healthy: backend"):
            verify.wait_for(unhealthy, timeout=0)

    def test_redirect_cannot_forward_credentials(self):
        """Require the probe's redirect handler to refuse cross-origin credential forwarding."""
        handler = verify.NoRedirect()
        self.assertIsNone(handler.redirect_request(None, None, 302, "Found", {}, "https://other.example"))


if __name__ == "__main__":
    unittest.main()
