"""Card payments on top of the gateway."""
import time
from decimal import Decimal

from shop import config, gateway, log
from shop.errors import PaymentDeclined


def charge_card(token: str, amount: Decimal, reference: str) -> str:
    """Charge a card token and return the charge id."""
    for attempt in range(config.MAX_PAYMENT_RETRIES):
        try:
            charge_id = gateway.authorize(token, amount, reference)
        except gateway.GatewayDeclined as exc:
            if exc.code in gateway.HARD_DECLINES:
                log.event("payment.declined", code=exc.code, reference=reference)
                raise PaymentDeclined(exc.code) from exc
            log.warn("payment.retry", code=exc.code, attempt=attempt + 1)
            time.sleep(config.RETRY_BACKOFF_S[attempt])
        else:
            log.event("payment.charged", charge_id=charge_id, reference=reference)
            return charge_id
    raise PaymentDeclined("processing_error", retryable=True)


def refund_charge(charge_id: str, amount: Decimal) -> str:
    return gateway.refund(charge_id, amount)
