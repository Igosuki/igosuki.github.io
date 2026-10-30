"""Product lookup."""
from dataclasses import dataclass
from decimal import Decimal

from shop import log


@dataclass(frozen=True)
class Product:
    sku: str
    name: str
    price: Decimal
    weight_g: int


_PRODUCTS = {
    "MUG-01": Product("MUG-01", "Enamel mug", Decimal("14.00"), 320),
    "TEE-02": Product("TEE-02", "Logo tee", Decimal("28.00"), 210),
    "LMP-07": Product("LMP-07", "Desk lamp", Decimal("64.50"), 1400),
    "NTB-11": Product("NTB-11", "Dot-grid notebook", Decimal("9.50"), 180),
}


def get_product(sku: str) -> Product:
    try:
        return _PRODUCTS[sku]
    except KeyError:
        log.warn("catalog.unknown_sku", sku=sku)
        raise
