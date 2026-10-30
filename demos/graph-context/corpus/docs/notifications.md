# Notifications

Emails are rendered from `shop.templates` and sent with `shop.notifications.send_email`.

Order confirmations and payment failures go to the customer only. Refunds have a recipient list built by
`refund_recipients`; the rules are in code so they can be tested. Finance's threshold is `FINANCE_REFUND_LIMIT` in
`shop.config`. Customers can opt out of refund emails on their profile.

See [refunds](refunds.md) for the workflow that triggers them.
