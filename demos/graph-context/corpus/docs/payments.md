# Payments

`shop.payments.charge_card` authorizes a card token through `shop.gateway.authorize`.

## Declines

The processor returns a code with each decline. Codes in `HARD_DECLINES` (insufficient funds, expired card, do not
honor, stolen card) end the attempt at once: `charge_card` raises `PaymentDeclined`. Anything else is treated as
transient and retried up to `MAX_PAYMENT_RETRIES` times with the backoff in `shop.config`.

What the customer and the stock do after a decline is handled by `shop.checkout.place_order`; see
[declined payments](runbooks/declined-payments.md).

## Testing

Tokens that start with `tok_decline_` make the gateway stub return that decline code.
