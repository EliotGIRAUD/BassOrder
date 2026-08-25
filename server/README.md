# BassOrder API (self-host)

Email/password auth (Argon2id) + JWT + rotating refresh. Cloud knowledge: private mirror + aggregated pool. Google/Discord OAuth stubs (wire with client id/secret).

## Dev

```bash
cd server
# PowerShell
$env:BASSORDER_JWT_SECRET="paste-a-random-secret-of-at-least-32-characters"
# Or local only:
# $env:BASSORDER_ALLOW_INSECURE_DEV="1"
cargo run
```

Or from the repo root: `pnpm api`

Listen: `http://127.0.0.1:8787`

## Endpoints

| Method | Path | Role |
|---------|------|------|
| GET | `/health` | ping |
| POST | `/auth/register` | `{ email, password }` → tokens |
| POST | `/auth/login` | same |
| POST | `/auth/refresh` | `{ refreshToken }` |
| POST | `/auth/logout` | revoke refresh |
| GET | `/auth/me` | Bearer access |
| POST | `/auth/delete` | Bearer + `{ confirm: "DELETE", password? }` — erase account + knowledge mirror |
| GET | `/auth/oauth/:provider/start` | OAuth stub |
| PUT | `/knowledge/mirror` | Bearer — push private mirror (`profileId` + classified artists) |
| GET | `/knowledge/mirror?profileId=` | Bearer — restore your mirror |
| GET | `/knowledge/pool?keys=&limit=` | Bearer — read-only consensus (fill gaps) |

### Knowledge (V1 Mirror + Pool)

- **Mirror**: private backup per `(account_id, profileId)`. Only artists with a non-empty `parent` are stored (max 50,000).
- **Pool**: aggregates all mirrors; consensus = `(parent, sub)` with the most distinct accounts, tie-break `SUM(likes)`. Never overwrites a local classification in the app.
- Mirror body (camelCase) aligned with local Tauri knowledge.

### Phase 2 (planned)

- Materialized `knowledge_pool_cache` + periodic job
- Server-side completion for artists without `parent` (taxonomy / dictionary)
- Genre coverage stats / optional explicit votes

## Env

- `BASSORDER_JWT_SECRET` (**required**, ≥ 32 random chars; secrets like `change-me` are rejected)
- `BASSORDER_ALLOW_INSECURE_DEV=1` — allows a weak dev secret **only** on localhost
- `BASSORDER_API_ADDR` (default `127.0.0.1:8787`)
- `BASSORDER_DB` (server SQLite file)
- `BASSORDER_PUBLIC_BASE` (public URL for OAuth)
- `BASSORDER_CORS_ORIGINS` (comma-separated origins; **required** when binding outside localhost)

Rate-limit: 20 attempts / 15 min per IP (+ email) on register / login / refresh.
Client IP: `X-Real-IP` only if the peer is loopback (local Nginx).

VPS hardening: [`deploy/harden-vps.sh`](../deploy/harden-vps.sh) (UFW, fail2ban, nginx headers, SQLite backup, non-root Docker).

Docker Compose VPS: see [`deploy/`](../deploy/) (`docker-compose.yml`, Nginx, Certbot, `bootstrap.sh`).
Public prod: `https://api.bassorder.smegg.cloud`.
