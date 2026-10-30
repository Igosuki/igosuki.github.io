"""Turns a cart into a paid order."""
import uuid

from shop import audit, fraud, inventory, log, notifications, orders, payments, pricing
from shop.cart import Cart
from shop.customers import Customer
from shop.errors import CheckoutFailed, PaymentDeclined, PricingError


def place_order(cart: Cart, customer: Customer, card_token: str) -> orders.Order:
    log.event("checkout.start", cart_id=cart.cart_id, customer_id=customer.customer_id)
    try:
        breakdown = pricing.total(cart, customer)
    except PricingError as exc:
        log.warn("checkout.pricing_failed", cart_id=cart.cart_id, reason=str(exc))
        raise CheckoutFailed("pricing_unavailable") from exc

    if fraud.needs_review(fraud.score(customer, breakdown.total, customer.country)):
        raise CheckoutFailed("held_for_review")

    inventory.reserve(cart)
    order_id = f"ord_{uuid.uuid4().hex[:10]}"
    try:
        charge_id = payments.charge_card(card_token, breakdown.total, order_id)
    except PaymentDeclined as exc:
        inventory.release(cart)
        notifications.send_payment_failed(customer, exc.code)
        audit.record("payment_declined", customer.customer_id, code=exc.code)
        raise CheckoutFailed("declined") from exc

    inventory.commit(cart)
    order = orders.create(order_id, customer.customer_id, charge_id, breakdown.total)
    notifications.send_order_confirmation(customer, order)
    return order
