"""Append-only audit trail for money and stock movements."""
from shop import log

_TRAIL: list[dict] = []


def record(action: str, actor: str, **details) -> None:
    _TRAIL.append({"action": action, "actor": actor, **details})
    log.event("audit", action=action, actor=actor)


def trail_for(key: str, value: str) -> list[dict]:
    return [entry for entry in _TRAIL if entry.get(key) == value]
