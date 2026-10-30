"""Shipping quotes."""
from decimal import Decimal

from shop import config, countries, log, money

_BASE = Decimal("4.90")
_PER_KG = Decimal("2.10")
_INTERNATIONAL = Decimal("9.00")


def quote(weight_g: int, country: str, subtotal: Decimal) -> Decimal:
    if subtotal >= config.FREE_SHIPPING_OVER and country == config.STORE_COUNTRY:
        return Decimal("0")
    cost = _BASE + _PER_KG * (Decimal(weight_g) / 1000)
    if country != config.STORE_COUNTRY:
        cost += _INTERNATIONAL
    log.event("shipping.quote", country=country, eu=countries.is_eu(country))
    return money.quantize(cost)
