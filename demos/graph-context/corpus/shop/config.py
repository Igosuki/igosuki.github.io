"""Settings read from the environment once at import."""
import os
from decimal import Decimal

CURRENCY = "USD"
STORE_COUNTRY = "US"

OSS_ID = os.environ.get("SHOP_OSS_ID", "")

GATEWAY_URL = os.environ.get("SHOP_GATEWAY_URL", "https://pay.example.test/v2")
GATEWAY_KEY = os.environ.get("SHOP_GATEWAY_KEY", "")
GATEWAY_TIMEOUT_S = 8

MAX_PAYMENT_RETRIES = 3
RETRY_BACKOFF_S = (0.5, 2.0, 5.0)

RESERVATION_MINUTES = 15
FREE_SHIPPING_OVER = Decimal("75.00")
FRAUD_REVIEW_SCORE = 0.8

FINANCE_REFUND_LIMIT = Decimal("250.00")
SUPPORT_ADDRESS = "support@shop.example.test"
FINANCE_ADDRESS = "finance@shop.example.test"
OPS_WEBHOOK = os.environ.get("SHOP_OPS_WEBHOOK", "")
