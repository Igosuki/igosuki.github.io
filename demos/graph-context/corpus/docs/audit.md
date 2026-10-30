# Audit trail

`shop.audit.record` stores who did what to money or stock. Finance reads it at month end. It is separate from the
operational events in [logging](logging.md): audit entries are kept, log lines rotate.
