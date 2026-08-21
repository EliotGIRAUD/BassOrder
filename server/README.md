# BassOrder API (self-host)

Auth email/mdp (Argon2id) + JWT + refresh rotatif. Knowledge cloud : miroir privé + pool agrégé. OAuth Google/Discord en stub (à brancher avec client id/secret).

## Dev

```bash
cd server
# PowerShell
$env:BASSORDER_JWT_SECRET="coller-ici-un-secret-aleatoire-d-au-moins-32-caracteres"
# Ou uniquement en local :
# $env:BASSORDER_ALLOW_INSECURE_DEV="1"
cargo run
```

Ou depuis la racine : `pnpm api`

Écoute : `http://127.0.0.1:8787`

## Endpoints

| Méthode | Path | Rôle |
|---------|------|------|
| GET | `/health` | ping |
| POST | `/auth/register` | `{ email, password }` → tokens |
| POST | `/auth/login` | idem |
| POST | `/auth/refresh` | `{ refreshToken }` |
| POST | `/auth/logout` | révoque refresh |
| GET | `/auth/me` | Bearer access |
| GET | `/auth/oauth/:provider/start` | stub OAuth |
| PUT | `/knowledge/mirror` | Bearer — push miroir privé (`profileId` + artistes classés) |
| GET | `/knowledge/mirror?profileId=` | Bearer — restaure son miroir |
| GET | `/knowledge/pool?keys=&limit=` | Bearer — consensus lecture seule (combler les trous) |

### Knowledge (V1 Miroir + Pool)

- **Miroir** : backup privé par `(account_id, profileId)`. Seuls les artistes avec `parent` non vide sont stockés (max 50 000).
- **Pool** : agrège tous les miroirs ; consensus = `(parent, sub)` avec le plus de comptes distincts, tie-break `SUM(likes)`. N’écrase jamais un classement local côté app.
- Body miroir (camelCase) aligné sur la knowledge locale Tauri.

### Phase 2 (prévue)

- Cache matérialisé `knowledge_pool_cache` + job périodique
- Complétion serveur des artistes sans `parent` (taxonomie / dico)
- Stats couverture genres / éventuels votes explicites

## Env

- `BASSORDER_JWT_SECRET` (**obligatoire**, ≥ 32 chars aléatoires ; secrets type `change-me` refusés)
- `BASSORDER_ALLOW_INSECURE_DEV=1` — autorise un secret de dév faible **uniquement** en local
- `BASSORDER_API_ADDR` (défaut `127.0.0.1:8787`)
- `BASSORDER_DB` (fichier SQLite serveur)
- `BASSORDER_PUBLIC_BASE` (URL publique pour OAuth)
- `BASSORDER_CORS_ORIGINS` (origines séparées par des virgules ; **obligatoire** si bind hors localhost)

Rate-limit : 20 tentatives / 15 min par IP (+ email) sur register / login / refresh.
IP client : `X-Real-IP` uniquement si le peer est loopback (Nginx local).

Durcissement VPS : [`deploy/harden-vps.sh`](../deploy/harden-vps.sh) (UFW, fail2ban, headers nginx, backup SQLite, Docker non-root).

Docker Compose VPS : voir [`deploy/`](../deploy/) (`docker-compose.yml`, Nginx, Certbot, `bootstrap.sh`).
Prod publique : `https://api.bassorder.smegg.cloud`.
