# BassOrder deployment (VPS)

Target: `185.98.137.102` / domain `smegg.cloud` (without touching the main SMEGG site).

## DNS

Create two A records:

| Host | Type | Value |
|------|------|--------|
| `bassorder` | A | `185.98.137.102` |
| `api.bassorder` | A | `185.98.137.102` |

(at the registrar / DNS panel for `smegg.cloud`)

## Bootstrap

On the VPS (root), after a GitHub push:

```bash
curl -fsSL https://raw.githubusercontent.com/EliotGIRAUD/BassOrder/main/deploy/bootstrap.sh | bash
# or:
git clone https://github.com/EliotGIRAUD/BassOrder.git /opt/bassorder
bash /opt/bassorder/deploy/bootstrap.sh
```

Then upload the Windows installer to `/var/www/bassorder/downloads/`.

## Files

- `docker-compose.yml` — Rust API + SQLite volume (non-root, caps drop)
- `nginx/*.conf` — vhosts (+ header / rate-limit snippets)
- `harden-vps.sh` — firewall, fail2ban, SSH, nginx hardening, backups
- `harden-localhost-binds.sh` — MySQL + SMEGG (PM2) on 127.0.0.1 only
- `backup-sqlite.sh` — daily SQLite volume dump
- `pull-backups.ps1` — pull backups onto your PC (off VPS)
- `landing/` — download page
- `.env.example` — JWT secret template

After an existing deployment:

```bash
cd /opt/bassorder && git pull
bash deploy/harden-vps.sh
```

Backups on your PC (PowerShell):

```powershell
.\deploy\pull-backups.ps1
```
