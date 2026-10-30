"""Outgoing email and ops alerts."""
from decimal import Decimal

from shop import config, customers, log, templates
from shop.customers import Customer
from shop.orders import Order


def send_email(to: str, template: str, **context) -> None:
    body = templates.render(template, **context)
    log.event("email.sent", to=to, template=template, size=len(body))


def send_order_confirmation(customer: Customer, order: Order) -> None:
    send_email(customer.email, "order_confirmation", order_id=order.order_id, total=order.total)


def send_payment_failed(customer: Customer, reason: str) -> None:
    send_email(customer.email, "payment_failed", reason=reason)


def refund_recipients(customer: Customer, amount: Decimal, reason: str) -> list[tuple[str, str]]:
    """(address, template) pairs that hear about a refund."""
    recipients = []
    if customer.refund_emails:
        recipients.append((customer.email, "refund_issued"))
    if amount > config.FINANCE_REFUND_LIMIT:
        recipients.append((config.FINANCE_ADDRESS, "refund_finance"))
    if reason == "fraud":
        recipients.append((config.SUPPORT_ADDRESS, "refund_fraud"))
    return recipients


def notify_refund(order: Order, amount: Decimal, reason: str) -> None:
    customer = customers.get(order.customer_id)
    for address, template in refund_recipients(customer, amount, reason):
        send_email(address, template, order_id=order.order_id, amount=amount, reason=reason)
