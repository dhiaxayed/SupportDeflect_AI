"""Strict version-1 widget design schema shared by persisted tenant settings, public settings and the renderer.
Bounds constrain geometry; asset ownership is validated by the settings service boundary.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class WidgetDesign(BaseModel):
    """Versioned public design contract shared by the studio and vanilla renderer.

    Unknown keys are rejected so stored drafts and embed behavior cannot drift silently.
    Geometry values are CSS pixels, colors are six-digit hex, and logo_path must use the
    generated local asset route; tenant ownership is checked separately when settings save.
    """

    model_config = ConfigDict(extra="forbid")
    # Version fixes the renderer contract; a future incompatible shape needs an explicit migration.
    version: Literal[1] = 1
    width: int = Field(default=380, ge=280, le=640)
    height: int = Field(default=560, ge=320, le=800)
    launcher_size: int = Field(default=56, ge=40, le=88)
    position: Literal["bottom-right", "bottom-left"] = "bottom-right"
    offset_x: int = Field(default=20, ge=8, le=80)
    offset_y: int = Field(default=20, ge=8, le=80)
    radius: int = Field(default=16, ge=0, le=32)
    theme: Literal["light", "dark", "system"] = "light"
    background_color: str = Field(default="#f4f4f4", pattern=r"^#[0-9a-fA-F]{6}$")
    text_color: str = Field(default="#161616", pattern=r"^#[0-9a-fA-F]{6}$")
    placeholder: str = Field(default="Ask a question...", min_length=1, max_length=100)
    subtitle: str = Field(default="AI assistant", max_length=80)
    # Choosing custom requires an uploaded owned logo at the settings endpoint, beyond this schema.
    identity: Literal["default", "robot", "custom"] = "default"
    logo_path: str | None = Field(default=None, max_length=200, pattern=r"^/api/v1/widget/assets/[a-zA-Z0-9_-]+\.png$")
    logo_size: int = Field(default=32, ge=20, le=56)
    # Delay is measured in seconds and only applies to the delayed initial-open policy.
    open_behavior: Literal["closed", "open", "delayed"] = "closed"
    open_delay_seconds: int = Field(default=5, ge=1, le=60)
