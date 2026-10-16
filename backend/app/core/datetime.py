"""Normalize application timestamps to aware UTC at SQLAlchemy bind/result boundaries, including SQLite's naive
datetime results.
"""

from datetime import UTC, datetime
from typing import overload

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator


@overload
def as_utc(value: datetime) -> datetime:
    """Typing overload: a supplied datetime becomes an aware UTC datetime."""
    ...


@overload
def as_utc(value: None) -> None:
    """Typing overload: an absent optional timestamp remains None."""
    ...


def as_utc(value: datetime | None) -> datetime | None:
    """Return aware UTC for value, interpreting naive persisted timestamps as UTC; preserve None.

    SQLite discards timezone offsets, so never infer the host timezone for its naive results.
    Already aware values are converted to UTC without changing the instant they represent.
    """
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class UTCDateTime(TypeDecorator[datetime]):
    """Preserve UTC semantics across PostgreSQL and SQLite, including API serialization."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        """Normalize a datetime or None before the dialect persists it; dialect is SQLAlchemy context and does not
        alter the UTC interpretation.
        """
        return as_utc(value)

    def process_result_value(self, value, dialect):
        # SQLite discards offsets even for timezone=True; never return an ambiguous browser date.
        """Restore aware UTC on database output, including naive SQLite timestamps; preserve SQL NULL as None for
        callers and API serialization.
        """
        return as_utc(value)
