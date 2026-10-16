"""Report orphaned widget logos; deletion requires --apply and a seven-day grace period."""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import select

from app.core.config import get_settings
from app.db import SessionLocal
from app.models import Organization


def main():
    """Collect saved logo references and report unreferenced regular PNG files older than seven days inside the
    configured asset directory. Delete only with --apply after path/symlink checks; otherwise remain a dry run
    and leave database state unchanged.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    directory = Path(get_settings().widget_assets_directory).resolve()
    with SessionLocal() as db:
        referenced = {
            Path((design or {}).get("logo_path") or "").name
            for design in db.scalars(select(Organization.widget_design))
        }
    candidates = []
    for path in directory.glob("*.png"):
        if (
            not path.is_symlink()
            and path.is_file()
            and path.resolve().parent == directory
            and path.name not in referenced
            and path.stat().st_mtime < time.time() - 7 * 86400
        ):
            candidates.append(path)
    print(f"Unreferenced logos older than seven days: {len(candidates)}")
    if args.apply:
        for path in candidates:
            path.unlink(missing_ok=True)
        print("Orphaned logos removed; currently saved designs preserved.")
    else:
        print("Dry run only. Use --apply after reviewing the count and backing up assets.")


if __name__ == "__main__":
    main()
