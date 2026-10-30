# OSS registration

1. Finance registers the company for the non-Union OSS and receives an identification number.
2. Put the number in the deploy environment as `SHOP_OSS_ID`. `shop.config` reads it at import, so restart the
   service after changing it.
3. Check `shop.tax.vat_rate("DE")` in a shell; it should return `0.19`.

Rates are reviewed each January. Quarterly returns are due by the end of the month after each quarter.
