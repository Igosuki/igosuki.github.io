"""Coupon codes."""
from decimal import Decimal

from shop import log, money

_COUPONS = {"WELCOME10": Decimal("0.10"), "SPRING15": Decimal("0.15")}


def discount_for(code: str | None, subtotal: Decimal) -> Decimal:
    if not code:
        return Decimal("0")
    rate = _COUPONS.get(code.upper())
    if rate is None:
        log.warn("discount.unknown_coupon", code=code)
        return Decimal("0")
    return money.quantize(subtotal * rate)
