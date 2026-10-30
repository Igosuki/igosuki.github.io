"""Refund workflow."""
from decimal import Decimal

from shop import audit, log, notifications, orders, payments


def issue_refund(order_id: str, amount: Decimal, reason: str, actor: str) -> None:
    order = orders.get(order_id)
    log.event("refund.start", order_id=order_id, amount=amount)
    payments.refund_charge(order.charge_id, amount)
    orders.mark_refunded(order, amount)
    audit.record("refund", actor, order_id=order_id, amount=str(amount), reason=reason)
    notifications.notify_refund(order, amount, reason)
