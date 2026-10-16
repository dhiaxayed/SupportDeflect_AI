"""Local tenant logo storage with decoded-image validation and ownership checks.

Images are rasterized to bounded PNG files under random tenant-prefixed names.
The settings route saves the returned path separately; filesystem writes do not
participate in database rollback and unused files require the pruning operation.
"""

import io
import re
import warnings
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError

from app.core.config import get_settings


def asset_directory() -> Path:
    """Resolve the configured local logo directory without creating it or accessing the database."""
    return Path(get_settings().widget_assets_directory).resolve()


def asset_path(filename: str) -> Path:
    """Return a local PNG path for a validated generated filename, or raise HTTP 404.

    The restricted basename excludes traversal/separators; this does not check
    existence or tenant ownership, which are separate serving/settings concerns.
    """
    if not re.fullmatch(r"[a-zA-Z0-9_-]+\.png", filename):
        raise HTTPException(404, "Image not found")
    return asset_directory() / filename


def validate_owned_logo(org_id: str, path: str | None) -> None:
    """Accept None or require an existing local logo whose filename belongs to the tenant.

    A different prefix/missing file raises HTTP 422; an invalid basename may raise
    HTTP 404 through asset_path. No file is copied and no settings transaction is
    committed; validation must precede saving a custom logo reference.
    """
    if path is None:
        return
    filename = path.rsplit("/", 1)[-1]
    if not filename.startswith(org_id + "_") or not asset_path(filename).is_file():
        raise HTTPException(422, "Choose an image uploaded by this organization")


def store_logo(org_id: str, content: bytes) -> str:
    """Validate uploaded raster bytes, write a tenant-prefixed PNG and return its public path.

    Enforce byte/pixel/format bounds, take the first frame, resize proportionally
    and re-encode without source metadata. Oversize uploads raise HTTP 413 and
    invalid images raise HTTP 422; filesystem errors during saving propagate.
    The file write is independent of any later database settings commit.
    """
    if len(content) > get_settings().widget_logo_max_bytes:
        raise HTTPException(413, "Logo must be at most 2 MB")
    # Decode and re-encode raster content: extensions and client MIME types are not trusted.
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as source:
                if source.format not in {"PNG", "JPEG", "WEBP"}:
                    raise ValueError("Unsupported format")
                if min(source.size) < 1 or max(source.size) > 4096:
                    raise ValueError("Image dimensions exceed 4096 pixels")
                source.seek(0)
                image = source.convert("RGBA")
                image.thumbnail((512, 512))
                output = io.BytesIO()
                image.save(output, format="PNG", optimize=True)
    except (UnidentifiedImageError, ValueError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, "Upload a valid PNG, JPEG or WebP image, at most 4096 pixels per side") from None
    directory = asset_directory()
    directory.mkdir(parents=True, exist_ok=True)
    filename = f"{org_id}_{uuid4().hex}.png"
    asset_path(filename).write_bytes(output.getvalue())
    return f"/api/v1/widget/assets/{filename}"
