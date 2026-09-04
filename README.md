# signalboard

Real-time status board with the boring parts done properly.

![CI](https://github.com/brendanmcr/signalboard/actions/workflows/ci.yml/badge.svg) · 15+ tests (memory + Postgres contract) · k6 smoke in CI: p95 < 100ms enforced

- **WebSocket fan-out** — every posted signal broadcasts live to subscribed clients
- **RBAC** — viewer < poster < admin role hierarchy on every endpoint and the WS upgrade
- **Hash-chained audit log** — each mutation appends an entry committing to the previous entry's hash; `GET /api/audit/verify` re-walks the chain and reports the first break. Tampering, deletion, and reordering are all detected (there are tests that try)
- **Pluggable storage** — in-memory and Postgres adapters behind one contract; the same test suite runs against both (Postgres via service container in CI). Audit rows are stored as text on purpose: the chain commits to exact bytes, and jsonb/timestamptz round-trips could break verification of untampered history
- **Load-tested** — k6 mixed read/write scenario runs in CI with hard thresholds

## API

| Method | Path | Role |
|---|---|---|
| GET | `/healthz` | — |
| POST | `/api/keys` | admin |
| GET | `/api/channels` | viewer |
| POST | `/api/channels` | admin |
| GET | `/api/channels/:id/signals` | viewer |
| POST | `/api/channels/:id/signals` | poster |
| GET | `/api/audit` | admin |
| GET | `/api/audit/verify` | admin |
| WS | `/ws?token=…` | viewer |

## Run it

```sh
npm ci
npm test                       # memory adapter
ADMIN_KEY=dev npm start        # in-memory, port 3000

# with Postgres
export DATABASE_URL=postgres://user:pass@localhost:5432/signalboard
npm run migrate
ADMIN_KEY=dev npm start
```

Post a signal:

```sh
curl -X POST localhost:3000/api/channels -H "Authorization: Bearer dev" \
  -H "Content-Type: application/json" -d '{"name":"deploys"}'
curl -X POST localhost:3000/api/keys -H "Authorization: Bearer dev" \
  -H "Content-Type: application/json" -d '{"role":"poster"}'
```

## Status

v0.1.0 — working core (API, RBAC, WS, audit chain, both storage adapters, load test). Next: browser UI, reconnect/backoff client, public demo deploy.

## License

MIT
