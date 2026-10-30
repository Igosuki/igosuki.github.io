# VAT and sales tax

Rates live in `shop.tax`. `vat_rate` returns the rate for the delivery country, and `tax_amount` applies it to a net
amount.

## Rules

- US orders pay the flat sales tax we collect for our home state.
- Orders to the EU are charged the VAT rate of the destination country, not ours. The reasoning is in
  [ADR 7](adr/0007-destination-vat.md).
- Everything else is untaxed at checkout; the customer pays import duties on delivery.

Destination VAT is only lawful once we are registered for the EU One Stop Shop. The registration number is read from
`SHOP_OSS_ID` in `shop.config`. When it is not set, `vat_rate` refuses to guess and raises `TaxRegistrationError`
instead of charging a wrong rate. [OSS registration](runbooks/oss-registration.md) explains how to get and deploy the
number.

## Rounding

Tax is computed on the net amount after discounts, including shipping, then rounded with `shop.money.quantize`.
