"""Shopping cart."""
from dataclasses import dataclass, field

from shop import catalog, log


@dataclass
class CartItem:
    sku: str
    quantity: int


@dataclass
class Cart:
    cart_id: str
    items: list[CartItem] = field(default_factory=list)
    coupon: str | None = None

    def add(self, sku: str, quantity: int = 1) -> None:
        catalog.get_product(sku)
        for item in self.items:
            if item.sku == sku:
                item.quantity += quantity
                break
        else:
            self.items.append(CartItem(sku, quantity))
        log.event("cart.add", cart_id=self.cart_id, sku=sku, quantity=quantity)

    def remove(self, sku: str) -> None:
        self.items = [item for item in self.items if item.sku != sku]
        log.event("cart.remove", cart_id=self.cart_id, sku=sku)

    def weight_g(self) -> int:
        return sum(catalog.get_product(i.sku).weight_g * i.quantity for i in self.items)

    def is_empty(self) -> bool:
        return not self.items
