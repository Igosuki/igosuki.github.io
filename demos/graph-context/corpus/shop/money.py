"""Decimal helpers for currency amounts."""
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")


def quantize(amount: Decimal) -> Decimal:
    return amount.quantize(CENT, rounding=ROUND_HALF_UP)


def to_cents(amount: Decimal) -> int:
    return int(quantize(amount) * 100)
