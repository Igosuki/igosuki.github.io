# ADR 7: Charge destination VAT through the OSS

Status: accepted

## Context

Since July 2021 a seller outside the EU has to charge VAT at the buyer's national rate on consumer orders. The
alternative to the One Stop Shop is registering for VAT in each member state we ship to.

## Decision

Register once for the non-Union OSS and charge the destination rate in `shop.tax.vat_rate`. The rate table is
`DESTINATION_RATES`. Quarterly returns go to finance; see [VAT](../vat.md).

## Consequences

- Pricing depends on an OSS number being configured. We prefer a loud failure to a silently wrong rate.
- Rate changes are a code change to the table, reviewed by finance.
