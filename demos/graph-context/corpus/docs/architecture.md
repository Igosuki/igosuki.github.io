# Shop architecture

The shop is one Python package, `shop`, with no framework. A request handler builds a `Cart` and a `Customer` and
calls `shop.checkout.place_order`.

## Layers

- Pricing: `shop.pricing.total` combines the catalog, `shop.discounts`, `shop.shipping` and `shop.tax`.
  See [VAT](vat.md) for the tax rules.
- Payments: `shop.payments.charge_card` wraps the processor client in `shop.gateway`.
  See [payments](payments.md).
- Fulfilment: `shop.inventory` holds stock while a payment is in flight.
- After the sale: `shop.refunds` and `shop.notifications`. See [refunds](refunds.md) and
  [notifications](notifications.md).

Every module writes structured events through `shop.log`; see [logging](logging.md).

## Money

Amounts are `Decimal` and rounded half-up to cents by `shop.money.quantize`. Never use floats for amounts.
