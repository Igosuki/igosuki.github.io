# Declined payments

When a payment is declined during checkout:

- The stock reserved for the cart is put back with `shop.inventory.release`. Reservations that are never released
  expire after `RESERVATION_MINUTES`; `expire_stale` sweeps them.
- The customer gets the `payment_failed` email from `shop.notifications.send_payment_failed`. It contains the decline
  code and says nothing was charged.
- An `audit` entry records the code. See [audit](audit.md) for what the trail is for.

Support should not ask customers to retry a `stolen_card` decline.
