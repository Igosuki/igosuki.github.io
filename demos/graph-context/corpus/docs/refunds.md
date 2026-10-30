# Refunds

`shop.refunds.issue_refund` returns money through the gateway, updates the order with `shop.orders.mark_refunded`,
writes an audit entry and then tells the people who need to know. Who that is lives in
[notifications](notifications.md).

Partial refunds are allowed up to the amount still refundable on the order. A refund never changes stock.
