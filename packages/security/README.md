# @a-eyes/security

Reusable security primitives for MCP servers, extracted from [A-Eyes](https://github.com/florian-priegnitz/A-Eyes).

**Status:** internal workspace package, not yet published to npm. Structurally publishable; flip `private: true` when API stabilizes.

## Exports

- `RateLimiter` — sliding-window per-minute limiter with reservation support
- `writeAuditEntry`, `getAuditLogPath`, types `AuditEntry`, `SignedAuditEntry` — tamper-resistant JSONL audit log with HMAC chaining
- `signEntry`, `computeHmac`, `getAuditKey`, `GENESIS_HASH`, type `SignedFields` — HMAC-SHA256 signing primitives
- `verifyLogs`, `verifyLogFile`, type `VerifyResult` — verify the HMAC chain integrity of audit logs

Symbols prefixed with `_` (e.g. `_resetKeyCache`, `_resetAuditCache`) are test-only helpers and may change without notice.

## Side effects

The audit-log module reads/writes:

- `~/.a-eyes/audit.key` — HMAC key, created on first use with mode `0600`
- `~/.a-eyes/logs/<YYYY-MM-DD>.jsonl` — daily-rotated audit log

These paths are not yet configurable; consumers will inherit them.

## Roadmap

Upcoming additions in the A-Eyes #26 migration:

- Policy types + `isWindowAllowed` (deny-by-default allowlist)
- Content redaction (`applyRedactions`, `findMatchingRules`)
