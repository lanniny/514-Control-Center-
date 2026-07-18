# 514cc Control Center

Local-first control plane and operator console for 514cc.

## Run

```powershell
cd I:\514claude\514cc\apps\control-center
npm start
```

The server binds to `127.0.0.1` only and prints a URL containing an ephemeral access token. The browser stores that token in session storage; API calls without it are rejected.

Optional environment variables:

- `CONTROL_CENTER_PORT`: fixed loopback port; default `0` chooses an available port.
- `CONTROL_CENTER_DATA_DIR`: event/run/version state; default `.ai-shared/control-center` under the repository.
- `CONTROL_CENTER_OPEN=1`: request opening the browser after startup.

## Security model

- Repository sources are edited through optimistic locking, validation, backup, same-directory atomic replace, parse readback, and an append-only audit event.
- Runtime/user configuration is inventory-only in v1. Deployment remains behind the existing verified sync scripts and a separate approval.
- Secret-bearing runtime files never return raw content.
- Claude Fable plans in `plan` mode. Codex starts read-only; write-capable execution requires an approval-bearing run.
- Grok Build remains disabled until a real local CLI is installed and its protocol is verified. `grok-search-rs` is represented as an external research provider, not misreported as a coding CLI.

## API

- `GET /api/bootstrap`, `/api/health`, `/api/events` (SSE)
- `GET /api/config/sources`, `/api/config/:id`, `/api/config/:id/versions`
- `POST /api/config/:id/validate|plan|apply|rollback`
- `POST /api/router/preview`
- `GET/POST /api/runs`, `GET /api/runs/:id`, `POST /api/runs/:id/cancel`

## Tests

```powershell
npm test
npm run probe
```

The test suite does not call paid model endpoints. Native Claude/Codex/Gemini/Pi conversation smoke tests are opt-in and must be run with an explicit budget/approval outside unit tests.
