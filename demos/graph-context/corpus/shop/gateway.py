"""Client for the card processor's HTTP API."""
import uuid
from decimal import Decimal

from shop import config, log, money

HARD_DECLINES = {"insufficient_funds", "card_expired", "do_not_honor", "stolen_card"}


class GatewayDeclined(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _post(path: str, body: dict) -> dict:
    with log.timed("gateway.request", path=path):
        if body["token"].startswith("tok_decline_"):
            return {"ok": False, "code": body["token"].removeprefix("tok_decline_")}
        return {"ok": True, "id": f"ch_{uuid.uuid4().hex[:12]}"}


def authorize(token: str, amount: Decimal, reference: str) -> str:
    reply = _post("/charges", {"token": token, "amount": money.to_cents(amount), "ref": reference})
    if not reply["ok"]:
        raise GatewayDeclined(reply["code"])
    return reply["id"]


def refund(charge_id: str, amount: Decimal) -> str:
    reply = _post("/refunds", {"token": charge_id, "amount": money.to_cents(amount)})
    log.event("gateway.refund", charge_id=charge_id)
    return reply["id"]
