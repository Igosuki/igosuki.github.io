"""Order risk scoring."""
from decimal import Decimal

from shop import config, log
from shop.customers import Customer


def score(customer: Customer, amount: Decimal, shipping_country: str) -> float:
    value = 0.0
    if shipping_country != customer.country:
        value += 0.4
    if amount > Decimal("500"):
        value += 0.3
    if "new" in customer.tags:
        value += 0.2
    log.event("fraud.score", customer_id=customer.customer_id, score=value)
    return min(value, 1.0)


def needs_review(value: float) -> bool:
    return value >= config.FRAUD_REVIEW_SCORE
