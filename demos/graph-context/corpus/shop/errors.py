"""Exceptions raised across the shop."""


class ShopError(Exception):
    pass


class PricingError(ShopError):
    pass


class TaxRegistrationError(PricingError):
    def __init__(self, country: str):
        super().__init__(f"no tax registration for {country}")
        self.country = country


class OutOfStock(ShopError):
    def __init__(self, sku: str):
        super().__init__(f"{sku} is out of stock")
        self.sku = sku


class PaymentDeclined(ShopError):
    def __init__(self, code: str, retryable: bool = False):
        super().__init__(f"payment declined: {code}")
        self.code = code
        self.retryable = retryable


class CheckoutFailed(ShopError):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class RefundNotAllowed(ShopError):
    pass
