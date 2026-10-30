"""Plain-text email templates."""
from shop import log

_TEMPLATES = {
    "order_confirmation": "Thanks for your order {order_id}. Total: {total}.",
    "payment_failed": "Your payment could not be completed ({reason}). Nothing was charged.",
    "refund_issued": "We refunded {amount} for order {order_id}.",
    "refund_finance": "Refund of {amount} on order {order_id} ({reason}) needs a ledger entry.",
    "refund_fraud": "Order {order_id} was refunded as fraud. Review the account.",
}


def render(name: str, **context) -> str:
    log.event("template.render", template=name)
    return _TEMPLATES[name].format(**context)
