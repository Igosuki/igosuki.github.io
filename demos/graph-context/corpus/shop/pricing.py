"""Order totals."""
from dataclasses import dataclass
from decimal import Decimal

from shop import catalog, discounts, log, money, shipping, tax
from shop.cart import Cart
from shop.customers import Customer


@dataclass
class Breakdown:
    subtotal: Decimal
    discount: Decimal
    shipping: Decimal
    tax: Decimal
    total: Decimal


def subtotal(cart: Cart) -> Decimal:
    return money.quantize(
        sum((catalog.get_product(i.sku).price * i.quantity for i in cart.items), Decimal("0"))
    )


def total(cart: Cart, customer: Customer) -> Breakdown:
    """Price a cart for a customer, including shipping and tax."""
    sub = subtotal(cart)
    off = discounts.discount_for(cart.coupon, sub)
    ship = shipping.quote(cart.weight_g(), customer.country, sub - off)
    taxed = tax.tax_amount(sub - off + ship, customer.country)
    result = Breakdown(sub, off, ship, taxed, sub - off + ship + taxed)
    log.event("pricing.total", cart_id=cart.cart_id, total=result.total)
    return result
