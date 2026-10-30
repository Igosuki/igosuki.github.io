"""Structured logging shared by every shop module."""
import json
import logging
import os
import time
from contextlib import contextmanager

logging.basicConfig(level=os.environ.get("SHOP_LOG_LEVEL", "INFO"), format="%(message)s")
_root = logging.getLogger("shop")


def get_logger(name: str) -> logging.Logger:
    """Return a logger namespaced under shop."""
    return _root.getChild(name)


def event(name: str, **fields) -> None:
    """Emit one JSON log line with an event name and its fields."""
    _root.info(json.dumps({"event": name, "ts": time.time(), **fields}, default=str))


def warn(name: str, **fields) -> None:
    """Same as event, at warning level."""
    _root.warning(json.dumps({"event": name, "ts": time.time(), **fields}, default=str))


@contextmanager
def timed(name: str, **fields):
    """Log an event with the elapsed milliseconds when the block exits."""
    start = time.monotonic()
    try:
        yield
    finally:
        event(name, elapsed_ms=round((time.monotonic() - start) * 1000), **fields)
