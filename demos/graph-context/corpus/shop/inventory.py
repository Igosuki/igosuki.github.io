"""Stock levels and checkout reservations."""
import time

from shop import config, log
from shop.cart import Cart
from shop.errors import OutOfStock

_STOCK = {"MUG-01": 120, "TEE-02": 45, "LMP-07": 8, "NTB-11": 300}
_RESERVED: dict[str, tuple[float, dict[str, int]]] = {}


def reserve(cart: Cart) -> None:
    for item in cart.items:
        if _STOCK.get(item.sku, 0) < item.quantity:
            raise OutOfStock(item.sku)
    for item in cart.items:
        _STOCK[item.sku] -= item.quantity
    expires = time.time() + config.RESERVATION_MINUTES * 60
    _RESERVED[cart.cart_id] = (expires, {i.sku: i.quantity for i in cart.items})
    log.event("inventory.reserved", cart_id=cart.cart_id)


def release(cart: Cart) -> None:
    held = _RESERVED.pop(cart.cart_id, None)
    if held is None:
        return
    for sku, quantity in held[1].items():
        _STOCK[sku] += quantity
    log.event("inventory.released", cart_id=cart.cart_id)


def commit(cart: Cart) -> None:
    _RESERVED.pop(cart.cart_id, None)
    log.event("inventory.committed", cart_id=cart.cart_id)


def expire_stale() -> int:
    now = time.time()
    stale = [cid for cid, (expires, _) in _RESERVED.items() if expires < now]
    for cart_id in stale:
        for sku, quantity in _RESERVED.pop(cart_id)[1].items():
            _STOCK[sku] += quantity
    log.event("inventory.expired", count=len(stale))
    return len(stale)
