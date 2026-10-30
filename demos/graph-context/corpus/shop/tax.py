"""Sales tax and VAT."""
from decimal import Decimal

from shop import config, log, money
from shop.countries import is_eu
from shop.errors import TaxRegistrationError

DESTINATION_RATES = {
    "AT": "0.20", "BE": "0.21", "BG": "0.20", "HR": "0.25", "CY": "0.19", "CZ": "0.21",
    "DK": "0.25", "EE": "0.22", "FI": "0.255", "FR": "0.20", "DE": "0.19", "GR": "0.24",
    "HU": "0.27", "IE": "0.23", "IT": "0.22", "LV": "0.21", "LT": "0.21", "LU": "0.17",
    "MT": "0.18", "NL": "0.21", "PL": "0.23", "PT": "0.23", "RO": "0.19", "SK": "0.23",
    "SI": "0.22", "ES": "0.21", "SE": "0.25",
}

_US_SALES_TAX = Decimal("0.0725")


def vat_rate(country: str) -> Decimal:
    """Rate applied to goods delivered to `country`."""
    code = country.upper()
    if code == "US":
        return _US_SALES_TAX
    if not is_eu(code):
        return Decimal("0")
    if not config.OSS_ID:
        log.warn("tax.no_registration", country=code)
        raise TaxRegistrationError(code)
    return Decimal(DESTINATION_RATES[code])


def tax_amount(net: Decimal, country: str) -> Decimal:
    return money.quantize(net * vat_rate(country))
