"""Validate and restore one of our two known local-volume archive formats."""

import argparse
import gzip
import os
import shutil
import tarfile
import zlib
from pathlib import Path, PurePosixPath


def validate_members(archive, kind):
    """Return checked TAR members for the expected root, rejecting traversal, duplicates, links/devices and
    conflicting file/directory paths before deletion.
    """
    members = archive.getmembers()
    names = set()
    for member in members:
        path = PurePosixPath(member.name)
        if (
            path.is_absolute()
            or "\\" in member.name
            or ":" in member.name
            or ".." in path.parts
            or not path.parts
            or path.parts[0] != kind
            or str(path) in names
        ):
            raise SystemExit("Invalid or duplicate archive path")
        if not (member.isfile() or member.isdir()):
            raise SystemExit("Links/devices are not accepted in volume backups")
        names.add(str(path))
    if not any(member.isdir() and member.name.rstrip("/") == kind for member in members):
        raise SystemExit("Archive root directory is missing")
    files = {str(PurePosixPath(member.name)) for member in members if member.isfile()}
    if any(str(parent) in files for member in members for parent in PurePosixPath(member.name).parents):
        raise SystemExit("Archive contains conflicting file/directory paths")
    return members


def restore(archive_path, kind, destination, replace=False):
    """Validate complete gzip integrity and TAR structure from one open source; replace destination contents only when
    explicitly requested.
    """
    with open(archive_path, "rb") as compressed:
        # TAR EOF can precede the gzip trailer. Consume the entire compressed stream so
        # truncated/corrupt backups are rejected before existing volume data is touched.
        try:
            with gzip.GzipFile(fileobj=compressed, mode="rb") as content:
                while content.read(1024 * 1024):
                    pass
        except (OSError, EOFError, zlib.error):
            raise SystemExit("Archive is corrupted or incomplete") from None
        compressed.seek(0)
        _restore_validated_archive(compressed, kind, destination, replace)


def _restore_validated_archive(compressed, kind, destination, replace):
    """Extract integrity-checked contents and restore recorded UID/GID and modes with special bits removed;
    replacement is not atomic against disk failure. Use trusted backups: integrity
    checks do not authenticate an archive or make recorded owners/modes restrictive.
    """
    with tarfile.open(fileobj=compressed, mode="r:gz") as archive:
        members = validate_members(archive, kind)
        if not replace:
            print("Archive format validated")
            return
        if not destination.is_dir() or destination.is_symlink():
            raise SystemExit("Expected mounted volume is missing")
        for child in destination.iterdir():
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child)
            else:
                child.unlink()
        for member in members:
            parts = PurePosixPath(member.name).parts[1:]
            if not parts:
                continue
            target = destination.joinpath(*parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
        # Non-root services must still be able to write after restoration.
        # Restore directories last and never restore setuid/setgid bits.
        for member in sorted(members, key=lambda item: len(PurePosixPath(item.name).parts), reverse=True):
            target = destination.joinpath(*PurePosixPath(member.name).parts[1:])
            if hasattr(os, "chown"):
                os.chown(target, member.uid, member.gid)
            target.chmod(member.mode & 0o777)
        print("Volume restored")


def main():
    """Select one known mounted volume format from CLI arguments; require --replace before performing any destination
    mutation.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive")
    parser.add_argument("kind", choices=["widget-assets", "mail"])
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()
    destination = Path("/app/data/widget-assets" if args.kind == "widget-assets" else "/mail")
    restore(args.archive, args.kind, destination, args.replace)


if __name__ == "__main__":
    main()
