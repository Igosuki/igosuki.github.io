"""Country codes and groupings."""

EU_MEMBERS = frozenset(
    "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split()
)

_NAMES = {
    "united states": "US",
    "canada": "CA",
    "united kingdom": "GB",
    "germany": "DE",
    "france": "FR",
    "spain": "ES",
    "italy": "IT",
    "netherlands": "NL",
    "ireland": "IE",
    "sweden": "SE",
}


def normalize(country: str) -> str:
    """Accept an ISO code or an English name and return the ISO code."""
    value = country.strip()
    if len(value) == 2:
        return value.upper()
    return _NAMES[value.lower()]


def is_eu(code: str) -> bool:
    return code in EU_MEMBERS
