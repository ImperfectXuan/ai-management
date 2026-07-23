---
id: 06-error-handling
title: Error Handling and Logging
scope: all
---

# Error Handling and Logging

How to handle failures and record what happened. Good error handling turns outages into five-second investigations.

## Error Handling

### Fail Fast

- Validate inputs at system boundaries (API handlers, CLI entry points, message consumers)
- Reject invalid input immediately with a clear, actionable error message
- A startup-time crash with a useful message is better than undefined behavior in production

### Error Messages

Every error message should answer three questions:
1. **What** operation failed?
2. **What** input or state caused the failure?
3. **What** was expected instead?

✅ `UserService.createUser: email 'x@y' already exists — expected unique email`
❌ `Error: duplicate key`

### Don't Swallow Errors

- Every catch / except / rescue block must either handle the error or re-raise it
- An empty catch block is a bug — it hides failures and makes debugging near-impossible
- If you intentionally suppress an error, add a comment explaining why

### Custom Error Types

- Define a project-level base error type
- Add specific subtypes for common failure categories: `ValidationError`, `NotFoundError`, `AuthenticationError`, `ExternalServiceError`
- Attach a machine-readable error code that clients can switch on
- Include a human-readable message that a support engineer can act on

### Error Boundaries

- At module boundaries, wrap third-party errors in your own types
- Callers should not need to know that your database driver throws `PgConnectionError` — they should see `StorageUnavailableError`
- This keeps the blast radius of dependency changes small

## Logging

### Log Levels

- **DEBUG**: internal state useful during development. Noise in production — disable by default
- **INFO**: key business events. "User logged in", "Order placed", "Payment processed". Use sparingly — one or two per significant operation
- **WARN**: recoverable anomalies. "Retry #3 succeeded", "Cache miss, falling back to primary store", "Deprecated endpoint called"
- **ERROR**: something is broken and needs human attention. Include enough context to start investigating without re-running with debug logging

### What to Log, What NOT to Log

Always log:
- Unhandled exceptions — with full stack trace
- Failed external calls — include service name, endpoint, latency, and response status
- Security-relevant events: authentication failures, permission denials, rate limit hits

Never log:
- Passwords, tokens, API keys, session IDs (even hashed)
- Personal data: email addresses, phone numbers, identity numbers, credit card data
- Full request/response bodies unless explicitly in a debug mode with access controls

### Structured Logging

- Use key=value pairs or structured JSON: `userId=42 action=login status=success latencyMs=12`
- This makes logs searchable and aggregatable
- Include a correlation / trace ID in every log entry so you can follow a request across services
- Timestamps in UTC, ISO 8601 format
