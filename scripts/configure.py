"""Generate the Compose environment once, without overwriting existing secrets."""

import argparse
import ipaddress
import os
import re
import secrets
from pathlib import Path
from urllib.parse import urlsplit


def validate_origin(value):
    """Parse a browser-visible HTTP(S) origin; reject credentials, paths, malformed hosts/ports and whitespace that
    could corrupt generated environment lines.
    """
    origin = urlsplit(value)
    if (
        origin.scheme not in {"http", "https"}
        or not origin.hostname
        or origin.username is not None
        or origin.path not in {"", "/"}
        or origin.query
        or origin.fragment
        or "?" in value
        or "#" in value
        or any(character.isspace() for character in value)
    ):
        raise ValueError("Provide an HTTP(S) origin without credentials, query, fragment or path")
    try:
        ipaddress.ip_address(origin.hostname)
    except ValueError:
        if len(origin.hostname) > 253 or not all(
            re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?", label)
            for label in origin.hostname.rstrip(".").split(".")
        ):
            raise ValueError("Provide a valid IP address or DNS hostname") from None
    # Accessing port also rejects non-numeric and out-of-range values.
    if origin.port == 0:
        raise ValueError("Port must be between 1 and 65535")
    return origin


def main():
    """Create .env exclusively from the example with independent random secrets; preserve any existing file and print
    no generated secret values.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--url",
        required=True,
        help="Browser-visible origin, for example http://192.168.1.50",
    )
    args = parser.parse_args()
    try:
        origin = validate_origin(args.url)
    except ValueError as error:
        parser.error(str(error))
    root = Path(__file__).resolve().parents[1]
    target = root / ".env"
    values = {
        "SECRET_KEY": secrets.token_hex(32),
        "POSTGRES_PASSWORD": secrets.token_hex(32),
        "MAILER_SERVICE_TOKEN": secrets.token_hex(32),
        "MAILPIT_PASSWORD": secrets.token_hex(24),
        "PUBLIC_URL": args.url.rstrip("/"),
        "TRUSTED_HOSTS": f"{origin.hostname},localhost,127.0.0.1,backend",
    }
    lines = []
    for line in (root / ".env.example").read_text().splitlines():
        key, separator, _ = line.partition("=")
        lines.append(f"{key}={values[key]}" if separator and key in values else line)
    try:
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            output.write("\n".join(lines) + "\n")
    except FileExistsError:
        raise SystemExit("Existing .env preserved. Review it manually against .env.example.") from None
    print("Created .env with independent secrets. Set GROQ_API_KEY and confirm GROQ_MODEL before startup.")


if __name__ == "__main__":
    main()
