# Logging

All modules log through `shop.log`: `event` for normal records, `warn` for things worth a look, and `timed` around
anything slow. Fields are JSON so the aggregator can index them. Do not log card tokens or full email bodies.

Search the aggregator by `event` name, for example `checkout.pricing_failed` or `payment.declined`.
