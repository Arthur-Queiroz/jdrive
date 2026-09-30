# Observability

## MVP Scope

No dedicated logging, monitoring, tracing, or metrics stack is required.

Do not introduce:

- Prometheus
- Grafana
- Loki
- OpenTelemetry
- Centralized log storage

## Basic Runtime Output

The application framework may retain minimal standard runtime output for:

- Startup
- Fatal errors
- Database migration failure
- Port binding failure

Avoid verbose request logging by default.

## Health Check

A lightweight health endpoint is recommended:

```text
GET /health
```

Suggested response:

```json
{
  "status": "ok"
}
```

Optionally include database connectivity if this remains lightweight.

The health endpoint must not expose secrets or sensitive system information.
