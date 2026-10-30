"""Order records."""
from dataclasses import dataclass, field
from decimal import Decimal

from shop import log
from shop.errors import RefundNotAllowed


@dataclass
class Order:
    order_id: str
    customer_id: str
    charge_id: str
    total: Decimal
    status: str = "paid"
    refunded: Decimal = Decimal("0")
    history: list[str] = field(default_factory=list)


_ORDERS: dict[str, Order] = {}


def create(order_id: str, customer_id: str, charge_id: str, total: Decimal) -> Order:
    order = Order(order_id, customer_id, charge_id, total)
    _ORDERS[order_id] = order
    log.event("order.created", order_id=order_id, total=total)
    return order


def get(order_id: str) -> Order:
    return _ORDERS[order_id]


def refundable(order: Order) -> Decimal:
    return order.total - order.refunded


def mark_refunded(order: Order, amount: Decimal) -> None:
    if amount > refundable(order):
        raise RefundNotAllowed(f"{amount} exceeds refundable {refundable(order)}")
    order.refunded += amount
    order.status = "refunded" if refundable(order) == 0 else "partially_refunded"
    order.history.append(f"refund {amount}")
    log.event("order.refunded", order_id=order.order_id, amount=amount)
