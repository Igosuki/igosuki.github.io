"""Customer records and contact preferences."""
from dataclasses import dataclass, field

from shop import countries, log


@dataclass
class Customer:
    customer_id: str
    email: str
    country: str
    vat_id: str | None = None
    refund_emails: bool = True
    marketing_emails: bool = False
    tags: list[str] = field(default_factory=list)


_CUSTOMERS: dict[str, Customer] = {}


def register(customer_id: str, email: str, country: str) -> Customer:
    customer = Customer(customer_id, email, countries.normalize(country))
    _CUSTOMERS[customer_id] = customer
    log.event("customer.registered", customer_id=customer_id, country=customer.country)
    return customer


def get(customer_id: str) -> Customer:
    return _CUSTOMERS[customer_id]
